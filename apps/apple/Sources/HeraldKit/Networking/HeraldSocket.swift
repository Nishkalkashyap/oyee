import Foundation
import Network

#if os(macOS)
import AppKit
#endif

/// Connection state of the WebSocket delivery transport.
public enum ConnectionState: Sendable, Equatable {
    case disconnected
    case connecting
    case connected
    /// Waiting before the next reconnect attempt.
    case waiting(retryAt: Date)
    /// No network path; reconnects as soon as one appears.
    case offline
    /// The server rejected the device token (revoked / unpaired). No automatic retries.
    case unauthorized

    public var isConnected: Bool { self == .connected }

    public var label: String {
        switch self {
        case .disconnected: "Disconnected"
        case .connecting: "Connecting…"
        case .connected: "Connected"
        case .waiting: "Reconnecting…"
        case .offline: "Offline"
        case .unauthorized: "Device unpaired"
        }
    }
}

/// `URLSessionWebSocketTask` client for `GET /api/ws` (protocol §6).
///
/// - Authenticates with `Authorization: Bearer` and `?token=`.
/// - On `hello`, sends `sync` with the cursor from `cursorProvider`.
/// - Sends `ping` every 30 s; reconnects if no `pong` (or any frame) arrives for 75 s.
/// - Reconnects with exponential backoff + jitter (1 s → 60 s), immediately on network path changes, and on wake
///   from sleep (macOS).
@MainActor
public final class HeraldSocket {
    public static let pingInterval: TimeInterval = 30
    public static let staleTimeout: TimeInterval = 75

    public private(set) var state: ConnectionState = .disconnected {
        didSet { if state != oldValue { onStateChange?(state) } }
    }

    /// Called for every decoded server message (including `hello`, excluding `pong`).
    public var onMessage: ((ServerMessage) -> Void)?
    public var onStateChange: ((ConnectionState) -> Void)?
    /// Returns the cursor to send in `sync` after each (re)connect.
    public var cursorProvider: () -> String? = { nil }

    private let baseURL: URL
    private let token: String
    private let session: URLSession

    private var task: URLSessionWebSocketTask?
    private var generation = 0
    private var receiveTask: Task<Void, Never>?
    private var pingTask: Task<Void, Never>?
    private var reconnectTask: Task<Void, Never>?
    private var backoff = Backoff()
    private var wantsConnection = false
    private var isSleeping = false
    private var lastFrameAt = Date()

    private var pathMonitor: NWPathMonitor?
    private var networkAvailable = true
    private var lastPathSignature: String?
    private var observers: [NSObjectProtocol] = []

    public init(baseURL: URL, token: String) {
        self.baseURL = baseURL
        self.token = token
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 90
        config.waitsForConnectivity = false
        config.httpAdditionalHeaders = ["User-Agent": "Herald-Apple/\(HeraldKitInfo.version)"]
        self.session = URLSession(configuration: config)
    }

    /// `ws(s)://host/api/ws?token=…` derived from the server's http(s) URL.
    public nonisolated static func webSocketURL(baseURL: URL, token: String) -> URL? {
        let api = HeraldAPI(baseURL: baseURL, token: token)
        guard let httpURL = try? api.url(for: "/api/ws", query: [URLQueryItem(name: "token", value: token)]),
              var components = URLComponents(url: httpURL, resolvingAgainstBaseURL: false)
        else { return nil }
        switch components.scheme?.lowercased() {
        case "https": components.scheme = "wss"
        case "http": components.scheme = "ws"
        case "wss", "ws": break
        default: return nil
        }
        return components.url
    }

    // MARK: - Lifecycle

    /// Starts (and keeps) the connection alive until `stop()`.
    public func start() {
        guard !wantsConnection else {
            if state != .connected && state != .connecting { reconnectNow() }
            return
        }
        wantsConnection = true
        startPathMonitor()
        startSystemObservers()
        connect()
    }

    /// Closes the connection and stops reconnecting.
    public func stop() {
        wantsConnection = false
        teardown()
        pathMonitor?.cancel()
        pathMonitor = nil
        lastPathSignature = nil
        for observer in observers {
            #if os(macOS)
            NSWorkspace.shared.notificationCenter.removeObserver(observer)
            #endif
        }
        observers.removeAll()
        state = .disconnected
    }

    /// Reconnects immediately, resetting the backoff (network change, wake, foreground, manual retry).
    public func reconnectNow() {
        guard wantsConnection, !isSleeping else { return }
        backoff.reset()
        connect()
    }

    /// Sends a client message if connected.
    public func send(_ message: ClientMessage) {
        guard let task, let text = try? message.jsonString() else { return }
        let gen = generation
        Task { [weak self] in
            do {
                try await task.send(.string(text))
            } catch {
                self?.handleFailure(generation: gen, error: error)
            }
        }
    }

    // MARK: - Connection

    private func connect() {
        teardown()
        guard wantsConnection, !isSleeping else { return }
        guard let url = Self.webSocketURL(baseURL: baseURL, token: token) else {
            state = .disconnected
            return
        }
        generation += 1
        let gen = generation
        var request = URLRequest(url: url)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.timeoutInterval = 30
        let task = session.webSocketTask(with: request)
        task.maximumMessageSize = 16 * 1024 * 1024
        self.task = task
        state = .connecting
        lastFrameAt = Date()
        task.resume()
        receiveTask = Task { [weak self] in
            await self?.receiveLoop(task: task, generation: gen)
        }
    }

    private func teardown() {
        generation += 1
        receiveTask?.cancel()
        receiveTask = nil
        pingTask?.cancel()
        pingTask = nil
        reconnectTask?.cancel()
        reconnectTask = nil
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
    }

    private func receiveLoop(task: URLSessionWebSocketTask, generation gen: Int) async {
        while !Task.isCancelled {
            do {
                let message = try await task.receive()
                guard gen == generation else { return }
                lastFrameAt = Date()
                switch message {
                case .string(let text):
                    handle(text: text)
                case .data(let data):
                    handle(text: String(decoding: data, as: UTF8.self))
                @unknown default:
                    break
                }
            } catch {
                guard gen == generation else { return }
                handleFailure(generation: gen, error: error, response: task.response)
                return
            }
        }
    }

    private func handle(text: String) {
        let message: ServerMessage
        do {
            message = try ServerMessage.decode(text)
        } catch {
            return  // Ignore malformed frames.
        }
        switch message {
        case .hello:
            state = .connected
            backoff.reset()
            startPingLoop()
            send(.sync(since: cursorProvider()))
            onMessage?(message)
        case .pong:
            break
        default:
            onMessage?(message)
        }
    }

    private func startPingLoop() {
        pingTask?.cancel()
        let gen = generation
        pingTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(HeraldSocket.pingInterval))
                guard !Task.isCancelled, let self, gen == self.generation else { return }
                if Date().timeIntervalSince(self.lastFrameAt) > HeraldSocket.staleTimeout {
                    self.handleFailure(generation: gen, error: URLError(.timedOut))
                    return
                }
                self.send(.ping)
            }
        }
    }

    private func handleFailure(generation gen: Int, error: Error, response: URLResponse? = nil) {
        guard gen == generation else { return }
        teardown()
        if let http = response as? HTTPURLResponse, http.statusCode == 401 || http.statusCode == 403 {
            state = .unauthorized
            return
        }
        scheduleReconnect()
    }

    private func scheduleReconnect() {
        guard wantsConnection, !isSleeping else {
            state = .disconnected
            return
        }
        guard networkAvailable else {
            state = .offline
            return
        }
        let delay = backoff.nextDelay()
        state = .waiting(retryAt: Date().addingTimeInterval(delay))
        reconnectTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(delay))
            guard !Task.isCancelled else { return }
            self?.connect()
        }
    }

    // MARK: - Network path & sleep/wake

    private func startPathMonitor() {
        guard pathMonitor == nil else { return }
        let monitor = NWPathMonitor()
        monitor.pathUpdateHandler = { [weak self] path in
            let available = path.status == .satisfied
            let signature = "\(available)|" + path.availableInterfaces.map(\.name).joined(separator: ",")
            Task { @MainActor [weak self] in
                self?.networkChanged(available: available, signature: signature)
            }
        }
        monitor.start(queue: DispatchQueue(label: "dev.herald.path-monitor"))
        pathMonitor = monitor
    }

    private func networkChanged(available: Bool, signature: String) {
        let previous = lastPathSignature
        lastPathSignature = signature
        networkAvailable = available
        guard wantsConnection else { return }
        guard available else {
            if case .waiting = state {
                reconnectTask?.cancel()
                state = .offline
            }
            return
        }
        // The first callback just reports the current path.
        guard let previous, previous != signature else {
            if state == .offline { reconnectNow() }
            return
        }
        reconnectNow()
    }

    private func startSystemObservers() {
        #if os(macOS)
        guard observers.isEmpty else { return }
        let center = NSWorkspace.shared.notificationCenter
        observers.append(
            center.addObserver(forName: NSWorkspace.willSleepNotification, object: nil, queue: .main) { [weak self] _ in
                Task { @MainActor [weak self] in self?.systemWillSleep() }
            })
        observers.append(
            center.addObserver(forName: NSWorkspace.didWakeNotification, object: nil, queue: .main) { [weak self] _ in
                Task { @MainActor [weak self] in self?.systemDidWake() }
            })
        #endif
    }

    private func systemWillSleep() {
        isSleeping = true
        teardown()
        state = .disconnected
    }

    private func systemDidWake() {
        isSleeping = false
        guard wantsConnection else { return }
        reconnectNow()
    }
}
