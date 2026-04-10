import Foundation
import Security

/// Simple Keychain wrapper for storing connection credentials.
enum KeychainService {
    private static let service = "com.pimote.connections"

    static func save(connections: [Connection]) throws {
        let data = try JSONEncoder().encode(connections)
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: "connections",
        ]

        // Delete existing
        SecItemDelete(query as CFDictionary)

        // Add new
        var addQuery = query
        addQuery[kSecValueData as String] = data
        let status = SecItemAdd(addQuery as CFDictionary, nil)
        guard status == errSecSuccess else {
            throw KeychainError.saveFailed(status)
        }
    }

    static func loadConnections() -> [Connection] {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: "connections",
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]

        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess, let data = result as? Data else {
            return []
        }

        return (try? JSONDecoder().decode([Connection].self, from: data)) ?? []
    }

    enum KeychainError: Error {
        case saveFailed(OSStatus)
    }
}
