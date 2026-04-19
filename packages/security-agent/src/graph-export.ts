import { mkdir, writeFile } from "node:fs/promises";
import { release, tmpdir } from "node:os";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { LogicMapData, LogicRecord } from "./logic-map/store.js";
import type { NotebookData } from "./notebook/store.js";
import type { SurfaceMapData, SurfaceRecord } from "./surface-map/store.js";
import type { WorkspaceGraphData, WorkspaceGraphNode } from "./workspace-graph/store.js";

type GraphCategory = "finding" | "logic" | "surface" | "workspace" | "reference";

interface ResearchGraphNode {
	id: string;
	label: string;
	kind: string;
	category: GraphCategory;
	status: string;
	score: number;
	summary?: string;
	path?: string;
	tags: string[];
	sources: string[];
	owner?: string;
	updatedAt?: string;
}

interface ResearchGraphEdge {
	source: string;
	target: string;
	relation: string;
	weight: number;
	sources: string[];
}

interface ResearchGraphDocument {
	title: string;
	workspaceRoot: string;
	generatedAt: string;
	nodes: ResearchGraphNode[];
	edges: ResearchGraphEdge[];
	notebook: {
		totalEntries: number;
		keys: string[];
	};
	stats: {
		totalNodes: number;
		totalEdges: number;
		workspaceNodes: number;
		surfaceNodes: number;
		logicNodes: number;
		findingNodes: number;
		referenceNodes: number;
	};
}

interface MutableResearchGraphNode {
	id: string;
	label: string;
	kind: string;
	category: GraphCategory;
	status: string;
	score: number;
	summary?: string;
	path?: string;
	tags: Set<string>;
	sources: Set<string>;
	owner?: string;
	updatedAt?: string;
}

interface MutableResearchGraphEdge {
	source: string;
	target: string;
	relation: string;
	weight: number;
	sources: Set<string>;
}

export interface WriteResearchGraphHtmlOptions {
	workspaceRoot: string;
	workspaceGraph: WorkspaceGraphData;
	surfaceMap: SurfaceMapData;
	logicMap: LogicMapData;
	notebook: NotebookData;
}

export interface ResearchGraphHtmlResult {
	path: string;
	url: string;
	displayPath: string;
	nodeCount: number;
	edgeCount: number;
}

function isWsl(env: NodeJS.ProcessEnv = process.env): boolean {
	if (env.WSL_DISTRO_NAME || env.WSLENV || env.WSL_INTEROP) {
		return true;
	}
	try {
		return /microsoft|wsl/i.test(release());
	} catch {
		return false;
	}
}

function encodePathSegments(path: string): string {
	return path
		.split("/")
		.map((segment) => encodeURIComponent(segment))
		.join("/");
}

function toWindowsDrivePath(filePath: string): string | undefined {
	const match = /^\/mnt\/([a-zA-Z])(?:\/(.*))?$/.exec(filePath);
	if (!match) {
		return undefined;
	}

	const driveLetter = match[1]!.toUpperCase();
	const remainder = (match[2] ?? "").replaceAll("/", "\\");
	return remainder.length > 0 ? `${driveLetter}:\\${remainder}` : `${driveLetter}:\\`;
}

function toWindowsDriveFileUrl(filePath: string): string | undefined {
	const match = /^\/mnt\/([a-zA-Z])(?:\/(.*))?$/.exec(filePath);
	if (!match) {
		return undefined;
	}

	const driveLetter = match[1]!.toUpperCase();
	const remainder = match[2] ?? "";
	const encodedRemainder = remainder
		.split("/")
		.filter((segment) => segment.length > 0)
		.map((segment) => encodeURIComponent(segment))
		.join("/");
	return encodedRemainder.length > 0 ? `file:///${driveLetter}:/${encodedRemainder}` : `file:///${driveLetter}:/`;
}

function toWslUncDisplayPath(filePath: string, distroName: string): string {
	const uncPath = filePath.replaceAll("/", "\\");
	return `\\\\wsl.localhost\\${distroName}${uncPath}`;
}

function toWslUncFileUrl(filePath: string, distroName: string): string {
	const encodedDistro = encodeURIComponent(distroName);
	const normalizedPath = filePath.startsWith("/") ? filePath : `/${filePath}`;
	return `file://wsl.localhost/${encodedDistro}${encodePathSegments(normalizedPath)}`;
}

function formatGraphFileLocation(filePath: string): { url: string; displayPath: string } {
	if (!isWsl()) {
		return {
			url: pathToFileURL(filePath).toString(),
			displayPath: filePath,
		};
	}

	const windowsDrivePath = toWindowsDrivePath(filePath);
	const windowsDriveUrl = toWindowsDriveFileUrl(filePath);
	if (windowsDrivePath && windowsDriveUrl) {
		return {
			url: windowsDriveUrl,
			displayPath: windowsDrivePath,
		};
	}

	const distroName = process.env.WSL_DISTRO_NAME?.trim() || "Ubuntu";
	return {
		url: toWslUncFileUrl(filePath, distroName),
		displayPath: toWslUncDisplayPath(filePath, distroName),
	};
}

function clampText(text: string | undefined, maxLength = 360): string | undefined {
	const trimmed = text?.trim();
	if (!trimmed) {
		return undefined;
	}
	return trimmed.length <= maxLength ? trimmed : `${trimmed.slice(0, maxLength - 3)}...`;
}

function uniqueSorted(values: Iterable<string>): string[] {
	return [...new Set([...values].map((value) => value.trim()).filter((value) => value.length > 0))].sort(
		(left, right) => left.localeCompare(right),
	);
}

function rankStatus(status: string): number {
	switch (status) {
		case "confirmed":
		case "covered":
		case "violated":
			return 5;
		case "active":
		case "hot":
		case "aligned":
			return 4;
		case "blocked":
		case "rejected":
			return 3;
		case "candidate":
			return 2;
		default:
			return 1;
	}
}

function pickStatus(current: string, next: string): string {
	return rankStatus(next) >= rankStatus(current) ? next : current;
}

function pickSummary(current: string | undefined, next: string | undefined): string | undefined {
	const nextSummary = clampText(next);
	if (!nextSummary) {
		return current;
	}
	if (!current) {
		return nextSummary;
	}
	return nextSummary.length > current.length ? nextSummary : current;
}

function pickUpdatedAt(current: string | undefined, next: string | undefined): string | undefined {
	if (!next) {
		return current;
	}
	if (!current) {
		return next;
	}
	return next > current ? next : current;
}

function categorizeNode(kind: string, sources: Iterable<string>, id: string): GraphCategory {
	const normalizedKind = kind.toLowerCase();
	const sourceSet = new Set([...sources].map((source) => source.toLowerCase()));
	if (normalizedKind === "finding" || id.startsWith("finding:")) {
		return "finding";
	}
	if (normalizedKind === "logic" || sourceSet.has("logic_map")) {
		return "logic";
	}
	if (
		sourceSet.has("surface_map") ||
		id.startsWith("module:") ||
		id.startsWith("surface:") ||
		id.startsWith("endpoint:") ||
		id.startsWith("flow:") ||
		id.startsWith("binary:") ||
		id.startsWith("auth:") ||
		id.startsWith("push:") ||
		id.startsWith("proxy:")
	) {
		return "surface";
	}
	if (sourceSet.has("workspace_graph") || sourceSet.has("workspace_seed") || sourceSet.has("finding_gate")) {
		return "workspace";
	}
	return "reference";
}

function createPlaceholderNode(id: string): MutableResearchGraphNode {
	return {
		id,
		label: id,
		kind: "reference",
		category: "reference",
		status: "candidate",
		score: 1,
		tags: new Set(),
		sources: new Set(["reference"]),
	};
}

function upsertNode(
	nodes: Map<string, MutableResearchGraphNode>,
	input: {
		id: string;
		label?: string;
		kind?: string;
		status?: string;
		score?: number;
		summary?: string;
		path?: string;
		tags?: string[];
		source: string;
		owner?: string;
		updatedAt?: string;
	},
): void {
	const existing = nodes.get(input.id) ?? createPlaceholderNode(input.id);
	existing.label = input.label?.trim() || existing.label;
	existing.kind = input.kind?.trim() || existing.kind;
	existing.status = pickStatus(existing.status, input.status?.trim() || existing.status);
	existing.score = Math.max(existing.score, input.score ?? existing.score);
	existing.summary = pickSummary(existing.summary, input.summary);
	existing.path = input.path?.trim() || existing.path;
	existing.owner = input.owner?.trim() || existing.owner;
	existing.updatedAt = pickUpdatedAt(existing.updatedAt, input.updatedAt);
	for (const tag of input.tags ?? []) {
		const trimmedTag = tag.trim();
		if (trimmedTag.length > 0) {
			existing.tags.add(trimmedTag);
		}
	}
	existing.sources.add(input.source);
	existing.category = categorizeNode(existing.kind, existing.sources, existing.id);
	nodes.set(existing.id, existing);
}

function edgeKey(source: string, target: string, relation: string): string {
	const [left, right] = source <= target ? [source, target] : [target, source];
	return `${relation}\u0000${left}\u0000${right}`;
}

function upsertEdge(
	edges: Map<string, MutableResearchGraphEdge>,
	source: string,
	target: string,
	relation: string,
	weight: number,
	edgeSource: string,
): void {
	if (source === target) {
		return;
	}
	const key = edgeKey(source, target, relation);
	const existing = edges.get(key);
	if (existing) {
		existing.weight = Math.max(existing.weight, weight);
		existing.sources.add(edgeSource);
		return;
	}
	edges.set(key, {
		source,
		target,
		relation,
		weight,
		sources: new Set([edgeSource]),
	});
}

function addWorkspaceGraphNode(nodes: Map<string, MutableResearchGraphNode>, node: WorkspaceGraphNode): void {
	upsertNode(nodes, {
		id: node.id,
		label: node.label,
		kind: node.kind,
		status: node.status,
		score: node.score,
		summary: node.summary ?? node.text,
		path: node.path,
		tags: [...node.tags, node.source],
		source: "workspace_graph",
		updatedAt: node.updatedAt,
	});
}

function addSurfaceNode(nodes: Map<string, MutableResearchGraphNode>, surface: SurfaceRecord): void {
	upsertNode(nodes, {
		id: surface.id,
		label: surface.label,
		kind: surface.kind,
		status: surface.status,
		score: surface.score,
		summary: surface.why ?? surface.evidence.join(" | "),
		tags: surface.evidence,
		source: "surface_map",
		owner: surface.owner,
		updatedAt: surface.updatedAt,
	});
}

function addLogicNode(nodes: Map<string, MutableResearchGraphNode>, rule: LogicRecord): void {
	upsertNode(nodes, {
		id: rule.id,
		label: rule.label,
		kind: "logic",
		status: rule.status,
		score: 3,
		summary: rule.gap || `${rule.intended} / ${rule.implemented}`,
		tags: [...rule.surfaces, ...rule.evidence],
		source: "logic_map",
		updatedAt: rule.updatedAt,
	});
}

function buildGraphDocument(options: WriteResearchGraphHtmlOptions): ResearchGraphDocument {
	const nodes = new Map<string, MutableResearchGraphNode>();
	const edges = new Map<string, MutableResearchGraphEdge>();

	for (const node of Object.values(options.workspaceGraph.nodes)) {
		addWorkspaceGraphNode(nodes, node);
	}
	for (const edge of options.workspaceGraph.edges) {
		upsertEdge(edges, edge.from, edge.to, edge.relation, edge.weight, "workspace_graph");
	}

	for (const surface of Object.values(options.surfaceMap.surfaces)) {
		addSurfaceNode(nodes, surface);
		for (const adjacentId of surface.adjacent) {
			upsertEdge(edges, surface.id, adjacentId, "adjacent", 1, "surface_map");
		}
	}

	for (const rule of Object.values(options.logicMap.rules)) {
		addLogicNode(nodes, rule);
		for (const surfaceId of rule.surfaces) {
			upsertEdge(edges, rule.id, surfaceId, "surfaces", 1, "logic_map");
		}
	}

	for (const edge of edges.values()) {
		if (!nodes.has(edge.source)) {
			nodes.set(edge.source, createPlaceholderNode(edge.source));
		}
		if (!nodes.has(edge.target)) {
			nodes.set(edge.target, createPlaceholderNode(edge.target));
		}
	}

	const orderedNodes = [...nodes.values()]
		.map(
			(node): ResearchGraphNode => ({
				id: node.id,
				label: node.label,
				kind: node.kind,
				category: node.category,
				status: node.status,
				score: node.score,
				summary: node.summary,
				path: node.path,
				tags: uniqueSorted(node.tags),
				sources: uniqueSorted(node.sources),
				owner: node.owner,
				updatedAt: node.updatedAt,
			}),
		)
		.sort((left, right) => {
			if (right.score !== left.score) {
				return right.score - left.score;
			}
			return left.id.localeCompare(right.id);
		});
	const orderedEdges = [...edges.values()]
		.map(
			(edge): ResearchGraphEdge => ({
				source: edge.source,
				target: edge.target,
				relation: edge.relation,
				weight: edge.weight,
				sources: uniqueSorted(edge.sources),
			}),
		)
		.sort((left, right) => {
			const leftKey = `${left.source} ${left.relation} ${left.target}`;
			const rightKey = `${right.source} ${right.relation} ${right.target}`;
			return leftKey.localeCompare(rightKey);
		});

	const workspaceRootLabel = basename(options.workspaceRoot) || options.workspaceRoot;
	const notebookKeys = Object.keys(options.notebook).sort((left, right) => left.localeCompare(right));
	const stats = {
		totalNodes: orderedNodes.length,
		totalEdges: orderedEdges.length,
		workspaceNodes: orderedNodes.filter((node) => node.category === "workspace").length,
		surfaceNodes: orderedNodes.filter((node) => node.category === "surface").length,
		logicNodes: orderedNodes.filter((node) => node.category === "logic").length,
		findingNodes: orderedNodes.filter((node) => node.category === "finding").length,
		referenceNodes: orderedNodes.filter((node) => node.category === "reference").length,
	};

	return {
		title: `${workspaceRootLabel} research graph`,
		workspaceRoot: options.workspaceRoot,
		generatedAt: new Date().toISOString(),
		nodes: orderedNodes,
		edges: orderedEdges,
		notebook: {
			totalEntries: notebookKeys.length,
			keys: notebookKeys,
		},
		stats,
	};
}

function serializeForHtml(value: unknown): string {
	return JSON.stringify(value).replaceAll("<", "\\u003c").replaceAll(">", "\\u003e").replaceAll("&", "\\u0026");
}

function renderResearchGraphHtml(document: ResearchGraphDocument): string {
	const documentJson = serializeForHtml(document);
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${document.title}</title>
<style>
	:root {
		color-scheme: dark;
		--bg: #06080d;
		--panel: rgba(13, 19, 28, 0.92);
		--panel-border: rgba(92, 161, 255, 0.18);
		--panel-strong: rgba(92, 161, 255, 0.32);
		--text: #eef4ff;
		--muted: #95a5bf;
		--dim: #64748b;
		--accent: #5ca1ff;
		--success: #46c37b;
		--surface: #74b8ff;
		--logic: #7ecbff;
		--finding: #ff7a88;
		--workspace: #93b4ff;
		--reference: #7b8798;
	}

	* {
		box-sizing: border-box;
	}

	html,
	body {
		height: 100%;
		margin: 0;
		background:
			radial-gradient(circle at top left, rgba(92, 161, 255, 0.12), transparent 30%),
			radial-gradient(circle at bottom right, rgba(126, 203, 255, 0.08), transparent 25%),
			var(--bg);
		color: var(--text);
		font: 14px/1.45 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
	}

	body {
		display: grid;
		grid-template-rows: auto 1fr;
	}

	header {
		display: flex;
		gap: 12px;
		align-items: center;
		justify-content: space-between;
		padding: 16px 20px 12px;
		border-bottom: 1px solid rgba(255, 255, 255, 0.05);
		background: linear-gradient(180deg, rgba(15, 21, 31, 0.94), rgba(7, 10, 15, 0.94));
		backdrop-filter: blur(12px);
	}

	.title-wrap {
		display: grid;
		gap: 4px;
	}

	h1 {
		margin: 0;
		font-size: 18px;
		font-weight: 700;
		letter-spacing: 0.02em;
	}

	.subtitle {
		color: var(--muted);
		font-size: 12px;
	}

	.badges {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		justify-content: flex-end;
	}

	.badge {
		padding: 6px 10px;
		border: 1px solid var(--panel-border);
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.03);
		color: var(--muted);
		font-size: 12px;
	}

	main {
		min-height: 0;
		display: grid;
		grid-template-columns: minmax(0, 1fr) 340px;
		gap: 14px;
		padding: 14px;
	}

	.panel {
		border: 1px solid var(--panel-border);
		border-radius: 16px;
		background: var(--panel);
		box-shadow: 0 18px 60px rgba(0, 0, 0, 0.32);
		backdrop-filter: blur(10px);
	}

	.graph-panel {
		min-height: 0;
		position: relative;
		overflow: hidden;
	}

	#graph {
		width: 100%;
		height: 100%;
		display: block;
		background:
			radial-gradient(circle at center, rgba(92, 161, 255, 0.06), transparent 45%),
			linear-gradient(180deg, rgba(255, 255, 255, 0.01), rgba(255, 255, 255, 0.02));
	}

	.graph-toolbar {
		position: absolute;
		top: 12px;
		left: 12px;
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
		padding: 10px;
		border: 1px solid var(--panel-border);
		border-radius: 12px;
		background: rgba(8, 11, 17, 0.88);
		backdrop-filter: blur(10px);
	}

	.graph-toolbar button,
	.graph-toolbar input {
		font: inherit;
		color: var(--text);
	}

	.graph-toolbar button {
		padding: 6px 10px;
		border: 1px solid var(--panel-border);
		border-radius: 10px;
		background: rgba(255, 255, 255, 0.03);
		cursor: pointer;
	}

	.graph-toolbar button:hover {
		border-color: var(--panel-strong);
		background: rgba(255, 255, 255, 0.06);
	}

	.graph-toolbar input {
		width: 220px;
		padding: 7px 10px;
		border: 1px solid var(--panel-border);
		border-radius: 10px;
		background: rgba(0, 0, 0, 0.22);
		outline: none;
	}

	.graph-toolbar input:focus {
		border-color: var(--panel-strong);
		box-shadow: 0 0 0 3px rgba(92, 161, 255, 0.12);
	}

	.hud {
		position: absolute;
		right: 12px;
		bottom: 12px;
		padding: 8px 10px;
		border: 1px solid var(--panel-border);
		border-radius: 12px;
		background: rgba(8, 11, 17, 0.88);
		color: var(--muted);
		font-size: 12px;
	}

	aside {
		min-height: 0;
		display: grid;
		grid-template-rows: auto auto minmax(0, 1fr);
		gap: 12px;
	}

	.section {
		padding: 14px;
	}

	h2 {
		margin: 0 0 10px;
		font-size: 13px;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--muted);
	}

	.legend {
		display: grid;
		gap: 8px;
	}

	.legend-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		color: var(--text);
	}

	.swatch {
		width: 10px;
		height: 10px;
		border-radius: 999px;
		margin-right: 8px;
		display: inline-block;
	}

	.muted {
		color: var(--muted);
	}

	.dim {
		color: var(--dim);
	}

	.kv {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 6px 10px;
		color: var(--muted);
		font-size: 12px;
	}

	.detail-card {
		overflow: auto;
	}

	.detail-card .value {
		color: var(--text);
		word-break: break-word;
	}

	.detail-card ul {
		margin: 6px 0 0;
		padding-left: 18px;
	}

	.detail-card li + li,
	.note-list li + li {
		margin-top: 4px;
	}

	.note-list {
		margin: 0;
		padding-left: 18px;
		color: var(--muted);
	}

	.empty {
		position: absolute;
		inset: 0;
		display: none;
		align-items: center;
		justify-content: center;
		text-align: center;
		color: var(--muted);
		font-size: 13px;
		background: rgba(6, 8, 13, 0.72);
	}

	.edge {
		stroke: rgba(146, 169, 199, 0.22);
		stroke-width: 1.2;
	}

	.edge.related_finding {
		stroke-dasharray: 4 4;
	}

	.edge.adjacent {
		stroke: rgba(116, 184, 255, 0.26);
	}

	.edge.touches,
	.edge.surfaces {
		stroke: rgba(92, 161, 255, 0.34);
	}

	.edge.highlight {
		stroke: rgba(255, 255, 255, 0.72);
		stroke-width: 2;
	}

	.edge.dimmed {
		opacity: 0.16;
	}

	.node circle {
		stroke-width: 1.5;
	}

	.node text {
		fill: var(--text);
		font-size: 11px;
		pointer-events: none;
	}

	.node.surface circle {
		fill: var(--surface);
		stroke: rgba(255, 255, 255, 0.12);
	}

	.node.logic circle {
		fill: var(--logic);
		stroke: rgba(255, 255, 255, 0.12);
	}

	.node.finding circle {
		fill: var(--finding);
		stroke: rgba(255, 255, 255, 0.18);
	}

	.node.workspace circle {
		fill: var(--workspace);
		stroke: rgba(255, 255, 255, 0.12);
	}

	.node.reference circle {
		fill: var(--reference);
		stroke: rgba(255, 255, 255, 0.08);
	}

	.node.confirmed circle,
	.node.covered circle,
	.node.violated circle {
		stroke: rgba(70, 195, 123, 0.9);
	}

	.node.active circle,
	.node.hot circle,
	.node.aligned circle {
		stroke: rgba(92, 161, 255, 0.92);
	}

	.node.blocked circle,
	.node.rejected circle {
		stroke: rgba(242, 107, 122, 0.85);
	}

	.node.selected circle {
		stroke: white;
		stroke-width: 2.4;
	}

	.node.dimmed {
		opacity: 0.24;
	}

	.node.hidden-label text {
		display: none;
	}

	@media (max-width: 1080px) {
		main {
			grid-template-columns: 1fr;
			grid-template-rows: minmax(420px, 60vh) auto;
		}
	}
</style>
</head>
<body>
<header>
	<div class="title-wrap">
		<h1>${document.title}</h1>
		<div class="subtitle">Workspace root: ${document.workspaceRoot}</div>
	</div>
	<div class="badges">
		<div class="badge">${document.stats.totalNodes} nodes</div>
		<div class="badge">${document.stats.totalEdges} edges</div>
		<div class="badge">${document.notebook.totalEntries} notebook entries</div>
		<div class="badge">Generated ${document.generatedAt}</div>
	</div>
</header>
<main>
	<section class="panel graph-panel">
		<div class="graph-toolbar">
			<input id="search" type="search" placeholder="Find node by id or label">
			<button id="find-node" type="button">Find</button>
			<button id="fit-view" type="button">Fit</button>
			<button id="toggle-sim" type="button">Freeze</button>
			<button id="toggle-labels" type="button">Labels</button>
		</div>
		<svg id="graph" aria-label="research graph">
			<g id="viewport">
				<g id="edge-layer"></g>
				<g id="node-layer"></g>
			</g>
		</svg>
		<div id="empty-state" class="empty">No graph nodes yet. Keep researching and rerun <code>/graph</code>.</div>
		<div id="hud" class="hud">Drag nodes to pin. Drag empty space to pan. Scroll to zoom.</div>
	</section>
	<aside>
		<section class="panel section">
			<h2>Legend</h2>
			<div class="legend">
				<div class="legend-row"><span><span class="swatch" style="background: var(--surface)"></span>Surface</span><span class="muted">${document.stats.surfaceNodes}</span></div>
				<div class="legend-row"><span><span class="swatch" style="background: var(--logic)"></span>Logic rule</span><span class="muted">${document.stats.logicNodes}</span></div>
				<div class="legend-row"><span><span class="swatch" style="background: var(--finding)"></span>Finding</span><span class="muted">${document.stats.findingNodes}</span></div>
				<div class="legend-row"><span><span class="swatch" style="background: var(--workspace)"></span>Workspace</span><span class="muted">${document.stats.workspaceNodes}</span></div>
				<div class="legend-row"><span><span class="swatch" style="background: var(--reference)"></span>Reference</span><span class="muted">${document.stats.referenceNodes}</span></div>
			</div>
		</section>
		<section class="panel section">
			<h2>Notebook</h2>
			<ul id="notebook-keys" class="note-list"></ul>
		</section>
		<section id="details" class="panel section detail-card">
			<h2>Selection</h2>
			<div class="muted">Select a node to inspect its current research state.</div>
		</section>
	</aside>
</main>
<script id="graph-data" type="application/json">${documentJson}</script>
<script>
	(function () {
		'use strict';

		const data = JSON.parse(document.getElementById('graph-data').textContent || '{}');
		const svg = document.getElementById('graph');
		const viewport = document.getElementById('viewport');
		const edgeLayer = document.getElementById('edge-layer');
		const nodeLayer = document.getElementById('node-layer');
		const details = document.getElementById('details');
		const notebookKeys = document.getElementById('notebook-keys');
		const emptyState = document.getElementById('empty-state');
		const searchInput = document.getElementById('search');
		const fitButton = document.getElementById('fit-view');
		const findButton = document.getElementById('find-node');
		const toggleSimButton = document.getElementById('toggle-sim');
		const toggleLabelsButton = document.getElementById('toggle-labels');

		const categoryOrder = ['surface', 'logic', 'finding', 'workspace', 'reference'];
		const categories = new Map(categoryOrder.map(function (name, index) { return [name, index]; }));
		const state = {
			width: 0,
			height: 0,
			scale: 1,
			panX: 0,
			panY: 0,
			selectedId: null,
			draggingNode: null,
			panning: false,
			lastPointer: null,
			alpha: 0.32,
			running: true,
			showLabels: data.nodes.length <= 80,
		};

		const nodeIndex = new Map();
		const edgeViews = [];
		const nodeViews = [];

		function escapeHtml(value) {
			return String(value)
				.replaceAll('&', '&amp;')
				.replaceAll('<', '&lt;')
				.replaceAll('>', '&gt;')
				.replaceAll('"', '&quot;');
		}

		function relationLength(relation) {
			switch (relation) {
				case 'touches':
					return 84;
				case 'surfaces':
					return 112;
				case 'adjacent':
					return 126;
				case 'related_finding':
					return 148;
				default:
					return 102;
			}
		}

		function ensureSize() {
			const rect = svg.getBoundingClientRect();
			state.width = Math.max(480, rect.width);
			state.height = Math.max(360, rect.height);
			svg.setAttribute('viewBox', '0 0 ' + state.width + ' ' + state.height);
		}

		function initialPosition(index, count, category) {
			const angle = (Math.PI * 2 * index) / Math.max(1, count);
			const clusterAngle = ((categories.get(category) || 0) / Math.max(1, categoryOrder.length)) * Math.PI * 2;
			const radius = 120 + ((categories.get(category) || 0) * 24);
			return {
				x: Math.cos(angle + clusterAngle) * radius,
				y: Math.sin(angle + clusterAngle) * radius,
			};
		}

		function createNodeView(node, index) {
			const position = initialPosition(index, data.nodes.length, node.category);
			const radius = 7 + Math.max(0, node.score - 1) * 1.8;
			const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
			group.classList.add('node', node.category, node.status);
			const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
			circle.setAttribute('r', String(radius));
			const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
			label.setAttribute('x', String(radius + 6));
			label.setAttribute('y', '4');
			label.textContent = node.label;
			group.append(circle, label);
			nodeLayer.appendChild(group);
			const view = {
				data: node,
				element: group,
				radius: radius,
				x: position.x,
				y: position.y,
				vx: 0,
				vy: 0,
				fx: null,
				fy: null,
				neighbors: new Set(),
			};
			group.addEventListener('click', function (event) {
				event.stopPropagation();
				selectNode(node.id);
			});
			group.addEventListener('pointerdown', function (event) {
				event.preventDefault();
				state.draggingNode = view;
				view.fx = pointerToGraph(event).x;
				view.fy = pointerToGraph(event).y;
				state.alpha = Math.max(state.alpha, 0.24);
				state.running = true;
				updateButtons();
			});
			return view;
		}

		function createEdgeView(edge) {
			const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
			line.classList.add('edge', edge.relation);
			line.setAttribute('stroke-width', String(1 + Math.min(2.5, edge.weight * 0.3)));
			edgeLayer.appendChild(line);
			return {
				data: edge,
				element: line,
				source: nodeIndex.get(edge.source),
				target: nodeIndex.get(edge.target),
			};
		}

		function renderNotebookKeys() {
			notebookKeys.innerHTML = '';
			if (!data.notebook.keys.length) {
				notebookKeys.innerHTML = '<li class="dim">No notebook entries</li>';
				return;
			}
			for (const key of data.notebook.keys) {
				const item = document.createElement('li');
				item.textContent = key;
				notebookKeys.appendChild(item);
			}
		}

		function renderDetails(node) {
			if (!node) {
				details.innerHTML =
					'<h2>Selection</h2>' +
					'<div class="muted">Select a node to inspect its current research state.</div>';
				return;
			}

			const neighborCount = node.neighbors.size;
			const tags =
				node.data.tags.length > 0
					? '<ul>' + node.data.tags.map(function (tag) { return '<li>' + escapeHtml(tag) + '</li>'; }).join('') + '</ul>'
					: '<div class="dim">No tags</div>';
			const sources =
				node.data.sources.length > 0
					? node.data.sources.map(escapeHtml).join(', ')
					: '<span class="dim">Unknown</span>';
			const summary = node.data.summary ? escapeHtml(node.data.summary) : '<span class="dim">No summary</span>';
			const path = node.data.path ? escapeHtml(node.data.path) : '<span class="dim">None</span>';
			const owner = node.data.owner ? escapeHtml(node.data.owner) : '<span class="dim">Unclaimed</span>';

			details.innerHTML =
				'<h2>Selection</h2>' +
				'<div class="kv">' +
				'<div>Label</div><div class="value">' + escapeHtml(node.data.label) + '</div>' +
				'<div>ID</div><div class="value">' + escapeHtml(node.data.id) + '</div>' +
				'<div>Kind</div><div class="value">' + escapeHtml(node.data.kind) + '</div>' +
				'<div>Status</div><div class="value">' + escapeHtml(node.data.status) + '</div>' +
				'<div>Score</div><div class="value">' + escapeHtml(node.data.score) + '</div>' +
				'<div>Neighbors</div><div class="value">' + neighborCount + '</div>' +
				'<div>Sources</div><div class="value">' + sources + '</div>' +
				'<div>Owner</div><div class="value">' + owner + '</div>' +
				'<div>Path</div><div class="value">' + path + '</div>' +
				'<div>Summary</div><div class="value">' + summary + '</div>' +
				'<div>Tags</div><div class="value">' + tags + '</div>' +
				'</div>';
		}

		function updateButtons() {
			toggleSimButton.textContent = state.running ? 'Freeze' : 'Resume';
			toggleLabelsButton.textContent = state.showLabels ? 'Hide labels' : 'Show labels';
		}

		function updateViewport() {
			viewport.setAttribute('transform', 'translate(' + state.panX + ' ' + state.panY + ') scale(' + state.scale + ')');
		}

		function pointerToGraph(event) {
			const rect = svg.getBoundingClientRect();
			return {
				x: (event.clientX - rect.left - state.panX) / state.scale,
				y: (event.clientY - rect.top - state.panY) / state.scale,
			};
		}

		function fitView() {
			if (nodeViews.length === 0) {
				return;
			}
			const padding = 48;
			let minX = Infinity;
			let minY = Infinity;
			let maxX = -Infinity;
			let maxY = -Infinity;
			for (const node of nodeViews) {
				minX = Math.min(minX, node.x - node.radius);
				maxX = Math.max(maxX, node.x + node.radius);
				minY = Math.min(minY, node.y - node.radius);
				maxY = Math.max(maxY, node.y + node.radius);
			}
			const width = Math.max(1, maxX - minX);
			const height = Math.max(1, maxY - minY);
			const scaleX = Math.max(0.15, (state.width - padding * 2) / width);
			const scaleY = Math.max(0.15, (state.height - padding * 2) / height);
			state.scale = Math.min(2.5, Math.max(0.2, Math.min(scaleX, scaleY)));
			state.panX = state.width / 2 - ((minX + maxX) / 2) * state.scale;
			state.panY = state.height / 2 - ((minY + maxY) / 2) * state.scale;
			updateViewport();
		}

		function selectNode(nodeId) {
			state.selectedId = nodeId;
			const selectedNode = nodeId ? nodeIndex.get(nodeId) : null;
			renderDetails(selectedNode || null);
			updateSelectionStyling();
		}

		function updateSelectionStyling() {
			const selectedNode = state.selectedId ? nodeIndex.get(state.selectedId) : null;
			for (const node of nodeViews) {
				const isSelected = selectedNode && node.data.id === selectedNode.data.id;
				const isNeighbor = selectedNode && selectedNode.neighbors.has(node.data.id);
				node.element.classList.toggle('selected', Boolean(isSelected));
				node.element.classList.toggle('dimmed', Boolean(selectedNode) && !isSelected && !isNeighbor);
				node.element.classList.toggle(
					'hidden-label',
					!state.showLabels && !isSelected && !(selectedNode && selectedNode.neighbors.has(node.data.id)),
				);
			}
			for (const edge of edgeViews) {
				const connectsSelection =
					selectedNode &&
					(edge.data.source === selectedNode.data.id ||
						edge.data.target === selectedNode.data.id ||
						(selectedNode.neighbors.has(edge.data.source) && selectedNode.neighbors.has(edge.data.target)));
				edge.element.classList.toggle('highlight', Boolean(connectsSelection));
				edge.element.classList.toggle('dimmed', Boolean(selectedNode) && !connectsSelection);
			}
		}

		function focusNode(node) {
			selectNode(node.data.id);
			state.scale = Math.max(state.scale, 1);
			state.panX = state.width / 2 - node.x * state.scale;
			state.panY = state.height / 2 - node.y * state.scale;
			updateViewport();
		}

		function findNodeByQuery(query) {
			const trimmed = query.trim().toLowerCase();
			if (!trimmed) {
				return null;
			}
			return (
				nodeViews.find(function (node) {
					return (
						node.data.id.toLowerCase().includes(trimmed) ||
						node.data.label.toLowerCase().includes(trimmed) ||
						node.data.tags.some(function (tag) {
							return tag.toLowerCase().includes(trimmed);
						})
					);
				}) || null
			);
		}

		function tick() {
			if (!state.running || nodeViews.length === 0) {
				return;
			}

			state.alpha = Math.max(0.02, state.alpha * 0.992);

			for (let i = 0; i < nodeViews.length; i++) {
				const left = nodeViews[i];
				for (let j = i + 1; j < nodeViews.length; j++) {
					const right = nodeViews[j];
					let dx = right.x - left.x;
					let dy = right.y - left.y;
					const distanceSq = Math.max(120, dx * dx + dy * dy);
					const distance = Math.sqrt(distanceSq);
					const repulsion = (2200 / distanceSq) * state.alpha;
					dx /= distance;
					dy /= distance;
					left.vx -= dx * repulsion;
					left.vy -= dy * repulsion;
					right.vx += dx * repulsion;
					right.vy += dy * repulsion;

					const minDistance = left.radius + right.radius + 16;
					if (distance < minDistance) {
						const overlap = ((minDistance - distance) / Math.max(1, distance)) * 0.08;
						left.vx -= dx * overlap;
						left.vy -= dy * overlap;
						right.vx += dx * overlap;
						right.vy += dy * overlap;
					}
				}
			}

			for (const edge of edgeViews) {
				if (!edge.source || !edge.target) {
					continue;
				}
				let dx = edge.target.x - edge.source.x;
				let dy = edge.target.y - edge.source.y;
				const distance = Math.max(1, Math.sqrt(dx * dx + dy * dy));
				const desired = relationLength(edge.data.relation);
				const pull = (distance - desired) * 0.0035 * Math.max(0.6, edge.data.weight) * state.alpha;
				dx /= distance;
				dy /= distance;
				edge.source.vx += dx * pull;
				edge.source.vy += dy * pull;
				edge.target.vx -= dx * pull;
				edge.target.vy -= dy * pull;
			}

			for (const node of nodeViews) {
				node.vx += (-node.x * 0.0009) * state.alpha;
				node.vy += (-node.y * 0.0009) * state.alpha;
				node.vx *= 0.88;
				node.vy *= 0.88;

				if (node.fx !== null && node.fy !== null) {
					node.x = node.fx;
					node.y = node.fy;
					node.vx = 0;
					node.vy = 0;
					continue;
				}

				node.x += node.vx;
				node.y += node.vy;
			}

			render();
			if (state.running) {
				window.requestAnimationFrame(tick);
			}
		}

		function render() {
			for (const edge of edgeViews) {
				if (!edge.source || !edge.target) {
					continue;
				}
				edge.element.setAttribute('x1', String(edge.source.x));
				edge.element.setAttribute('y1', String(edge.source.y));
				edge.element.setAttribute('x2', String(edge.target.x));
				edge.element.setAttribute('y2', String(edge.target.y));
			}
			for (const node of nodeViews) {
				node.element.setAttribute('transform', 'translate(' + node.x + ' ' + node.y + ')');
			}
			updateViewport();
			updateSelectionStyling();
		}

		function restartSimulation(alpha) {
			state.alpha = Math.max(state.alpha, alpha || 0.18);
			if (!state.running) {
				return;
			}
			window.requestAnimationFrame(tick);
		}

		function handlePointerMove(event) {
			if (state.draggingNode) {
				const point = pointerToGraph(event);
				state.draggingNode.fx = point.x;
				state.draggingNode.fy = point.y;
				render();
				return;
			}
			if (state.panning && state.lastPointer) {
				state.panX += event.clientX - state.lastPointer.x;
				state.panY += event.clientY - state.lastPointer.y;
				state.lastPointer = { x: event.clientX, y: event.clientY };
				updateViewport();
			}
		}

		function handlePointerUp() {
			if (state.draggingNode) {
				state.draggingNode = null;
			}
			state.panning = false;
			state.lastPointer = null;
		}

		function zoomAround(clientX, clientY, nextScale) {
			const rect = svg.getBoundingClientRect();
			const screenX = clientX - rect.left;
			const screenY = clientY - rect.top;
			const graphX = (screenX - state.panX) / state.scale;
			const graphY = (screenY - state.panY) / state.scale;
			state.scale = nextScale;
			state.panX = screenX - graphX * state.scale;
			state.panY = screenY - graphY * state.scale;
			updateViewport();
		}

		svg.addEventListener('click', function () {
			selectNode(null);
		});
		svg.addEventListener('pointerdown', function (event) {
			if (event.target !== svg) {
				return;
			}
			state.panning = true;
			state.lastPointer = { x: event.clientX, y: event.clientY };
		});
		svg.addEventListener('wheel', function (event) {
			event.preventDefault();
			const factor = event.deltaY > 0 ? 0.9 : 1.1;
			const nextScale = Math.max(0.15, Math.min(4, state.scale * factor));
			zoomAround(event.clientX, event.clientY, nextScale);
		}, { passive: false });
		window.addEventListener('pointermove', handlePointerMove);
		window.addEventListener('pointerup', handlePointerUp);
		window.addEventListener('resize', function () {
			ensureSize();
			fitView();
		});

		findButton.addEventListener('click', function () {
			const node = findNodeByQuery(searchInput.value);
			if (node) {
				focusNode(node);
			}
		});
		searchInput.addEventListener('keydown', function (event) {
			if (event.key === 'Enter') {
				const node = findNodeByQuery(searchInput.value);
				if (node) {
					focusNode(node);
				}
			}
		});
		fitButton.addEventListener('click', function () {
			fitView();
		});
		toggleSimButton.addEventListener('click', function () {
			state.running = !state.running;
			updateButtons();
			if (state.running) {
				restartSimulation(0.16);
			}
		});
		toggleLabelsButton.addEventListener('click', function () {
			state.showLabels = !state.showLabels;
			updateButtons();
			updateSelectionStyling();
		});

		ensureSize();
		renderNotebookKeys();
		updateButtons();

		if (!data.nodes.length) {
			emptyState.style.display = 'flex';
			return;
		}

		data.nodes.forEach(function (node, index) {
			const view = createNodeView(node, index);
			nodeViews.push(view);
			nodeIndex.set(node.id, view);
		});

		data.edges.forEach(function (edge) {
			const source = nodeIndex.get(edge.source);
			const target = nodeIndex.get(edge.target);
			if (!source || !target) {
				return;
			}
			source.neighbors.add(target.data.id);
			target.neighbors.add(source.data.id);
			edgeViews.push(createEdgeView(edge));
		});

		fitView();
		render();
		restartSimulation(0.28);
	})();
</script>
</body>
</html>
`;
}

function createGraphFileName(workspaceRoot: string): string {
	const workspaceName = basename(workspaceRoot).replace(/[^a-zA-Z0-9._-]+/g, "-") || "workspace";
	const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
	return `${workspaceName}-research-graph-${timestamp}.html`;
}

export async function writeResearchGraphHtml(options: WriteResearchGraphHtmlOptions): Promise<ResearchGraphHtmlResult> {
	const document = buildGraphDocument(options);
	const outputDir = join(tmpdir(), "pire-graphs");
	await mkdir(outputDir, { recursive: true });
	const filePath = join(outputDir, createGraphFileName(options.workspaceRoot));
	await writeFile(filePath, renderResearchGraphHtml(document), "utf-8");
	const location = formatGraphFileLocation(filePath);
	return {
		path: filePath,
		url: location.url,
		displayPath: location.displayPath,
		nodeCount: document.stats.totalNodes,
		edgeCount: document.stats.totalEdges,
	};
}
