import Foundation
import Combine

/// Manages the shell WebSocket channel: sends input, receives output.
class ShellService: ObservableObject {
    @Published var isConnected = false

    let ws = WebSocketService()
    var onOutput: ((String) -> Void)?

    init() {
        ws.onMessage = { [weak self] text in
            guard let data = text.data(using: .utf8),
                  let msg = try? JSONDecoder().decode(ShellMessage.self, from: data) else { return }
            switch msg.type {
            case "data":
                if let output = msg.data {
                    self?.onOutput?(output)
                }
            case "exit":
                DispatchQueue.main.async {
                    self?.isConnected = false
                }
            default:
                break
            }
        }
    }

    func connect(url: String, pin: String) {
        ws.connect(url: url, pin: pin, path: "/shell")
        // Track connection state
        ws.$isConnected.assign(to: &$isConnected)
    }

    func disconnect() {
        ws.disconnect()
    }

    func sendInput(_ text: String) {
        let msg = ["type": "data", "data": text]
        guard let data = try? JSONSerialization.data(withJSONObject: msg),
              let json = String(data: data, encoding: .utf8) else { return }
        ws.send(json)
    }

    func sendResize(cols: Int, rows: Int) {
        let msg: [String: Any] = ["type": "resize", "cols": cols, "rows": rows]
        guard let data = try? JSONSerialization.data(withJSONObject: msg),
              let json = String(data: data, encoding: .utf8) else { return }
        ws.send(json)
    }
}

private struct ShellMessage: Decodable {
    let type: String
    let data: String?
    let code: Int?
}
