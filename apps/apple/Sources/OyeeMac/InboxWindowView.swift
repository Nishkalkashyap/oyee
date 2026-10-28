import OyeeKit
import SwiftUI

/// The inbox window in Gluon's layout: the warm ground with two 22pt panels, the list on white and the conversation
/// on the thread color. Shows pairing when the Mac isn't paired yet.
struct InboxWindowView: View {
    @Bindable var model: OyeeModel

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
                            .font(.oyee(13, .medium))
                            .foregroundStyle(Color.orange)
                            .padding([.horizontal, .top], 24)
                        }
                        PairingView(model: model)
                    }
                    .frame(maxWidth: 520)
                    .frame(maxWidth: .infinity)
                }
                .background(Theme.background, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
                .padding(8)
            } else {
                HStack(spacing: 8) {
                    VStack(spacing: 0) {
                        InboxListView(store: model.store, selection: $model.selectedNotificationID)
                        statusBar
                    }
                    .frame(width: 360)
                    .background(Theme.background, in: RoundedRectangle(cornerRadius: 22, style: .continuous))

                    Group {
                        if let id = model.selectedNotificationID {
                            NotificationLoaderView(id: id, store: model.store)
                                .id(id)
                        } else {
                            VStack(spacing: 8) {
                                BrandMark(size: 44)
                                Text("Select a notification").font(.oyee(15, .bold))
                                Text("Pick one from the list to see it, act on it or reply.")
                                    .font(.oyee(13))
                                    .foregroundStyle(Theme.muted)
                            }
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                            .background(Theme.thread)
                        }
                    }
                    .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
                }
                .padding(.horizontal, 8)
                .padding(.bottom, 8)
                .padding(.top, 30)  // clears the traffic lights (hidden title bar)
            }
        }
        .frame(minWidth: 720, minHeight: 460)
        .background(Theme.ground)
        .ignoresSafeArea()
        .navigationTitle("Oyee")
        .onOpenURL { model.handleOpenURL($0) }
    }

    /// Connection state and refresh, at the bottom of the list panel.
    private var statusBar: some View {
        HStack(spacing: 6) {
            ConnectionStatusDot(state: model.connectionState)
            Text(model.connectionState.label).font(.oyee(12)).foregroundStyle(Theme.muted)
            Spacer()
            Button {
                model.reconnect()
                Task { await model.store.refresh() }
            } label: {
                Image(systemName: "arrow.clockwise")
            }
            .buttonStyle(PillButtonStyle(.ghost, size: .small))
            .help("Reconnect and refresh")
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .overlay(alignment: .top) { Divider().overlay(Theme.border) }
    }
}
