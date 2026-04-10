import Foundation
import Combine

/// Manages a WebSocket connection to the pimote server with PIN auth and auto-reconnect.
class WebSocketService: NSObject, ObservableObject {
    @Published var isConnected = false
    @Published var connectionError: String?

    private var webSocket: URLSessionWebSocketTask?
    private var urlSession: URLSession?
    private var serverUrl: String = ""
    private var pin: String = ""
    private var token: String?
    private var path: String = "/agent"
    private var reconnectAttempts = 0
    private let maxReconnectAttempts = 5

    var onMessage: ((String) -> Void)?

    func connect(url: String, pin: String, path: String = "/agent") {
        self.serverUrl = url
        self.pin = pin
        self.path = path
        self.reconnectAttempts = 0
        self.connectionError = nil
        doConnect()
    }

    func disconnect() {
        reconnectAttempts = maxReconnectAttempts // prevent auto-reconnect
        webSocket?.cancel(with: .goingAway, reason: nil)
        webSocket = nil
        DispatchQueue.main.async { self.isConnected = false }
    }

    func send(_ text: String) {
        guard let ws = webSocket else { return }
        ws.send(.string(text)) { error in
            if let error {
                print("WebSocket send error: \(error)")
            }
        }
    }

    // MARK: - Private

    private func doConnect() {
        let authParam: String
        if let token = token {
            authParam = "token=\(token)"
        } else {
            authParam = "pin=\(pin)"
        }

        // Convert http(s) to ws(s), handle missing scheme
        var wsUrl = serverUrl.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        if wsUrl.hasPrefix("https://") {
            wsUrl = "wss://" + wsUrl.dropFirst(8)
        } else if wsUrl.hasPrefix("http://") {
            wsUrl = "ws://" + wsUrl.dropFirst(7)
        } else if wsUrl.hasPrefix("wss://") || wsUrl.hasPrefix("ws://") {
            // already a websocket URL
        } else {
            wsUrl = "ws://" + wsUrl
        }

        let fullUrlString = "\(wsUrl)\(path)?\(authParam)"
        print("[Pimote] Connecting to: \(fullUrlString)")
        guard let url = URL(string: fullUrlString) else {
            print("[Pimote] Invalid URL: \(fullUrlString)")
            DispatchQueue.main.async { self.connectionError = "Invalid URL" }
            return
        }

        let session = URLSession(configuration: .default, delegate: self, delegateQueue: nil)
        self.urlSession = session
        let ws = session.webSocketTask(with: url)
        self.webSocket = ws
        ws.resume()
        print("[Pimote] WebSocket task resumed")
        receiveMessage()
    }

    private func receiveMessage() {
        webSocket?.receive { [weak self] result in
            guard let self else { return }
            switch result {
            case .success(let message):
                switch message {
                case .string(let text):
                    self.handleMessage(text)
                case .data(let data):
                    if let text = String(data: data, encoding: .utf8) {
                        self.handleMessage(text)
                    }
                @unknown default:
                    break
                }
                self.receiveMessage()

            case .failure(let error):
                print("[Pimote] WebSocket receive error: \(error)")
                DispatchQueue.main.async {
                    self.isConnected = false
                }
                self.attemptReconnect()
            }
        }
    }

    private func handleMessage(_ text: String) {
        // Check for auth token
        if let data = text.data(using: .utf8),
           let auth = try? JSONDecoder().decode(AuthMessage.self, from: data),
           auth.type == "auth",
           let newToken = auth.token {
            self.token = newToken
        }

        DispatchQueue.main.async {
            if !self.isConnected {
                self.isConnected = true
                self.reconnectAttempts = 0
                self.connectionError = nil
            }
        }

        onMessage?(text)
    }

    private func attemptReconnect() {
        guard reconnectAttempts < maxReconnectAttempts else {
            DispatchQueue.main.async {
                self.connectionError = "Connection lost after \(self.maxReconnectAttempts) attempts"
            }
            return
        }
        reconnectAttempts += 1
        let delay = Double(min(reconnectAttempts * 2, 10))
        DispatchQueue.global().asyncAfter(deadline: .now() + delay) { [weak self] in
            self?.doConnect()
        }
    }
}

extension WebSocketService: URLSessionWebSocketDelegate {
    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didOpenWithProtocol protocol: String?) {
        print("[Pimote] WebSocket connected")
        DispatchQueue.main.async {
            self.isConnected = true
            self.connectionError = nil
        }
    }

    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didCloseWith closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?) {
        print("[Pimote] WebSocket closed: \(closeCode)")
        DispatchQueue.main.async {
            self.isConnected = false
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        if let error {
            print("[Pimote] URLSession error: \(error)")
            DispatchQueue.main.async {
                self.connectionError = error.localizedDescription
                self.isConnected = false
            }
            attemptReconnect()
        }
    }
}
