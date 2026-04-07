import type { SessionEntry } from "./session-manager.js";

export const IMPLICIT_CONTINUATION_MESSAGE =
	"Continue with the next concrete step. Do not stop after announcing intent.";

export function extractTextContent(content: string | Array<{ type: string; text?: string }> | undefined): string {
	if (content === undefined) {
		return "";
	}
	if (typeof content === "string") {
		return content;
	}
	return content
		.filter((part): part is { type: "text"; text: string } => part.type === "text" && typeof part.text === "string")
		.map((part) => part.text)
		.join("\n");
}

export function isImplicitContinuationText(text: string): boolean {
	return text.trim() === IMPLICIT_CONTINUATION_MESSAGE;
}

export function isImplicitContinuationUserMessage(message: {
	role: string;
	content?: string | Array<{ type: string; text?: string }>;
}): boolean {
	return message.role === "user" && isImplicitContinuationText(extractTextContent(message.content));
}

export function isImplicitContinuationEntry(entry: SessionEntry): boolean {
	return entry.type === "message" && isImplicitContinuationUserMessage(entry.message);
}
