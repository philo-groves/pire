#!/usr/bin/env node

/**
 * Standalone pimote server that resumes the most recent pire session.
 *
 * Usage:
 *   npx tsx packages/pimote/src/serve-session.ts --pin 1234 [--port 19836] [--host 0.0.0.0]
 */

import { join } from "node:path";
import {
	type CreateAgentSessionRuntimeFactory,
	createAgentSession,
	createAgentSessionRuntime,
	createRpcHandler,
	getAgentDir,
	SessionManager,
} from "@philogroves/pire";
import { hashPin } from "./auth.js";
import { startServer } from "./server.js";
import { startTunnel } from "./tunnel.js";

const IMPLICIT_CONTINUATION = "Continue with the next concrete step. Do not stop after announcing intent.";

function isImplicitContinuation(text: string): boolean {
	return text.trim() === IMPLICIT_CONTINUATION;
}

/**
 * Extract text and thinking from an AgentMessage content array.
 * Thinking blocks are wrapped in <thinking>...</thinking> markers
 * so the mobile client can render them distinctly.
 */
function extractText(msg: any): string {
	if (typeof msg.text === "string") return msg.text;
	if (typeof msg.content === "string") return msg.content;
	if (Array.isArray(msg.content)) {
		const parts: string[] = [];
		for (const c of msg.content) {
			if (c.type === "text" && c.text) {
				parts.push(c.text);
			} else if (c.type === "thinking" && c.thinking) {
				parts.push(`<thinking>${c.thinking}</thinking>`);
			}
		}
		return parts.join("\n");
	}
	return "";
}

/**
 * Simplify raw AgentSessionEvents into mobile-friendly events.
 * Returns null for events that should be suppressed.
 */
function simplifyEvent(event: any): any | null {
	switch (event.type) {
		case "message_start": {
			const msg = event.message;
			if (!msg) return null;
			if (msg.role !== "user" && msg.role !== "assistant") return null;
			const text = extractText(msg);
			if (isImplicitContinuation(text)) return null;
			return {
				type: "message_start",
				message: { id: msg.id, role: msg.role, text },
			};
		}

		case "message_update": {
			const msg = event.message;
			if (!msg || (msg.role !== "user" && msg.role !== "assistant")) return null;
			// Send the accumulated text so the client can replace (not append)
			return {
				type: "message_update",
				message: {
					id: msg.id,
					role: msg.role,
					text: extractText(msg),
				},
			};
		}

		case "message_end": {
			const msg = event.message;
			if (!msg || (msg.role !== "user" && msg.role !== "assistant")) return null;
			return {
				type: "message_end",
				message: {
					id: msg.id,
					role: msg.role,
					text: extractText(msg),
				},
			};
		}

		case "tool_execution_start": {
			// Show as a compact tool call indicator
			return {
				type: "message_start",
				message: {
					id: `tool-${event.toolCallId ?? Date.now()}`,
					role: "tool",
					text: `Tool: \`${event.toolName}\``,
				},
			};
		}

		case "agent_start":
		case "agent_end":
		case "turn_start":
		case "turn_end":
			return event;

		default:
			return null;
	}
}

async function main() {
	const args = process.argv.slice(2);
	let pin: string | undefined;
	let port = 19836;
	let host = "0.0.0.0";
	let cwd = process.cwd();

	for (let i = 0; i < args.length; i++) {
		switch (args[i]) {
			case "--pin":
				pin = args[++i];
				break;
			case "--port":
				port = Number.parseInt(args[++i] ?? "", 10);
				break;
			case "--host":
				host = args[++i] ?? "0.0.0.0";
				break;
			case "--cwd":
				cwd = args[++i] ?? process.cwd();
				break;
		}
	}

	if (!pin) {
		console.error("Usage: serve-session --pin <pin> [--port 19836] [--host 0.0.0.0] [--cwd /path]");
		process.exit(1);
	}

	const agentDir = getAgentDir();
	const sessionDir = join(agentDir, "sessions", `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`);

	// Try to continue the most recent session
	let sessionManager: SessionManager;
	try {
		sessionManager = SessionManager.continueRecent(cwd, sessionDir);
		console.log(`Resuming session: ${sessionManager.getSessionId()}`);
	} catch {
		console.log("No existing session found, creating new one");
		sessionManager = SessionManager.create(cwd, sessionDir);
	}

	// Create a runtime factory for session switching
	const createRuntime: CreateAgentSessionRuntimeFactory = async (opts) => {
		const result = await createAgentSession({
			cwd: opts.cwd,
			agentDir: opts.agentDir,
			sessionManager: opts.sessionManager,
			sessionStartEvent: opts.sessionStartEvent,
		});
		return {
			...result,
			services: { cwd: opts.cwd, agentDir: opts.agentDir } as any,
			diagnostics: [],
		};
	};

	// Create the runtime
	const runtime = await createAgentSessionRuntime(createRuntime, {
		cwd,
		agentDir,
		sessionManager,
	});

	console.log(`Session loaded: ${runtime.session.messages.length} messages`);

	// Create the shared RPC handler and wrap it with session listing
	const innerHandler = createRpcHandler(runtime);

	const rpcHandler = {
		handleCommand: async (command: any): Promise<any> => {
			// Custom command: list available sessions
			if (command.type === "list_sessions") {
				try {
					const sessions = await SessionManager.list(cwd, sessionDir);
					return {
						id: command.id,
						type: "response",
						command: "list_sessions",
						success: true,
						data: {
							currentSessionId: runtime.session.sessionId,
							sessions: sessions.map((s: any) => ({
								id: s.id,
								path: s.path,
								name: s.name,
								cwd: s.cwd,
								created: s.created.toISOString(),
								modified: s.modified.toISOString(),
								messageCount: s.messageCount,
								firstMessage: s.firstMessage?.slice(0, 120),
							})),
						},
					};
				} catch (err: unknown) {
					return {
						id: command.id,
						type: "response",
						command: "list_sessions",
						success: false,
						error: err instanceof Error ? err.message : String(err),
					};
				}
			}

			// Intercept get_messages to filter for mobile-friendly payload
			if (command.type === "get_messages") {
				const response = (await innerHandler.handleCommand(command)) as any;
				if (response.success && response.data?.messages) {
					const simplified: any[] = [];
					for (const m of response.data.messages) {
						if (m.role === "user" || m.role === "assistant") {
							if (Array.isArray(m.content)) {
								const parts: string[] = [];
								const toolNames: string[] = [];
								for (const c of m.content) {
									if (c.type === "text" && c.text) parts.push(c.text);
									else if (c.type === "thinking" && c.thinking)
										parts.push(`<thinking>${c.thinking}</thinking>`);
									else if (c.type === "toolCall" && c.name) toolNames.push(c.name);
								}
								const text = parts.join("\n");
								if (text.length > 0 && !isImplicitContinuation(text)) {
									simplified.push({ id: m.id, role: m.role, text });
								}
								// Add compact tool call indicators after the message
								for (const name of toolNames) {
									simplified.push({ id: `${m.id}-tool-${name}`, role: "tool", text: `Tool: \`${name}\`` });
								}
							} else {
								const text = m.text ?? m.content ?? "";
								if (text.length > 0 && !isImplicitContinuation(text)) {
									simplified.push({ id: m.id, role: m.role, text });
								}
							}
						}
					}
					response.data.messages = simplified;
				}
				return response;
			}

			return innerHandler.handleCommand(command);
		},
		subscribe(listener: (event: any) => void): () => void {
			return innerHandler.subscribe((event: any) => {
				const simplified = simplifyEvent(event);
				if (simplified) listener(simplified);
			});
		},
		dispose: innerHandler.dispose.bind(innerHandler),
	};

	// Hash PIN and start server
	const pinHash = await hashPin(pin);
	const _server = await startServer({ port, host, pinHash, rpcHandler });

	// Show connection info
	console.log(`\npimote server on http://${host}:${port}`);
	console.log(`Session: ${runtime.session.sessionId} (${runtime.session.messages.length} msgs)`);

	// Show local network IPs
	const { networkInterfaces } = await import("node:os");
	const nets = networkInterfaces();
	const localIps: string[] = [];
	for (const [, addrs] of Object.entries(nets)) {
		for (const addr of addrs ?? []) {
			if (addr.family === "IPv4" && !addr.internal) {
				localIps.push(addr.address);
			}
		}
	}
	if (localIps.length > 0) {
		console.log(`\nLocal network:`);
		for (const ip of localIps) {
			console.log(`  http://${ip}:${port}`);
		}
	}

	// Try cloudflared tunnel for external access
	try {
		const tunnel = await startTunnel(port);
		console.log(`\nTunnel (external access): ${tunnel.url}`);
		const { printQrCode } = await import("./qr.js");
		await printQrCode(tunnel.url);
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		if (msg.includes("not found")) {
			console.log(`\nNo cloudflared — local access only. Install for external access:`);
			console.log(`  brew install cloudflare/cloudflare/cloudflared`);
		}
	}

	console.log("\nWaiting for connections...");
	await new Promise(() => {});
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
