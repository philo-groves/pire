/**
 * Small utility helpers.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Find an executable on PATH (like Unix `which`).
 * Returns the absolute path or undefined if not found.
 */
export async function which(name: string): Promise<string | undefined> {
	try {
		const { stdout } = await execFileAsync("which", [name]);
		const path = stdout.trim();
		return path || undefined;
	} catch {
		return undefined;
	}
}
