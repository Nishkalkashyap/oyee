import BackgroundTasks
import HeraldKit
import UIKit

/// Best-effort background catch-up: a `BGAppRefreshTask` that pulls `updatedSince` changes over REST and posts local
/// notifications for new items. iOS decides when (and whether) it runs, typically not more than every 15+ minutes.
enum BackgroundRefresh {
    static let identifier = "dev.herald.ios.refresh"

    @MainActor
    static func register(model: HeraldModel) {
        // `using: .main` → the launch handler runs on the main queue.
        BGTaskScheduler.shared.register(forTaskWithIdentifier: identifier, using: .main) { task in
            MainActor.assumeIsolated {
                guard let refresh = task as? BGAppRefreshTask else {
                    task.setTaskCompleted(success: false)
                    return
                }
                handle(refresh, model: model)
            }
        }
    }

    static func schedule() {
        let request = BGAppRefreshTaskRequest(identifier: identifier)
        request.earliestBeginDate = Date(timeIntervalSinceNow: 15 * 60)
        do {
            try BGTaskScheduler.shared.submit(request)
        } catch {
            // Fails in the simulator and when Background App Refresh is disabled; nothing else to do.
            NSLog("Herald: couldn't schedule background refresh: \(error)")
        }
    }

    @MainActor
    private static func handle(_ task: BGAppRefreshTask, model: HeraldModel) {
        schedule()  // Keep the chain going.
        guard model.isPaired else {
            task.setTaskCompleted(success: true)
            return
        }
        let work = Task { @MainActor in
            model.start()
            await model.store.catchUp()
            await model.presenter?.waitForPendingPosts()
            model.presenter?.setBadgeCount(model.store.unreadCount)
            model.store.saveNow()
            task.setTaskCompleted(success: !Task.isCancelled)
        }
        task.expirationHandler = {
            work.cancel()
        }
    }
}
