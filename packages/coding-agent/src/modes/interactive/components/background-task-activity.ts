import { Box, Container, Spacer, Text } from "@mariozechner/pi-tui";
import type { AgentSessionEvent, BackgroundTaskInfo } from "../../../core/agent-session.js";
import { theme } from "../theme/theme.js";

type BackgroundTaskUpdateEvent = Extract<AgentSessionEvent, { type: "background_task_update" }>;

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

function capitalizeStatus(status: BackgroundTaskInfo["status"]): string {
	return status.charAt(0).toUpperCase() + status.slice(1);
}

export class BackgroundTaskActivityComponent extends Container {
	private info: BackgroundTaskInfo;
	private readonly box: Box;
	private expanded = false;
	private statusLine: string;
	private detailLine?: string;
	private outputPreview = "";

	constructor(info: BackgroundTaskInfo, expanded = false) {
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

	applyStart(info: BackgroundTaskInfo): void {
		this.info = info;
		this.statusLine = this.formatStatusLine("starting");
		this.rebuild();
	}

	applyUpdate(event: BackgroundTaskUpdateEvent): void {
		this.info = event.task;
		if (event.eventType === "output") {
			if (event.delta) {
				this.appendPreview(event.delta);
			}
			this.statusLine = this.formatStatusLine("streaming output");
		} else if (event.eventType === "cancel_requested") {
			this.statusLine = this.formatStatusLine("cancellation requested");
		} else {
			this.setPreview(event.text);
			this.statusLine = this.formatStatusLine("settled");
		}
		this.rebuild();
	}

	applyEnd(info: BackgroundTaskInfo): void {
		this.info = info;
		this.setPreview(info.lastOutput ?? info.errorMessage);
		this.statusLine = this.formatStatusLine(info.status === "failed" ? "failed" : "complete");
		this.rebuild();
	}

	private formatStatusLine(activity?: string): string {
		const parts = [capitalizeStatus(this.info.status)];
		if (this.info.pid !== undefined) {
			parts.push(`pid ${this.info.pid}`);
		}
		if (this.info.exitCode !== undefined) {
			parts.push(`exit ${this.info.exitCode}`);
		}
		if (activity) {
			parts.push(activity);
		}
		return parts.join(" · ");
	}

	private setPreview(text: string | undefined): void {
		const preview = formatPreview(text);
		if (preview) {
			this.outputPreview = preview;
			this.detailLine = preview;
		}
	}

	private appendPreview(delta: string): void {
		const normalized = delta.replace(/\s+/g, " ");
		if (!normalized.trim()) {
			return;
		}
		this.outputPreview = `${this.outputPreview}${normalized}`.trim();
		if (this.outputPreview.length > 240) {
			this.outputPreview = this.outputPreview.slice(-240).trimStart();
		}
		this.detailLine = this.outputPreview;
	}

	private rebuild(): void {
		this.box.clear();
		const header = `${theme.fg("customMessageLabel", "\x1b[1m[Background]\x1b[22m")} ${theme.fg("accent", shortenId(this.info.id))} ${theme.fg("muted", this.info.command)}`;
		this.box.addChild(new Text(header, 0, 0));
		this.box.addChild(new Spacer(1));
		this.box.addChild(new Text(theme.fg("customMessageText", this.statusLine), 0, 0));
		if (this.expanded && this.detailLine) {
			this.box.addChild(new Spacer(1));
			this.box.addChild(new Text(theme.fg("muted", this.detailLine), 0, 0));
		}
	}
}
