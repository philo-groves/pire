declare module "qrcode-terminal" {
	export function generate(text: string, options?: { small?: boolean }, callback?: (code: string) => void): void;
}

declare module "node-pty" {
	export interface IPtyForkOptions {
		name?: string;
		cols?: number;
		rows?: number;
		cwd?: string;
		env?: Record<string, string>;
	}

	export interface IPty {
		onData(callback: (data: string) => void): void;
		onExit(callback: (e: { exitCode: number; signal?: number }) => void): void;
		write(data: string): void;
		resize(cols: number, rows: number): void;
		kill(signal?: string): void;
		pid: number;
	}

	export function spawn(file: string, args: string[], options: IPtyForkOptions): IPty;
}
