import { createMockAdapter } from '@clawket/agent-protocol';
import legacyFixture from '../../../../../tests/fixtures/mobile-storage/v2.1.2-gateway-configs.schema-fixture.json';

import type { GatewayConfigsState } from '../../types';
import {
  ConnectionNotFoundError,
  ConnectionStore,
  createConnectionId,
  type LegacyConnectionStorage,
  type SecureConnectionStorage,
} from './connection-store';

const CURRENT_KEY = 'clawket.connectionRegistry.v1';
const ROLLBACK_KEY = 'clawket.connectionRegistry.rollback.v1';
const LEGACY_KEY = 'clawket.gatewayConfigsState.v1';

const LEGACY_2_1_FIXTURE = legacyFixture.secureStore.value as GatewayConfigsState;

class MemorySecureStorage implements SecureConnectionStorage {
  readonly values = new Map<string, string>();
  readonly writes: Array<{ key: string; value: string }> = [];
  failNextCurrentWrite = false;

  async getItemAsync(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async setItemAsync(key: string, value: string): Promise<void> {
    if (key === CURRENT_KEY && this.failNextCurrentWrite) {
      this.failNextCurrentWrite = false;
      throw new Error('secure write failed');
    }
    this.values.set(key, value);
    this.writes.push({ key, value });
  }
}

function legacyStorage(state: GatewayConfigsState = { activeId: null, configs: [] }): LegacyConnectionStorage & {
  getGatewayConfigsState: jest.Mock<Promise<GatewayConfigsState>, []>;
} {
  return {
    getGatewayConfigsState: jest.fn(async () => state),
  };
}

function openClawInput(label: string, token = `${label}-token`) {
  return {
    backendKind: 'openclaw' as const,
    transportKind: 'relay' as const,
    label,
    environment: 'preview' as const,
    url: `wss://${label.toLowerCase()}.example/ws`,
    auth: { token, password: `${label}-password` },
    bootstrap: { token: `${label}-bootstrap`, strategy: 'legacy-bound' as const },
    relay: {
      serverUrl: `https://${label.toLowerCase()}.example`,
      gatewayId: `gw_${label}`,
      clientToken: `gct_${label}`,
    },
  };
}

describe('ConnectionStore', () => {
  it('migrates the released 2.1 schema fixture once and preserves every credential-bearing field', async () => {
    expect(legacyFixture.provenance).toMatchObject({
      kind: 'schema-reconstruction',
      sourceCommit: '3e37a72',
      sourceVersion: '2.1.2',
    });
    const secureStorage = new MemorySecureStorage();
    const legacyRaw = JSON.stringify(LEGACY_2_1_FIXTURE);
    secureStorage.values.set(LEGACY_KEY, legacyRaw);
    const legacy = legacyStorage(LEGACY_2_1_FIXTURE);
    const store = new ConnectionStore({ secureStorage, legacyStorage: legacy });

    const first = await store.load();
    const second = await store.load();

    expect(first).toEqual(second);
    expect(first.activeConnectionId).toBe('hermes-preview');
    expect(first.freeConnectionId).toBe('hermes-preview');
    expect(first.connections).toEqual([
      expect.objectContaining({
        id: 'openclaw-production',
        backendKind: 'openclaw',
        transportKind: 'relay',
        environment: 'production',
        isFreeSlot: false,
      }),
      expect.objectContaining({
        id: 'hermes-preview',
        backendKind: 'hermes',
        environment: 'preview',
        isFreeSlot: true,
      }),
      expect.objectContaining({
        id: 'youmind-default',
        backendKind: 'youmind',
        transportKind: 'https',
      }),
    ]);
    expect(JSON.stringify(first)).not.toContain('sanitized-openclaw-token');
    expect(JSON.stringify(first)).not.toContain('gct_sanitized_openclaw');
    expect(JSON.stringify(first)).not.toContain('sanitized-bootstrap-token');
    expect(legacy.getGatewayConfigsState).toHaveBeenCalledTimes(1);

    const persisted = JSON.parse(secureStorage.values.get(CURRENT_KEY) ?? '{}');
    expect(persisted.state.records[0]).toMatchObject({
      auth: { token: 'sanitized-openclaw-token', password: 'sanitized-openclaw-password' },
      bootstrap: { token: 'sanitized-bootstrap-token', strategy: 'mobile-setup' },
      relay: { clientToken: 'gct_sanitized_openclaw' },
    });
    expect(persisted.state.records[1]).toMatchObject({
      relay: { clientToken: 'hct_sanitized_hermes' },
      hermes: { bridgeUrl: 'ws://127.0.0.1:8789/v1/hermes/ws' },
      debugMode: true,
    });
    expect(persisted.state.records[2]).toMatchObject({
      transportKind: 'https',
      youmind: { authScopeKey: 'youmind:sanitized@example.invalid' },
    });
    expect(secureStorage.values.has(ROLLBACK_KEY)).toBe(true);
    expect(secureStorage.values.get(LEGACY_KEY)).toBe(legacyRaw);

    const forbiddenLegacy = {
      getGatewayConfigsState: jest.fn(async () => {
        throw new Error('legacy migration must not repeat');
      }),
    };
    const restarted = new ConnectionStore({ secureStorage, legacyStorage: forbiddenLegacy });
    await expect(restarted.load()).resolves.toEqual(first);
    expect(forbiddenLegacy.getGatewayConfigsState).not.toHaveBeenCalled();
  });

  it('keeps exactly one active connection while preserving the independently selected free slot', async () => {
    const secureStorage = new MemorySecureStorage();
    const store = new ConnectionStore({
      secureStorage,
      legacyStorage: legacyStorage(),
      now: () => 100,
      random: () => 0.25,
    });

    await store.load();
    const first = await store.add(openClawInput('First'));
    const second = await store.add({
      ...openClawInput('Second'),
      id: 'second-id',
      createdAt: 200,
    });

    expect(store.getSnapshot()).toMatchObject({
      activeConnectionId: first.id,
      freeConnectionId: first.id,
    });
    expect(store.getSnapshot().connections.filter((connection) => connection.isFreeSlot)).toHaveLength(1);

    const change = await store.setActive(second.id);
    expect(change).toMatchObject({
      previousConnectionId: first.id,
      activeConnectionId: second.id,
      changed: true,
    });
    expect(store.getSnapshot()).toMatchObject({
      activeConnectionId: second.id,
      freeConnectionId: first.id,
    });

    const revision = store.getSnapshot().revision;
    await expect(store.setActive(second.id)).resolves.toMatchObject({ changed: false });
    expect(store.getSnapshot().revision).toBe(revision);
    await store.setFreeConnection(second.id);
    expect(store.getSnapshot().connections).toEqual([
      expect.objectContaining({ id: first.id, isFreeSlot: false }),
      expect.objectContaining({ id: second.id, isFreeSlot: true }),
    ]);
    await expect(store.setActive('missing')).rejects.toBeInstanceOf(ConnectionNotFoundError);
  });

  it('imports legacy editor changes atomically without exposing credentials in descriptors', async () => {
    const secureStorage = new MemorySecureStorage();
    let legacyState: GatewayConfigsState = { activeId: null, configs: [] };
    const legacy: LegacyConnectionStorage = {
      getGatewayConfigsState: jest.fn(async () => legacyState),
    };
    const store = new ConnectionStore({ secureStorage, legacyStorage: legacy });
    await store.load();
    legacyState = {
      activeId: 'edited',
      configs: [{
        id: 'edited',
        name: 'Edited connection',
        backendKind: 'openclaw',
        transportKind: 'local',
        mode: 'local',
        url: 'ws://127.0.0.1:18789/ws',
        token: 'editor-secret',
        createdAt: 10,
        updatedAt: 20,
      }],
    };

    const imported = await store.syncLegacyState();

    expect(imported).toMatchObject({
      activeConnectionId: 'edited',
      connections: [expect.objectContaining({
        id: 'edited',
        backendKind: 'openclaw',
        label: 'Edited connection',
      })],
    });
    expect(JSON.stringify(imported)).not.toContain('editor-secret');
    const persisted = JSON.parse(secureStorage.values.get(CURRENT_KEY) ?? '{}');
    expect(persisted.state.records[0].auth.token).toBe('editor-secret');
    expect(secureStorage.values.has(ROLLBACK_KEY)).toBe(true);

    const revision = imported.revision;
    await store.syncLegacyState();
    expect(store.getSnapshot().revision).toBe(revision);
  });

  it('does not label a custom relay registry as an official production or preview environment', async () => {
    const customLegacy: GatewayConfigsState = {
      activeId: 'custom-relay',
      configs: [{
        id: 'custom-relay',
        name: 'Self hosted',
        backendKind: 'openclaw',
        transportKind: 'relay',
        mode: 'relay',
        url: 'wss://relay.example.test/ws',
        relay: {
          serverUrl: 'https://registry.example.test',
          gatewayId: 'gw_custom',
        },
        createdAt: 1,
        updatedAt: 1,
      }],
    };
    const store = new ConnectionStore({
      secureStorage: new MemorySecureStorage(),
      legacyStorage: legacyStorage(customLegacy),
    });

    const snapshot = await store.load();

    expect(snapshot.connections[0].environment).toBeUndefined();
  });

  it('replaces a record without changing its stable identity or exposing credentials', async () => {
    const secureStorage = new MemorySecureStorage();
    const store = new ConnectionStore({
      secureStorage,
      legacyStorage: legacyStorage(),
      now: () => 100,
      random: () => 0,
    });
    const connection = await store.add(openClawInput('Before', 'old-secret'));

    const replaced = await store.replace(connection.id, {
      ...openClawInput('After', 'new-secret'),
      debugMode: true,
    });

    expect(replaced).toMatchObject({ id: connection.id, label: 'After', createdAt: 100 });
    expect(JSON.stringify(replaced)).not.toContain('new-secret');
    let capturedToken: string | undefined;
    const adapter = await store.createAdapter(connection.id, (record, descriptor) => {
      capturedToken = record.auth?.token;
      return createMockAdapter({ connection: descriptor });
    });
    expect(capturedToken).toBe('new-secret');
    expect(adapter.connection).toEqual(replaced);

    const patched = await store.update(connection.id, { label: 'Renamed safely' });
    expect(patched.label).toBe('Renamed safely');
    await store.createAdapter(connection.id, (record, descriptor) => {
      expect(record.auth?.token).toBe('new-secret');
      expect(record.bootstrap?.token).toBe('After-bootstrap');
      return createMockAdapter({ connection: descriptor });
    });

    await store.update(connection.id, { auth: null, bootstrap: null });
    await store.createAdapter(connection.id, (record, descriptor) => {
      expect(record.auth).toBeUndefined();
      expect(record.bootstrap).toBeUndefined();
      return createMockAdapter({ connection: descriptor });
    });
  });

  it('rejects invalid patches without changing the committed state', async () => {
    const secureStorage = new MemorySecureStorage();
    const store = new ConnectionStore({ secureStorage, legacyStorage: legacyStorage() });
    const connection = await store.add({ ...openClawInput('Valid'), id: 'valid' });
    const committed = secureStorage.values.get(CURRENT_KEY);

    await expect(store.update(connection.id, { label: ' ' })).rejects.toThrow('Invalid connection record patch');

    expect(secureStorage.values.get(CURRENT_KEY)).toBe(committed);
    expect(store.getSnapshot().connections[0].label).toBe('Valid');
  });

  it('leaves the committed key and in-memory snapshot unchanged when a secure write fails', async () => {
    const secureStorage = new MemorySecureStorage();
    const store = new ConnectionStore({
      secureStorage,
      legacyStorage: legacyStorage(),
      now: () => 100,
      random: () => 0.1,
    });
    await store.add(openClawInput('Committed', 'committed-secret'));
    const committedRaw = secureStorage.values.get(CURRENT_KEY);
    const committedSnapshot = store.getSnapshot();
    secureStorage.failNextCurrentWrite = true;

    await expect(store.add(openClawInput('Rejected', 'rejected-secret'))).rejects.toThrow('secure write failed');

    expect(secureStorage.values.get(CURRENT_KEY)).toBe(committedRaw);
    expect(store.getSnapshot()).toBe(committedSnapshot);
    expect(secureStorage.values.get(CURRENT_KEY)).not.toContain('rejected-secret');
    const restarted = new ConnectionStore({ secureStorage, legacyStorage: legacyStorage() });
    await expect(restarted.load()).resolves.toEqual(committedSnapshot);
  });

  it('retains exactly one prior committed version and can roll backward and forward', async () => {
    const secureStorage = new MemorySecureStorage();
    const store = new ConnectionStore({
      secureStorage,
      legacyStorage: legacyStorage(),
      now: () => 100,
      random: () => 0.1,
    });
    const first = await store.add({ ...openClawInput('First'), id: 'first' });
    await store.add({ ...openClawInput('Second'), id: 'second' });
    expect(store.getSnapshot().connections.map((connection) => connection.id)).toEqual(['first', 'second']);

    const rolledBack = await store.rollback();
    expect(rolledBack.connections.map((connection) => connection.id)).toEqual([first.id]);

    const rolledForward = await store.rollback();
    expect(rolledForward.connections.map((connection) => connection.id)).toEqual(['first', 'second']);
  });

  it('uses the rollback snapshot when the current snapshot is corrupt', async () => {
    const secureStorage = new MemorySecureStorage();
    const store = new ConnectionStore({ secureStorage, legacyStorage: legacyStorage() });
    await store.add({ ...openClawInput('First'), id: 'first' });
    await store.add({ ...openClawInput('Second'), id: 'second' });
    secureStorage.values.set(CURRENT_KEY, '{not-json');

    const restarted = new ConnectionStore({ secureStorage, legacyStorage: legacyStorage() });
    const recovered = await restarted.load();

    expect(recovered.connections.map((connection) => connection.id)).toEqual(['first']);
  });

  it('selects a deterministic fallback when the active or free connection is removed', async () => {
    const store = new ConnectionStore({
      secureStorage: new MemorySecureStorage(),
      legacyStorage: legacyStorage(),
    });
    await store.add({ ...openClawInput('First'), id: 'first' });
    await store.add({ ...openClawInput('Second'), id: 'second' });
    await store.setActive('first');
    await store.setFreeConnection('first');

    await expect(store.remove('first')).resolves.toBe(true);
    expect(store.getSnapshot()).toMatchObject({
      activeConnectionId: 'second',
      freeConnectionId: 'second',
    });
    await expect(store.remove('missing')).resolves.toBe(false);
    await store.remove('second');
    expect(store.getSnapshot()).toMatchObject({
      activeConnectionId: null,
      freeConnectionId: null,
      connections: [],
    });
  });

  it('publishes runtime bridge capability downgrade metadata without persisting credentials or a revision', async () => {
    const store = new ConnectionStore({
      secureStorage: new MemorySecureStorage(),
      legacyStorage: legacyStorage(),
    });
    await store.add({ ...openClawInput('Bridge'), id: 'bridge' });
    const revision = store.getSnapshot().revision;
    const listener = jest.fn();
    const unsubscribe = store.subscribe(listener);

    store.setBridgeOutdated('missing', true);
    store.setBridgeOutdated('bridge', true);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot()).toMatchObject({
      revision,
      connections: [expect.objectContaining({ id: 'bridge', bridgeOutdated: true })],
    });
    await store.createAdapter('bridge', (_record, descriptor) => {
      expect(descriptor.bridgeOutdated).toBe(true);
      return createMockAdapter({ connection: descriptor });
    });

    store.setBridgeOutdated('bridge', false);
    expect(store.getSnapshot().connections[0].bridgeOutdated).toBeUndefined();
    unsubscribe();
  });
});

describe('createConnectionId', () => {
  it('normalizes clock and random boundaries into storage-safe stable ids', () => {
    expect(createConnectionId(1000, 0)).toBe('connection_rs_0000000');
    expect(createConnectionId(Number.NaN, Number.NaN)).toBe('connection_0_0000000');
    expect(createConnectionId(1000.9, 1)).toMatch(/^connection_rs_[a-z0-9]{7}$/);
  });
});
