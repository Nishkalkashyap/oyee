import SwiftUI

/// Pair this device: server URL + `XXXX-XXXX` code (case-insensitive, dash optional). Prefilled from a
/// `oyee://pair?server=…&code=…` deep link, which still requires the user to confirm.
public struct PairingView: View {
    let model: OyeeModel
    var compact: Bool

    @ViewState private var server = Pairing.defaultServerURL
    @ViewState private var code = ""
    @ViewState private var busy = false
    @ViewState private var error: String?

    public init(model: OyeeModel, compact: Bool = false) {
        self.model = model
        self.compact = compact
    }

    private var canSubmit: Bool {
        !busy && Pairing.normalizeServerURL(server) != nil && Pairing.normalizeCode(code) != nil
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: compact ? 10 : 16) {
            if !compact {
                BrandMark(size: 52)
                Text("Pair this device")
                    .font(.oyee(28, .heavy))
                    .padding(.top, 6)
            }
            Text("In the Oyee web app, open **Home → Connect a device** and enter the code shown there (or open the pairing link on this device).")
                .font(.oyee(compact ? 12.5 : 14))
                .foregroundStyle(Theme.muted)
                .fixedSize(horizontal: false, vertical: true)

            if model.isPaired, model.pendingPairLink != nil {
                Label("This device is already paired. Pairing again replaces the current pairing.", systemImage: "exclamationmark.triangle")
                    .font(.caption)
                    .foregroundStyle(.orange)
            }

            VStack(alignment: .leading, spacing: 4) {
                Text("Server URL").font(.oyee(12.5, .semibold)).foregroundStyle(Theme.secondaryLabel)
                TextField("https://oyee.example.com", text: $server)
                    .textFieldStyle(.plain)
                    .font(.oyee(14))
                    .padding(.horizontal, 14)
                    .frame(height: 40)
                    .background(Theme.secondary, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                    .autocorrectionDisabled()
                    #if os(iOS)
                    .textInputAutocapitalization(.never)
                    .keyboardType(.URL)
                    #endif
            }
            VStack(alignment: .leading, spacing: 4) {
                Text("Pairing code").font(.oyee(12.5, .semibold)).foregroundStyle(Theme.secondaryLabel)
                TextField("XXXX-XXXX", text: $code)
                    .textFieldStyle(.plain)
                    .font(.system(size: 22, weight: .medium, design: .monospaced))
                    .tracking(2)
                    .padding(.horizontal, 14)
                    .frame(height: 50)
                    .background(Theme.secondary, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
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
                    .font(.oyee(13.5))
                    .foregroundStyle(Color(hex: 0xDC2626))
                    .fixedSize(horizontal: false, vertical: true)
            }

            HStack {
                if model.pendingPairLink != nil {
                    Button("Cancel") { model.pendingPairLink = nil }
                        .buttonStyle(PillButtonStyle(.ghost, size: compact ? .regular : .large))
                }
                Spacer()
                Button(action: submit) {
                    HStack {
                        if busy { ProgressView().controlSize(.small) }
                        Text("Pair")
                    }
                    .frame(minWidth: 60)
                }
                .buttonStyle(PillButtonStyle(.brand, size: compact ? .regular : .large))
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
            } catch let apiError as OyeeAPIError {
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
