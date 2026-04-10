/**
 * Cloudflare quick tunnel: spawns cloudflared and parses the public URL.
 *
 * Quick tunnels are free, require no account, and create an ephemeral
 * https://*.trycloudflare.com URL that routes to the local server.
 */

import { type ChildProcess, spawn } from "node:child_process";
import { which } from "./utils.js";

export interface TunnelResult {
	url: string;
	process: ChildProcess;
	close(): void;
}

/**
 * Start a cloudflared quick tunnel pointing at the given local port.
 * Returns the public URL once it's ready.
 *
 * Throws if cloudflared is not installed.
 */
export async function startTunnel(localPort: number): Promise<TunnelResult> {
	const cloudflaredPath = await which("cloudflared");
	if (!cloudflaredPath) {
		throw new Error("cloudflared not found. Install with: brew install cloudflare/cloudflare/cloudflared");
	}

	return new Promise((resolve, reject) => {
		const child = spawn(cloudflaredPath, ["tunnel", "--url", `http://localhost:${localPort}`], {
			stdio: ["ignore", "pipe", "pipe"],
		});

		let resolved = false;
		const urlPattern = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;

		const onData = (chunk: Buffer) => {
			if (resolved) return;
			const text = chunk.toString();
			const match = text.match(urlPattern);
			if (match) {
				resolved = true;
				resolve({
					url: match[0],
					process: child,
					close() {
						child.kill("SIGTERM");
					},
				});
			}
		};

		// cloudflared prints the URL to stderr
		child.stderr?.on("data", onData);
		child.stdout?.on("data", onData);

		child.on("error", (err) => {
			if (!resolved) {
				resolved = true;
				reject(err);
			}
		});

		child.on("exit", (code) => {
			if (!resolved) {
				resolved = true;
				reject(new Error(`cloudflared exited with code ${code} before providing a URL`));
			}
		});

		// Timeout after 30 seconds
		setTimeout(() => {
			if (!resolved) {
				resolved = true;
				child.kill("SIGTERM");
				reject(new Error("Timed out waiting for cloudflared to provide a URL"));
			}
		}, 30_000);
	});
}
