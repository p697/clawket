import { BRIDGE_UPDATE_START_METHOD, BRIDGE_UPDATE_STATUS_METHOD, type BridgeUpdateStart, type BridgeUpdateStatus } from '@clawket/agent-protocol';

export { isBridgeUpdateFinished, parseBridgeUpdateStatus, type BridgeUpdateOutcome, type BridgeUpdateStart, type BridgeUpdateStatus } from '@clawket/agent-protocol';

/**
 * Phone-started official update (owner decision 2026-10-06). The CLI injects this control; runtimes
 * only expose `start` (no parameters) and `status`, never the private local owner `stop`.
 */
export interface RemoteUpdateControl {
  /** False when the computer opted out or this process cannot launch the official updater. */
  available(): boolean;
  start(): Promise<BridgeUpdateStart>;
  status(): BridgeUpdateStatus | null;
}

export function isRemoteUpdateMethod(method: unknown): boolean {
  return method === BRIDGE_UPDATE_START_METHOD || method === BRIDGE_UPDATE_STATUS_METHOD;
}

/** Answers both methods the same way for every backend; parameters are ignored by design. */
export async function handleRemoteUpdateRequest(control: RemoteUpdateControl | undefined, method: string): Promise<unknown> {
  if (!control?.available()) throw new Error('Remote Bridge update is unavailable on this computer');
  return method === BRIDGE_UPDATE_START_METHOD ? control.start() : { status: control.status() };
}

/** Health/handshake marker, present only while the control is available. */
export function remoteUpdateHealth(control: RemoteUpdateControl | undefined): { remoteUpdate?: 1 } {
  return control?.available() ? { remoteUpdate: 1 } : {};
}
