import Foundation
import Testing

@testable import OyeeKit

/// Intercepts requests for a dedicated URLSession. Each test session gets its own handler via a header-free
/// registry keyed by the session's configuration identifier.
final class StubURLProtocol: URLProtocol, @unchecked Sendable {
    struct Captured: Sendable {
        var method: String
        var url: URL
        var headers: [String: String]
        var body: Data?
    }

    typealias Handler = @Sendable (Captured) -> (status: Int, body: String)

    private static let lock = NSLock()
    nonisolated(unsafe) private static var handlers: [String: Handler] = [:]
    nonisolated(unsafe) private static var captured: [String: [Captured]] = [:]

    static func makeSession(_ handler: @escaping Handler) -> (URLSession, String) {
        let id = UUID().uuidString
        lock.withLock { handlers[id] = handler }
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [StubURLProtocol.self]
        config.httpAdditionalHeaders = ["X-Stub-Session": id]
        return (URLSession(configuration: config), id)
    }

    static func requests(_ id: String) -> [Captured] {
        lock.withLock { captured[id] ?? [] }
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        let id = request.value(forHTTPHeaderField: "X-Stub-Session") ?? ""
        var body = request.httpBody
        if body == nil, let stream = request.httpBodyStream {
            stream.open()
            var data = Data()
            var buffer = [UInt8](repeating: 0, count: 4096)
            while stream.hasBytesAvailable {
                let read = stream.read(&buffer, maxLength: buffer.count)
                if read <= 0 { break }
                data.append(buffer, count: read)
            }
            stream.close()
            body = data
        }
        let capture = Captured(
            method: request.httpMethod ?? "GET", url: request.url!,
            headers: request.allHTTPHeaderFields ?? [:], body: body)
        let handler = Self.lock.withLock { () -> Handler? in
            Self.captured[id, default: []].append(capture)
            return Self.handlers[id]
        }
        let (status, text) = handler?(capture) ?? (500, "")
        let response = HTTPURLResponse(
            url: request.url!, statusCode: status, httpVersion: "HTTP/1.1",
            headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(text.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}

@Suite("REST client")
struct APITests {
    let base = URL(string: "https://oyee.example.com")!

    @Test func listSendsBearerAndQuery() async throws {
        let page = String(decoding: try fixture("page"), as: UTF8.self)
        let (session, id) = StubURLProtocol.makeSession { _ in (200, page) }
        let api = OyeeAPI(baseURL: base, token: "oyee_dev_abc", session: session)
        let result = try await api.listNotifications(
            NotificationQuery(limit: 20, severity: .critical, updatedSince: "2026-10-28T10:00:00.000+02:00"))
        #expect(result.items.count == 2)
        #expect(result.nextCursor == "opaque-cursor-1")

        let request = try #require(StubURLProtocol.requests(id).first)
        #expect(request.method == "GET")
        #expect(request.headers["Authorization"] == "Bearer oyee_dev_abc")
        let components = try #require(URLComponents(url: request.url, resolvingAgainstBaseURL: false))
        #expect(components.path == "/api/notifications")
        #expect(components.percentEncodedQuery?.contains("limit=20") == true)
        #expect(components.percentEncodedQuery?.contains("severity=critical") == true)
        // `+` must be percent-encoded so it isn't read as a space.
        #expect(components.percentEncodedQuery?.contains("%2B02:00") == true)
    }

    @Test func pairNormalizesCodeAndSendsNoAuth() async throws {
        let body = String(decoding: try fixture("pair_result"), as: UTF8.self)
        let (session, id) = StubURLProtocol.makeSession { _ in (201, body) }
        let api = OyeeAPI(baseURL: base, token: nil, session: session)
        let result = try await api.pair(code: "k7q2-9xma", name: "Mac", platform: .macos)
        #expect(result.token == "oyee_dev_abcdefghijklmnopqrstuvwxyz0123456789")

        let request = try #require(StubURLProtocol.requests(id).first)
        #expect(request.method == "POST")
        #expect(request.url.path == "/api/devices/pair")
        #expect(request.headers["Authorization"] == nil)
        #expect(request.headers["Content-Type"] == "application/json")
        let sent = try JSONSerialization.jsonObject(with: try #require(request.body)) as? [String: String]
        #expect(sent == ["code": "K7Q29XMA", "name": "Mac", "platform": "macos"])
    }

    @Test func invalidPairingCodeFailsLocally() async {
        let api = OyeeAPI(baseURL: base, token: nil)
        await #expect(throws: OyeeAPIError.self) {
            _ = try await api.pair(code: "nope", name: "Mac", platform: .macos)
        }
    }

    @Test func respondReadResolveDelete() async throws {
        let full = String(decoding: try OyeeJSON.makeEncoder().encode(try v2("ask-open")), as: UTF8.self)
        let (session, id) = StubURLProtocol.makeSession { request in
            request.method == "DELETE" ? (204, "") : (200, full)
        }
        let api = OyeeAPI(baseURL: base, token: "t", session: session)
        _ = try await api.respond(id: "ntf_1", option: "Approve")
        _ = try await api.respond(id: "ntf_1", text: "hello")
        _ = try await api.markRead(id: "ntf_1")
        _ = try await api.resolve(id: "ntf_1")
        try await api.delete(id: "ntf_1")

        let requests = StubURLProtocol.requests(id)
        #expect(requests.map(\.method) == ["POST", "POST", "POST", "POST", "DELETE"])
        #expect(
            requests.map(\.url.path) == [
                "/api/notifications/ntf_1/respond", "/api/notifications/ntf_1/respond", "/api/notifications/ntf_1/read",
                "/api/notifications/ntf_1/resolve", "/api/notifications/ntf_1",
            ])
        let first = try JSONSerialization.jsonObject(with: try #require(requests[0].body)) as? [String: String]
        #expect(first == ["option": "Approve"])
        let second = try JSONSerialization.jsonObject(with: try #require(requests[1].body)) as? [String: String]
        #expect(second == ["text": "hello"])
    }

    @Test func errorEnvelopeBecomesTypedError() async throws {
        let (session, _) = StubURLProtocol.makeSession { _ in
            (404, #"{"error":{"code":"not_found","message":"Notification not found"}}"#)
        }
        let api = OyeeAPI(baseURL: base, token: "t", session: session)
        do {
            _ = try await api.notification(id: "ntf_missing")
            Issue.record("expected an error")
        } catch let error as OyeeAPIError {
            #expect(error == .server(status: 404, code: .notFound, message: "Notification not found"))
            #expect(error.localizedDescription == "Notification not found")
            #expect(!error.isUnauthorized)
        }
    }

    @Test func unauthorizedAndNonEnvelopeErrors() async throws {
        let (session, _) = StubURLProtocol.makeSession { request in
            request.url.path == "/api/me" ? (401, #"{"error":{"code":"unauthorized","message":"Bad token"}}"#) : (502, "Bad Gateway")
        }
        let api = OyeeAPI(baseURL: base, token: "t", session: session)
        await #expect(throws: OyeeAPIError.server(status: 401, code: .unauthorized, message: "Bad token")) {
            _ = try await api.me()
        }
        await #expect(throws: OyeeAPIError.http(status: 502, body: "Bad Gateway")) {
            _ = try await api.sources()
        }
        #expect(OyeeAPIError.server(status: 401, code: .unauthorized, message: "").isUnauthorized)
    }

    @Test func requiresTokenForAuthenticatedCalls() async {
        let api = OyeeAPI(baseURL: base, token: nil)
        await #expect(throws: OyeeAPIError.notPaired) { _ = try await api.me() }
    }

    @Test func urlBuildingKeepsBasePath() throws {
        let api = OyeeAPI(baseURL: URL(string: "https://host/oyee/")!, token: "t")
        #expect(try api.url(for: "/api/me").absoluteString == "https://host/oyee/api/me")
        let withQuery = try api.url(for: "/api/notifications", query: [URLQueryItem(name: "q", value: "a b&c")])
        #expect(withQuery.absoluteString == "https://host/oyee/api/notifications?q=a%20b%26c")
    }
}
