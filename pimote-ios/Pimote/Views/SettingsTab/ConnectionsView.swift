import SwiftUI

/// Settings tab: manage saved connections, disconnect.
struct ConnectionsView: View {
    @EnvironmentObject var connectionManager: ConnectionManager

    var body: some View {
        NavigationStack {
            List {
                if let active = connectionManager.activeConnection {
                    Section("Active Connection") {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(active.name)
                                .font(.headline)
                            Text(active.url)
                                .font(.caption)
                                .foregroundColor(.secondary)

                            HStack(spacing: 16) {
                                Label(
                                    connectionManager.agentService.isConnected ? "Agent Connected" : "Agent Disconnected",
                                    systemImage: connectionManager.agentService.isConnected ? "checkmark.circle.fill" : "xmark.circle.fill"
                                )
                                .foregroundColor(connectionManager.agentService.isConnected ? .green : .red)
                                .font(.caption)

                                Label(
                                    connectionManager.shellService.isConnected ? "Shell Connected" : "Shell Disconnected",
                                    systemImage: connectionManager.shellService.isConnected ? "checkmark.circle.fill" : "xmark.circle.fill"
                                )
                                .foregroundColor(connectionManager.shellService.isConnected ? .green : .red)
                                .font(.caption)
                            }
                            .padding(.top, 4)
                        }
                        .padding(.vertical, 4)

                        Button("Disconnect", role: .destructive) {
                            connectionManager.disconnect()
                        }
                    }
                }

                Section("Saved Connections") {
                    ForEach(connectionManager.connections) { conn in
                        HStack {
                            VStack(alignment: .leading) {
                                Text(conn.name)
                                    .fontWeight(.medium)
                                Text(conn.url)
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                            }

                            Spacer()

                            if conn.id != connectionManager.activeConnection?.id {
                                Button("Connect") {
                                    connectionManager.connect(to: conn)
                                }
                                .buttonStyle(.bordered)
                                .controlSize(.small)
                            } else {
                                Text("Active")
                                    .font(.caption)
                                    .foregroundColor(.green)
                            }
                        }
                    }
                    .onDelete { indexSet in
                        for index in indexSet {
                            connectionManager.removeConnection(connectionManager.connections[index])
                        }
                    }

                    if connectionManager.connections.isEmpty {
                        Text("No saved connections")
                            .foregroundColor(.secondary)
                    }
                }

                Section("About") {
                    HStack {
                        Text("Version")
                        Spacer()
                        Text("1.0.0")
                            .foregroundColor(.secondary)
                    }
                }
            }
            .navigationTitle("Settings")
        }
    }
}
