/**
 * Shell channel: WebSocket ↔ node-pty.
 *
 * Spawns a PTY with the user's shell and bridges it over WebSocket.
 */

import type { WebSocket } from "ws";
import type { ShellClientMessage } from "./types.js";

// node-pty types from vendor.d.ts
interface IPty {
	onData(callback: (data: string) => void): void;
	onExit(callback: (e: { exitCode: number; signal?: number }) => void): void;
	write(data: string): void;
	resize(cols: number, rows: number): void;
	kill(signal?: string): void;
}

interface PtyModule {
	spawn(file: string, args: string[], options: Record<string, unknown>): IPty;
}

// node-pty is an optional native dependency — import dynamically
let ptyModule: PtyModule | undefined;

async function getPty(): Promise<PtyModule> {
	if (ptyModule) return ptyModule;
	try {
		ptyModule = (await import("node-pty" as string)) as PtyModule;
		return ptyModule;
	} catch {
		throw new Error("node-pty is not installed. Install with: npm install node-pty");
	}
}

export async function handleShellConnection(ws: WebSocket): Promise<void> {
	let pty: PtyModule;
	try {
		pty = await getPty();
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		if (ws.readyState === ws.OPEN) {
			ws.send(JSON.stringify({ type: "data", data: `\r\n\x1b[31mError: ${msg}\x1b[0m\r\n` }));
			ws.close();
		}
		return;
	}

	let ptyProcess: IPty;
	try {
		const shell = process.env.SHELL || "/bin/zsh";
		ptyProcess = pty.spawn(shell, [], {
			name: "xterm-256color",
			cols: 80,
			rows: 24,
			cwd: process.cwd(),
			env: process.env as Record<string, string>,
		});
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		if (ws.readyState === ws.OPEN) {
			ws.send(JSON.stringify({ type: "data", data: `\r\n\x1b[31mFailed to spawn shell: ${msg}\x1b[0m\r\n` }));
			ws.close();
		}
		return;
	}

	// PTY → WebSocket
	ptyProcess.onData((data: string) => {
		if (ws.readyState === ws.OPEN) {
			ws.send(JSON.stringify({ type: "data", data }));
		}
	});

	ptyProcess.onExit(({ exitCode }: { exitCode: number }) => {
		if (ws.readyState === ws.OPEN) {
			ws.send(JSON.stringify({ type: "exit", code: exitCode }));
			ws.close();
		}
	});

	// WebSocket → PTY
	ws.on("message", (raw) => {
		try {
			const msg = JSON.parse(String(raw)) as ShellClientMessage;
			switch (msg.type) {
				case "data":
					ptyProcess.write(msg.data);
					break;
				case "resize":
					ptyProcess.resize(msg.cols, msg.rows);
					break;
			}
		} catch {
			// Ignore malformed messages
		}
	});

	ws.on("close", () => {
		ptyProcess.kill();
	});
}
