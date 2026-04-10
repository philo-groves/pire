import Foundation
import Combine

/// Manages saved connections and the active connection state.
class ConnectionManager: ObservableObject {
    @Published var connections: [Connection] = []
    @Published var activeConnection: Connection?

    let agentService = AgentService()
    let shellService = ShellService()

    private var cancellables = Set<AnyCancellable>()

    init() {
        connections = KeychainService.loadConnections()

        // Forward child objectWillChange so SwiftUI re-renders
        agentService.objectWillChange
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in self?.objectWillChange.send() }
            .store(in: &cancellables)
        shellService.objectWillChange
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in self?.objectWillChange.send() }
            .store(in: &cancellables)
    }

    func addConnection(_ connection: Connection) {
        connections.append(connection)
        saveConnections()
    }

    func removeConnection(_ connection: Connection) {
        connections.removeAll { $0.id == connection.id }
        if activeConnection?.id == connection.id {
            disconnect()
        }
        saveConnections()
    }

    func connect(to connection: Connection) {
        activeConnection = connection
        agentService.connect(url: connection.url, pin: connection.pin)
        shellService.connect(url: connection.url, pin: connection.pin)
    }

    func disconnect() {
        agentService.disconnect()
        shellService.disconnect()
        activeConnection = nil
    }

    private func saveConnections() {
        try? KeychainService.save(connections: connections)
    }
}
