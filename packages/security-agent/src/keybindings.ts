import {
	type KeybindingDefinitions,
	type KeybindingsConfig,
	KeybindingsManager,
	TUI_KEYBINDINGS,
} from "@mariozechner/pi-tui";

export interface SecurityAgentAppKeybindings {
	"app.abort": true;
	"app.exit": true;
	"app.plan.scrollUp": true;
	"app.plan.scrollDown": true;
	"app.surfaces.scrollLeft": true;
	"app.surfaces.scrollRight": true;
}

declare module "@mariozechner/pi-tui" {
	interface Keybindings extends SecurityAgentAppKeybindings {}
}

export const SECURITY_AGENT_KEYBINDINGS = {
	...TUI_KEYBINDINGS,
	"app.abort": {
		defaultKeys: "escape",
		description: "Abort the active run",
	},
	"app.exit": {
		defaultKeys: "ctrl+d",
		description: "Exit the console",
	},
	"app.plan.scrollUp": {
		defaultKeys: "shift+up",
		description: "Scroll the plan panel up",
	},
	"app.plan.scrollDown": {
		defaultKeys: "shift+down",
		description: "Scroll the plan panel down",
	},
	"app.surfaces.scrollLeft": {
		defaultKeys: "shift+left",
		description: "Scroll the surfaces panel left",
	},
	"app.surfaces.scrollRight": {
		defaultKeys: "shift+right",
		description: "Scroll the surfaces panel right",
	},
} as const satisfies KeybindingDefinitions;

export function createSecurityAgentKeybindings(userBindings: KeybindingsConfig = {}): KeybindingsManager {
	return new KeybindingsManager(SECURITY_AGENT_KEYBINDINGS, userBindings);
}
