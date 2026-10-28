import Foundation

/// Pairing code + server URL helpers (protocol §2.2).
public enum Pairing {
    public static let alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
    private static let alphabetSet = Set(alphabet)

    /// Normalises user input into the 8-character code the server expects (`K7Q29XMA`).
    /// Case-insensitive; the dash and whitespace are optional. Returns `nil` if the code is invalid.
    public static func normalizeCode(_ input: String) -> String? {
        let cleaned = input.uppercased().filter { !$0.isWhitespace && $0 != "-" }
        guard cleaned.count == 8, cleaned.allSatisfy({ alphabetSet.contains($0) }) else { return nil }
        return cleaned
    }

    /// Formats a (possibly partial) code as `XXXX-XXXX` for display while typing.
    public static func displayCode(_ input: String) -> String {
        let cleaned = String(input.uppercased().filter { !$0.isWhitespace && $0 != "-" }.prefix(8))
        guard cleaned.count > 4 else { return cleaned }
        let index = cleaned.index(cleaned.startIndex, offsetBy: 4)
        return "\(cleaned[..<index])-\(cleaned[index...])"
    }

    /// Normalises a server URL typed by the user: trims, adds `https://` when there's no scheme (or `http://` for
    /// localhost / 127.0.0.1), lowercases the host, and drops a trailing slash, query and fragment.
    public static func normalizeServerURL(_ input: String) -> URL? {
        var text = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return nil }
        if !text.contains("://") {
            let lower = text.lowercased()
            let isLocal = lower.hasPrefix("localhost") || lower.hasPrefix("127.0.0.1") || lower.hasPrefix("[::1]")
            text = (isLocal ? "http://" : "https://") + text
        }
        guard var components = URLComponents(string: text),
              let scheme = components.scheme?.lowercased(), scheme == "http" || scheme == "https",
              let host = components.host, !host.isEmpty
        else { return nil }
        components.scheme = scheme
        components.host = host.lowercased()
        components.query = nil
        components.fragment = nil
        components.user = nil
        components.password = nil
        while components.path.hasSuffix("/") { components.path.removeLast() }
        return components.url
    }

    /// A parsed `herald://pair?server=…&code=…` deep link.
    public struct Link: Sendable, Hashable {
        public var server: URL
        public var code: String

        public init(server: URL, code: String) {
            self.server = server
            self.code = code
        }
    }

    /// Parses `herald://pair?server=https%3A%2F%2Fhost&code=K7Q2-9XMA`. Returns nil for other URLs.
    public static func parseLink(_ url: URL) -> Link? {
        guard url.scheme?.lowercased() == "herald",
              let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        else { return nil }
        // `herald://pair?…` puts "pair" in the host; `herald:pair?…` / `herald:///pair` in the path.
        let target = (components.host ?? "") + components.path
        guard target.trimmingCharacters(in: CharacterSet(charactersIn: "/")).lowercased() == "pair" else { return nil }
        let items = components.queryItems ?? []
        guard let serverText = items.first(where: { $0.name == "server" })?.value,
              let codeText = items.first(where: { $0.name == "code" })?.value,
              let server = normalizeServerURL(serverText),
              let code = normalizeCode(codeText)
        else { return nil }
        return Link(server: server, code: code)
    }
}
