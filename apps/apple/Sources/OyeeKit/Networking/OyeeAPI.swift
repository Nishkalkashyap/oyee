import Foundation

/// Errors returned by `OyeeAPI`.
public enum OyeeAPIError: Error, Sendable, Equatable, LocalizedError {
    /// The server returned an error envelope `{ "error": { code, message } }`.
    case server(status: Int, code: ErrorCode, message: String)
    /// Non-2xx without a parseable error envelope.
    case http(status: Int, body: String)
    /// Network-level failure (offline, DNS, TLS, timeout, …).
    case transport(String)
    /// The response body didn't match the expected shape.
    case decoding(String)
    case invalidURL(String)
    case notPaired

    public var errorDescription: String? {
        switch self {
        case .server(_, _, let message): message
        case .http(let status, let body): "HTTP \(status)\(body.isEmpty ? "" : ": \(body.prefix(200))")"
        case .transport(let message): message
        case .decoding(let message): "Unexpected response from server: \(message)"
        case .invalidURL(let url): "Invalid URL: \(url)"
        case .notPaired: "This device isn't paired."
        }
    }

    /// True when the device token is no longer valid (revoked / unpaired from the web).
    public var isUnauthorized: Bool {
        switch self {
        case .server(let status, let code, _): status == 401 || code == .unauthorized
        case .http(let status, _): status == 401
        default: false
        }
    }

    public var status: Int? {
        switch self {
        case .server(let status, _, _), .http(let status, _): status
        default: nil
        }
    }
}

/// Async REST client for the Oyee API, authenticated with a device token (`Authorization: Bearer oyee_dev_…`).
public struct OyeeAPI: Sendable {
    public let baseURL: URL
    public let token: String?
    let session: URLSession

    public init(baseURL: URL, token: String?, session: URLSession = OyeeAPI.defaultSession) {
        self.baseURL = baseURL
        self.token = token
        self.session = session
    }

    public static let defaultSession: URLSession = {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 30
        config.waitsForConnectivity = false
        config.httpAdditionalHeaders = ["User-Agent": "Oyee-Apple/\(OyeeKitInfo.version)"]
        return URLSession(configuration: config)
    }()

    // MARK: Meta / pairing

    public func config() async throws -> ServerConfig {
        try await send("GET", "/api/config", authenticated: false)
    }

    /// `POST /api/devices/pair` (no auth). `code` may be typed with or without the dash, any case.
    public func pair(code: String, name: String, platform: Platform) async throws -> PairResult {
        guard let normalized = Pairing.normalizeCode(code) else {
            throw OyeeAPIError.server(
                status: 400, code: .badRequest, message: "Pairing codes look like XXXX-XXXX (letters and digits).")
        }
        let input = PairInput(code: normalized, name: String(name.prefix(64)), platform: platform)
        return try await send("POST", "/api/devices/pair", body: input, authenticated: false)
    }

    public func me() async throws -> User {
        try await send("GET", "/api/me")
    }

    // MARK: Notifications

    public func listNotifications(_ query: NotificationQuery = NotificationQuery()) async throws
        -> Page<OyeeNotification>
    {
        try await send("GET", "/api/notifications", query: query.queryItems)
    }

    public func notification(id: String) async throws -> OyeeNotification {
        try await send("GET", "/api/notifications/\(escape(id))")
    }

    public func respond(id: String, actionId: String? = nil, text: String? = nil) async throws -> OyeeNotification {
        try await send("POST", "/api/notifications/\(escape(id))/respond", body: RespondInput(actionId: actionId, text: text))
    }

    public func markRead(id: String) async throws -> OyeeNotification {
        try await send("POST", "/api/notifications/\(escape(id))/read")
    }

    public func resolve(id: String) async throws -> OyeeNotification {
        try await send("POST", "/api/notifications/\(escape(id))/resolve")
    }

    public func delete(id: String) async throws {
        try await sendNoContent("DELETE", "/api/notifications/\(escape(id))")
    }

    public func readAll(source: String? = nil) async throws -> Int {
        struct Body: Encodable { var source: String? }
        let result: ReadAllResult = try await send("POST", "/api/notifications/read-all", body: Body(source: source))
        return result.updated
    }

    public func sources() async throws -> [SourceSummary] {
        let list: ItemList<SourceSummary> = try await send("GET", "/api/sources")
        return list.items
    }

    // MARK: Devices

    public func updateSelf(name: String) async throws -> Device {
        try await send("PUT", "/api/devices/self", body: UpdateSelfDeviceInput(name: String(name.prefix(64))))
    }

    public func unpairSelf() async throws {
        try await sendNoContent("DELETE", "/api/devices/self")
    }

    // MARK: Templates

    public func templates() async throws -> [Template] {
        let list: ItemList<Template> = try await send("GET", "/api/templates")
        return list.items
    }

    // MARK: - Plumbing

    private func escape(_ id: String) -> String {
        id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed.subtracting(CharacterSet(charactersIn: "/")))
            ?? id
    }

    /// Builds the URL for an API path, preserving any path prefix in `baseURL` (e.g. `https://host/oyee`).
    public func url(for path: String, query: [URLQueryItem] = []) throws -> URL {
        guard var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false) else {
            throw OyeeAPIError.invalidURL(baseURL.absoluteString)
        }
        var basePath = components.percentEncodedPath
        while basePath.hasSuffix("/") { basePath.removeLast() }
        components.percentEncodedPath = basePath + path
        components.queryItems = query.isEmpty ? nil : query
        // `+` is valid in a query but servers often decode it as a space (e.g. ISO offsets).
        components.percentEncodedQuery = components.percentEncodedQuery?.replacingOccurrences(of: "+", with: "%2B")
        guard let url = components.url else { throw OyeeAPIError.invalidURL(path) }
        return url
    }

    func makeRequest(
        _ method: String, _ path: String, query: [URLQueryItem] = [], bodyData: Data? = nil, authenticated: Bool = true
    ) throws -> URLRequest {
        var request = URLRequest(url: try url(for: path, query: query))
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if authenticated {
            guard let token else { throw OyeeAPIError.notPaired }
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        if let bodyData {
            request.httpBody = bodyData
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        } else if method == "POST" || method == "PUT" {
            // Some frameworks reject POSTs without a body; send an empty JSON object.
            request.httpBody = Data("{}".utf8)
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        return request
    }

    private struct Empty: Encodable {}

    func send<T: Decodable>(
        _ method: String, _ path: String, query: [URLQueryItem] = [], authenticated: Bool = true
    ) async throws -> T {
        try await send(method, path, query: query, body: Empty?.none, authenticated: authenticated)
    }

    func send<T: Decodable, B: Encodable>(
        _ method: String, _ path: String, query: [URLQueryItem] = [], body: B?, authenticated: Bool = true
    ) async throws -> T {
        let bodyData = try body.map { try OyeeJSON.makeEncoder().encode($0) }
        let request = try makeRequest(method, path, query: query, bodyData: bodyData, authenticated: authenticated)
        let data = try await perform(request)
        do {
            return try OyeeJSON.makeDecoder().decode(T.self, from: data)
        } catch {
            throw OyeeAPIError.decoding(String(describing: error))
        }
    }

    func sendNoContent(_ method: String, _ path: String) async throws {
        let request = try makeRequest(method, path)
        _ = try await perform(request)
    }

    private func perform(_ request: URLRequest) async throws -> Data {
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch let error as URLError {
            throw OyeeAPIError.transport(error.localizedDescription)
        } catch {
            throw OyeeAPIError.transport(String(describing: error))
        }
        guard let http = response as? HTTPURLResponse else {
            throw OyeeAPIError.transport("Not an HTTP response")
        }
        guard (200..<300).contains(http.statusCode) else {
            throw Self.error(status: http.statusCode, data: data)
        }
        return data
    }

    /// Maps a non-2xx response to a typed error using the `{ error: { code, message } }` envelope when present.
    public static func error(status: Int, data: Data) -> OyeeAPIError {
        if let envelope = try? OyeeJSON.makeDecoder().decode(APIErrorEnvelope.self, from: data) {
            return .server(status: status, code: envelope.error.code, message: envelope.error.message)
        }
        return .http(status: status, body: String(decoding: data.prefix(500), as: UTF8.self))
    }
}

public enum OyeeKitInfo {
    public static let version = "0.1.0"
}
