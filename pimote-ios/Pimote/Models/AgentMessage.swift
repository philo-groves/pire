import Foundation

/// Represents a message in the agent conversation, parsed from RPC events.
struct AgentMessage: Identifiable {
    let id: String
    let role: MessageRole
    var text: String
    let timestamp: Date

    enum MessageRole: String {
        case user
        case assistant
        case tool
        case system
    }
}

/// Parsed from the get_messages RPC response.
struct RpcMessagesResponse: Decodable {
    let type: String
    let command: String?
    let success: Bool?
    let data: MessagesData?

    struct MessagesData: Decodable {
        let messages: [RpcMessage]?
    }
}

struct RpcMessage: Decodable {
    let id: String?
    let role: String?
    let content: RpcContent?
    let text: String?

    enum RpcContent: Decodable {
        case string(String)
        case array([RpcContentBlock])

        init(from decoder: Decoder) throws {
            let container = try decoder.singleValueContainer()
            if let str = try? container.decode(String.self) {
                self = .string(str)
                return
            }
            if let arr = try? container.decode([RpcContentBlock].self) {
                self = .array(arr)
                return
            }
            self = .string("")
        }

        var textValue: String {
            switch self {
            case .string(let s): return s
            case .array(let blocks):
                return blocks.compactMap { block in
                    if block.type == "text" { return block.text }
                    return nil
                }.joined(separator: "\n")
            }
        }
    }
}

struct RpcContentBlock: Decodable {
    let type: String?
    let text: String?
}

/// Auth token message sent by server on successful PIN auth.
struct AuthMessage: Decodable {
    let type: String
    let token: String?
}

/// Generic RPC response envelope.
struct RpcResponse: Decodable {
    let type: String
    let command: String?
    let success: Bool?
    let error: String?
}

/// Agent session event (streamed from server).
struct AgentSessionEvent: Decodable {
    let type: String
    let message: EventMessage?
    let text: String?
    let delta: String?
    let entryId: String?

    struct EventMessage: Decodable {
        let id: String?
        let role: String?
        let content: RpcMessage.RpcContent?
        let text: String?
    }
}
