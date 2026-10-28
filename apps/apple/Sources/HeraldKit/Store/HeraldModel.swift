import Foundation
import Observation
import UserNotifications

#if os(macOS)
import AppKit
#elseif canImport(UIKit)
import UIKit
#endif

/// Opens a URL with the system handler.
@MainActor
public func heraldOpenURL(_ url: URL) {
    #if os(macOS)
    NSWorkspace.shared.open(url)
    #elseif canImport(UIKit)
    UIApplication.shared.open(url)
    #endif
}

/// App-wide coordinator: credentials, REST client, WebSocket, inbox store and notification presenter.
@MainActor
@Observable
public final class HeraldModel {
    public struct Configuration: Sendable {
        public var platform: Platform
        public var deviceName: String
        public var storageDirectory: URL
        /// Whether to post system notifications (false in tests / unbundled runs).
        public var enableSystemNotifications: Bool

        public init(
            platform: Platform = .current, deviceName: String, storageDirectory: URL = HeraldPaths.applicationSupport(),
            enableSystemNotifications: Bool = true
        ) {
            self.platform = platform
            self.deviceName = deviceName
            self.storageDirectory = storageDirectory
            self.enableSystemNotifications = enableSystemNotifications
        }
    }

    public let configuration: Configuration
    public let store: InboxStore
    @ObservationIgnored public let presenter: NotificationPresenter?

    public private(set) var credentials: Credentials?
    public private(set) var connectionState: ConnectionState = .disconnected
    /// The server rejected our token (device revoked). The UI offers to pair again.
    public private(set) var needsRepair = false
    public private(set) var notificationAuthorization: UNAuthorizationStatus = .notDetermined

    /// A pairing deep link waiting for the user's confirmation.
    public var pendingPairLink: Pairing.Link?
    /// Notification to show in the inbox (set when the user taps a system notification).
    public var selectedNotificationID: String?
    /// Incremented when something wants the inbox window shown (macOS opens its window when this changes).
    public private(set) var inboxRequest = 0
    /// Bumped by `herald://settings`; the menu-bar label opens the Settings window.
    public var settingsRequest = 0
    /// Incremented when a pairing link arrives (macOS shows the pairing UI).
    public private(set) var pairingRequest = 0

    @ObservationIgnored private let credentialStore: CredentialStore
    @ObservationIgnored private var socket: HeraldSocket?
    @ObservationIgnored private var started = false
    @ObservationIgnored public var openURL: (URL) -> Void = { url in heraldOpenURL(url) }

    public init(configuration: Configuration) {
        self.configuration = configuration
        self.credentialStore = CredentialStore(directory: configuration.storageDirectory)
        self.store = InboxStore(cacheURL: configuration.storageDirectory.appendingPathComponent("inbox-cache.json"))
        self.presenter = configuration.enableSystemNotifications ? NotificationPresenter() : nil
        self.credentials = credentialStore.load()

        store.sink = presenter
        // The API must be usable before `start()`: a notification action can launch the app in the background.
        store.api = credentials.map { HeraldAPI(baseURL: $0.serverURL, token: $0.token) }
        store.deviceId = credentials?.deviceId
        store.openURL = { [weak self] url in self?.openURL(url) }
        store.onUnauthorized = { [weak self] in self?.needsRepair = true }
        presenter?.onResponse = { [weak self] info in await self?.handleNotificationResponse(info) }
        presenter?.activate()
    }

    public var isPaired: Bool { credentials != nil }
    public var api: HeraldAPI? { credentials.map { HeraldAPI(baseURL: $0.serverURL, token: $0.token) } }

    // MARK: Lifecycle

    /// Loads the cache and, if paired, configures the API (does not connect the socket; see `connect()`).
    public func start() {
        guard !started else { return }
        started = true
        store.loadCache()
        configureClients()
        Task { await refreshNotificationAuthorization() }
    }

    /// Connects the WebSocket (if paired) and refreshes the first page over REST.
    public func connect() {
        guard isPaired else { return }
        if socket == nil { configureClients() }
        socket?.start()
        Task { await store.refresh() }
    }

    /// Closes the WebSocket (iOS background).
    public func disconnect() {
        socket?.stop()
    }

    /// Reconnect now (manual retry / foreground).
    public func reconnect() {
        guard isPaired else { return }
        if socket == nil { configureClients() }
        socket?.start()
        socket?.reconnectNow()
    }

    private func configureClients() {
        socket?.stop()
        socket = nil
        guard let credentials else {
            store.api = nil
            connectionState = .disconnected
            return
        }
        store.api = HeraldAPI(baseURL: credentials.serverURL, token: credentials.token)
        store.deviceId = credentials.deviceId
        let socket = HeraldSocket(baseURL: credentials.serverURL, token: credentials.token)
        socket.cursorProvider = { [weak self] in self?.store.syncState.cursor }
        socket.onMessage = { [weak self, weak socket] message in
            guard let self else { return }
            if let followUp = self.store.apply(message) { socket?.send(followUp) }
        }
        socket.onStateChange = { [weak self] state in
            self?.connectionState = state
            if state == .unauthorized { self?.needsRepair = true }
            if state == .connected { self?.needsRepair = false }
        }
        self.socket = socket
    }

    // MARK: Pairing

    /// Pairs with a server using a code (`XXXX-XXXX`, dash optional, case-insensitive).
    public func pair(server: String, code: String) async throws {
        guard let serverURL = Pairing.normalizeServerURL(server) else {
            throw HeraldAPIError.invalidURL(server)
        }
        guard let normalizedCode = Pairing.normalizeCode(code) else {
            throw HeraldAPIError.server(
                status: 400, code: .badRequest, message: "Enter the 8-character code shown on the web (XXXX-XXXX).")
        }
        let api = HeraldAPI(baseURL: serverURL, token: nil)
        let result = try await api.pair(
            code: normalizedCode, name: configuration.deviceName, platform: configuration.platform)

        // Replacing an existing pairing: drop the old state first.
        if let old = self.api, credentials?.serverURL != serverURL || credentials?.token != result.token {
            Task.detached { try? await old.unpairSelf() }
            resetLocalState()
        }
        let credentials = Credentials(
            serverURL: serverURL, token: result.token, deviceId: result.device.id, deviceName: result.device.name,
            userId: result.user.id, userEmail: result.user.email, userName: result.user.name)
        try credentialStore.save(credentials)
        self.credentials = credentials
        needsRepair = false
        pendingPairLink = nil
        configureClients()
        connect()
        if let presenter { _ = await presenter.requestAuthorization() }
        await refreshNotificationAuthorization()
    }

    /// Unpairs this device on the server (best effort) and forgets the credentials locally.
    public func unpair() async {
        if let api { try? await api.unpairSelf() }
        resetLocalState()
    }

    private func resetLocalState() {
        socket?.stop()
        socket = nil
        let ids = store.notifications.map(\.id)
        presenter?.remove(ids: ids)
        store.reset()
        store.api = nil
        store.deviceId = nil
        credentialStore.clear()
        credentials = nil
        connectionState = .disconnected
        needsRepair = false
    }

    // MARK: URLs

    /// Handles `herald://pair?server=…&code=…` (prefills pairing; the user confirms) and `herald://inbox`.
    @discardableResult
    public func handleOpenURL(_ url: URL) -> Bool {
        if let link = Pairing.parseLink(url) {
            pendingPairLink = link
            pairingRequest += 1
            return true
        }
        if url.scheme?.lowercased() == "herald", url.host()?.lowercased() == "settings" {
            settingsRequest += 1
            return true
        }
        if url.scheme?.lowercased() == "herald" {
            if let id = URLComponents(url: url, resolvingAgainstBaseURL: false)?
                .queryItems?.first(where: { $0.name == "id" })?.value
            {
                selectedNotificationID = id
            }
            inboxRequest += 1
            return true
        }
        return false
    }

    public func requestInbox(select id: String? = nil) {
        if let id { selectedNotificationID = id }
        inboxRequest += 1
    }

    // MARK: Notifications

    public func requestNotificationPermission() async {
        if let presenter { _ = await presenter.requestAuthorization() }
        await refreshNotificationAuthorization()
    }

    public func refreshNotificationAuthorization() async {
        guard let presenter else { return }
        notificationAuthorization = await presenter.authorizationStatus()
    }

    func handleNotificationResponse(_ info: NotificationResponseInfo) async {
        switch info.kind {
        case .open:
            if let url = info.url {
                openURL(url)
            } else {
                requestInbox(select: info.notificationId)
            }
            await store.markRead(info.notificationId)
        case .action(let actionId, let url):
            if let url {
                openURL(url)
            } else {
                await store.respond(id: info.notificationId, actionId: actionId, text: nil)
            }
        case .reply(let text):
            let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty else { return }
            await store.respond(id: info.notificationId, actionId: nil, text: String(trimmed.prefix(2000)))
        case .dismiss:
            break
        }
    }
}
