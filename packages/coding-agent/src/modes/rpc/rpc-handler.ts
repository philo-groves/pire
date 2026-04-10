/**
 * Shared RPC command handler.
 *
 * Extracted from rpc-mode.ts so that both the stdin/stdout RPC mode
 * and remote adapters (e.g. pimote WebSocket bridge) can dispatch
 * commands against the same AgentSessionRuntime without duplicating
 * the protocol logic.
 */

import type { AgentSessionEvent } from "../../core/agent-session.js";
import type { AgentSessionRuntime } from "../../core/agent-session-runtime.js";
import type { RpcCommand, RpcResponse, RpcSessionState, RpcSlashCommand } from "./rpc-types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RpcHandlerOptions {
	/**
	 * Called after operations that change the session (new_session, switch_session, fork).
	 * The adapter should rebind its event subscription to the new session.
	 */
	onSessionChanged?: () => Promise<void>;
}

export interface RpcHandler {
	/** Dispatch a single RPC command and return its response. */
	handleCommand(command: RpcCommand): Promise<RpcResponse>;

	/**
	 * Subscribe to session events. Returns an unsubscribe function.
	 * The handler automatically resubscribes on session changes.
	 */
	subscribe(listener: (event: AgentSessionEvent) => void): () => void;

	/** Clean up resources. */
	dispose(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function success<T extends RpcCommand["type"]>(id: string | undefined, command: T, data?: object | null): RpcResponse {
	if (data === undefined) {
		return { id, type: "response", command, success: true } as RpcResponse;
	}
	return { id, type: "response", command, success: true, data } as RpcResponse;
}

function error(id: string | undefined, command: string, message: string): RpcResponse {
	return { id, type: "response", command, success: false, error: message };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createRpcHandler(runtimeHost: AgentSessionRuntime, options: RpcHandlerOptions = {}): RpcHandler {
	let session = runtimeHost.session;

	// Event subscription management
	const listeners = new Set<(event: AgentSessionEvent) => void>();
	let sessionUnsubscribe: (() => void) | undefined;

	const bindSessionEvents = () => {
		sessionUnsubscribe?.();
		sessionUnsubscribe = session.subscribe((event) => {
			for (const listener of listeners) {
				listener(event);
			}
		});
	};

	bindSessionEvents();

	const refreshSession = async () => {
		session = runtimeHost.session;
		bindSessionEvents();
		await options.onSessionChanged?.();
	};

	// -------------------------------------------------------------------
	// Command dispatcher
	// -------------------------------------------------------------------

	const handleCommand = async (command: RpcCommand): Promise<RpcResponse> => {
		const id = command.id;

		switch (command.type) {
			// =================================================================
			// Prompting
			// =================================================================

			case "prompt": {
				session
					.prompt(command.message, {
						images: command.images,
						streamingBehavior: command.streamingBehavior,
						source: "rpc",
					})
					.catch(() => {});
				return success(id, "prompt");
			}

			case "steer": {
				await session.steer(command.message, command.images);
				return success(id, "steer");
			}

			case "follow_up": {
				await session.followUp(command.message, command.images);
				return success(id, "follow_up");
			}

			case "abort": {
				await session.abort();
				return success(id, "abort");
			}

			case "new_session": {
				const opts = command.parentSession ? { parentSession: command.parentSession } : undefined;
				const result = await runtimeHost.newSession(opts);
				if (!result.cancelled) {
					await refreshSession();
				}
				return success(id, "new_session", result);
			}

			// =================================================================
			// State
			// =================================================================

			case "get_state": {
				const state: RpcSessionState = {
					model: session.model,
					thinkingLevel: session.thinkingLevel,
					isStreaming: session.isStreaming,
					isCompacting: session.isCompacting,
					steeringMode: session.steeringMode,
					followUpMode: session.followUpMode,
					sessionFile: session.sessionFile,
					sessionId: session.sessionId,
					sessionName: session.sessionName,
					autoCompactionEnabled: session.autoCompactionEnabled,
					messageCount: session.messages.length,
					pendingMessageCount: session.pendingMessageCount,
				};
				return success(id, "get_state", state);
			}

			// =================================================================
			// Model
			// =================================================================

			case "set_model": {
				const models = await session.modelRegistry.getAvailable();
				const model = models.find((m) => m.provider === command.provider && m.id === command.modelId);
				if (!model) {
					return error(id, "set_model", `Model not found: ${command.provider}/${command.modelId}`);
				}
				await session.setModel(model);
				return success(id, "set_model", model);
			}

			case "cycle_model": {
				const result = await session.cycleModel();
				if (!result) {
					return success(id, "cycle_model", null);
				}
				return success(id, "cycle_model", result);
			}

			case "get_available_models": {
				const models = await session.modelRegistry.getAvailable();
				return success(id, "get_available_models", { models });
			}

			// =================================================================
			// Thinking
			// =================================================================

			case "set_thinking_level": {
				session.setThinkingLevel(command.level);
				return success(id, "set_thinking_level");
			}

			case "cycle_thinking_level": {
				const level = session.cycleThinkingLevel();
				if (!level) {
					return success(id, "cycle_thinking_level", null);
				}
				return success(id, "cycle_thinking_level", { level });
			}

			// =================================================================
			// Queue Modes
			// =================================================================

			case "set_steering_mode": {
				session.setSteeringMode(command.mode);
				return success(id, "set_steering_mode");
			}

			case "set_follow_up_mode": {
				session.setFollowUpMode(command.mode);
				return success(id, "set_follow_up_mode");
			}

			// =================================================================
			// Compaction
			// =================================================================

			case "compact": {
				const result = await session.compact(command.customInstructions);
				return success(id, "compact", result);
			}

			case "set_auto_compaction": {
				session.setAutoCompactionEnabled(command.enabled);
				return success(id, "set_auto_compaction");
			}

			// =================================================================
			// Retry
			// =================================================================

			case "set_auto_retry": {
				session.setAutoRetryEnabled(command.enabled);
				return success(id, "set_auto_retry");
			}

			case "abort_retry": {
				session.abortRetry();
				return success(id, "abort_retry");
			}

			// =================================================================
			// Bash
			// =================================================================

			case "bash": {
				const result = await session.executeBash(command.command);
				return success(id, "bash", result);
			}

			case "abort_bash": {
				session.abortBash();
				return success(id, "abort_bash");
			}

			// =================================================================
			// Session
			// =================================================================

			case "get_session_stats": {
				const stats = session.getSessionStats();
				return success(id, "get_session_stats", stats);
			}

			case "export_html": {
				const path = await session.exportToHtml(command.outputPath);
				return success(id, "export_html", { path });
			}

			case "switch_session": {
				const result = await runtimeHost.switchSession(command.sessionPath);
				if (!result.cancelled) {
					await refreshSession();
				}
				return success(id, "switch_session", result);
			}

			case "fork": {
				const result = await runtimeHost.fork(command.entryId);
				if (!result.cancelled) {
					await refreshSession();
				}
				return success(id, "fork", { text: result.selectedText, cancelled: result.cancelled });
			}

			case "get_fork_messages": {
				const messages = session.getUserMessagesForForking();
				return success(id, "get_fork_messages", { messages });
			}

			case "get_last_assistant_text": {
				const text = session.getLastAssistantText();
				return success(id, "get_last_assistant_text", { text });
			}

			case "set_session_name": {
				const name = command.name.trim();
				if (!name) {
					return error(id, "set_session_name", "Session name cannot be empty");
				}
				session.setSessionName(name);
				return success(id, "set_session_name");
			}

			case "spawn_subagent": {
				const info = await session.spawnSubagent({
					task: command.task,
					context: command.context,
					maxTurns: command.maxTurns,
				});
				return success(id, "spawn_subagent", info);
			}

			case "send_subagent_input": {
				const info = await session.sendSubagentInput(command.agentId, command.message);
				return success(id, "send_subagent_input", info);
			}

			case "wait_subagent": {
				const info = await session.waitForSubagent(command.agentId, command.timeoutMs);
				return success(id, "wait_subagent", info);
			}

			case "close_subagent": {
				const info = await session.closeSubagent(command.agentId);
				return success(id, "close_subagent", info);
			}

			case "get_subagent_report": {
				const info = session.listSubagents().find((subagent) => subagent.id === command.agentId);
				if (!info) {
					return error(id, "get_subagent_report", `Unknown subagent: ${command.agentId}`);
				}
				return success(id, "get_subagent_report", {
					subagent: info,
					text: info.lastAssistantText ?? null,
				});
			}

			case "list_subagents": {
				return success(id, "list_subagents", { agents: session.listSubagents() });
			}

			case "start_background_task": {
				const info = await session.startBackgroundTask({ command: command.command });
				return success(id, "start_background_task", info);
			}

			case "wait_background_task": {
				const info = await session.waitForBackgroundTask(command.taskId, command.timeoutMs);
				return success(id, "wait_background_task", info);
			}

			case "cancel_background_task": {
				const info = await session.cancelBackgroundTask(command.taskId);
				return success(id, "cancel_background_task", info);
			}

			case "get_background_task_report": {
				const report = session.getBackgroundTaskReport(command.taskId);
				return success(id, "get_background_task_report", report);
			}

			case "list_background_tasks": {
				return success(id, "list_background_tasks", { tasks: session.listBackgroundTasks() });
			}

			// =================================================================
			// Messages
			// =================================================================

			case "get_messages": {
				return success(id, "get_messages", { messages: session.messages });
			}

			// =================================================================
			// Commands (available for invocation via prompt)
			// =================================================================

			case "get_commands": {
				const commands: RpcSlashCommand[] = [];

				for (const cmd of session.extensionRunner?.getRegisteredCommands() ?? []) {
					commands.push({
						name: cmd.invocationName,
						description: cmd.description,
						source: "extension",
						sourceInfo: cmd.sourceInfo,
					});
				}

				for (const template of session.promptTemplates) {
					commands.push({
						name: template.name,
						description: template.description,
						source: "prompt",
						sourceInfo: template.sourceInfo,
					});
				}

				for (const skill of session.resourceLoader.getSkills().skills) {
					commands.push({
						name: `skill:${skill.name}`,
						description: skill.description,
						source: "skill",
						sourceInfo: skill.sourceInfo,
					});
				}

				return success(id, "get_commands", { commands });
			}

			default: {
				const unknownCommand = command as { type: string };
				return error(undefined, unknownCommand.type, `Unknown command: ${unknownCommand.type}`);
			}
		}
	};

	// -------------------------------------------------------------------
	// Public API
	// -------------------------------------------------------------------

	return {
		handleCommand,

		subscribe(listener: (event: AgentSessionEvent) => void): () => void {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},

		async dispose(): Promise<void> {
			sessionUnsubscribe?.();
			listeners.clear();
		},
	};
}
