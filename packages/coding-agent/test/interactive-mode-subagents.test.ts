import { Container } from "@mariozechner/pi-tui";
import { beforeAll, describe, expect, test, vi } from "vitest";
import { SubagentActivityComponent } from "../src/modes/interactive/components/subagent-activity.js";
import { InteractiveMode } from "../src/modes/interactive/interactive-mode.js";
import { initTheme } from "../src/modes/interactive/theme/theme.js";

type InteractiveModePrototypeWithEnsureSubagentActivity = {
	ensureSubagentActivity(this: Record<string, unknown>, subagent: Record<string, unknown>): unknown;
	updateSelectedActivity(this: Record<string, unknown>): void;
	selectActivity(this: Record<string, unknown>, delta: -1 | 1): void;
	getSelectedSubagentInfo(this: Record<string, unknown>): unknown;
};

function stripAnsi(text: string): string {
	return text.replace(/\x1b\[[0-9;]*m/g, "");
}

describe("SubagentActivityComponent", () => {
	beforeAll(() => {
		initTheme("dark");
	});

	test("renders task, status, and final report", () => {
		const info = {
			id: "12345678-abcd",
			status: "running" as const,
			depth: 1,
			parentDepth: 0,
			task: "Inspect config",
			turns: 0,
			maxTurns: 6,
			createdAt: 1,
			updatedAt: 1,
		};
		const component = new SubagentActivityComponent(info, true);
		component.applyUpdate({
			type: "subagent_update",
			subagent: { ...info, turns: 1, updatedAt: 2 },
			eventType: "message_end",
			messageRole: "assistant",
			text: "Config looks healthy.",
			isError: false,
		});
		component.applyEnd({
			...info,
			status: "idle",
			turns: 1,
			updatedAt: 3,
			lastAssistantText: "Config looks healthy.",
		});

		const output = component.render(120).join("\n");
		expect(output).toContain("Subagent");
		expect(output).toContain("Inspect config");
		expect(output).toContain("Idle");
		expect(output).toContain("Config looks healthy.");
	});
});

describe("InteractiveMode subagent events", () => {
	beforeAll(() => {
		initTheme("dark");
	});

	test("creates and updates a distinct subagent activity row", async () => {
		const fakeThis: any = {
			isInitialized: true,
			footer: { invalidate: vi.fn() },
			ui: { requestRender: vi.fn() },
			chatContainer: new Container(),
			toolOutputExpanded: true,
			subagentComponents: new Map(),
			backgroundTaskComponents: new Map(),
			activityOrder: [],
			selectedActivity: undefined,
		};
		const interactiveModePrototype =
			InteractiveMode.prototype as unknown as InteractiveModePrototypeWithEnsureSubagentActivity;
		fakeThis.ensureSubagentActivity = interactiveModePrototype.ensureSubagentActivity.bind(fakeThis);
		fakeThis.updateSelectedActivity = interactiveModePrototype.updateSelectedActivity.bind(fakeThis);

		const handleEvent = Reflect.get(InteractiveMode.prototype, "handleEvent") as (
			this: typeof fakeThis,
			event: any,
		) => Promise<void>;

		const base = {
			id: "subagent-12345678",
			status: "running" as const,
			depth: 1,
			parentDepth: 0,
			task: "Review files",
			turns: 0,
			maxTurns: 6,
			createdAt: 1,
			updatedAt: 1,
		};

		await handleEvent.call(fakeThis, { type: "subagent_start", subagent: base });
		await handleEvent.call(fakeThis, {
			type: "subagent_update",
			subagent: { ...base, turns: 1, updatedAt: 2 },
			eventType: "message_end",
			messageRole: "assistant",
			text: "Review complete.",
			isError: false,
		});
		await handleEvent.call(fakeThis, {
			type: "subagent_end",
			subagent: {
				...base,
				status: "idle" as const,
				turns: 1,
				updatedAt: 3,
				lastAssistantText: "Review complete.",
			},
		});

		expect(fakeThis.subagentComponents.size).toBe(1);
		const rendered = fakeThis.chatContainer.children
			.flatMap((child: { render: (width: number) => string[] }) => child.render(120))
			.join("\n");
		expect(rendered).toContain("Review files");
		expect(rendered).toContain("Review complete.");
		expect(rendered).toContain("Idle");
	});

	test("cycles the selected subagent row", async () => {
		const fakeThis: any = {
			isInitialized: true,
			footer: { invalidate: vi.fn() },
			ui: { requestRender: vi.fn() },
			chatContainer: new Container(),
			toolOutputExpanded: false,
			subagentComponents: new Map(),
			backgroundTaskComponents: new Map(),
			activityOrder: [],
			selectedActivity: undefined,
			showStatus: vi.fn(),
		};
		const interactiveModePrototype =
			InteractiveMode.prototype as unknown as InteractiveModePrototypeWithEnsureSubagentActivity;
		fakeThis.ensureSubagentActivity = interactiveModePrototype.ensureSubagentActivity.bind(fakeThis);
		fakeThis.updateSelectedActivity = interactiveModePrototype.updateSelectedActivity.bind(fakeThis);
		const selectActivity = interactiveModePrototype.selectActivity.bind(fakeThis);

		fakeThis.ensureSubagentActivity({
			id: "subagent-a",
			status: "running",
			depth: 1,
			parentDepth: 0,
			task: "First",
			turns: 0,
			maxTurns: 6,
			createdAt: 1,
			updatedAt: 1,
		});
		fakeThis.ensureSubagentActivity({
			id: "subagent-b",
			status: "running",
			depth: 1,
			parentDepth: 0,
			task: "Second",
			turns: 0,
			maxTurns: 6,
			createdAt: 1,
			updatedAt: 1,
		});

		expect(fakeThis.selectedActivity).toEqual({ kind: "subagent", id: "subagent-a" });

		selectActivity(1);
		expect(fakeThis.selectedActivity).toEqual({ kind: "subagent", id: "subagent-b" });

		const rendered = fakeThis.chatContainer.children
			.flatMap((child: { render: (width: number) => string[] }) => child.render(120))
			.join("\n");
		const plainRendered = stripAnsi(rendered);
		expect(plainRendered).toContain("› [Subagent]");
		expect(plainRendered).toContain("Second");
	});

	test("performs actions on the selected subagent row", async () => {
		const session = {
			listSubagents: vi.fn(() => [
				{
					id: "subagent-b",
					status: "running",
					depth: 1,
					parentDepth: 0,
					task: "Second",
					turns: 0,
					maxTurns: 6,
					createdAt: 1,
					updatedAt: 1,
					lastAssistantText: "Final child report",
				},
			]),
			waitForSubagent: vi.fn(async () => ({
				id: "subagent-b",
				status: "idle",
				depth: 1,
				parentDepth: 0,
				task: "Second",
				turns: 1,
				maxTurns: 6,
				createdAt: 1,
				updatedAt: 2,
				lastAssistantText: "Final child report",
			})),
			closeSubagent: vi.fn(async () => ({
				id: "subagent-b",
				status: "closed",
				depth: 1,
				parentDepth: 0,
				task: "Second",
				turns: 1,
				maxTurns: 6,
				createdAt: 1,
				updatedAt: 3,
				lastAssistantText: "Final child report",
			})),
		};
		const fakeThis: any = {
			session,
			selectedActivity: { kind: "subagent", id: "subagent-b" },
			showStatus: vi.fn(),
			showWarning: vi.fn(),
			showError: vi.fn(),
			copyTextToClipboard: vi.fn(async () => {}),
		};
		const interactiveModePrototype =
			InteractiveMode.prototype as unknown as InteractiveModePrototypeWithEnsureSubagentActivity & {
				handleSelectedSubagentWait(this: Record<string, unknown>): Promise<void>;
				handleSelectedSubagentClose(this: Record<string, unknown>): Promise<void>;
				handleSelectedSubagentCopy(this: Record<string, unknown>): Promise<void>;
			};
		fakeThis.getSelectedSubagentInfo = interactiveModePrototype.getSelectedSubagentInfo.bind(fakeThis);

		await interactiveModePrototype.handleSelectedSubagentWait.call(fakeThis);
		await interactiveModePrototype.handleSelectedSubagentCopy.call(fakeThis);
		await interactiveModePrototype.handleSelectedSubagentClose.call(fakeThis);

		expect(session.waitForSubagent).toHaveBeenCalledWith("subagent-b");
		expect(fakeThis.copyTextToClipboard).toHaveBeenCalledWith("Final child report");
		expect(session.closeSubagent).toHaveBeenCalledWith("subagent-b");
		expect(fakeThis.showStatus).toHaveBeenCalledWith("Subagent settled: Final child report");
		expect(fakeThis.showStatus).toHaveBeenCalledWith("Closed subagent subagent");
	});

	test("cycles across mixed activity rows in insertion order", async () => {
		const fakeThis: any = {
			isInitialized: true,
			footer: { invalidate: vi.fn() },
			ui: { requestRender: vi.fn() },
			chatContainer: new Container(),
			toolOutputExpanded: false,
			subagentComponents: new Map(),
			backgroundTaskComponents: new Map(),
			activityOrder: [],
			selectedActivity: undefined,
			showStatus: vi.fn(),
		};
		const interactiveModePrototype =
			InteractiveMode.prototype as unknown as InteractiveModePrototypeWithEnsureSubagentActivity & {
				ensureBackgroundTaskActivity(this: Record<string, unknown>, task: Record<string, unknown>): unknown;
			};
		fakeThis.ensureSubagentActivity = interactiveModePrototype.ensureSubagentActivity.bind(fakeThis);
		fakeThis.ensureBackgroundTaskActivity = interactiveModePrototype.ensureBackgroundTaskActivity.bind(fakeThis);
		fakeThis.updateSelectedActivity = interactiveModePrototype.updateSelectedActivity.bind(fakeThis);
		const selectActivity = interactiveModePrototype.selectActivity.bind(fakeThis);

		fakeThis.ensureSubagentActivity({
			id: "subagent-a",
			status: "running",
			depth: 1,
			parentDepth: 0,
			task: "First",
			turns: 0,
			maxTurns: 6,
			createdAt: 1,
			updatedAt: 1,
		});
		fakeThis.ensureBackgroundTaskActivity({
			id: "task-a",
			status: "running",
			command: "sleep 1",
			pid: 101,
			createdAt: 1,
			updatedAt: 1,
		});
		fakeThis.ensureSubagentActivity({
			id: "subagent-b",
			status: "running",
			depth: 1,
			parentDepth: 0,
			task: "Second",
			turns: 0,
			maxTurns: 6,
			createdAt: 1,
			updatedAt: 1,
		});

		expect(fakeThis.selectedActivity).toEqual({ kind: "subagent", id: "subagent-a" });

		selectActivity(1);
		expect(fakeThis.selectedActivity).toEqual({ kind: "backgroundTask", id: "task-a" });

		selectActivity(1);
		expect(fakeThis.selectedActivity).toEqual({ kind: "subagent", id: "subagent-b" });
	});
});
