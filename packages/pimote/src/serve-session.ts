#!/usr/bin/env node

/**
 * Pimote session observer — reads the live pire session file and streams
 * updates to mobile clients over WebSocket. Does NOT create its own
 * AgentSessionRuntime, so it never competes with the running pire process.
 *
 * Usage:
 *   npx tsx packages/pimote/src/serve-session.ts --pin 1234 [--port 19836] [--host 0.0.0.0]
 */

import * as fs from "node:fs";
import { join } from "node:path";
import { getAgentDir, type SessionInfo, SessionManager } from "@philogroves/pire";
import { hashPin } from "./auth.js";
import { startServer } from "./server.js";
import { startTunnel } from "./tunnel.js";

const IMPLICIT_CONTINUATION = "Continue with the next concrete step. Do not stop after announcing intent.";

function isImplicitContinuation(text: string): boolean {
	return text.trim() === IMPLICIT_CONTINUATION;
}

/** Extract user-visible text from a session entry's message content. */
function extractMessageText(msg: any): string {
	if (typeof msg.content === "string") return msg.content;
	if (Array.isArray(msg.content)) {
		const parts: string[] = [];
		for (const c of msg.content) {
			if (c.type === "text" && c.text) parts.push(c.text);
			else if (c.type === "thinking" && c.thinking) parts.push(`<thinking>${c.thinking}</thinking>`);
		}
		return parts.join("\n");
	}
	return msg.text ?? "";
}

/** Extract tool call names from a message content array. */
function extractToolNames(msg: any): string[] {
	if (!Array.isArray(msg.content)) return [];
	return msg.content.filter((c: any) => c.type === "toolCall" && c.name).map((c: any) => c.name);
}

/** Parse a session JSONL file into mobile-friendly messages. */
function parseSessionFile(filePath: string): any[] {
	if (!fs.existsSync(filePath)) return [];
	const lines = fs.readFileSync(filePath, "utf-8").split("\n").filter(Boolean);
	const simplified: any[] = [];

	for (const line of lines) {
		let entry: any;
		try {
			entry = JSON.parse(line);
		} catch {
			continue;
		}
		if (entry.type !== "message") continue;
		const msg = entry.message;
		if (!msg || (msg.role !== "user" && msg.role !== "assistant")) continue;

		const text = extractMessageText(msg);
		if (text.length > 0 && !isImplicitContinuation(text)) {
			simplified.push({ id: msg.id ?? entry.id, role: msg.role, text });
		}

		const toolNames = extractToolNames(msg);
		for (const name of toolNames) {
			simplified.push({ id: `${msg.id ?? entry.id}-tool-${name}`, role: "tool", text: `Tool: \`${name}\`` });
		}
	}

	return simplified;
}

/**
 * Watch a session directory for the most recently modified JSONL file.
 * Auto-switches to new files when they appear (e.g. new pire session).
 * Calls listener whenever the active file's content changes.
 */
function watchSessionDir(
	sessionDir: string,
	onFileChanged: (filePath: string, messages: any[]) => void,
): { getCurrentFile: () => string | undefined; stop: () => void } {
	let currentFile = findMostRecentSessionFile(sessionDir);
	let lastSize = 0;
	let lastMtime = 0;
	try {
		if (currentFile) {
			const stat = fs.statSync(currentFile);
			lastSize = stat.size;
			lastMtime = stat.mtimeMs;
		}
	} catch {}

	const check = () => {
		try {
			// Check if a newer file appeared in the directory
			const newest = findMostRecentSessionFile(sessionDir);
			if (newest && newest !== currentFile) {
				currentFile = newest;
				lastSize = 0;
				lastMtime = 0;
				console.log(`[pimote] Switched to session: ${newest}`);
			}

			if (!currentFile) return;

			const stat = fs.statSync(currentFile);
			if (stat.size !== lastSize || stat.mtimeMs !== lastMtime) {
				lastSize = stat.size;
				lastMtime = stat.mtimeMs;
				const messages = parseSessionFile(currentFile);
				onFileChanged(currentFile, messages);
			}
		} catch {
			// file may be temporarily unavailable
		}
	};

	const interval = setInterval(check, 500);
	return {
		getCurrentFile: () => currentFile,
		stop: () => clearInterval(interval),
	};
}

/** Find the most recent session JSONL file in a directory. */
function findMostRecentSessionFile(sessionDir: string): string | undefined {
	if (!fs.existsSync(sessionDir)) return undefined;
	const files = fs
		.readdirSync(sessionDir)
		.filter((f) => f.endsWith(".jsonl"))
		.sort();
	if (files.length === 0) return undefined;
	// Sort by mtime to get the most recent
	const withMtime = files.map((f) => {
		const p = join(sessionDir, f);
		return { path: p, mtime: fs.statSync(p).mtimeMs };
	});
	withMtime.sort((a, b) => b.mtime - a.mtime);
	return withMtime[0]?.path;
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

	// Find the most recent session file
	const initialFile = findMostRecentSessionFile(sessionDir);
	if (!initialFile) {
		console.error("No session files found in", sessionDir);
		process.exit(1);
	}

	console.log(`Observing session: ${initialFile}`);
	let currentMessages = parseSessionFile(initialFile);
	console.log(`Loaded ${currentMessages.length} messages`);

	// Track connected WebSocket listeners for broadcasting
	const wsListeners = new Set<(event: any) => void>();

	// Queue for messages sent from mobile, drained by pire extension polling /input
	const pendingInput: string[] = [];

	// Watch the entire session directory — auto-switches to newest file
	const watcher = watchSessionDir(sessionDir, (_filePath, messages) => {
		currentMessages = messages;
		for (const listener of wsListeners) {
			listener({ type: "session_refresh" });
		}
	});

	// Build a read-only RPC handler
	const rpcHandler = {
		handleCommand: async (command: any): Promise<any> => {
			const id = command.id;

			switch (command.type) {
				case "get_messages":
					return {
						id,
						type: "response",
						command: "get_messages",
						success: true,
						data: { messages: currentMessages },
					};

				case "list_sessions": {
					try {
						const sessions = await SessionManager.list(cwd, sessionDir);
						return {
							id,
							type: "response",
							command: "list_sessions",
							success: true,
							data: {
								currentSessionId: watcher.getCurrentFile(),
								sessions: sessions.map((s: SessionInfo) => ({
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
							id,
							type: "response",
							command: "list_sessions",
							success: false,
							error: err instanceof Error ? err.message : String(err),
						};
					}
				}

				case "switch_session": {
					const newPath = command.sessionPath;
					if (!newPath || !fs.existsSync(newPath)) {
						return {
							id,
							type: "response",
							command: "switch_session",
							success: false,
							error: "Session file not found",
						};
					}
					// Load the requested session (watcher will auto-track the most recent)
					currentMessages = parseSessionFile(newPath);
					return { id, type: "response", command: "switch_session", success: true, data: { cancelled: false } };
				}

				case "prompt":
				case "steer":
				case "follow_up": {
					const inputMsg = command.message ?? "";
					if (inputMsg.length > 0) {
						pendingInput.push(inputMsg);
						console.log(`[pimote] Queued remote input: ${inputMsg.slice(0, 80)}`);
					}
					return { id, type: "response", command: command.type, success: true };
				}

				case "get_state":
					return {
						id,
						type: "response",
						command: "get_state",
						success: true,
						data: {
							isStreaming: false,
							messageCount: currentMessages.length,
							sessionFile: watcher.getCurrentFile(),
						},
					};

				default:
					return { id, type: "response", command: command.type, success: false, error: "Read-only observer mode" };
			}
		},

		subscribe(listener: (event: any) => void): () => void {
			wsListeners.add(listener);
			return () => wsListeners.delete(listener);
		},

		async dispose(): Promise<void> {
			watcher.stop();
			wsListeners.clear();
		},
	};

	// Start server
	const pinHash = await hashPin(pin);
	const _server = await startServer({
		port,
		host,
		pinHash,
		rpcHandler,
		drainInput: () => pendingInput.splice(0),
	});

	// Show connection info
	console.log(`\npimote server on http://${host}:${port}`);
	console.log(`Messages: ${currentMessages.length}`);

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

	// Try cloudflared tunnel
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
