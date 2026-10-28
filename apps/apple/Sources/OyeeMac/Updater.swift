import AppKit
import CryptoKit
import Foundation
import Observation
import OyeeKit
import UserNotifications

/// Self-update from GitHub Releases. Enabled only in builds published by the release workflow (Info.plist
/// `OyeeAutoUpdate`), so local development builds never replace themselves.
///
/// Checks `releases/latest` shortly after launch and every 6 hours. With "Install updates automatically" on (the
/// default) a newer version is downloaded, verified against SHA256SUMS.txt, swapped in place and relaunched.
@MainActor
@Observable
final class Updater {
    enum State: Equatable {
        case idle, checking, upToDate
        case available(version: String)
        case downloading(version: String)
        case installing(version: String)
        case failed(String)
    }

    struct Release: Decodable {
        struct Asset: Decodable {
            let name: String
            let browser_download_url: URL
        }
        let tag_name: String
        let assets: [Asset]
        var version: String { tag_name.hasPrefix("v") ? String(tag_name.dropFirst()) : tag_name }
    }

    static let repo = "Nishkalkashyap/oyee"
    private static let autoInstallKey = "autoInstallUpdates"
    private static let updatedFromKey = "updatedFromVersion"

    private(set) var state: State = .idle
    let currentVersion = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.0.0"
    let enabled = Bundle.main.infoDictionary?["OyeeAutoUpdate"] as? Bool ?? false
    var autoInstall: Bool {
        didSet { UserDefaults.standard.set(autoInstall, forKey: Self.autoInstallKey) }
    }

    @ObservationIgnored private var latest: Release?
    @ObservationIgnored private var loop: Task<Void, Never>?

    init() {
        autoInstall = UserDefaults.standard.object(forKey: Self.autoInstallKey) as? Bool ?? true
    }

    func start() {
        announceIfJustUpdated()
        guard enabled, loop == nil else { return }
        loop = Task { [weak self] in
            try? await Task.sleep(for: .seconds(15))
            while !Task.isCancelled {
                await self?.check(installIfAuto: true)
                try? await Task.sleep(for: .seconds(6 * 3600))
            }
        }
    }

    func check(installIfAuto: Bool) async {
        guard enabled else { return }
        switch state {
        case .downloading, .installing: return
        default: break
        }
        state = .checking
        do {
            var req = URLRequest(url: URL(string: "https://api.github.com/repos/\(Self.repo)/releases/latest")!)
            req.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
            let (data, response) = try await URLSession.shared.data(for: req)
            guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw UpdateError("GitHub is unreachable") }
            let release = try JSONDecoder().decode(Release.self, from: data)
            latest = release
            guard Self.isNewer(release.version, than: currentVersion) else {
                state = .upToDate
                return
            }
            state = .available(version: release.version)
            if installIfAuto, autoInstall { await install() }
        } catch {
            state = .failed((error as? UpdateError)?.message ?? "Couldn't check for updates")
        }
    }

    /// Downloads, verifies and installs the latest release, then relaunches.
    func install() async {
        guard let release = latest, Self.isNewer(release.version, than: currentVersion) else { return }
        let version = release.version
        do {
            guard let zip = release.assets.first(where: { $0.name.hasSuffix("-macOS.zip") }) else {
                throw UpdateError("The release has no macOS download")
            }
            let destination = Bundle.main.bundleURL
            guard FileManager.default.isWritableFile(atPath: destination.deletingLastPathComponent().path) else {
                throw UpdateError("Move Oyee to Applications to enable updates")
            }
            state = .downloading(version: version)
            let (tmpZip, _) = try await URLSession.shared.download(from: zip.browser_download_url)
            try await verify(tmpZip, name: zip.name, release: release)

            state = .installing(version: version)
            let work = FileManager.default.temporaryDirectory.appendingPathComponent("oyee-update-\(UUID().uuidString)")
            try FileManager.default.createDirectory(at: work, withIntermediateDirectories: true)
            try run("/usr/bin/ditto", ["-x", "-k", tmpZip.path, work.path])
            let newApp = work.appendingPathComponent("Oyee.app")
            let info = NSDictionary(contentsOf: newApp.appendingPathComponent("Contents/Info.plist"))
            guard info?["CFBundleIdentifier"] as? String == Bundle.main.bundleIdentifier,
                  info?["CFBundleShortVersionString"] as? String == version
            else { throw UpdateError("The download isn't the expected Oyee \(version)") }

            UserDefaults.standard.set(currentVersion, forKey: Self.updatedFromKey)
            try relaunch(replacing: destination, with: newApp)
        } catch {
            state = .failed((error as? UpdateError)?.message ?? "Update failed: \(error.localizedDescription)")
        }
    }

    // MARK: Helpers

    private func verify(_ file: URL, name: String, release: Release) async throws {
        guard let sumsAsset = release.assets.first(where: { $0.name == "SHA256SUMS.txt" }) else {
            throw UpdateError("The release has no checksums")
        }
        let (sumsData, _) = try await URLSession.shared.data(from: sumsAsset.browser_download_url)
        let expected = String(decoding: sumsData, as: UTF8.self)
            .split(separator: "\n")
            .first { $0.hasSuffix(name) }?
            .split(separator: " ").first.map(String.init)
        let actual = SHA256.hash(data: try Data(contentsOf: file)).map { String(format: "%02x", $0) }.joined()
        guard let expected, expected.lowercased() == actual else { throw UpdateError("Checksum mismatch, update discarded") }
    }

    /// Hands off to a tiny shell script that waits for this process to exit, swaps the bundle and opens the new one.
    private func relaunch(replacing destination: URL, with newApp: URL) throws {
        let script = """
        while /bin/kill -0 \(ProcessInfo.processInfo.processIdentifier) 2>/dev/null; do /bin/sleep 0.2; done
        /bin/rm -rf "\(destination.path)"
        /bin/mv "\(newApp.path)" "\(destination.path)"
        /usr/bin/xattr -dr com.apple.quarantine "\(destination.path)" 2>/dev/null
        /usr/bin/open "\(destination.path)"
        """
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/sh")
        process.arguments = ["-c", "/usr/bin/nohup /bin/sh -c '\(script.replacingOccurrences(of: "'", with: "'\\''"))' >/dev/null 2>&1 &"]
        try process.run()
        process.waitUntilExit()
        NSApp.terminate(nil)
    }

    private func run(_ tool: String, _ args: [String]) throws {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: tool)
        p.arguments = args
        try p.run()
        p.waitUntilExit()
        guard p.terminationStatus == 0 else { throw UpdateError("Couldn't unpack the update") }
    }

    /// After a self-update: one local notification saying it happened.
    private func announceIfJustUpdated() {
        guard let from = UserDefaults.standard.string(forKey: Self.updatedFromKey) else { return }
        UserDefaults.standard.removeObject(forKey: Self.updatedFromKey)
        guard from != currentVersion else { return }
        let content = UNMutableNotificationContent()
        content.title = "Oyee updated to \(currentVersion)"
        content.body = "Installed automatically (was \(from))."
        UNUserNotificationCenter.current().add(
            UNNotificationRequest(identifier: "oyee.updated", content: content, trigger: nil))
    }

    static func isNewer(_ candidate: String, than current: String) -> Bool {
        func parts(_ v: String) -> [Int] { v.split(separator: ".").map { Int($0) ?? 0 } + [0, 0, 0] }
        let a = parts(candidate), b = parts(current)
        for i in 0..<3 where a[i] != b[i] { return a[i] > b[i] }
        return false
    }

    var statusText: String {
        if !enabled { return "Self-built: update by rebuilding (published releases update themselves)." }
        switch state {
        case .idle: return "Checks GitHub Releases every 6 hours."
        case .checking: return "Checking for updates…"
        case .upToDate: return "Up to date."
        case .available(let v): return "Version \(v) is available."
        case .downloading(let v): return "Downloading \(v)…"
        case .installing(let v): return "Installing \(v) and restarting…"
        case .failed(let message): return message
        }
    }
}

struct UpdateError: Error {
    let message: String
    init(_ message: String) { self.message = message }
}
