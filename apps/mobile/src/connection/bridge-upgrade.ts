import type { ConnectionDescriptor } from '@clawket/agent-protocol';
import type { ConnectionRuntimeDetails } from './runtime-details';

export type BridgeGeneration = 'legacy' | 'current';
/** Only authenticated Bridge evidence: never infer age from a saved date or Gateway version. */
export function classifyBridge(connection: Pick<ConnectionDescriptor, 'backendKind' | 'transportKind'>,
  version: string | null, capabilities: readonly string[]): BridgeGeneration | undefined {
  if (connection.backendKind !== 'hermes' && !(connection.backendKind === 'openclaw' && connection.transportKind === 'relay')) return undefined;
  const match = version?.match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  if (match) return Number(match[1]) < 3 ? 'legacy' : 'current';
  const marker = connection.backendKind === 'hermes' ? 'hermes.multi-session.v2' : 'bridge.capabilities.v2';
  return capabilities.includes(marker) ? 'current' : 'legacy';
}
export function bridgeUpgradeIds(connections: readonly ConnectionDescriptor[], details: Readonly<Record<string, ConnectionRuntimeDetails>>,
  saved: Readonly<Record<string, BridgeGeneration>>): string[] {
  return connections.filter(c => (c.backendKind === 'hermes' || (c.backendKind === 'openclaw' && c.transportKind === 'relay'))
    && (details[c.id]?.bridgeGeneration ?? saved[c.id]) === 'legacy').map(c => c.id);
}
export function parseBridgeEvidence(raw: string | null): Record<string, BridgeGeneration> {
  try { const value: unknown = JSON.parse(raw ?? '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter(([key, v]) => key.length > 0 && key.length <= 256 && (v === 'legacy' || v === 'current'))) as Record<string, BridgeGeneration>;
  } catch { return {}; }
}
