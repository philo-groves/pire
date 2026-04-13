import { Container, Text } from "@mariozechner/pi-tui";
import type { AgentSessionEvent, SubagentInfo } from "../../../core/agent-session.js";
import { theme } from "../theme/theme.js";

type SubagentUpdateEvent = Extract<AgentSessionEvent, { type: "subagent_update" }>;

function shortenId(id: string): string {
	return id.slice(0, 8);
}

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export class SubagentActivityComponent extends Container {
	private info: SubagentInfo;
	private activity = "spawned";
	private spinnerFrame = 0;
	private selected = false;

	constructor(info: SubagentInfo, _expanded = false) {
		super();
		this.info = info;
		this.rebuild();
	}

	setExpanded(_expanded: boolean): void {
		// Output is no longer shown to the user — kept compact
	}

	setSelected(selected: boolean): void {
		if (this.selected !== selected) {
			this.selected = selected;
			this.rebuild();
		}
	}

	applyStart(info: SubagentInfo): void {
		this.info = info;
		this.activity = "starting";
		this.rebuild();
	}

	applyUpdate(event: SubagentUpdateEvent): void {
		this.info = event.subagent;
		this.spinnerFrame = (this.spinnerFrame + 1) % SPINNER_FRAMES.length;

		switch (event.eventType) {
			case "message_update":
				if (event.assistantEventType === "thinking_delta" || event.assistantEventType === "thinking_end") {
					this.activity = "thinking";
				} else if (event.assistantEventType === "toolcall_delta" || event.assistantEventType === "toolcall_end") {
					this.activity = event.toolName ? `running ${event.toolName}` : "tool call";
				} else {
					this.activity = "working";
				}
				break;
			case "tool_execution_start":
				this.activity = event.toolName ? `running ${event.toolName}` : "tool call";
				break;
			case "tool_execution_end":
				this.activity = event.isError ? `${event.toolName ?? "tool"} failed` : `${event.toolName ?? "tool"} done`;
				break;
			case "turn_end":
				this.activity = "turn complete";
				break;
			case "turn_start":
				this.activity = "new turn";
				break;
			case "agent_end":
				this.activity = "finishing";
				break;
			default:
				break;
		}

		this.rebuild();
	}

	applyEnd(info: SubagentInfo): void {
		this.info = info;
		this.activity = info.status === "failed" ? "failed" : "complete";
		this.rebuild();
	}

	private rebuild(): void {
		this.clear();

		const isDone = this.info.status === "idle" || this.info.status === "closed" || this.info.status === "failed";
		const indicator = isDone
			? this.info.status === "failed"
				? theme.fg("error", "✗")
				: theme.fg("success", "✓")
			: theme.fg("accent", SPINNER_FRAMES[this.spinnerFrame]);

		const id = theme.fg("muted", shortenId(this.info.id));
		const task = theme.fg("dim", this.info.task.length > 60 ? `${this.info.task.slice(0, 57)}...` : this.info.task);
		const status = theme.fg("muted", `${this.info.turns}/${this.info.maxTurns}t · ${this.activity}`);

		const prefix = this.selected ? theme.fg("accent", "› ") : "  ";
		const line = `${prefix}${indicator} ${theme.bold("subagent")} ${id} ${task} ${status}`;

		this.addChild(new Text(line, 0, 0));
	}
}
