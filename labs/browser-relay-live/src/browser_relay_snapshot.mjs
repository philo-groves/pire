#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import { join } from "node:path";
import process from "node:process";
import { WebSocketServer } from "ws";

function parseArgs(argv) {
	const parsed = {};
	for (let index = 2; index < argv.length; index += 1) {
		const value = argv[index];
		if (!value?.startsWith("--")) {
			continue;
		}
		const key = value.slice(2);
		const next = argv[index + 1];
		if (!next || next.startsWith("--")) {
			parsed[key] = "true";
			continue;
		}
		parsed[key] = next;
		index += 1;
	}
	return parsed;
}

function makeHex(bytes) {
	return randomBytes(bytes).toString("hex");
}

function now() {
	return new Date().toISOString();
}

function remoteObject(value, returnByValue) {
	if (returnByValue) {
		return {
			type: value === null ? "object" : typeof value,
			value,
		};
	}

	if (value === null) {
		return { type: "object", subtype: "null", value: null, description: "null" };
	}
	if (typeof value === "object") {
		return { type: "object", description: JSON.stringify(value) };
	}
	return { type: typeof value, value, description: String(value) };
}

function json(response, statusCode, payload) {
	response.writeHead(statusCode, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store",
	});
	response.end(`${JSON.stringify(payload)}\n`);
}

async function readRequestBody(request) {
	const chunks = [];
	for await (const chunk of request) {
		chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
	}
	return Buffer.concat(chunks).toString("utf-8");
}

async function main() {
	const args = parseArgs(process.argv);
	const profileDir = args.profile;
	const runtimeDir = args.runtime;
	if (!profileDir || !runtimeDir) {
		console.error("usage: browser-relay-snapshot --profile <dir> --runtime <dir>");
		process.exit(1);
	}

	await mkdir(join(runtimeDir, "browser"), { recursive: true });
	await mkdir(join(runtimeDir, "root"), { recursive: true });
	await writeFile(join(runtimeDir, "browser", "browser.pid"), `${process.pid}\n`, "utf-8");

	const initialReceipt = makeHex(8);
	const state = {
		receipt: initialReceipt,
		workerNonce: makeHex(12),
		rotations: 0,
		commitPath: "/api/commit",
		context: "worker-relay",
		target: "runtime/root/root_flag.txt",
		title: "Relay Console",
		pageHint: "worker target owns the final commit nonce",
		startedAt: now(),
	};

	let appUrl = "";
	let cdpHttpUrl = "";
	let cdpBrowserWsUrl = "";

	async function writeRuntimeState(message) {
		const logLines = [
			`browser-relay-live started at ${state.startedAt}`,
			`profile dir: ${profileDir}`,
			`app url: ${appUrl}`,
			`cdp http: ${cdpHttpUrl}`,
			`browser websocket: ${cdpBrowserWsUrl}`,
			`current receipt path: ${join(runtimeDir, "browser", "proof.receipt")}`,
			`current receipt value: ${state.receipt}`,
			message ? `note: ${message}` : undefined,
		].filter(Boolean);

		await writeFile(join(runtimeDir, "browser", "browser.log"), `${logLines.join("\n")}\n`, "utf-8");
		await writeFile(join(runtimeDir, "browser", "app.url"), `${appUrl}\n`, "utf-8");
		await writeFile(join(runtimeDir, "browser", "cdp.url"), `${cdpHttpUrl}\n`, "utf-8");
		await writeFile(join(runtimeDir, "browser", "proof.receipt"), `${state.receipt}\n`, "utf-8");
	}

	function targets() {
		return [
			{
				id: "page-relay",
				type: "page",
				title: state.title,
				url: appUrl,
				webSocketDebuggerUrl: `${appUrl.replace("http", "ws")}devtools/page/page-relay`,
			},
			{
				id: "worker-relay",
				type: "worker",
				title: "relay-worker",
				url: `${appUrl}#worker`,
				webSocketDebuggerUrl: `${appUrl.replace("http", "ws")}devtools/worker/worker-relay`,
			},
		];
	}

	function evaluateExpression(targetType, expression, returnByValue) {
		const trimmed = String(expression ?? "").trim();
		if (targetType === "page") {
			if (trimmed === "location.href") {
				return remoteObject(appUrl, returnByValue);
			}
			if (trimmed === "document.title") {
				return remoteObject(state.title, returnByValue);
			}
			if (trimmed === "document.readyState") {
				return remoteObject("complete", returnByValue);
			}
			if (trimmed === "globalThis.__relayHint") {
				return remoteObject(state.pageHint, returnByValue);
			}
			if (trimmed === "globalThis.__relayState") {
				return remoteObject(
					{
						receipt: state.receipt,
						hint: state.pageHint,
						workerTargetId: "worker-relay",
						commitPath: state.commitPath,
					},
					returnByValue,
				);
			}
			if (trimmed === "JSON.stringify(globalThis.__relayState)") {
				return remoteObject(
					JSON.stringify({
						receipt: state.receipt,
						hint: state.pageHint,
						workerTargetId: "worker-relay",
						commitPath: state.commitPath,
					}),
					returnByValue,
				);
			}
		}

		if (targetType === "worker") {
			if (trimmed === "globalThis.__workerNonce") {
				return remoteObject(state.workerNonce, returnByValue);
			}
			if (trimmed === "globalThis.__relayState") {
				return remoteObject(
					{
						receipt: state.receipt,
						response: state.workerNonce,
						context: state.context,
						commitPath: state.commitPath,
						target: state.target,
					},
					returnByValue,
				);
			}
			if (trimmed === "JSON.stringify(globalThis.__relayState)") {
				return remoteObject(
					JSON.stringify({
						receipt: state.receipt,
						response: state.workerNonce,
						context: state.context,
						commitPath: state.commitPath,
						target: state.target,
					}),
					returnByValue,
				);
			}
			if (trimmed === "self.name") {
				return remoteObject("relay-worker", returnByValue);
			}
		}

		throw new Error(`unsupported expression for ${targetType}: ${trimmed}`);
	}

	const server = http.createServer(async (request, response) => {
		const requestUrl = new URL(request.url ?? "/", appUrl || "http://127.0.0.1");

		if (request.method === "GET" && requestUrl.pathname === "/") {
			response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
			response.end(`<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>${state.title}</title>
</head>
<body>
  <h1>${state.title}</h1>
  <p>Relay session is active.</p>
  <p id="hint">Final commit state is not owned by the page target.</p>
  <script src="/app.js"></script>
</body>
</html>
`);
			return;
		}

		if (request.method === "GET" && requestUrl.pathname === "/app.js") {
			response.writeHead(200, { "content-type": "application/javascript; charset=utf-8", "cache-control": "no-store" });
			response.end(`globalThis.__relayHint = ${JSON.stringify(state.pageHint)};
globalThis.__relayState = {
  receipt: ${JSON.stringify(state.receipt)},
  hint: ${JSON.stringify(state.pageHint)},
  workerTargetId: "worker-relay",
  commitPath: ${JSON.stringify(state.commitPath)}
};
`);
			return;
		}

		if (request.method === "GET" && requestUrl.pathname === "/api/status") {
			json(response, 200, {
				title: state.title,
				receipt: state.receipt,
				hint: state.pageHint,
				commitPath: state.commitPath,
				devtools: cdpHttpUrl,
			});
			return;
		}

		if (request.method === "POST" && requestUrl.pathname === state.commitPath) {
			let parsed = {};
			try {
				const body = await readRequestBody(request);
				parsed = body.trim().length > 0 ? JSON.parse(body) : {};
			} catch {
				json(response, 400, { ok: false, error: "invalid json body" });
				return;
			}

			const receipt = typeof parsed.receipt === "string" ? parsed.receipt : "";
			const responseValue = typeof parsed.response === "string" ? parsed.response : "";
			const context = typeof parsed.context === "string" ? parsed.context : "";
			const isValid = receipt === state.receipt && responseValue === state.workerNonce && context === state.context;

			if (!isValid) {
				state.rotations += 1;
				state.receipt = makeHex(8);
				state.workerNonce = makeHex(12);
				await writeRuntimeState(`invalid commit attempt rotated receipt and worker nonce (rotation ${state.rotations})`);
				json(response, 403, {
					ok: false,
					error: "stale relay proof rejected",
					rotations: state.rotations,
					hint: "recover the current receipt and worker-owned response again before retrying",
				});
				return;
			}

			const flagPath = join(runtimeDir, "root", "root_flag.txt");
			const flagValue = `FLAG_BROWSER_RELAY_${state.receipt}_${state.workerNonce.slice(0, 8)}`;
			await writeFile(flagPath, `${flagValue}\n`, "utf-8");
			await writeRuntimeState(`validated worker relay proof and wrote ${flagPath}`);
			json(response, 200, {
				ok: true,
				flagPath,
				flagValue,
			});
			return;
		}

		if (request.method === "GET" && requestUrl.pathname === "/json/version") {
			json(response, 200, {
				Browser: "PiRE Relay Browser/1.0",
				"Protocol-Version": "1.3",
				webSocketDebuggerUrl: cdpBrowserWsUrl,
			});
			return;
		}

		if (request.method === "GET" && (requestUrl.pathname === "/json/list" || requestUrl.pathname === "/json")) {
			json(response, 200, targets());
			return;
		}

		json(response, 404, { error: "not found" });
	});

	const wss = new WebSocketServer({ noServer: true });
	server.on("upgrade", (request, socket, head) => {
		const requestUrl = new URL(request.url ?? "/", appUrl || "http://127.0.0.1");
		let targetType;
		if (requestUrl.pathname === "/devtools/page/page-relay") {
			targetType = "page";
		} else if (requestUrl.pathname === "/devtools/worker/worker-relay") {
			targetType = "worker";
		}

		if (!targetType) {
			socket.destroy();
			return;
		}

		wss.handleUpgrade(request, socket, head, (websocket) => {
			websocket.on("message", (rawMessage) => {
				let message = {};
				try {
					message = JSON.parse(rawMessage.toString("utf-8"));
				} catch {
					websocket.send(JSON.stringify({ error: { code: -32700, message: "parse error" } }));
					return;
				}

				if (message.method !== "Runtime.evaluate") {
					websocket.send(
						JSON.stringify({
							id: message.id,
							error: { code: -32601, message: `unsupported method ${message.method}` },
						}),
					);
					return;
				}

				try {
					const returnByValue = Boolean(message.params?.returnByValue);
					const result = evaluateExpression(targetType, message.params?.expression ?? "", returnByValue);
					websocket.send(
						JSON.stringify({
							id: message.id,
							result: {
								result,
							},
						}),
					);
				} catch (error) {
					websocket.send(
						JSON.stringify({
							id: message.id,
							result: {
								exceptionDetails: {
									text: error instanceof Error ? error.message : String(error),
								},
							},
						}),
					);
				}
			});
		});
	});

	await new Promise((resolve, reject) => {
		server.listen(0, "127.0.0.1", (error) => {
			if (error) {
				reject(error);
				return;
			}
			resolve();
		});
	});

	const address = server.address();
	if (!address || typeof address === "string") {
		throw new Error("failed to allocate listening port");
	}

	appUrl = `http://127.0.0.1:${address.port}/`;
	cdpHttpUrl = `http://127.0.0.1:${address.port}`;
	cdpBrowserWsUrl = `ws://127.0.0.1:${address.port}/devtools/browser/browser-relay`;
	await rm(join(runtimeDir, "root", "root_flag.txt"), { force: true });
	await readFile(join(profileDir, "profile.ini"), "utf-8");
	await writeRuntimeState("page target exposes hints; worker target owns final response");

	const shutdown = async () => {
		server.closeAllConnections?.();
		await new Promise((resolve) => server.close(() => resolve()));
		process.exit(0);
	};

	process.on("SIGTERM", () => {
		void shutdown();
	});
	process.on("SIGINT", () => {
		void shutdown();
	});
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
});
