import type { AgentTool } from "@mariozechner/pi-agent-core";
import { type Static, Type } from "@mariozechner/pi-ai";
import type { NotebookStore } from "../notebook/store.js";

const notebookWriteSchema = Type.Object({
	key: Type.String({ description: "Notebook entry name" }),
	value: Type.String({ description: "Notebook entry value" }),
});

const notebookReadSchema = Type.Object({
	key: Type.Optional(Type.String({ description: "Notebook entry name" })),
});

const notebookAppendSchema = Type.Object({
	key: Type.String({ description: "Notebook entry name" }),
	value: Type.String({ description: "Text to append" }),
});

const notebookDeleteSchema = Type.Object({
	key: Type.String({ description: "Notebook entry name" }),
});

type NotebookWriteParams = Static<typeof notebookWriteSchema>;
type NotebookReadParams = Static<typeof notebookReadSchema>;
type NotebookAppendParams = Static<typeof notebookAppendSchema>;
type NotebookDeleteParams = Static<typeof notebookDeleteSchema>;

export function createNotebookTools(store: NotebookStore): Array<AgentTool<any>> {
	const writeTool: AgentTool<typeof notebookWriteSchema, { key: string; entries: number }> = {
		name: "notebook_write",
		label: "Notebook Write",
		description: "Write a named entry to the research notebook, replacing any existing value.",
		parameters: notebookWriteSchema,
		async execute(_toolCallId: string, params: NotebookWriteParams) {
			const notebook = await store.set(params.key, params.value);
			return {
				content: [{ type: "text", text: `Wrote "${params.key}" (${Object.keys(notebook).length} entries total)` }],
				details: {
					key: params.key,
					entries: Object.keys(notebook).length,
				},
			};
		},
	};

	const readTool: AgentTool<typeof notebookReadSchema, { key?: string; entries?: number }> = {
		name: "notebook_read",
		label: "Notebook Read",
		description: "Read the full research notebook or a single named entry.",
		parameters: notebookReadSchema,
		async execute(_toolCallId: string, params: NotebookReadParams) {
			const notebook = store.read();
			if (params.key) {
				const value = notebook[params.key];
				if (value === undefined) {
					throw new Error(`No notebook entry for "${params.key}"`);
				}

				return {
					content: [{ type: "text", text: value }],
					details: {
						key: params.key,
					},
				};
			}

			return {
				content: [{ type: "text", text: store.formatForPrompt() }],
				details: {
					entries: Object.keys(notebook).length,
				},
			};
		},
	};

	const appendTool: AgentTool<typeof notebookAppendSchema, { key: string; entries: number }> = {
		name: "notebook_append",
		label: "Notebook Append",
		description: "Append a new line of text to a notebook entry, creating it if needed.",
		parameters: notebookAppendSchema,
		async execute(_toolCallId: string, params: NotebookAppendParams) {
			const notebook = await store.append(params.key, params.value);
			return {
				content: [
					{ type: "text", text: `Appended to "${params.key}" (${Object.keys(notebook).length} entries total)` },
				],
				details: {
					key: params.key,
					entries: Object.keys(notebook).length,
				},
			};
		},
	};

	const deleteTool: AgentTool<typeof notebookDeleteSchema, { key: string; entries: number }> = {
		name: "notebook_delete",
		label: "Notebook Delete",
		description: "Delete an entry from the research notebook.",
		parameters: notebookDeleteSchema,
		async execute(_toolCallId: string, params: NotebookDeleteParams) {
			const notebook = store.read();
			if (!(params.key in notebook)) {
				throw new Error(`No notebook entry for "${params.key}"`);
			}

			const updated = await store.delete(params.key);
			return {
				content: [
					{ type: "text", text: `Deleted "${params.key}" (${Object.keys(updated).length} entries remaining)` },
				],
				details: {
					key: params.key,
					entries: Object.keys(updated).length,
				},
			};
		},
	};

	return [writeTool, readTool, appendTool, deleteTool];
}
