/**
 * Minimal RPC handler interface for the pimote agent bridge.
 *
 * The actual implementation comes from createRpcHandler() in the
 * coding-agent package. We define a minimal interface here so pimote
 * doesn't depend on internal module paths.
 */

export interface RpcHandler {
	handleCommand(command: unknown): Promise<unknown>;
	subscribe(listener: (event: unknown) => void): () => void;
	dispose(): Promise<void>;
}
