import { bridgeUpgradeIds, classifyBridge, parseBridgeEvidence } from './bridge-upgrade';
import type { ConnectionDescriptor } from '@clawket/agent-protocol';
const old: ConnectionDescriptor = { id: 'old', backendKind: 'openclaw', transportKind: 'relay', label: 'Old', createdAt: 1, isFreeSlot: true };
it('classifies authenticated old and current Bridge handshakes for both backends', () => {
  expect(classifyBridge(old, '0.7.0', [])).toBe('legacy');
  expect(classifyBridge(old, null, [])).toBe('legacy');
  expect(classifyBridge(old, '3.0.0', [])).toBe('current');
  expect(classifyBridge(old, null, ['bridge.capabilities.v2'])).toBe('current');
  expect(classifyBridge({ ...old, backendKind: 'hermes', transportKind: 'local' }, null, [])).toBe('legacy');
  expect(classifyBridge({ ...old, backendKind: 'hermes' }, null, ['hermes.multi-session.v2'])).toBe('current');
});
it('never asks direct OpenClaw, other backends, or unverified saved connections to upgrade', () => {
  for (const transportKind of ['local', 'tailscale', 'cloudflare', 'custom'] as const) expect(classifyBridge({ ...old, transportKind }, '0.7.0', [])).toBeUndefined();
  for (const backendKind of ['youmind', 'local-model'] as const) expect(classifyBridge({ ...old, backendKind }, null, [])).toBeUndefined();
  expect(bridgeUpgradeIds([old], {}, {})).toEqual([]);
});
it('keeps verified old offline connections but clears upgraded and removed ones', () => {
  expect(bridgeUpgradeIds([old], {}, { old: 'legacy', removed: 'legacy' })).toEqual(['old']);
  expect(bridgeUpgradeIds([old], { old: { bridgeGeneration: 'current', bridgeVersion: '3.0.0', bridgeCapabilities: [], lastReadyAt: 2 } }, { old: 'legacy' })).toEqual([]);
  expect(bridgeUpgradeIds([], {}, { old: 'legacy' })).toEqual([]);
});
it('rejects malformed persisted evidence', () => {
  for (const raw of ['broken', 'null', '[]', '"legacy"']) expect(parseBridgeEvidence(raw)).toEqual({});
  expect(parseBridgeEvidence('{"old":"legacy","bad":true,"unknown":"unknown"}')).toEqual({old:'legacy'});
});
