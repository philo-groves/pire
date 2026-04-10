import SwiftUI

/// A single message bubble in the agent conversation.
struct MessageRow: View {
    let message: AgentMessage

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            // Role label with icon — above message
            HStack(spacing: 4) {
                Image(systemName: iconName)
                    .font(.system(size: 9))
                    .foregroundColor(roleColor)
                Text(roleLabel)
                    .font(.system(size: 10, design: .monospaced))
                    .fontWeight(.semibold)
                    .foregroundColor(roleColor)
            }

            MarkdownText(message.text)
        }
        .padding(.horizontal, 4)
        .padding(.vertical, 3)
    }

    private var iconName: String {
        switch message.role {
        case .user: return "person.fill"
        case .assistant: return "brain"
        case .tool: return "wrench.fill"
        case .system: return "info.circle.fill"
        }
    }

    private var roleLabel: String {
        switch message.role {
        case .user: return "You"
        case .assistant: return "Agent"
        case .tool: return "Tool"
        case .system: return "System"
        }
    }

    private var roleColor: Color {
        switch message.role {
        case .user: return .blue
        case .assistant: return .purple
        case .tool: return .orange
        case .system: return .gray
        }
    }
}
