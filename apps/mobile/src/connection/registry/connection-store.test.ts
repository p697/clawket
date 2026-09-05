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
  readLegacyGatewayConfigsState: jest.Mock<Promise<GatewayConfigsState>, []>;
  migrateLegacyYouMindState: jest.Mock<Promise<void>, [string, string]>;
} {
  return {
    readLegacyGatewayConfigsState: jest.fn(async () => state),
    migrateLegacyYouMindState: jest.fn(async (_url: string, _scopeKey: string) => undefined),
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
    expect(legacy.readLegacyGatewayConfigsState).toHaveBeenCalledTimes(1);

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
    expect(legacy.migrateLegacyYouMindState).toHaveBeenCalledTimes(1);
    expect(legacy.migrateLegacyYouMindState).toHaveBeenCalledWith(
      'https://youmind.com',
      'youmind:sanitized@example.invalid',
    );
    expect(secureStorage.values.has(ROLLBACK_KEY)).toBe(true);
    expect(secureStorage.values.get(LEGACY_KEY)).toBe(legacyRaw);

    const forbiddenLegacy = {
      readLegacyGatewayConfigsState: jest.fn(async () => {
        throw new Error('legacy migration must not repeat');
      }),
      migrateLegacyYouMindState: jest.fn(async () => {
        throw new Error('YouMind migration must not repeat');
      }),
    };
    const restarted = new ConnectionStore({ secureStorage, legacyStorage: forbiddenLegacy });
    await expect(restarted.load()).resolves.toEqual(first);
    expect(forbiddenLegacy.readLegacyGatewayConfigsState).not.toHaveBeenCalled();
  });

  it('retries the initial registry migration when legacy YouMind auth migration fails', async () => {
    const secureStorage = new MemorySecureStorage();
    const legacy = legacyStorage({
      activeId: 'legacy-sprite',
      configs: [{
        id: 'legacy-sprite',
        name: 'Legacy sprite',
        backendKind: 'youmind',
        transportKind: 'custom',
        mode: 'custom',
        url: 'https://youmind.example.test',
        createdAt: 10,
        updatedAt: 20,
      }],
    });
    legacy.migrateLegacyYouMindState
      .mockRejectedValueOnce(new Error('legacy auth copy failed'))
      .mockResolvedValue(undefined);
    const store = new ConnectionStore({ secureStorage, legacyStorage: legacy });

    await expect(store.load()).rejects.toThrow('legacy auth copy failed');
    expect(secureStorage.values.has(CURRENT_KEY)).toBe(false);
    expect(secureStorage.values.has(ROLLBACK_KEY)).toBe(false);

    await expect(store.load()).resolves.toMatchObject({
      activeConnectionId: 'legacy-sprite',
      connections: [expect.objectContaining({
        id: 'legacy-sprite',
        backendKind: 'youmind',
      })],
    });
    expect(legacy.migrateLegacyYouMindState).toHaveBeenCalledTimes(2);
    expect(legacy.migrateLegacyYouMindState).toHaveBeenLastCalledWith(
      'https://youmind.example.test',
      'cfg:legacy-sprite',
    );
    expect(secureStorage.values.has(CURRENT_KEY)).toBe(true);
    expect(secureStorage.values.has(ROLLBACK_KEY)).toBe(true);
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

  it('upserts a Relay identity without duplicating it or dropping existing credentials', async () => {
    const secureStorage = new MemorySecureStorage();
    const store = new ConnectionStore({
      secureStorage,
      legacyStorage: legacyStorage(),
      now: () => 100,
      random: () => 0,
    });
    const first = await store.upsert({
      ...openClawInput('First', 'old-token'),
      id: 'stable-relay',
    });
    const updated = await store.upsert({
      backendKind: 'openclaw',
      transportKind: 'relay',
      label: 'Renamed relay',
      environment: 'preview',
      url: 'wss://new-relay.example/ws',
      auth: { token: 'new-token' },
      relay: {
        serverUrl: 'https://first.example/',
        gatewayId: 'gw_First',
        clientToken: 'new-client-token',
      },
      debugMode: true,
    });

    expect(first).toMatchObject({ created: true, connection: { id: 'stable-relay' } });
    expect(updated).toMatchObject({
      created: false,
      connection: { id: 'stable-relay', label: 'First' },
    });
    expect(store.getSnapshot().connections).toHaveLength(1);
    await store.createAdapter('stable-relay', (record, descriptor) => {
      expect(record).toMatchObject({
        auth: { token: 'new-token', password: 'First-password' },
        bootstrap: { token: 'First-bootstrap', strategy: 'legacy-bound' },
        relay: {
          serverUrl: 'https://first.example/',
          gatewayId: 'gw_First',
          clientToken: 'new-client-token',
        },
        debugMode: true,
      });
      return createMockAdapter({ connection: descriptor });
    });
  });

  it('upserts the same direct Hermes bridge while keeping its stable record identity', async () => {
    const store = new ConnectionStore({
      secureStorage: new MemorySecureStorage(),
      legacyStorage: legacyStorage(),
      now: () => 200,
      random: () => 0,
    });
    const first = await store.upsert({
      id: 'hermes-stable',
      backendKind: 'hermes',
      transportKind: 'local',
      label: 'Hermes local',
      url: 'ws://127.0.0.1:8789/v1/hermes/ws',
      auth: { token: 'keep-me' },
      hermes: {
        bridgeUrl: 'ws://127.0.0.1:8789/v1/hermes/ws',
        displayName: 'Original Hermes',
      },
    });
    const second = await store.upsert({
      backendKind: 'hermes',
      transportKind: 'local',
      label: 'Hermes refreshed',
      url: 'ws://127.0.0.1:8789/v1/hermes/ws/',
      hermes: { bridgeUrl: 'ws://127.0.0.1:8789/v1/hermes/ws/' },
    });

    expect(first.created).toBe(true);
    expect(second).toMatchObject({
      created: false,
      connection: { id: 'hermes-stable', label: 'Hermes local' },
    });
    expect(store.getSnapshot().connections).toHaveLength(1);
    await store.createAdapter('hermes-stable', (record, descriptor) => {
      expect(record.auth?.token).toBe('keep-me');
      expect(record.hermes?.displayName).toBe('Original Hermes');
      return createMockAdapter({ connection: descriptor });
    });
  });

  it('upserts direct OpenClaw endpoints and explicit record ids without creating duplicates', async () => {
    const store = new ConnectionStore({
      secureStorage: new MemorySecureStorage(),
      legacyStorage: legacyStorage(),
      now: () => 300,
      random: () => 0,
    });
    const direct = await store.upsert({
      id: 'openclaw-direct',
      backendKind: 'openclaw',
      transportKind: 'local',
      label: 'Local OpenClaw',
      url: 'ws://127.0.0.1:18789/ws',
      auth: { token: 'old-direct-token' },
    });
    const refreshed = await store.upsert({
      backendKind: 'openclaw',
      transportKind: 'custom',
      label: 'Refreshed OpenClaw',
      url: 'ws://127.0.0.1:18789/ws/',
      auth: { token: 'new-direct-token' },
    });
    const explicit = await store.upsert({
      id: 'openclaw-direct',
      backendKind: 'openclaw',
      transportKind: 'custom',
      label: 'Explicit refresh',
      url: 'wss://new-endpoint.example/ws',
      auth: { password: 'new-password' },
    });

    expect(direct.created).toBe(true);
    expect(refreshed).toMatchObject({
      created: false,
      connection: { id: 'openclaw-direct', label: 'Local OpenClaw' },
    });
    expect(explicit).toMatchObject({
      created: false,
      connection: { id: 'openclaw-direct', label: 'Local OpenClaw' },
    });
    expect(store.getSnapshot().connections).toHaveLength(1);
    await store.createAdapter('openclaw-direct', (record, descriptor) => {
      expect(record).toMatchObject({
        transportKind: 'custom',
        url: 'wss://new-endpoint.example/ws',
        auth: { token: 'new-direct-token', password: 'new-password' },
      });
      return createMockAdapter({ connection: descriptor });
    });
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

  it('returns a defensive credential-bearing clone only through the runtime API', async () => {
    const store = new ConnectionStore({
      secureStorage: new MemorySecureStorage(),
      legacyStorage: legacyStorage(),
      now: () => 100,
      random: () => 0,
    });
    const connection = await store.add({
      ...openClawInput('Runtime', 'runtime-secret'),
      id: 'runtime-record',
    });

    const first = await store.getRuntimeRecord(connection.id);
    expect(first).toMatchObject({
      id: 'runtime-record',
      auth: { token: 'runtime-secret', password: 'Runtime-password' },
      bootstrap: { token: 'Runtime-bootstrap' },
      relay: { clientToken: 'gct_Runtime' },
    });
    expect(JSON.stringify(store.getSnapshot())).not.toContain('runtime-secret');

    first.auth!.token = 'caller-mutated-token';
    first.relay!.clientToken = 'caller-mutated-relay-token';
    const second = await store.getRuntimeRecord(connection.id);
    expect(second.auth?.token).toBe('runtime-secret');
    expect(second.relay?.clientToken).toBe('gct_Runtime');
    expect(second).not.toBe(first);
    expect(second.auth).not.toBe(first.auth);
    expect(second.relay).not.toBe(first.relay);

    await expect(store.getRuntimeRecord('missing-runtime-record')).rejects.toEqual(
      new ConnectionNotFoundError('missing-runtime-record'),
    );
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
