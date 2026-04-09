import { Container } from "@mariozechner/pi-tui";
import { beforeAll, describe, expect, test, vi } from "vitest";
import { BackgroundTaskActivityComponent } from "../src/modes/interactive/components/background-task-activity.js";
import { InteractiveMode } from "../src/modes/interactive/interactive-mode.js";
import { initTheme } from "../src/modes/interactive/theme/theme.js";

type InteractiveModePrototypeWithEnsureBackgroundTaskActivity = {
	ensureBackgroundTaskActivity(this: Record<string, unknown>, task: Record<string, unknown>): unknown;
	updateSelectedActivity(this: Record<string, unknown>): void;
	selectActivity(this: Record<string, unknown>, delta: -1 | 1): void;
	getSelectedBackgroundTaskInfo(this: Record<string, unknown>): unknown;
};

function stripAnsi(text: string): string {
	return text.replace(/\x1b\[[0-9;]*m/g, "");
}

describe("BackgroundTaskActivityComponent", () => {
	beforeAll(() => {
		initTheme("dark");
	});

	test("renders command, status, and output preview", () => {
		const info = {
			id: "task-12345678",
			status: "running" as const,
			command: "sleep 1; echo done",
			pid: 123,
			createdAt: 1,
			updatedAt: 1,
		};
		const component = new BackgroundTaskActivityComponent(info, true);
		component.applyUpdate({
			type: "background_task_update",
			task: { ...info, updatedAt: 2, lastOutput: "done" },
			eventType: "output",
			delta: "done",
			text: "done",
		});
		component.applyEnd({
			...info,
			status: "completed",
			lastOutput: "done",
			exitCode: 0,
			updatedAt: 3,
		});

		const output = component.render(120).join("\n");
		expect(output).toContain("Background");
		expect(output).toContain("sleep 1; echo done");
		expect(output).toContain("Completed");
		expect(output).toContain("done");
	});
});

describe("InteractiveMode background task events", () => {
	beforeAll(() => {
		initTheme("dark");
	});

	test("creates and updates a distinct background task activity row", async () => {
		const fakeThis: any = {
			isInitialized: true,
			footer: { invalidate: vi.fn() },
			ui: { requestRender: vi.fn() },
			chatContainer: new Container(),
			toolOutputExpanded: true,
			backgroundTaskComponents: new Map(),
			subagentComponents: new Map(),
			activityOrder: [],
			selectedActivity: undefined,
		};
		const interactiveModePrototype =
			InteractiveMode.prototype as unknown as InteractiveModePrototypeWithEnsureBackgroundTaskActivity;
		fakeThis.ensureBackgroundTaskActivity = interactiveModePrototype.ensureBackgroundTaskActivity.bind(fakeThis);
		fakeThis.updateSelectedActivity = interactiveModePrototype.updateSelectedActivity.bind(fakeThis);

		const handleEvent = Reflect.get(InteractiveMode.prototype, "handleEvent") as (
			this: typeof fakeThis,
			event: any,
		) => Promise<void>;

		const base = {
			id: "task-12345678",
			status: "running" as const,
			command: "sleep 1; echo done",
			pid: 123,
			createdAt: 1,
			updatedAt: 1,
		};

		await handleEvent.call(fakeThis, { type: "background_task_start", task: base });
		await handleEvent.call(fakeThis, {
			type: "background_task_update",
			task: { ...base, updatedAt: 2, lastOutput: "done" },
			eventType: "output",
			delta: "done",
			text: "done",
		});
		await handleEvent.call(fakeThis, {
			type: "background_task_end",
			task: {
				...base,
				status: "completed" as const,
				lastOutput: "done",
				exitCode: 0,
				updatedAt: 3,
			},
		});

		expect(fakeThis.backgroundTaskComponents.size).toBe(1);
		const rendered = fakeThis.chatContainer.children
			.flatMap((child: { render: (width: number) => string[] }) => child.render(120))
			.join("\n");
		expect(rendered).toContain("sleep 1; echo done");
		expect(rendered).toContain("done");
		expect(rendered).toContain("Completed");
	});

	test("cycles the selected background task row", async () => {
		const fakeThis: any = {
			isInitialized: true,
			footer: { invalidate: vi.fn() },
			ui: { requestRender: vi.fn() },
			chatContainer: new Container(),
			toolOutputExpanded: false,
			backgroundTaskComponents: new Map(),
			subagentComponents: new Map(),
			activityOrder: [],
			selectedActivity: undefined,
			showStatus: vi.fn(),
		};
		const interactiveModePrototype =
			InteractiveMode.prototype as unknown as InteractiveModePrototypeWithEnsureBackgroundTaskActivity;
		fakeThis.ensureBackgroundTaskActivity = interactiveModePrototype.ensureBackgroundTaskActivity.bind(fakeThis);
		fakeThis.updateSelectedActivity = interactiveModePrototype.updateSelectedActivity.bind(fakeThis);
		const selectActivity = interactiveModePrototype.selectActivity.bind(fakeThis);

		fakeThis.ensureBackgroundTaskActivity({
			id: "task-a",
			status: "running",
			command: "sleep 1",
			pid: 101,
			createdAt: 1,
			updatedAt: 1,
		});
		fakeThis.ensureBackgroundTaskActivity({
			id: "task-b",
			status: "running",
			command: "sleep 2",
			pid: 202,
			createdAt: 1,
			updatedAt: 1,
		});

		expect(fakeThis.selectedActivity).toEqual({ kind: "backgroundTask", id: "task-a" });

		selectActivity(1);
		expect(fakeThis.selectedActivity).toEqual({ kind: "backgroundTask", id: "task-b" });

		const rendered = fakeThis.chatContainer.children
			.flatMap((child: { render: (width: number) => string[] }) => child.render(120))
			.join("\n");
		const plainRendered = stripAnsi(rendered);
		expect(plainRendered).toContain("› [Background]");
		expect(plainRendered).toContain("sleep 2");
	});

	test("performs actions on the selected background task row", async () => {
		const session = {
			listBackgroundTasks: vi.fn(() => [
				{
					id: "task-b",
					status: "running",
					command: "npm run watch",
					pid: 202,
					createdAt: 1,
					updatedAt: 1,
					lastOutput: "watching files",
				},
			]),
			waitForBackgroundTask: vi.fn(async () => ({
				id: "task-b",
				status: "completed",
				command: "npm run watch",
				pid: 202,
				exitCode: 0,
				createdAt: 1,
				updatedAt: 2,
				lastOutput: "build complete",
			})),
			cancelBackgroundTask: vi.fn(async () => ({
				id: "task-b",
				status: "cancelled",
				command: "npm run watch",
				pid: 202,
				createdAt: 1,
				updatedAt: 3,
				lastOutput: "stopped",
			})),
			getBackgroundTaskReport: vi.fn((taskId: string) => ({
				task: {
					id: taskId,
					status: "completed",
					command: "npm run watch",
					pid: 202,
					createdAt: 1,
					updatedAt: 2,
					lastOutput: "build complete",
				},
				text: "build complete",
			})),
		};
		const fakeThis: any = {
			session,
			selectedActivity: { kind: "backgroundTask", id: "task-b" },
			showStatus: vi.fn(),
			showWarning: vi.fn(),
			showError: vi.fn(),
			copyTextToClipboard: vi.fn(async () => {}),
		};
		const interactiveModePrototype =
			InteractiveMode.prototype as unknown as InteractiveModePrototypeWithEnsureBackgroundTaskActivity & {
				handleSelectedBackgroundTaskWait(this: Record<string, unknown>): Promise<void>;
				handleSelectedBackgroundTaskCancel(this: Record<string, unknown>): Promise<void>;
				handleSelectedBackgroundTaskCopy(this: Record<string, unknown>): Promise<void>;
			};
		fakeThis.getSelectedBackgroundTaskInfo = interactiveModePrototype.getSelectedBackgroundTaskInfo.bind(fakeThis);

		await interactiveModePrototype.handleSelectedBackgroundTaskWait.call(fakeThis);
		await interactiveModePrototype.handleSelectedBackgroundTaskCopy.call(fakeThis);
		await interactiveModePrototype.handleSelectedBackgroundTaskCancel.call(fakeThis);

		expect(session.waitForBackgroundTask).toHaveBeenCalledWith("task-b");
		expect(session.getBackgroundTaskReport).toHaveBeenCalledWith("task-b");
		expect(fakeThis.copyTextToClipboard).toHaveBeenCalledWith("build complete");
		expect(session.cancelBackgroundTask).toHaveBeenCalledWith("task-b");
		expect(fakeThis.showStatus).toHaveBeenCalledWith("Background task settled: build complete");
		expect(fakeThis.showStatus).toHaveBeenCalledWith("Cancelled background task task-b");
	});
});
