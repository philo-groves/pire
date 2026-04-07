import { mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { ExecResult } from "@mariozechner/pi-coding-agent";

export interface DecompArtifactObservation {
	path: string;
	type?: "binary" | "log" | "text" | "other";
	command?: string;
	finding?: string;
}

export interface DecompToolDetails {
	tool: string;
	targetPath: string;
	command: string[];
	commandString: string;
	exitCode: number;
	killed: boolean;
	stdoutPreview: string;
	stderrPreview: string;
	summary: string;
	artifacts: DecompArtifactObservation[];
}

interface ToolExecResult extends DecompToolDetails {}

type ExecFn = (command: string, args: string[], options?: { signal?: AbortSignal; cwd?: string }) => Promise<ExecResult>;

const PREVIEW_LINE_LIMIT = 80;
const PREVIEW_CHAR_LIMIT = 8000;

function quoteShellArg(value: string): string {
	if (/^[A-Za-z0-9_./:@=-]+$/.test(value)) {
		return value;
	}
	return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

function commandToString(command: string, args: string[]): string {
	return [command, ...args].map((value) => quoteShellArg(value)).join(" ");
}

function truncateOutput(text: string, maxLines = PREVIEW_LINE_LIMIT): string {
	const normalized = text.trim();
	if (normalized.length === 0) {
		return "";
	}

	const clippedChars = normalized.length > PREVIEW_CHAR_LIMIT ? `${normalized.slice(0, PREVIEW_CHAR_LIMIT)}\n...` : normalized;
	const lines = clippedChars.split("\n");
	if (lines.length <= maxLines) {
		return clippedChars;
	}

	return `${lines.slice(0, maxLines).join("\n")}\n... ${lines.length - maxLines} more lines`;
}

function getArtifactStem(targetPath: string): string {
	return basename(targetPath).replace(/[^A-Za-z0-9._-]+/g, "_");
}

async function ensureArtifactDir(cwd: string): Promise<string> {
	const artifactDir = join(cwd, ".pire", "artifacts");
	await mkdir(artifactDir, { recursive: true });
	return artifactDir;
}

async function runTool(
	exec: ExecFn,
	command: string,
	args: string[],
	targetPath: string,
	toolName: string,
	artifacts: DecompArtifactObservation[],
	signal?: AbortSignal,
): Promise<ToolExecResult> {
	const result = await exec(command, args, { signal });
	const commandString = commandToString(command, args);
	const stdoutPreview = truncateOutput(result.stdout);
	const stderrPreview = truncateOutput(result.stderr);
	const statusText =
		result.code === 0 ? "ok" : result.killed ? `killed (exit ${result.code})` : `failed (exit ${result.code})`;
	const preview = stdoutPreview || stderrPreview || "no output";

	return {
		tool: toolName,
		targetPath,
		command: [command, ...args],
		commandString,
		exitCode: result.code,
		killed: result.killed,
		stdoutPreview,
		stderrPreview,
		summary: `${toolName}: ${statusText}\ncommand: ${commandString}\n${preview}`,
		artifacts: artifacts.map((artifact) => ({
			...artifact,
			command: artifact.command ?? commandString,
		})),
	};
}

async function buildGhidraWorkspace(cwd: string, targetPath: string, suffix: string): Promise<{
	projectDir: string;
	projectName: string;
	scriptDir: string;
	scriptPath: string;
	outputPath: string;
	logPath: string;
}> {
	const artifactDir = await ensureArtifactDir(cwd);
	const stem = getArtifactStem(targetPath);
	const projectDir = join(artifactDir, `ghidra-project-${stem}-${suffix}`);
	const scriptDir = join(artifactDir, "ghidra-scripts");
	await mkdir(projectDir, { recursive: true });
	await mkdir(scriptDir, { recursive: true });
	return {
		projectDir,
		projectName: `pire_${stem}_${suffix}`,
		scriptDir,
		scriptPath: join(scriptDir, `pire_${suffix}_${stem}.py`),
		outputPath: join(artifactDir, `ghidra-${suffix}-${stem}.txt`),
		logPath: join(artifactDir, `ghidra-${suffix}-${stem}.log`),
	};
}

function buildFunctionListScript(outputPath: string): string {
	return [
		"from ghidra.util.task import ConsoleTaskMonitor",
		"",
		"manager = currentProgram.getFunctionManager()",
		"functions = manager.getFunctions(True)",
		"lines = []",
		"for function in functions:",
		"    lines.append('%s %s' % (function.getEntryPoint(), function.getName()))",
		"",
		`output_path = r'''${outputPath}'''`,
		"writer = open(output_path, 'w')",
		"try:",
		"    writer.write('\\n'.join(lines))",
		"finally:",
		"    writer.close()",
		"print('wrote function list to %s' % output_path)",
	].join("\n");
}

function buildDecompileScript(outputPath: string, functionName?: string): string {
	const requested = functionName ?? "";
	return [
		"from ghidra.app.decompiler import DecompInterface",
		"",
		`requested_name = r'''${requested}'''`,
		"function_manager = currentProgram.getFunctionManager()",
		"target_function = None",
		"if requested_name:",
		"    iterator = function_manager.getFunctions(True)",
		"    for function in iterator:",
		"        if function.getName() == requested_name:",
		"            target_function = function",
		"            break",
		"if target_function is None:",
		"    target_function = function_manager.getFunctionContaining(currentProgram.getImageBase())",
		"if target_function is None:",
		"    iterator = function_manager.getFunctions(True)",
		"    if iterator.hasNext():",
		"        target_function = iterator.next()",
		"if target_function is None:",
		"    raise Exception('No function available to decompile')",
		"",
		"decompiler = DecompInterface()",
		"decompiler.openProgram(currentProgram)",
		"result = decompiler.decompileFunction(target_function, 60, monitor)",
		"if not result.decompileCompleted():",
		"    raise Exception('Decompilation did not complete for %s' % target_function.getName())",
		"decompiled = result.getDecompiledFunction().getC()",
		`output_path = r'''${outputPath}'''`,
		"writer = open(output_path, 'w')",
		"try:",
		"    writer.write(decompiled)",
		"finally:",
		"    writer.close()",
		"print('decompiled %s to %s' % (target_function.getName(), output_path))",
	].join("\n");
}

export async function runDecompGhidraFunctions(
	exec: ExecFn,
	cwd: string,
	targetPath: string,
	signal?: AbortSignal,
): Promise<ToolExecResult> {
	const workspace = await buildGhidraWorkspace(cwd, targetPath, "functions");
	await writeFile(workspace.scriptPath, `${buildFunctionListScript(workspace.outputPath)}\n`, "utf-8");
	const args = [
		workspace.projectDir,
		workspace.projectName,
		"-import",
		targetPath,
		"-overwrite",
		"-scriptPath",
		workspace.scriptDir,
		"-postScript",
		basename(workspace.scriptPath),
	];
	const result = await exec("analyzeHeadless", args, { signal });
	await writeFile(workspace.logPath, `${result.stdout}${result.stderr}`.trimEnd() + "\n", "utf-8");

	return runTool(
		async () => result,
		"analyzeHeadless",
		args,
		targetPath,
		"decomp_ghidra_functions",
		[
			{ path: targetPath, type: "binary", finding: `ghidra function analysis for ${targetPath}` },
			{ path: workspace.outputPath, type: "text", finding: `ghidra function list for ${targetPath}` },
			{ path: workspace.logPath, type: "log", finding: `ghidra function-analysis log for ${targetPath}` },
			{ path: workspace.projectDir, type: "other", finding: `ghidra project directory for ${targetPath}` },
		],
		signal,
	);
}

export async function runDecompGhidraDecompile(
	exec: ExecFn,
	cwd: string,
	targetPath: string,
	options: { functionName?: string },
	signal?: AbortSignal,
): Promise<ToolExecResult> {
	const workspace = await buildGhidraWorkspace(cwd, targetPath, "decompile");
	await writeFile(workspace.scriptPath, `${buildDecompileScript(workspace.outputPath, options.functionName)}\n`, "utf-8");
	const args = [
		workspace.projectDir,
		workspace.projectName,
		"-import",
		targetPath,
		"-overwrite",
		"-scriptPath",
		workspace.scriptDir,
		"-postScript",
		basename(workspace.scriptPath),
	];
	const result = await exec("analyzeHeadless", args, { signal });
	await writeFile(workspace.logPath, `${result.stdout}${result.stderr}`.trimEnd() + "\n", "utf-8");

	return runTool(
		async () => result,
		"analyzeHeadless",
		args,
		targetPath,
		"decomp_ghidra_decompile",
		[
			{ path: targetPath, type: "binary", finding: `ghidra decompilation for ${targetPath}` },
			{ path: workspace.outputPath, type: "text", finding: `ghidra decompiled output for ${targetPath}` },
			{ path: workspace.logPath, type: "log", finding: `ghidra decompilation log for ${targetPath}` },
			{ path: workspace.projectDir, type: "other", finding: `ghidra project directory for ${targetPath}` },
		],
		signal,
	);
}
