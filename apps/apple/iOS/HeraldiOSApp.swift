import HeraldKit
import SwiftUI
import UIKit

/// Herald for iOS. Delivery is a WebSocket while the app is in the foreground (plus a short grace period after
/// backgrounding) and best-effort `BGAppRefreshTask` catch-up otherwise. There is no APNs, so iOS does not get
/// instant notifications while the app is suspended.
@main
struct HeraldiOSApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            RootView(model: appDelegate.model)
                .onOpenURL { url in appDelegate.model.handleOpenURL(url) }
        }
        .onChange(of: scenePhase) { _, phase in
            appDelegate.lifecycle.scenePhaseChanged(phase)
        }
    }
}

@MainActor
final class AppDelegate: NSObject, UIApplicationDelegate {
    /// Created with the delegate (before launch finishes) so the notification delegate is installed in time to
    /// receive a response that launched the app.
    let model = HeraldModel(configuration: .init(platform: .ios, deviceName: UIDevice.current.name))
    private(set) lazy var lifecycle = ForegroundLifecycle(model: model)

    func application(
        _ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        // BGTaskScheduler handlers must be registered before launch finishes.
        BackgroundRefresh.register(model: model)
        model.start()
        return true
    }
}

/// Keeps the socket connected while the app is in the foreground, for ~25 s after it goes to the background, and
/// schedules background refresh.
@MainActor
final class ForegroundLifecycle {
    static let backgroundGrace: Duration = .seconds(25)

    private let model: HeraldModel
    private var backgroundTask: UIBackgroundTaskIdentifier = .invalid
    private var graceTask: Task<Void, Never>?

    init(model: HeraldModel) {
        self.model = model
    }

    func scenePhaseChanged(_ phase: ScenePhase) {
        switch phase {
        case .active:
            graceTask?.cancel()
            graceTask = nil
            endBackgroundTask()
            // Connects the socket (its `sync` catches up) and refreshes the first page over REST.
            model.connect()
            Task { await model.refreshNotificationAuthorization() }
        case .background:
            BackgroundRefresh.schedule()
            model.store.saveNow()
            beginBackgroundTask()
            graceTask?.cancel()
            graceTask = Task { [weak self] in
                try? await Task.sleep(for: ForegroundLifecycle.backgroundGrace)
                guard !Task.isCancelled else { return }
                self?.model.disconnect()
                self?.endBackgroundTask()
            }
        case .inactive:
            break
        @unknown default:
            break
        }
    }

    private func beginBackgroundTask() {
        guard backgroundTask == .invalid else { return }
        backgroundTask = UIApplication.shared.beginBackgroundTask(withName: "dev.herald.socket") { [weak self] in
            MainActor.assumeIsolated {
                self?.model.disconnect()
                self?.endBackgroundTask()
            }
        }
    }

    private func endBackgroundTask() {
        guard backgroundTask != .invalid else { return }
        UIApplication.shared.endBackgroundTask(backgroundTask)
        backgroundTask = .invalid
    }
}
