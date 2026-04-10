import Foundation

/// A pire session available for viewing.
struct SessionInfo: Identifiable, Decodable {
    let id: String
    let path: String
    var name: String?
    let cwd: String?
    let created: String
    let modified: String
    let messageCount: Int
    let firstMessage: String?

    var displayName: String {
        if let name, !name.isEmpty { return name }
        if let first = firstMessage, !first.isEmpty {
            return String(first.prefix(60))
        }
        return id.prefix(8).description
    }

    var modifiedDate: Date? {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f.date(from: modified) ?? ISO8601DateFormatter().date(from: modified)
    }

    var createdDate: Date? {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f.date(from: created) ?? ISO8601DateFormatter().date(from: created)
    }
}

struct ListSessionsResponse: Decodable {
    let type: String
    let command: String?
    let success: Bool?
    let data: ListSessionsData?
}

struct ListSessionsData: Decodable {
    let currentSessionId: String?
    let sessions: [SessionInfo]?
}
