import { Box, Container, Spacer, Text } from "@mariozechner/pi-tui";
import type { AgentSessionEvent, SubagentInfo } from "../../../core/agent-session.js";
import { theme } from "../theme/theme.js";

type SubagentUpdateEvent = Extract<AgentSessionEvent, { type: "subagent_update" }>;

function formatPreview(text: string | undefined): string | undefined {
	if (!text) {
		return undefined;
	}
	const preview = text.replace(/\s+/g, " ").trim();
	return preview.length > 0 ? preview : undefined;
}

function shortenId(id: string): string {
	return id.slice(0, 8);
}

function capitalizeStatus(status: SubagentInfo["status"]): string {
	return status.charAt(0).toUpperCase() + status.slice(1);
}

export class SubagentActivityComponent extends Container {
	private info: SubagentInfo;
	private readonly box: Box;
	private expanded = false;
	private selected = false;
	private statusLine: string;
	private detailLine?: string;
	private textPreview = "";

	constructor(info: SubagentInfo, expanded = false) {
		super();
		this.info = info;
		this.expanded = expanded;
		this.statusLine = this.formatStatusLine("spawned");
		this.box = new Box(1, 1, (text) => theme.bg("customMessageBg", text));

		this.addChild(new Spacer(1));
		this.addChild(this.box);
		this.rebuild();
	}

	setExpanded(expanded: boolean): void {
		if (this.expanded !== expanded) {
			this.expanded = expanded;
			this.rebuild();
		}
	}

	setSelected(selected: boolean): void {
		if (this.selected !== selected) {
			this.selected = selected;
			this.rebuild();
		}
	}

	applyStart(info: SubagentInfo): void {
		this.info = info;
		this.statusLine = this.formatStatusLine("starting");
		this.rebuild();
	}

	applyUpdate(event: SubagentUpdateEvent): void {
		this.info = event.subagent;

		switch (event.eventType) {
			case "message_update":
				if (
					(event.assistantEventType === "text_delta" ||
						event.assistantEventType === "thinking_delta" ||
						event.assistantEventType === "toolcall_delta") &&
					event.delta
				) {
					this.appendPreview(event.delta);
				}
				if (event.assistantEventType === "text_end" || event.assistantEventType === "thinking_end") {
					this.setPreview(event.text);
				}
				this.statusLine = this.formatStatusLine(this.describeMessageUpdate(event));
				break;

			case "message_end":
				this.setPreview(event.text);
				this.statusLine = this.formatStatusLine(
					event.isError ? "assistant error" : event.messageRole === "assistant" ? "assistant report" : "message",
				);
				break;

			case "tool_execution_start":
				this.statusLine = this.formatStatusLine(`tool ${event.toolName ?? "call"} running`);
				this.detailLine = event.toolName ? `Tool: ${event.toolName}` : this.detailLine;
				break;

			case "tool_execution_update":
				this.statusLine = this.formatStatusLine(`tool ${event.toolName ?? "call"} updating`);
				break;

			case "tool_execution_end":
				this.statusLine = this.formatStatusLine(
					event.isError ? `tool ${event.toolName ?? "call"} failed` : `tool ${event.toolName ?? "call"} complete`,
				);
				this.detailLine = event.toolName ? `Tool: ${event.toolName}` : this.detailLine;
				break;

			case "turn_end":
				this.setPreview(event.text);
				this.statusLine = this.formatStatusLine("turn complete");
				break;

			case "turn_start":
				this.statusLine = this.formatStatusLine("turn started");
				break;

			case "message_start":
				this.setPreview(event.text);
				this.statusLine = this.formatStatusLine(
					event.messageRole === "assistant" ? "drafting response" : `${event.messageRole ?? "message"} started`,
				);
				break;

			case "agent_start":
				this.statusLine = this.formatStatusLine("running");
				break;

			case "agent_end":
				this.statusLine = this.formatStatusLine("settling");
				break;
		}

		this.rebuild();
	}

	applyEnd(info: SubagentInfo): void {
		this.info = info;
		this.setPreview(info.lastAssistantText ?? info.errorMessage);
		this.statusLine = this.formatStatusLine(info.status === "failed" ? "failed" : "complete");
		this.rebuild();
	}

	private describeMessageUpdate(event: SubagentUpdateEvent): string {
		switch (event.assistantEventType) {
			case "thinking_delta":
			case "thinking_end":
				return "thinking";
			case "toolcall_delta":
				return "building tool call";
			case "toolcall_end":
				return `requested ${event.toolName ?? "tool"}`;
			case "text_delta":
			case "text_end":
				return "drafting response";
			default:
				return "updating";
		}
	}

	private formatStatusLine(activity?: string): string {
		const parts = [
			capitalizeStatus(this.info.status),
			`depth ${this.info.depth}`,
			`${this.info.turns}/${this.info.maxTurns} turns`,
		];
		if (activity) {
			parts.push(activity);
		}
		return parts.join(" · ");
	}

	private setPreview(text: string | undefined): void {
		const preview = formatPreview(text);
		if (preview) {
			this.textPreview = preview;
			this.detailLine = preview;
		}
	}

	private appendPreview(delta: string): void {
		const normalized = delta.replace(/\s+/g, " ");
		if (!normalized.trim()) {
			return;
		}
		this.textPreview = `${this.textPreview}${normalized}`.trim();
		if (this.textPreview.length > 240) {
			this.textPreview = this.textPreview.slice(-240).trimStart();
		}
		this.detailLine = this.textPreview;
	}

	private rebuild(): void {
		this.box.clear();
		this.box.setBgFn((text) => (this.selected ? theme.bg("selectedBg", text) : theme.bg("customMessageBg", text)));
		const prefix = this.selected ? theme.fg("accent", "› ") : "";
		const header = `${prefix}${theme.fg("customMessageLabel", "\x1b[1m[Subagent]\x1b[22m")} ${theme.fg("accent", shortenId(this.info.id))} ${theme.fg("muted", this.info.task)}`;
		this.box.addChild(new Text(header, 0, 0));
		this.box.addChild(new Spacer(1));
		this.box.addChild(new Text(theme.fg("customMessageText", this.statusLine), 0, 0));
		if ((this.expanded || this.selected) && this.detailLine) {
			this.box.addChild(new Spacer(1));
			this.box.addChild(new Text(theme.fg("muted", this.detailLine), 0, 0));
		}
	}
}
