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
