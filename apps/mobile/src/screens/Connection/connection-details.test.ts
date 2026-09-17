import type { ConnectionDescriptor } from '@clawket/agent-protocol';
import {
  buildConnectionDetailRows,
  formatConnectionLastReady,
  parseConnectionServerHost,
} from './connection-details';

function connection(patch: Partial<ConnectionDescriptor> = {}): ConnectionDescriptor {
  return {
    id: 'studio',
    backendKind: 'openclaw',
    transportKind: 'relay',
    label: 'Studio',
    createdAt: 1,
    isFreeSlot: true,
    ...patch,
  };
}

describe('buildConnectionDetailRows', () => {
  it('lists identity, transport and Bridge facts and omits rows without a value', () => {
    const rows = buildConnectionDetailRows({
      connection: connection({ environment: 'preview' }),
      serverHost: 'relay.example',
      details: {
        lastReadyAt: Date.UTC(2026, 8, 5, 7, 30),
        bridgeVersion: '2026.9.5',
        bridgeCapabilities: ['bridge.capabilities.v2', 'hermes.multi-session.v2'],
      },
      locale: 'en-US',
    });
    expect(rows.map((row) => row.id)).toEqual([
      'backend', 'transport', 'environment', 'server', 'bridge-version', 'bridge-capabilities', 'last-ready',
    ]);
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'backend', valueKey: 'OpenClaw', titleNamespace: 'config' }),
      expect.objectContaining({ id: 'transport', valueKey: 'Relay' }),
      expect.objectContaining({ id: 'environment', valueKey: 'Preview', titleNamespace: 'settings' }),
      expect.objectContaining({ id: 'server', value: 'relay.example' }),
      expect.objectContaining({ id: 'bridge-version', value: '2026.9.5' }),
      expect.objectContaining({ id: 'bridge-capabilities', value: 'bridge.capabilities.v2, hermes.multi-session.v2' }),
      expect.objectContaining({ id: 'last-ready', value: expect.stringContaining('2026') }),
    ]));
  });

  it('keeps the minimum rows for a connection that never reached the Bridge', () => {
    const rows = buildConnectionDetailRows({
      connection: connection({ backendKind: 'local-model', transportKind: 'relay' }),
      serverHost: '  ',
      details: { lastReadyAt: null, bridgeVersion: null, bridgeCapabilities: [] },
    });
    expect(rows.map((row) => row.id)).toEqual(['backend', 'transport', 'environment', 'last-ready']);
    expect(rows[0]).toMatchObject({ valueKey: 'Local model' });
    expect(rows[2]).toMatchObject({ valueKey: 'Production' });
    expect(rows[3]).toMatchObject({ value: '—' });
  });
});

describe('formatConnectionLastReady', () => {
  it('formats a timestamp and falls back to a dash for missing or corrupt input', () => {
    expect(formatConnectionLastReady(Date.UTC(2026, 8, 5, 7, 30), 'en-US')).toContain('2026');
    expect(formatConnectionLastReady(null, 'en-US')).toBe('—');
    expect(formatConnectionLastReady(Number.NaN, 'en-US')).toBe('—');
    expect(formatConnectionLastReady(-5, 'en-US')).toBe('—');
  });
});

describe('parseConnectionServerHost', () => {
  it('extracts the host and ignores malformed URLs', () => {
    expect(parseConnectionServerHost('wss://relay.example:8443/ws?token=secret')).toBe('relay.example:8443');
    expect(parseConnectionServerHost('not a url')).toBeUndefined();
    expect(parseConnectionServerHost('')).toBeUndefined();
  });
});
