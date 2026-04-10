import Foundation

/// A saved pimote server connection profile.
struct Connection: Identifiable, Codable {
    let id: UUID
    var name: String
    var url: String
    var pin: String

    init(name: String = "", url: String, pin: String) {
        self.id = UUID()
        self.name = name.isEmpty ? Connection.nameFromUrl(url) : name
        self.url = url
        self.pin = pin
    }

    static func nameFromUrl(_ url: String) -> String {
        guard let host = URL(string: url)?.host else { return "Unknown" }
        let parts = host.split(separator: ".")
        if parts.count >= 3 {
            return String(parts[0])
        }
        return host
    }
}
