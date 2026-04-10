/**
 * Pimote — Remote access for pire.
 *
 * Public API for programmatic usage (e.g. from the /pimote slash command).
 */

export { createSessionToken, hashPin, revokeAllTokens, validateSessionToken, verifyPin } from "./auth.js";
export { type PimoteInstance, type StartPimoteOptions, startPimote } from "./main.js";
export { printQrCode } from "./qr.js";
export type { RpcHandler } from "./rpc-handler-types.js";
export { type PimoteServer, type PimoteServerOptions, startServer } from "./server.js";
export { startTunnel, type TunnelResult } from "./tunnel.js";
export type { PimoteConfig, PimoteStatus, ShellClientMessage, ShellServerMessage } from "./types.js";
