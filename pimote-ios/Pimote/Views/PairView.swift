import SwiftUI
import AVFoundation

/// Pairing screen: scan QR code or enter URL + PIN manually.
struct PairView: View {
    @EnvironmentObject var connectionManager: ConnectionManager
    @State private var showManualEntry = false
    @State private var showScanner = false
    @State private var url = ""
    @State private var pin = ""
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            VStack(spacing: 24) {
                Spacer()

                Image(systemName: "antenna.radiowaves.left.and.right")
                    .font(.system(size: 64))
                    .foregroundColor(.accentColor)

                Text("Connect to Pimote")
                    .font(.title)
                    .fontWeight(.bold)

                Text("Scan the QR code shown in your pire terminal, or enter the connection details manually.")
                    .font(.body)
                    .foregroundColor(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 32)

                // Connection error
                if let err = connectionManager.agentService.connectionError {
                    Text(err)
                        .font(.caption)
                        .foregroundColor(.red)
                        .padding(.horizontal, 32)
                }

                // Saved connections
                if !connectionManager.connections.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Saved Connections")
                            .font(.headline)
                            .padding(.horizontal)

                        ForEach(connectionManager.connections) { conn in
                            Button {
                                connectionManager.connect(to: conn)
                            } label: {
                                HStack {
                                    Image(systemName: "server.rack")
                                    VStack(alignment: .leading) {
                                        Text(conn.name)
                                            .fontWeight(.medium)
                                        Text(conn.url)
                                            .font(.caption)
                                            .foregroundColor(.secondary)
                                    }
                                    Spacer()
                                    Image(systemName: "chevron.right")
                                        .foregroundColor(.secondary)
                                }
                                .padding()
                                .background(Color(.secondarySystemBackground))
                                .cornerRadius(12)
                            }
                            .buttonStyle(.plain)
                            .padding(.horizontal)
                            .contextMenu {
                                Button {
                                    connectionManager.connect(to: conn)
                                } label: {
                                    Label("Connect", systemImage: "bolt.fill")
                                }
                                Button(role: .destructive) {
                                    connectionManager.removeConnection(conn)
                                } label: {
                                    Label("Delete", systemImage: "trash")
                                }
                            }
                        }
                    }
                }

                Spacer()

                // Scan QR button
                Button {
                    showScanner = true
                } label: {
                    Label("Scan QR Code", systemImage: "qrcode.viewfinder")
                        .frame(maxWidth: .infinity)
                        .padding()
                        .background(Color.accentColor)
                        .foregroundColor(.white)
                        .cornerRadius(12)
                }
                .padding(.horizontal, 32)

                // Manual entry button
                Button {
                    showManualEntry = true
                } label: {
                    Label("Enter Manually", systemImage: "keyboard")
                        .frame(maxWidth: .infinity)
                        .padding()
                        .background(Color(.secondarySystemBackground))
                        .foregroundColor(.primary)
                        .cornerRadius(12)
                }
                .padding(.horizontal, 32)
                .padding(.bottom, 32)
            }
            .navigationTitle("Pimote")
            .sheet(isPresented: $showScanner) {
                QRScanSheet(onScanned: { scannedUrl in
                    showScanner = false
                    url = scannedUrl
                    // Auto-open PIN entry with pre-filled URL
                    showManualEntry = true
                })
            }
            .sheet(isPresented: $showManualEntry) {
                ManualEntrySheet(url: $url, pin: $pin, errorMessage: $errorMessage) {
                    guard !url.isEmpty, !pin.isEmpty else {
                        errorMessage = "URL and PIN are required"
                        return
                    }
                    let connection = Connection(url: url, pin: pin)
                    connectionManager.addConnection(connection)
                    connectionManager.connect(to: connection)
                    showManualEntry = false
                    url = ""
                    pin = ""
                }
            }
        }
    }
}

// MARK: - QR Scanner Sheet

struct QRScanSheet: View {
    @Environment(\.dismiss) private var dismiss
    var onScanned: (String) -> Void

    var body: some View {
        NavigationStack {
            QRScannerView { url in
                onScanned(url)
            }
            .ignoresSafeArea()
            .navigationTitle("Scan QR Code")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
    }
}

// MARK: - Manual Entry Sheet

struct ManualEntrySheet: View {
    @Environment(\.dismiss) private var dismiss
    @Binding var url: String
    @Binding var pin: String
    @Binding var errorMessage: String?
    var onConnect: () -> Void

    var body: some View {
        NavigationStack {
            Form {
                Section("Server URL") {
                    TextField("https://xxx.trycloudflare.com", text: $url)
                        .textContentType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                }

                Section("PIN") {
                    SecureField("Enter PIN", text: $pin)
                        .textContentType(.password)
                }

                if let error = errorMessage {
                    Section {
                        Text(error)
                            .foregroundColor(.red)
                    }
                }
            }
            .navigationTitle("Connect")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        dismiss()
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Connect", action: onConnect)
                        .disabled(url.isEmpty || pin.isEmpty)
                }
            }
        }
    }
}
