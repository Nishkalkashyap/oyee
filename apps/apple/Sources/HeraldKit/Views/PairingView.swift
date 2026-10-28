import SwiftUI

/// Pair this device: server URL + `XXXX-XXXX` code (case-insensitive, dash optional). Prefilled from a
/// `herald://pair?server=…&code=…` deep link, which still requires the user to confirm.
public struct PairingView: View {
    let model: HeraldModel
    var compact: Bool

    @ViewState private var server = Pairing.defaultServerURL
    @ViewState private var code = ""
    @ViewState private var busy = false
    @ViewState private var error: String?

    public init(model: HeraldModel, compact: Bool = false) {
        self.model = model
        self.compact = compact
    }

    private var canSubmit: Bool {
        !busy && Pairing.normalizeServerURL(server) != nil && Pairing.normalizeCode(code) != nil
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: compact ? 10 : 16) {
            if !compact {
                Label("Pair this device", systemImage: "link.badge.plus")
                    .font(.title2.weight(.semibold))
            }
            Text("In the Herald web app, open **Devices → Pair a device** and enter the code shown there (or open the pairing link on this device).")
                .font(compact ? .caption : .callout)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)

            if model.isPaired, model.pendingPairLink != nil {
                Label("This device is already paired. Pairing again replaces the current pairing.", systemImage: "exclamationmark.triangle")
                    .font(.caption)
                    .foregroundStyle(.orange)
            }

            VStack(alignment: .leading, spacing: 4) {
                Text("Server URL").font(.caption).foregroundStyle(.secondary)
                TextField("https://herald.example.com", text: $server)
                    .textFieldStyle(.roundedBorder)
                    .autocorrectionDisabled()
                    #if os(iOS)
                    .textInputAutocapitalization(.never)
                    .keyboardType(.URL)
                    #endif
            }
            VStack(alignment: .leading, spacing: 4) {
                Text("Pairing code").font(.caption).foregroundStyle(.secondary)
                TextField("XXXX-XXXX", text: $code)
                    .textFieldStyle(.roundedBorder)
                    .font(.system(.title3, design: .monospaced))
                    .autocorrectionDisabled()
                    #if os(iOS)
                    .textInputAutocapitalization(.characters)
                    #endif
                    .onChange(of: code) { _, newValue in
                        let formatted = Pairing.displayCode(newValue)
                        if formatted != newValue { code = formatted }
                    }
                    .onSubmit(submit)
            }

            if let error {
                Text(error)
                    .font(.callout)
                    .foregroundStyle(.red)
                    .fixedSize(horizontal: false, vertical: true)
            }

            HStack {
                if model.pendingPairLink != nil {
                    Button("Cancel") { model.pendingPairLink = nil }
                }
                Spacer()
                Button(action: submit) {
                    HStack {
                        if busy { ProgressView().controlSize(.small) }
                        Text("Pair")
                    }
                    .frame(minWidth: 60)
                }
                .buttonStyle(.borderedProminent)
                .keyboardShortcut(.defaultAction)
                .disabled(!canSubmit)
            }
        }
        .padding(compact ? 0 : 24)
        .onAppear(perform: prefill)
        .onChange(of: model.pendingPairLink) { prefill() }
    }

    private func prefill() {
        if let link = model.pendingPairLink {
            server = link.server.absoluteString
            code = Pairing.displayCode(link.code)
            error = nil
        } else if let existing = model.credentials?.serverURL {
            server = existing.absoluteString
        }
    }

    private func submit() {
        guard canSubmit else { return }
        busy = true
        error = nil
        Task {
            do {
                try await model.pair(server: server, code: code)
            } catch let apiError as HeraldAPIError {
                switch apiError {
                case .server(_, .notFound, _), .server(_, .badRequest, _), .server(_, .conflict, _):
                    error = "\(apiError.localizedDescription) Codes expire after 10 minutes and work once."
                default:
                    error = apiError.localizedDescription
                }
            } catch {
                self.error = error.localizedDescription
            }
            busy = false
        }
    }
}
