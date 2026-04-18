import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { KnownProvider } from "@mariozechner/pi-ai";
import { getEnvApiKey } from "@mariozechner/pi-ai";
import type { OAuthCredentials } from "@mariozechner/pi-ai/oauth";
import { getOAuthApiKey } from "@mariozechner/pi-ai/oauth";

type ApiKeyCredential = {
	type: "api_key";
	key: string;
};

type OAuthCredential = {
	type: "oauth";
} & OAuthCredentials;

type AuthCredential = ApiKeyCredential | OAuthCredential;
type AuthStorageData = Record<string, AuthCredential>;

function getDefaultAgentDir(): string {
	const envDir = process.env.PI_CODING_AGENT_DIR;
	if (envDir) {
		if (envDir === "~") {
			return homedir();
		}
		if (envDir.startsWith("~/")) {
			return join(homedir(), envDir.slice(2));
		}
		return envDir;
	}

	return join(homedir(), ".pi", "agent");
}

export function getDefaultAuthPath(): string {
	return join(getDefaultAgentDir(), "auth.json");
}

function loadAuthData(authPath: string = getDefaultAuthPath()): AuthStorageData {
	if (!existsSync(authPath)) {
		return {};
	}

	try {
		return JSON.parse(readFileSync(authPath, "utf-8")) as AuthStorageData;
	} catch {
		return {};
	}
}

function persistAuthData(authPath: string, data: AuthStorageData): void {
	writeFileSync(authPath, `${JSON.stringify(data, null, 2)}\n`, "utf-8");
}

export function hasConfiguredAuth(provider: KnownProvider, authPath?: string): boolean {
	if (getEnvApiKey(provider)) {
		return true;
	}

	const data = loadAuthData(authPath);
	return provider in data;
}

export async function getConfiguredApiKey(
	provider: string,
	authPath: string = getDefaultAuthPath(),
): Promise<string | undefined> {
	const envKey = getEnvApiKey(provider);
	if (envKey) {
		return envKey;
	}

	const data = loadAuthData(authPath);
	const credential = data[provider];
	if (!credential) {
		return undefined;
	}

	if (credential.type === "api_key") {
		return credential.key;
	}

	const oauthCredentials: Record<string, OAuthCredentials> = {};
	for (const [providerId, value] of Object.entries(data)) {
		if (value.type === "oauth") {
			oauthCredentials[providerId] = value;
		}
	}

	const resolved = await getOAuthApiKey(provider, oauthCredentials);
	if (!resolved) {
		return undefined;
	}

	data[provider] = { type: "oauth", ...resolved.newCredentials };
	persistAuthData(authPath, data);
	return resolved.apiKey;
}
