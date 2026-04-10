import Foundation
import Combine

/// Manages the agent RPC channel: sends commands, parses events, maintains message list.
class AgentService: ObservableObject {
    @Published var messages: [AgentMessage] = []
    @Published var isStreaming = false
    @Published var isConnected = false
    @Published var connectionError: String?
    @Published var sessions: [SessionInfo] = []
    @Published var currentSessionId: String?

    let ws = WebSocketService()
    private var currentStreamId: String?
    private var currentStreamText: String = ""
    private var cancellables = Set<AnyCancellable>()

    private var hasRequestedHistory = false

    init() {
        ws.onMessage = { [weak self] text in
            self?.handleServerMessage(text)
        }
        // Forward nested ObservableObject changes
        ws.$isConnected.receive(on: DispatchQueue.main).assign(to: &$isConnected)
        ws.$connectionError.receive(on: DispatchQueue.main).assign(to: &$connectionError)
    }

    func connect(url: String, pin: String) {
        hasRequestedHistory = false
        ws.connect(url: url, pin: pin, path: "/agent")
    }

    func disconnect() {
        ws.disconnect()
    }

    func sendPrompt(_ text: String) {
        sendCommand(type: "prompt", extra: ["message": text])
    }

    func sendFollowUp(_ text: String) {
        sendCommand(type: "follow_up", extra: ["message": text])
    }

    func sendSteer(_ text: String) {
        sendCommand(type: "steer", extra: ["message": text])
    }

    func abort() {
        sendCommand(type: "abort")
    }

    func listSessions() {
        sendCommand(type: "list_sessions")
    }

    private var pendingSwitchSessionId: String?

    func switchSession(path: String) {
        messages = []
        pendingSwitchSessionId = path
        sendCommand(type: "switch_session", extra: ["sessionPath": path])
    }

    // MARK: - Private

    private func sendCommand(type: String, extra: [String: Any] = [:]) {
        var command: [String: Any] = ["type": type, "id": UUID().uuidString]
        for (key, value) in extra {
            command[key] = value
        }
        guard let data = try? JSONSerialization.data(withJSONObject: command),
              let json = String(data: data, encoding: .utf8) else { return }
        ws.send(json)
    }

    private func handleServerMessage(_ text: String) {
        guard let data = text.data(using: .utf8) else { return }

        // Check for auth message — request history + session list once authenticated
        if let auth = try? JSONDecoder().decode(AuthMessage.self, from: data),
           auth.type == "auth", !hasRequestedHistory {
            hasRequestedHistory = true
            sendCommand(type: "get_messages")
            sendCommand(type: "list_sessions")
            return
        }

        // Handle list_sessions response
        if let response = try? JSONDecoder().decode(ListSessionsResponse.self, from: data),
           response.type == "response",
           response.command == "list_sessions",
           response.success == true,
           let sessData = response.data {
            DispatchQueue.main.async {
                self.sessions = sessData.sessions ?? []
                self.currentSessionId = sessData.currentSessionId
            }
            return
        }

        // Handle switch_session response — fetch new messages
        if let response = try? JSONDecoder().decode(RpcResponse.self, from: data),
           response.type == "response",
           response.command == "switch_session" {
            if response.success == true {
                pendingSwitchSessionId = nil
                sendCommand(type: "get_messages")
                sendCommand(type: "list_sessions")
            }
            return
        }

        // Try parsing as RPC response (e.g., get_messages)
        if let response = try? JSONDecoder().decode(RpcMessagesResponse.self, from: data),
           response.type == "response",
           response.command == "get_messages",
           response.success == true,
           let msgs = response.data?.messages {
            DispatchQueue.main.async {
                self.messages = msgs.compactMap { msg in
                    let role: AgentMessage.MessageRole
                    switch msg.role {
                    case "user": role = .user
                    case "assistant": role = .assistant
                    case "tool": role = .tool
                    default: role = .system
                    }
                    let msgText = msg.text ?? msg.content?.textValue ?? ""
                    guard !msgText.isEmpty else { return nil }
                    return AgentMessage(
                        id: msg.id ?? UUID().uuidString,
                        role: role,
                        text: msgText,
                        timestamp: Date()
                    )
                }
            }
            return
        }

        // Try parsing as session event
        if let event = try? JSONDecoder().decode(AgentSessionEvent.self, from: data) {
            DispatchQueue.main.async {
                self.handleEvent(event)
            }
        }
    }

    private func handleEvent(_ event: AgentSessionEvent) {
        switch event.type {
        case "message_start":
            if let msg = event.message {
                let role = parseRole(msg.role)
                let id = msg.id ?? UUID().uuidString
                let text = msg.text ?? msg.content?.textValue ?? ""
                currentStreamId = id
                isStreaming = msg.role == "assistant"
                messages.append(AgentMessage(
                    id: id,
                    role: role,
                    text: text,
                    timestamp: Date()
                ))
            }

        case "message_update":
            // Server sends full accumulated text, not a delta
            if let msg = event.message,
               let id = msg.id ?? currentStreamId,
               let idx = messages.lastIndex(where: { $0.id == id }) {
                let text = msg.text ?? msg.content?.textValue ?? ""
                messages[idx].text = text
            }

        case "message_end":
            if let msg = event.message,
               let id = msg.id ?? currentStreamId,
               let idx = messages.lastIndex(where: { $0.id == id }) {
                let text = msg.text ?? msg.content?.textValue ?? ""
                messages[idx].text = text
            }
            currentStreamId = nil
            isStreaming = false

        case "agent_end":
            // Agent finished — refresh full message list to stay in sync
            isStreaming = false
            currentStreamId = nil
            sendCommand(type: "get_messages")

        default:
            break
        }
    }

    private func parseRole(_ role: String?) -> AgentMessage.MessageRole {
        switch role {
        case "user": return .user
        case "assistant": return .assistant
        case "tool": return .tool
        default: return .system
        }
    }
}
