/**
 * Agent bridge: WebSocket adapter for the shared RPC handler.
 *
 * Receives RpcCommand JSON over WebSocket, dispatches via createRpcHandler,
 * and streams RpcResponse + AgentSessionEvent back to the client.
 */

import type { WebSocket } from "ws";
import type { RpcHandler } from "./rpc-handler-types.js";

export function handleAgentConnection(ws: WebSocket, rpcHandler: RpcHandler): void {
	// Subscribe to session events and forward to this client
	const unsubscribe = rpcHandler.subscribe((event) => {
		if (ws.readyState === ws.OPEN) {
			ws.send(JSON.stringify(event));
		}
	});

	// Handle incoming commands
	ws.on("message", (raw) => {
		let command: unknown;
		try {
			command = JSON.parse(String(raw));
		} catch {
			ws.send(
				JSON.stringify({
					type: "response",
					command: "parse",
					success: false,
					error: "Failed to parse command JSON",
				}),
			);
			return;
		}

		void (async () => {
			try {
				const response = await rpcHandler.handleCommand(command as any);
				if (ws.readyState === ws.OPEN) {
					ws.send(JSON.stringify(response));
				}
			} catch (err: unknown) {
				if (ws.readyState === ws.OPEN) {
					ws.send(
						JSON.stringify({
							type: "response",
							command: (command as any)?.type ?? "unknown",
							success: false,
							error: err instanceof Error ? err.message : String(err),
						}),
					);
				}
			}
		})();
	});

	ws.on("close", () => {
		unsubscribe();
	});
}
