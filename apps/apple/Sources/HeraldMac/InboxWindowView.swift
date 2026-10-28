import HeraldKit
import SwiftUI

/// The inbox window: list + detail, or pairing when the Mac isn't paired yet.
struct InboxWindowView: View {
    @Bindable var model: HeraldModel

    var body: some View {
        Group {
            if !model.isPaired || model.pendingPairLink != nil || model.needsRepair {
                ScrollView {
                    VStack(alignment: .leading, spacing: 12) {
                        if model.needsRepair {
                            Label(
                                "The server no longer accepts this Mac's token. Pair it again.",
                                systemImage: "exclamationmark.triangle.fill"
                            )
                            .foregroundStyle(.orange)
                            .padding([.horizontal, .top], 24)
                        }
                        PairingView(model: model)
                    }
                    .frame(maxWidth: 520)
                    .frame(maxWidth: .infinity)
                }
            } else {
                NavigationSplitView {
                    InboxListView(store: model.store, selection: $model.selectedNotificationID)
                        .navigationSplitViewColumnWidth(min: 280, ideal: 360)
                        .toolbar { sidebarToolbar }
                } detail: {
                    if let id = model.selectedNotificationID {
                        NotificationLoaderView(id: id, store: model.store)
                            .id(id)
                    } else {
                        ContentUnavailableView(
                            "No notification selected", systemImage: "bell",
                            description: Text("Pick a notification from the list."))
                    }
                }
            }
        }
        .frame(minWidth: 640, minHeight: 420)
        .navigationTitle("Herald")
        .onOpenURL { model.handleOpenURL($0) }
    }

    @ToolbarContentBuilder
    private var sidebarToolbar: some ToolbarContent {
        ToolbarItem {
            Menu {
                InboxFilterControls(store: model.store)
            } label: {
                Label(
                    "Filter",
                    systemImage: model.store.filter.isDefault
                        ? "line.3.horizontal.decrease.circle" : "line.3.horizontal.decrease.circle.fill")
            }
        }
        ToolbarItem {
            Button {
                Task { await model.store.markAllRead() }
            } label: {
                Label("Mark all read", systemImage: "envelope.open")
            }
            .disabled(model.store.unreadCount == 0)
        }
        ToolbarItem {
            Button {
                model.reconnect()
                Task { await model.store.refresh() }
            } label: {
                HStack(spacing: 4) {
                    ConnectionStatusDot(state: model.connectionState)
                    Image(systemName: "arrow.clockwise")
                }
            }
            .help("\(model.connectionState.label). Click to refresh.")
        }
    }
}
