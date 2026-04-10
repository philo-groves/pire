import SwiftUI

/// Main agent conversation view: message list + input field + session picker.
struct AgentView: View {
    @EnvironmentObject var connectionManager: ConnectionManager
    @State private var inputText = ""
    @State private var showSessionPicker = false
    @FocusState private var inputFocused: Bool

    private var agentService: AgentService {
        connectionManager.agentService
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                // Message list
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 12) {
                            if agentService.messages.isEmpty && !agentService.isStreaming {
                                VStack(spacing: 12) {
                                    if !agentService.isConnected {
                                        ProgressView()
                                        Text("Connecting...")
                                            .font(.subheadline)
                                            .foregroundColor(.secondary)
                                        if let url = connectionManager.activeConnection?.url {
                                            Text(url)
                                                .font(.caption)
                                                .foregroundColor(.secondary)
                                        }
                                    } else {
                                        Text("No messages yet")
                                            .font(.subheadline)
                                            .foregroundColor(.secondary)
                                    }
                                }
                                .frame(maxWidth: .infinity)
                                .padding(.top, 60)
                            }

                            ForEach(agentService.messages) { message in
                                MessageRow(message: message)
                                    .id(message.id)
                            }

                            if agentService.isStreaming {
                                HStack(spacing: 8) {
                                    ProgressView()
                                        .scaleEffect(0.8)
                                    Text("Streaming...")
                                        .font(.caption)
                                        .foregroundColor(.secondary)
                                }
                                .padding(.horizontal)
                            }
                        }
                        .padding(.vertical, 8)
                    }
                    .onChange(of: agentService.messages.count) {
                        if let last = agentService.messages.last {
                            withAnimation {
                                proxy.scrollTo(last.id, anchor: .bottom)
                            }
                        }
                    }
                }

                Divider()

                // Input bar
                HStack(spacing: 12) {
                    TextField("Send a message...", text: $inputText, axis: .vertical)
                        .textFieldStyle(.plain)
                        .lineLimit(1...5)
                        .focused($inputFocused)
                        .onSubmit { sendMessage() }

                    if agentService.isStreaming {
                        Button {
                            agentService.abort()
                        } label: {
                            Image(systemName: "stop.circle.fill")
                                .font(.title2)
                                .foregroundColor(.red)
                        }
                    } else {
                        Button {
                            sendMessage()
                        } label: {
                            Image(systemName: "arrow.up.circle.fill")
                                .font(.title2)
                                .foregroundColor(inputText.isEmpty ? .secondary : .accentColor)
                        }
                        .disabled(inputText.isEmpty)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
                .background(Color(.systemBackground))
            }
            .navigationTitle("Agent")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button {
                        agentService.listSessions()
                        showSessionPicker = true
                    } label: {
                        Image(systemName: "clock.arrow.circlepath")
                    }
                }
                ToolbarItem(placement: .navigationBarTrailing) {
                    HStack(spacing: 4) {
                        if let err = agentService.connectionError {
                            Text(err)
                                .font(.caption2)
                                .foregroundColor(.red)
                                .lineLimit(1)
                        }
                        Circle()
                            .fill(agentService.isConnected ? Color.green : Color.red)
                            .frame(width: 10, height: 10)
                    }
                }
            }
            .sheet(isPresented: $showSessionPicker) {
                SessionPickerSheet(
                    sessions: agentService.sessions,
                    currentSessionId: agentService.currentSessionId,
                    onSelect: { session in
                        agentService.switchSession(path: session.path)
                        showSessionPicker = false
                    }
                )
            }
        }
    }

    private func sendMessage() {
        let text = inputText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        inputText = ""

        if agentService.isStreaming {
            agentService.sendSteer(text)
        } else {
            agentService.sendPrompt(text)
        }
    }
}

// MARK: - Session Picker

struct SessionPickerSheet: View {
    @Environment(\.dismiss) private var dismiss
    let sessions: [SessionInfo]
    let currentSessionId: String?
    let onSelect: (SessionInfo) -> Void

    private var dateFormatter: RelativeDateTimeFormatter {
        let f = RelativeDateTimeFormatter()
        f.unitsStyle = .short
        return f
    }

    var body: some View {
        NavigationStack {
            List {
                if sessions.isEmpty {
                    VStack(spacing: 8) {
                        ProgressView()
                        Text("Loading sessions...")
                            .foregroundColor(.secondary)
                    }
                    .frame(maxWidth: .infinity)
                    .listRowBackground(Color.clear)
                } else {
                    ForEach(sessions) { session in
                        Button {
                            onSelect(session)
                        } label: {
                            HStack {
                                VStack(alignment: .leading, spacing: 4) {
                                    HStack {
                                        Text(session.displayName)
                                            .font(.body)
                                            .lineLimit(2)
                                        if session.id == currentSessionId {
                                            Text("current")
                                                .font(.caption2)
                                                .foregroundColor(.white)
                                                .padding(.horizontal, 6)
                                                .padding(.vertical, 2)
                                                .background(Color.accentColor)
                                                .cornerRadius(4)
                                        }
                                    }
                                    HStack(spacing: 8) {
                                        Text("\(session.messageCount) msgs")
                                        if let date = session.modifiedDate {
                                            Text(dateFormatter.localizedString(for: date, relativeTo: Date()))
                                        }
                                    }
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                                }
                                Spacer()
                                if session.id == currentSessionId {
                                    Image(systemName: "checkmark")
                                        .foregroundColor(.accentColor)
                                }
                            }
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            .navigationTitle("Sessions")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }
}
