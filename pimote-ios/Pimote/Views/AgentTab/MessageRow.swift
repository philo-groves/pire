import SwiftUI

/// A single message bubble in the agent conversation.
struct MessageRow: View {
    let message: AgentMessage

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            // Role icon
            Image(systemName: iconName)
                .font(.caption)
                .foregroundColor(roleColor)
                .frame(width: 24, height: 24)
                .background(roleColor.opacity(0.15))
                .clipShape(Circle())

            VStack(alignment: .leading, spacing: 4) {
                Text(roleLabel)
                    .font(.caption)
                    .fontWeight(.semibold)
                    .foregroundColor(roleColor)

                Text(message.text)
                    .font(.body)
                    .textSelection(.enabled)
            }

            Spacer(minLength: 0)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 4)
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
