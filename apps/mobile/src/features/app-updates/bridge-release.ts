import type { ConnectionDescriptor } from '@clawket/agent-protocol';
export type BridgeRelease = { version: string; unifiedUpdate: boolean; checkedAt: number };
export const BRIDGE_RELEASE_URL = 'https://registry.npmjs.org/@p697%2fclawket/latest';
export function stableVersion(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 64 && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value) && value.split('.').every(n => Number.isSafeInteger(Number(n)));
}
export function newerVersion(latest: string, current: string): boolean {
  if (!stableVersion(latest) || !stableVersion(current)) return false;
  const right = current.split('.').map(Number);
  for (const [i, n] of latest.split('.').map(Number).entries()) if (n !== right[i]) return n > right[i];
  return false;
}
export function parseRelease(value: unknown, checkedAt: number): BridgeRelease | null {
  if (!value || typeof value !== 'object') return null;
  const metadata = value as { name?: unknown; version?: unknown; clawket?: { updateProtocol?: unknown } };
  return metadata.name === '@p697/clawket' && stableVersion(metadata.version) ? { version: metadata.version, unifiedUpdate: metadata.clawket?.updateProtocol === 1, checkedAt } : null;
}
export function usesBridge(c: Pick<ConnectionDescriptor, 'backendKind' | 'transportKind'>): boolean {
  return c.backendKind !== 'openclaw' || c.transportKind === 'relay';
}
export function upgradeCommand(release: BridgeRelease | null): string | null {
  // Never advertise an unreleased command or freeze the guide on 3.0.0.
  return release?.unifiedUpdate ? `npx -y @p697/clawket@${release.version} update` : null;
}
