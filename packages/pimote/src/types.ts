/**
 * WebSocket message types for shell and control channels.
 */

// ---------------------------------------------------------------------------
// Shell channel messages
// ---------------------------------------------------------------------------

/** Client → Server: terminal data (keystrokes) */
export interface ShellDataMessage {
	type: "data";
	data: string;
}

/** Server → Client: terminal output */
export interface ShellOutputMessage {
	type: "data";
	data: string;
}

/** Client → Server: resize the PTY */
export interface ShellResizeMessage {
	type: "resize";
	cols: number;
	rows: number;
}

/** Server → Client: shell process exited */
export interface ShellExitMessage {
	type: "exit";
	code: number;
}

export type ShellClientMessage = ShellDataMessage | ShellResizeMessage;
export type ShellServerMessage = ShellOutputMessage | ShellExitMessage;

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface PimoteConfig {
	pinHash: string;
	port: number;
}

// ---------------------------------------------------------------------------
// Server status
// ---------------------------------------------------------------------------

export interface PimoteStatus {
	running: boolean;
	port: number;
	localUrl: string;
	tunnelUrl?: string;
	connectedClients: number;
}
