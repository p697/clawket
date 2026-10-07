import { RELAY_OWNER_PONG_V1_CAPABILITY, RELAY_TRANSFER_HINT_V1_CAPABILITY } from '@clawket/shared';
import type { RelayRuntime } from './runtime';
import { CONTROL_PREFIX, type SocketAttachment } from './types';

const CONTENTION_WINDOW_MS = 60_000;
const PROBE_TIMEOUT_MS = 12_000;

// Old Hermes runtimes reconnect after being replaced, using the same saved
// instance ID. Permit ordinary replacement, but probe repeated contenders so
// two old processes cannot continuously evict each other and their clients.
export function admitHermesOwner(
  runtime: RelayRuntime, clientId: string, capabilities: string[], now: number,
): { allowed: boolean; replacementAt?: number } {
  const current = runtime.gatewaySocket;
  const attachment = current?.deserializeAttachment() as SocketAttachment | null;
  if (runtime.policy.backend !== 'hermes' || current?.readyState !== WebSocket.OPEN
    || attachment?.clientId !== clientId) return { allowed: true };
  if (capabilities.includes(RELAY_OWNER_PONG_V1_CAPABILITY)
    || attachment.capabilities?.some(capability => capability === RELAY_OWNER_PONG_V1_CAPABILITY
      || capability === RELAY_TRANSFER_HINT_V1_CAPABILITY)) {
    return { allowed: true, replacementAt: now };
  }
  const previous = attachment.ownerContention;
  if (!previous || now - previous.lastAttemptAt >= CONTENTION_WINDOW_MS) {
    return { allowed: true, replacementAt: now };
  }
  const next = { ...previous, lastAttemptAt: now };
  if (previous.probeAt !== undefined && now >= previous.probeAt
    && now - previous.probeAt >= PROBE_TIMEOUT_MS && previous.ackAt === undefined) {
    return { allowed: true, replacementAt: now };
  }
  // Neither retries nor hibernation renew an outstanding probe's deadline.
  const sendProbe = previous.probeAt === undefined
    || (previous.ackAt !== undefined && now - previous.probeAt >= PROBE_TIMEOUT_MS)
    || (previous.probeAt > now);
  if (sendProbe) { next.probeAt = now; delete next.ackAt; }
  try {
    current.serializeAttachment({ ...attachment, ownerContention: next });
    if (sendProbe) current.send(CONTROL_PREFIX + JSON.stringify({
      type: 'control', event: 'gateway_ping', ts: now,
    }));
  } catch {
    // Keep the current generation intact if its evidence cannot be persisted.
  }
  return { allowed: false };
}

export function acknowledgeOwnerContention(
  runtime: RelayRuntime, socket: WebSocket, event: string, ts: unknown, now: number,
): boolean {
  if (runtime.policy.backend !== 'hermes' || runtime.gatewaySocket !== socket
    || event !== 'gateway_pong') return false;
  const attachment = socket.deserializeAttachment() as SocketAttachment | null;
  const probe = attachment?.ownerContention;
  if (!attachment || !probe || probe.probeAt !== ts || typeof ts !== 'number'
    || now < ts || now - ts >= PROBE_TIMEOUT_MS) return false;
  socket.serializeAttachment({ ...attachment, ownerContention: { ...probe, ackAt: now } });
  return true;
}
