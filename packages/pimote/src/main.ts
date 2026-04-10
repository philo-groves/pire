#!/usr/bin/env node

/**
 * Pimote CLI entry point.
 *
 * Usage:
 *   pimote --pin <pin>           Start with specified PIN
 *   pimote --port <port>         Override default port (19836)
 *   pimote --no-tunnel           Skip cloudflared tunnel
 *
 * Normally invoked via the /pimote slash command rather than directly.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { hashPin } from "./auth.js";
import { printQrCode } from "./qr.js";
import type { RpcHandler } from "./rpc-handler-types.js";
import { startServer } from "./server.js";
import { startTunnel, type TunnelResult } from "./tunnel.js";
import type { PimoteConfig } from "./types.js";

const DEFAULT_PORT = 19836;
const CONFIG_DIR = path.join(os.homedir(), ".pi");
const CONFIG_PATH = path.join(CONFIG_DIR, "pimote.json");

// ---------------------------------------------------------------------------
// Config persistence
// ---------------------------------------------------------------------------

function loadConfig(): PimoteConfig | undefined {
	try {
		const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
		return JSON.parse(raw) as PimoteConfig;
	} catch {
		return undefined;
	}
}

function saveConfig(config: PimoteConfig): void {
	fs.mkdirSync(CONFIG_DIR, { recursive: true });
	fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`);
}

// ---------------------------------------------------------------------------
// Programmatic start (used by /pimote command)
// ---------------------------------------------------------------------------

export interface StartPimoteOptions {
	pin?: string;
	port?: number;
	host?: string;
	noTunnel?: boolean;
	rpcHandler: RpcHandler;
}

export interface PimoteInstance {
	port: number;
	localUrl: string;
	tunnelUrl?: string;
	connectedClients: number;
	stop(): Promise<void>;
}

export async function startPimote(options: StartPimoteOptions): Promise<PimoteInstance> {
	const port = options.port ?? DEFAULT_PORT;

	// Resolve PIN hash
	let config = loadConfig();
	if (options.pin) {
		const pinHash = await hashPin(options.pin);
		config = { pinHash, port };
		saveConfig(config);
	}

	if (!config?.pinHash) {
		throw new Error("No PIN configured. Use: /pimote start <pin>");
	}

	// Start server
	const host = options.host ?? "127.0.0.1";
	const server = await startServer({
		port,
		host,
		pinHash: config.pinHash,
		rpcHandler: options.rpcHandler,
	});

	const localUrl = `http://127.0.0.1:${port}`;
	console.log(`\npimote server listening on ${localUrl}`);

	// Try starting tunnel
	let tunnel: TunnelResult | undefined;
	if (!options.noTunnel) {
		try {
			tunnel = await startTunnel(port);
			console.log(`\ntunnel URL: ${tunnel.url}`);
			console.log("");
			await printQrCode(tunnel.url);
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			if (msg.includes("not found")) {
				console.log(`\ncloudflared not found. Install with: brew install cloudflare/cloudflare/cloudflared`);
				console.log(`Running in local-only mode on ${localUrl}`);
			} else {
				console.log(`\nFailed to start tunnel: ${msg}`);
				console.log(`Running in local-only mode on ${localUrl}`);
			}
		}
	}

	return {
		port,
		localUrl,
		tunnelUrl: tunnel?.url,
		get connectedClients() {
			return server.connectedClients;
		},
		async stop() {
			tunnel?.close();
			await server.close();
		},
	};
}

// ---------------------------------------------------------------------------
// CLI entry (standalone mode — not typical usage)
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
	const args = process.argv.slice(2);

	let pin: string | undefined;
	let _port = DEFAULT_PORT;
	let _noTunnel = false;

	for (let i = 0; i < args.length; i++) {
		switch (args[i]) {
			case "--pin":
				pin = args[++i];
				break;
			case "--port":
				_port = Number.parseInt(args[++i] ?? "", 10);
				break;
			case "--no-tunnel":
				_noTunnel = true;
				break;
			default:
				console.error(`Unknown argument: ${args[i]}`);
				process.exit(1);
		}
	}

	if (!pin && !loadConfig()?.pinHash) {
		console.error("No PIN set. Use --pin <pin> to set one (min 4 characters).");
		process.exit(1);
	}

	if (pin && pin.length < 4) {
		console.error("PIN must be at least 4 characters.");
		process.exit(1);
	}

	// In standalone mode, we don't have an RPC handler — create a no-op one
	console.error("pimote standalone mode: no agent session available.");
	console.error("Use the /pimote command within a pire session instead.");
	process.exit(1);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
