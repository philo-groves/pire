import SwiftUI

struct ContentView: View {
    @EnvironmentObject var connectionManager: ConnectionManager

    var body: some View {
        Group {
            if connectionManager.activeConnection != nil {
                TabView {
                    AgentView()
                        .tabItem {
                            Label("Agent", systemImage: "brain")
                        }

                    ShellView()
                        .tabItem {
                            Label("Shell", systemImage: "terminal")
                        }

                    ConnectionsView()
                        .tabItem {
                            Label("Settings", systemImage: "gear")
                        }
                }
            } else {
                PairView()
            }
        }
    }
}
