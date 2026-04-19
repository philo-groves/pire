import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const BIOME_EXTENSIONS = new Set([
	".cjs",
	".css",
	".cts",
	".html",
	".js",
	".json",
	".jsonc",
	".jsx",
	".md",
	".mjs",
	".mts",
	".ts",
	".tsx",
	".yaml",
	".yml",
]);

const TYPECHECK_ALL_PACKAGES_TRIGGER_FILES = new Set(["tsconfig.base.json"]);
const BROWSER_SMOKE_TRIGGER_FILES = new Set([
	"package-lock.json",
	"package.json",
	"scripts/browser-smoke-entry.ts",
	"scripts/check-browser-smoke.mjs",
]);

function run(command, args) {
	console.log(`> ${command} ${args.join(" ")}`);
	const result = spawnSync(command, args, { stdio: "inherit" });
	if (result.status !== 0) {
		process.exit(result.status ?? 1);
	}
}

function capture(command, args) {
	const result = spawnSync(command, args, { encoding: "utf8" });
	if (result.status !== 0) {
		const output = [result.stdout, result.stderr].filter(Boolean).join("");
		process.stderr.write(output);
		process.exit(result.status ?? 1);
	}
	return result.stdout;
}

function resolveLocalNodeScript(path) {
	const resolvedPath = resolve(path);
	if (!existsSync(resolvedPath)) {
		process.stderr.write(`Missing local tool: ${resolvedPath}\n`);
		process.exit(1);
	}
	return resolvedPath;
}

const node = process.execPath;
const biomeScript = resolveLocalNodeScript("node_modules/@biomejs/biome/bin/biome");
const tsgoScript = resolveLocalNodeScript("node_modules/@typescript/native-preview/bin/tsgo.js");

function isBiomeFile(file) {
	const extension = file.includes(".") ? file.slice(file.lastIndexOf(".")) : "";
	return BIOME_EXTENSIONS.has(extension);
}

function shouldTypecheckPackage(file, packageName) {
	const packagePrefix = `packages/${packageName}/`;
	if (!file.startsWith(packagePrefix)) {
		return false;
	}

	const packageRelativePath = file.slice(packagePrefix.length);
	return (
		packageRelativePath.startsWith("src/") ||
		packageRelativePath === "package.json" ||
		packageRelativePath === "tsconfig.json" ||
		packageRelativePath === "tsconfig.build.json"
	);
}

function getAllTypecheckPackages() {
	return ["agent", "ai", "coding-agent", "mom", "pods", "security-agent", "tui"];
}

const stagedFiles = capture("git", ["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"])
	.split("\0")
	.filter(Boolean);

if (stagedFiles.length === 0) {
	console.log("No staged files. Skipping pre-commit checks.");
	process.exit(0);
}

const biomeFiles = stagedFiles.filter((file) => existsSync(file) && isBiomeFile(file));
if (biomeFiles.length > 0) {
	run(node, [biomeScript, "check", "--write", "--error-on-warnings", ...biomeFiles]);
}

let runBrowserSmoke = false;
let runWebUiCheck = false;
const packagesToTypecheck = new Set();

for (const file of stagedFiles) {
	if (TYPECHECK_ALL_PACKAGES_TRIGGER_FILES.has(file)) {
		for (const packageName of getAllTypecheckPackages()) {
			packagesToTypecheck.add(packageName);
		}
	}

	if (BROWSER_SMOKE_TRIGGER_FILES.has(file) || file.startsWith("packages/ai/")) {
		runBrowserSmoke = true;
	}

	if (file.startsWith("packages/web-ui/")) {
		runBrowserSmoke = true;
		if (
			file.startsWith("packages/web-ui/src/") ||
			file.startsWith("packages/web-ui/example/") ||
			file === "packages/web-ui/package.json" ||
			file === "packages/web-ui/tsconfig.json" ||
			file === "packages/web-ui/tsconfig.build.json"
		) {
			runWebUiCheck = true;
		}
	}

	const packageMatch = /^packages\/([^/]+)\//.exec(file);
	if (!packageMatch) {
		continue;
	}

	const packageName = packageMatch[1];
	if (packageName === "web-ui") {
		continue;
	}

	if (
		existsSync(`packages/${packageName}/tsconfig.build.json`) &&
		shouldTypecheckPackage(file, packageName)
	) {
		packagesToTypecheck.add(packageName);
	}
}

for (const packageName of packagesToTypecheck) {
	run(node, [tsgoScript, "-p", `packages/${packageName}/tsconfig.build.json`, "--noEmit"]);
}

if (runWebUiCheck) {
	run("npm", ["run", "check", "--prefix", "packages/web-ui"]);
}

if (runBrowserSmoke) {
	run("npm", ["run", "check:browser-smoke"]);
}

for (const file of stagedFiles) {
	if (existsSync(file)) {
		run("git", ["add", "--", file]);
	}
}

console.log("Pre-commit checks passed.");
