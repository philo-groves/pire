import { Container } from "@mariozechner/pi-tui";
import { beforeAll, describe, expect, test, vi } from "vitest";
import { BackgroundTaskActivityComponent } from "../src/modes/interactive/components/background-task-activity.js";
import { InteractiveMode } from "../src/modes/interactive/interactive-mode.js";
import { initTheme } from "../src/modes/interactive/theme/theme.js";

type InteractiveModePrototypeWithEnsureBackgroundTaskActivity = {
	ensureBackgroundTaskActivity(this: Record<string, unknown>, task: Record<string, unknown>): unknown;
};

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
		};
		const interactiveModePrototype =
			InteractiveMode.prototype as unknown as InteractiveModePrototypeWithEnsureBackgroundTaskActivity;
		fakeThis.ensureBackgroundTaskActivity = interactiveModePrototype.ensureBackgroundTaskActivity.bind(fakeThis);

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
});
