import Foundation

/// What a paired device needs to talk to its server.
public struct Credentials: Codable, Sendable, Hashable {
    public var serverURL: URL
    public var token: String
    public var deviceId: String?
    public var deviceName: String?
    public var userId: String?
    public var userEmail: String?
    public var userName: String?
    public var pairedAt: Date

    public init(
        serverURL: URL, token: String, deviceId: String? = nil, deviceName: String? = nil, userId: String? = nil,
        userEmail: String? = nil, userName: String? = nil, pairedAt: Date = Date()
    ) {
        self.serverURL = serverURL
        self.token = token
        self.deviceId = deviceId
        self.deviceName = deviceName
        self.userId = userId
        self.userEmail = userEmail
        self.userName = userName
        self.pairedAt = pairedAt
    }
}

/// Where Oyee keeps its files: `~/Library/Application Support/Oyee` (macOS) or the app container's
/// Application Support directory (iOS).
public enum OyeePaths {
    public static func applicationSupport() -> URL {
        let base =
            FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? FileManager.default.temporaryDirectory
        return base.appendingPathComponent("Oyee", isDirectory: true)
    }
}

/// Stores the server URL + device token in a JSON file with `0600` permissions inside a `0700` directory.
///
/// Why not the Keychain: the macOS app is ad-hoc signed and rebuilt from source, so its code signature changes on
/// every build. Keychain items are bound to the signature of the app that created them, which makes macOS prompt for
/// the login password after every rebuild. A user-only file gives the same protection against other users and
/// survives rebuilds. On iOS the file additionally uses Data Protection (`completeUntilFirstUserAuthentication`, so
/// background refresh can still read it after the first unlock).
public struct CredentialStore: Sendable {
    public let fileURL: URL

    public init(directory: URL = OyeePaths.applicationSupport()) {
        self.fileURL = directory.appendingPathComponent("credentials.json")
    }

    public func load() -> Credentials? {
        guard let data = try? Data(contentsOf: fileURL) else { return nil }
        return try? OyeeJSON.makeDecoder().decode(Credentials.self, from: data)
    }

    public func save(_ credentials: Credentials) throws {
        let data = try OyeeJSON.makeEncoder().encode(credentials)
        try SecureFile.write(data, to: fileURL)
    }

    public func clear() {
        try? FileManager.default.removeItem(at: fileURL)
    }
}

/// Writes files readable only by the current user, atomically.
enum SecureFile {
    static func write(_ data: Data, to url: URL) throws {
        let fm = FileManager.default
        let directory = url.deletingLastPathComponent()
        try fm.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        try? fm.setAttributes([.posixPermissions: 0o700], ofItemAtPath: directory.path)

        var attributes: [FileAttributeKey: Any] = [.posixPermissions: 0o600]
        #if os(iOS)
        attributes[.protectionKey] = FileProtectionType.completeUntilFirstUserAuthentication
        #endif
        // Create the temp file with restrictive permissions from the start, then atomically swap it in.
        let temp = directory.appendingPathComponent(".\(url.lastPathComponent).\(UUID().uuidString).tmp")
        guard fm.createFile(atPath: temp.path, contents: data, attributes: attributes) else {
            throw CocoaError(.fileWriteUnknown)
        }
        do {
            if fm.fileExists(atPath: url.path) {
                _ = try fm.replaceItemAt(url, withItemAt: temp)
            } else {
                try fm.moveItem(at: temp, to: url)
            }
        } catch {
            try? fm.removeItem(at: temp)
            throw error
        }
        try? fm.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
    }
}
