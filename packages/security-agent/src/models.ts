import type { ThinkingLevel } from "@mariozechner/pi-agent-core";
import type { Api, KnownProvider, Model } from "@mariozechner/pi-ai";
import { getModels, getProviders, supportsXhigh } from "@mariozechner/pi-ai";
import { hasConfiguredAuth } from "./auth.js";

const AUTO_PROVIDER_ORDER: KnownProvider[] = [
	"openai-codex",
	"anthropic",
	"openai",
	"google",
	"google-gemini-cli",
	"github-copilot",
	"openrouter",
	"xai",
	"groq",
	"cerebras",
	"zai",
	"google-vertex",
	"amazon-bedrock",
	"mistral",
];

const DEFAULT_MODEL_IDS: Partial<Record<KnownProvider, string>> = {
	"openai-codex": "gpt-5.4",
	anthropic: "claude-opus-4-6",
	openai: "gpt-5.4",
	google: "gemini-2.5-pro",
	"google-gemini-cli": "gemini-2.5-pro",
	"github-copilot": "gpt-4o",
	openrouter: "openai/gpt-5.1-codex",
	xai: "grok-4-fast-non-reasoning",
	groq: "openai/gpt-oss-120b",
	cerebras: "zai-glm-4.7",
	zai: "glm-5",
	"google-vertex": "gemini-3-pro-preview",
	"amazon-bedrock": "us.anthropic.claude-opus-4-6-v1",
	mistral: "devstral-medium-latest",
};

const VALID_THINKING_LEVELS = new Set<ThinkingLevel>(["off", "minimal", "low", "medium", "high", "xhigh"]);

function isKnownProvider(value: string): value is KnownProvider {
	return getProviders().includes(value as KnownProvider);
}

function listProviderModels(provider: KnownProvider): Model<Api>[] {
	return getModels(provider) as Model<Api>[];
}

function findModel(provider: KnownProvider, modelId: string): Model<Api> | undefined {
	return listProviderModels(provider).find((model) => model.id === modelId);
}

function getDefaultModel(provider: KnownProvider): Model<Api> | undefined {
	const defaultModelId = DEFAULT_MODEL_IDS[provider];
	if (defaultModelId) {
		const model = findModel(provider, defaultModelId);
		if (model) {
			return model;
		}
	}

	return listProviderModels(provider)[0];
}

export function parseThinkingLevel(value: string | undefined): ThinkingLevel | undefined {
	if (!value) {
		return undefined;
	}

	if (!VALID_THINKING_LEVELS.has(value as ThinkingLevel)) {
		return undefined;
	}

	return value as ThinkingLevel;
}

export function clampThinkingLevel(model: Model<Api>, requested: ThinkingLevel): ThinkingLevel {
	if (!model.reasoning) {
		return "off";
	}

	if (requested === "xhigh" && !supportsXhigh(model)) {
		return "high";
	}

	return requested;
}

export function resolveModelCommandInput(input: string, currentModel: Model<Api>): Model<Api> {
	const trimmed = input.trim();
	if (trimmed.length === 0) {
		return currentModel;
	}

	const parts = trimmed.split(/\s+/).filter((part) => part.length > 0);
	if (parts.length >= 2 && isKnownProvider(parts[0]!)) {
		return resolveModel({ provider: parts[0]!, modelId: parts.slice(1).join(" ") });
	}

	if (trimmed.includes("/")) {
		const separatorIndex = trimmed.indexOf("/");
		const provider = trimmed.slice(0, separatorIndex);
		const modelId = trimmed.slice(separatorIndex + 1);
		if (!provider || !modelId) {
			throw new Error(`Invalid model selector "${trimmed}". Use /model <provider>/<model-id>.`);
		}
		return resolveModel({ provider, modelId });
	}

	if (isKnownProvider(trimmed)) {
		return resolveModel({ provider: trimmed });
	}

	if (isKnownProvider(currentModel.provider)) {
		const currentProviderMatch = findModel(currentModel.provider, trimmed);
		if (currentProviderMatch) {
			return currentProviderMatch;
		}
	}

	const matches = getProviders().flatMap((provider) =>
		listProviderModels(provider).filter((model) => model.id === trimmed),
	);
	if (matches.length === 1) {
		return matches[0]!;
	}
	if (matches.length > 1) {
		const providers = Array.from(new Set(matches.map((model) => model.provider))).join(", ");
		throw new Error(`Model "${trimmed}" is ambiguous across ${providers}. Use /model <provider>/<model-id>.`);
	}

	throw new Error(`Model "${trimmed}" not found.`);
}

export interface ResolveModelOptions {
	provider?: string;
	modelId?: string;
}

export function resolveModel(options: ResolveModelOptions): Model<Api> {
	if (options.provider) {
		if (!isKnownProvider(options.provider)) {
			throw new Error(`Unknown provider "${options.provider}"`);
		}

		if (options.modelId) {
			const model = findModel(options.provider, options.modelId);
			if (!model) {
				throw new Error(`Model "${options.provider}/${options.modelId}" not found`);
			}
			return model;
		}

		const defaultModel = getDefaultModel(options.provider);
		if (!defaultModel) {
			throw new Error(`Provider "${options.provider}" has no registered models`);
		}
		return defaultModel;
	}

	for (const provider of AUTO_PROVIDER_ORDER) {
		if (!hasConfiguredAuth(provider)) {
			continue;
		}

		const defaultModel = getDefaultModel(provider);
		if (defaultModel) {
			return defaultModel;
		}
	}

	throw new Error(
		"No configured model found. Pass --provider/--model or configure auth in env vars or ~/.pi/agent/auth.json.",
	);
}
