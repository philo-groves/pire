import SwiftUI
import WebKit

/// Shell tab: WKWebView wrapping xterm.js for full terminal emulation.
struct ShellView: View {
    @EnvironmentObject var connectionManager: ConnectionManager

    var body: some View {
        NavigationStack {
            XtermWebView(shellService: connectionManager.shellService)
                .navigationTitle("Shell")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .navigationBarTrailing) {
                        Circle()
                            .fill(connectionManager.shellService.isConnected ? Color.green : Color.red)
                            .frame(width: 10, height: 10)
                    }
                }
        }
    }
}

/// WKWebView wrapper that loads an embedded xterm.js terminal.
struct XtermWebView: UIViewRepresentable {
    let shellService: ShellService

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        let userContentController = WKUserContentController()
        userContentController.add(context.coordinator, name: "shellInput")
        userContentController.add(context.coordinator, name: "shellResize")
        config.userContentController = userContentController

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.isOpaque = false
        webView.backgroundColor = .black
        webView.scrollView.isScrollEnabled = false

        // Load embedded xterm.html
        if let htmlPath = Bundle.main.path(forResource: "xterm", ofType: "html") {
            let htmlUrl = URL(fileURLWithPath: htmlPath)
            webView.loadFileURL(htmlUrl, allowingReadAccessTo: htmlUrl.deletingLastPathComponent())
        } else {
            // Fallback: load inline HTML
            webView.loadHTMLString(Self.fallbackHtml, baseURL: nil)
        }

        context.coordinator.webView = webView
        context.coordinator.shellService = shellService

        // Forward shell output to xterm
        shellService.onOutput = { output in
            let escaped = output
                .replacingOccurrences(of: "\\", with: "\\\\")
                .replacingOccurrences(of: "'", with: "\\'")
                .replacingOccurrences(of: "\n", with: "\\n")
                .replacingOccurrences(of: "\r", with: "\\r")
            DispatchQueue.main.async {
                webView.evaluateJavaScript("writeToTerminal('\(escaped)')")
            }
        }

        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    class Coordinator: NSObject, WKScriptMessageHandler {
        weak var webView: WKWebView?
        var shellService: ShellService?

        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            switch message.name {
            case "shellInput":
                if let input = message.body as? String {
                    shellService?.sendInput(input)
                }
            case "shellResize":
                if let size = message.body as? [String: Int],
                   let cols = size["cols"],
                   let rows = size["rows"] {
                    shellService?.sendResize(cols: cols, rows: rows)
                }
            default:
                break
            }
        }
    }

    static let fallbackHtml = """
    <!DOCTYPE html>
    <html>
    <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/css/xterm.min.css">
        <script src="https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/lib/xterm.min.js"></script>
        <script src="https://cdn.jsdelivr.net/npm/@xterm/addon-fit@0.10.0/lib/addon-fit.min.js"></script>
        <style>
            html, body { margin: 0; padding: 0; height: 100%; background: #1e1e1e; overflow: hidden; }
            #terminal { height: 100%; }
        </style>
    </head>
    <body>
        <div id="terminal"></div>
        <script>
            const term = new Terminal({
                fontSize: 14,
                fontFamily: 'Menlo, monospace',
                theme: { background: '#1e1e1e' },
                cursorBlink: true,
            });
            const fitAddon = new FitAddon.FitAddon();
            term.loadAddon(fitAddon);
            term.open(document.getElementById('terminal'));
            fitAddon.fit();

            term.onData(data => {
                window.webkit.messageHandlers.shellInput.postMessage(data);
            });

            function writeToTerminal(data) {
                term.write(data);
            }

            const resizeObserver = new ResizeObserver(() => {
                fitAddon.fit();
                window.webkit.messageHandlers.shellResize.postMessage({
                    cols: term.cols,
                    rows: term.rows,
                });
            });
            resizeObserver.observe(document.getElementById('terminal'));
        </script>
    </body>
    </html>
    """;
}
