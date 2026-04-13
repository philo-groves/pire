import { Container, Text } from "@mariozechner/pi-tui";
import type { AgentSessionEvent, BackgroundTaskInfo } from "../../../core/agent-session.js";
import { theme } from "../theme/theme.js";

type BackgroundTaskUpdateEvent = Extract<AgentSessionEvent, { type: "background_task_update" }>;

function shortenId(id: string): string {
	return id.slice(0, 8);
}

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export class BackgroundTaskActivityComponent extends Container {
	private info: BackgroundTaskInfo;
	private activity = "spawned";
	private spinnerFrame = 0;
	private selected = false;

	constructor(info: BackgroundTaskInfo, _expanded = false) {
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

	applyStart(info: BackgroundTaskInfo): void {
		this.info = info;
		this.activity = "starting";
		this.rebuild();
	}

	applyUpdate(event: BackgroundTaskUpdateEvent): void {
		this.info = event.task;
		this.spinnerFrame = (this.spinnerFrame + 1) % SPINNER_FRAMES.length;

		if (event.eventType === "output") {
			this.activity = "running";
		} else if (event.eventType === "cancel_requested") {
			this.activity = "cancelling";
		} else {
			this.activity = "settled";
		}
		this.rebuild();
	}

	applyEnd(info: BackgroundTaskInfo): void {
		this.info = info;
		this.activity =
			info.status === "failed" ? "failed" : info.exitCode !== undefined ? `exit ${info.exitCode}` : "complete";
		this.rebuild();
	}

	private rebuild(): void {
		this.clear();

		const isDone =
			this.info.status === "completed" || this.info.status === "cancelled" || this.info.status === "failed";
		const indicator = isDone
			? this.info.status === "failed"
				? theme.fg("error", "✗")
				: theme.fg("success", "✓")
			: theme.fg("accent", SPINNER_FRAMES[this.spinnerFrame]);

		const id = theme.fg("muted", shortenId(this.info.id));
		const cmd = this.info.command.length > 50 ? `${this.info.command.slice(0, 47)}...` : this.info.command;
		const cmdDisplay = theme.fg("dim", cmd);
		const status = theme.fg(
			"muted",
			this.info.pid !== undefined ? `pid ${this.info.pid} · ${this.activity}` : this.activity,
		);

		const prefix = this.selected ? theme.fg("accent", "› ") : "  ";
		const line = `${prefix}${indicator} ${theme.bold("task")} ${id} ${cmdDisplay} ${status}`;

		this.addChild(new Text(line, 0, 0));
	}
}
