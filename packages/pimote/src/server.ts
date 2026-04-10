/**
 * HTTP server + WebSocket upgrade handler with PIN authentication.
 *
 * Routes:
 *   /agent  — RPC command channel (WebSocket)
 *   /shell  — PTY shell channel (WebSocket)
 *   /health — HTTP health check
 */

import * as http from "node:http";
import { type WebSocket, WebSocketServer } from "ws";
import { handleAgentConnection } from "./agent-bridge.js";
import {
	createSessionToken,
	getLockoutRemaining,
	recordFailure,
	resetFailures,
	validateSessionToken,
	verifyPin,
} from "./auth.js";
import type { RpcHandler } from "./rpc-handler-types.js";
import { handleShellConnection } from "./shell-channel.js";

export interface PimoteServerOptions {
	port: number;
	host?: string;
	pinHash: string;
	rpcHandler: RpcHandler;
}

export interface PimoteServer {
	readonly port: number;
	readonly connectedClients: number;
	close(): Promise<void>;
}

export async function startServer(options: PimoteServerOptions): Promise<PimoteServer> {
	const { port, host = "127.0.0.1", pinHash, rpcHandler } = options;

	const agentWss = new WebSocketServer({ noServer: true });
	const shellWss = new WebSocketServer({ noServer: true });

	const clients = new Set<WebSocket>();

	const server = http.createServer((req, res) => {
		if (req.url === "/health") {
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ status: "ok", clients: clients.size }));
			return;
		}
		res.writeHead(404);
		res.end("Not Found");
	});

	server.on("upgrade", async (req, socket, head) => {
		const reqUrl = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
		const pathname = reqUrl.pathname;

		// --- Authentication ---
		const lockoutSeconds = getLockoutRemaining();
		if (lockoutSeconds > 0) {
			socket.write(`HTTP/1.1 429 Too Many Requests\r\nRetry-After: ${lockoutSeconds}\r\nConnection: close\r\n\r\n`);
			socket.destroy();
			return;
		}

		const pin = reqUrl.searchParams.get("pin") ?? undefined;
		const token = reqUrl.searchParams.get("token") ?? undefined;

		let authenticated = false;
		let newToken: string | undefined;

		if (token && validateSessionToken(token)) {
			authenticated = true;
		} else if (pin) {
			const valid = await verifyPin(pin, pinHash);
			if (valid) {
				authenticated = true;
				resetFailures();
				newToken = createSessionToken();
			} else {
				const lockout = recordFailure();
				const retryHeader = lockout > 0 ? `Retry-After: ${lockout}\r\n` : "";
				socket.write(`HTTP/1.1 401 Unauthorized\r\n${retryHeader}Connection: close\r\n\r\n`);
				socket.destroy();
				return;
			}
		} else {
			socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
			socket.destroy();
			return;
		}

		if (!authenticated) {
			socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
			socket.destroy();
			return;
		}

		// --- Route to appropriate WebSocket server ---
		const upgradeHeaders: Record<string, string> = {};
		if (newToken) {
			upgradeHeaders["X-Pimote-Token"] = newToken;
		}

		if (pathname === "/agent") {
			agentWss.handleUpgrade(req, socket, head, (ws) => {
				clients.add(ws);
				ws.on("close", () => clients.delete(ws));

				// Send token as first message if newly issued
				if (newToken) {
					ws.send(JSON.stringify({ type: "auth", token: newToken }));
				}

				handleAgentConnection(ws, rpcHandler);
				agentWss.emit("connection", ws, req);
			});
		} else if (pathname === "/shell") {
			shellWss.handleUpgrade(req, socket, head, (ws) => {
				clients.add(ws);
				ws.on("close", () => clients.delete(ws));

				if (newToken) {
					ws.send(JSON.stringify({ type: "auth", token: newToken }));
				}

				void handleShellConnection(ws);
				shellWss.emit("connection", ws, req);
			});
		} else {
			socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
			socket.destroy();
		}
	});

	return new Promise((resolve, reject) => {
		server.on("error", reject);
		server.listen(port, host, () => {
			resolve({
				get port() {
					return port;
				},
				get connectedClients() {
					return clients.size;
				},
				close() {
					return new Promise<void>((res) => {
						// Close all WebSocket connections
						for (const client of clients) {
							client.close();
						}
						agentWss.close();
						shellWss.close();
						server.close(() => res());
					});
				},
			});
		});
	});
}
