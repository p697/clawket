import type {
  AgentAdapter,
  BackendKind,
  ConnectionDescriptor,
  ConnectionRecord,
  ServiceEnvironment,
  TransportKind,
} from '@clawket/agent-protocol';
import {
  resolveGatewayBackendKind,
  resolveGatewayTransportKind,
} from '@clawket/agent-protocol';
import * as SecureStore from 'expo-secure-store';

import { resolveOfficialRelayEnvironment } from '../../services/relay-environment';
import { StorageService } from '../../services/storage';
import type { GatewayConfigsState, SavedGatewayConfig } from '../../types';

const CURRENT_STORAGE_KEY = 'clawket.connectionRegistry.v1';
const ROLLBACK_STORAGE_KEY = 'clawket.connectionRegistry.rollback.v1';
const LEGACY_CONFIGS_STORAGE_KEY = 'clawket.gatewayConfigsState.v1';
const STORAGE_VERSION = 1;

const SECURE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

const BACKEND_KINDS = new Set<BackendKind>(['openclaw', 'hermes', 'youmind']);
const TRANSPORT_KINDS = new Set<TransportKind>([
  'relay',
  'local',
  'tailscale',
  'cloudflare',
  'custom',
  'https',
]);

const LEGACY_TRANSPORT_NORMALIZERS: Record<BackendKind, (value: TransportKind) => TransportKind> = {
  openclaw: (value) => value,
  hermes: (value) => value,
  youmind: () => 'https',
};

const LEGACY_YOUMIND_METADATA: Record<BackendKind, (id: string) => ConnectionRecord['youmind']> = {
  openclaw: () => undefined,
  hermes: () => undefined,
  youmind: (id) => ({ authScopeKey: `cfg:${id}` }),
};

type RegistryState = {
  activeConnectionId: string | null;
  freeConnectionId: string | null;
  records: ConnectionRecord[];
};

type PersistedRegistrySnapshot = {
  version: typeof STORAGE_VERSION;
  revision: number;
  state: RegistryState;
};

type LegacyConnectionSupplement = Pick<ConnectionRecord, 'environment' | 'debugMode' | 'youmind'>;

export type NewConnectionRecord = Omit<ConnectionRecord, 'id' | 'createdAt'> & {
  id?: string;
  createdAt?: number;
};

export type ConnectionRecordReplacement = Omit<ConnectionRecord, 'id' | 'createdAt'>;

export type ConnectionUpsertResult = Readonly<{
  connection: ConnectionDescriptor;
  created: boolean;
}>;

export type ConnectionRecordPatch = Partial<
  Pick<ConnectionRecord, 'backendKind' | 'transportKind' | 'label' | 'url'>
> & {
  environment?: ServiceEnvironment | null;
  auth?: ConnectionRecord['auth'] | null;
  bootstrap?: ConnectionRecord['bootstrap'] | null;
  relay?: ConnectionRecord['relay'] | null;
  hermes?: ConnectionRecord['hermes'] | null;
  youmind?: ConnectionRecord['youmind'] | null;
  debugMode?: boolean | null;
};

export type ConnectionAdapterFactoryContext = Readonly<{
  onReconnect?: (reason: 'seq_gap') => void;
}>;

export type ConnectionAdapterFactory = (
  record: Readonly<ConnectionRecord>,
  descriptor: ConnectionDescriptor,
  context?: ConnectionAdapterFactoryContext,
) => AgentAdapter;

export type ConnectionStoreSnapshot = Readonly<{
  revision: number;
  activeConnectionId: string | null;
  freeConnectionId: string | null;
  connections: ReadonlyArray<ConnectionDescriptor>;
}>;

export type ActiveConnectionChange = Readonly<{
  previousConnectionId: string | null;
  activeConnectionId: string;
  changed: boolean;
  snapshot: ConnectionStoreSnapshot;
}>;

export interface SecureConnectionStorage {
  getItemAsync(key: string, options?: SecureStore.SecureStoreOptions): Promise<string | null>;
  setItemAsync(key: string, value: string, options?: SecureStore.SecureStoreOptions): Promise<void>;
}

export interface LegacyConnectionStorage {
  readLegacyGatewayConfigsState(): Promise<GatewayConfigsState>;
  migrateLegacyYouMindState(url: string, scopeKey: string): Promise<void>;
}

export interface ConnectionStoreOptions {
  secureStorage?: SecureConnectionStorage;
  legacyStorage?: LegacyConnectionStorage;
  now?: () => number;
  random?: () => number;
}

export class ConnectionNotFoundError extends Error {
  constructor(readonly connectionId: string) {
    super(`Connection not found: ${connectionId}`);
    this.name = 'ConnectionNotFoundError';
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized || undefined;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function normalizeEnvironment(value: unknown): ServiceEnvironment | undefined {
  return value === 'production' || value === 'preview' ? value : undefined;
}

function normalizeAuth(value: unknown): ConnectionRecord['auth'] {
  if (!isObject(value)) return undefined;
  const token = readOptionalString(value.token);
  const password = readOptionalString(value.password);
  return token || password ? { token, password } : undefined;
}

function normalizeBootstrap(value: unknown): ConnectionRecord['bootstrap'] {
  if (!isObject(value)) return undefined;
  const token = readOptionalString(value.token);
  const strategy = value.strategy === 'mobile-setup' || value.strategy === 'legacy-bound'
    ? value.strategy
    : undefined;
  if (!token || !strategy) return undefined;
  const expiresAtMs = typeof value.expiresAtMs === 'number' && Number.isFinite(value.expiresAtMs)
    ? value.expiresAtMs
    : undefined;
  const access = value.access === 'full' || value.access === 'limited' || value.access === 'node'
    ? value.access
    : undefined;
  return {
    token,
    strategy,
    ...(expiresAtMs !== undefined ? { expiresAtMs } : {}),
    ...(access ? { access } : {}),
  };
}

function normalizeRelay(value: unknown): ConnectionRecord['relay'] {
  if (!isObject(value)) return undefined;
  const serverUrl = readNonEmptyString(value.serverUrl);
  const gatewayId = readNonEmptyString(value.gatewayId);
  if (!serverUrl || !gatewayId) return undefined;
  const clientToken = readOptionalString(value.clientToken);
  const displayName = readNonEmptyString(value.displayName);
  const protocolVersion = typeof value.protocolVersion === 'number' && Number.isFinite(value.protocolVersion)
    ? Math.trunc(value.protocolVersion)
    : undefined;
  const supportsBootstrap = typeof value.supportsBootstrap === 'boolean'
    ? value.supportsBootstrap
    : undefined;
  return {
    serverUrl,
    gatewayId,
    ...(clientToken ? { clientToken } : {}),
    ...(displayName ? { displayName } : {}),
    ...(protocolVersion !== undefined ? { protocolVersion } : {}),
    ...(supportsBootstrap !== undefined ? { supportsBootstrap } : {}),
  };
}

function normalizeHermes(value: unknown): ConnectionRecord['hermes'] {
  if (!isObject(value)) return undefined;
  const bridgeUrl = readNonEmptyString(value.bridgeUrl);
  if (!bridgeUrl) return undefined;
  const displayName = readNonEmptyString(value.displayName);
  return { bridgeUrl, ...(displayName ? { displayName } : {}) };
}

function normalizeYouMind(value: unknown): ConnectionRecord['youmind'] {
  if (!isObject(value)) return undefined;
  const authScopeKey = readNonEmptyString(value.authScopeKey);
  return authScopeKey ? { authScopeKey } : undefined;
}

function normalizeConnectionRecord(value: unknown): ConnectionRecord | null {
  if (!isObject(value)) return null;
  const id = readNonEmptyString(value.id);
  const label = readNonEmptyString(value.label);
  const url = readNonEmptyString(value.url);
  const createdAt = typeof value.createdAt === 'number' && Number.isFinite(value.createdAt) && value.createdAt >= 0
    ? value.createdAt
    : undefined;
  if (
    !id
    || !label
    || !url
    || createdAt === undefined
    || !BACKEND_KINDS.has(value.backendKind as BackendKind)
    || !TRANSPORT_KINDS.has(value.transportKind as TransportKind)
  ) {
    return null;
  }
  const environment = normalizeEnvironment(value.environment);
  const auth = normalizeAuth(value.auth);
  const bootstrap = normalizeBootstrap(value.bootstrap);
  const relay = normalizeRelay(value.relay);
  const hermes = normalizeHermes(value.hermes);
  const youmind = normalizeYouMind(value.youmind);
  const invalidAuth = value.auth !== undefined && (
    !isObject(value.auth)
    || (value.auth.token !== undefined && !readOptionalString(value.auth.token))
    || (value.auth.password !== undefined && !readOptionalString(value.auth.password))
  );
  if (
    (value.environment !== undefined && !environment)
    || invalidAuth
    || (value.bootstrap !== undefined && !bootstrap)
    || (value.relay !== undefined && !relay)
    || (value.hermes !== undefined && !hermes)
    || (value.youmind !== undefined && !youmind)
    || (value.debugMode !== undefined && typeof value.debugMode !== 'boolean')
  ) {
    return null;
  }
  return {
    id,
    backendKind: value.backendKind as BackendKind,
    transportKind: value.transportKind as TransportKind,
    label,
    ...(environment ? { environment } : {}),
    createdAt,
    url,
    ...(auth ? { auth } : {}),
    ...(bootstrap ? { bootstrap } : {}),
    ...(relay ? { relay } : {}),
    ...(hermes ? { hermes } : {}),
    ...(youmind ? { youmind } : {}),
    ...(typeof value.debugMode === 'boolean' ? { debugMode: value.debugMode } : {}),
  };
}

function normalizeRegistryState(value: unknown): RegistryState | null {
  if (!isObject(value) || !Array.isArray(value.records)) return null;
  const records = value.records.map(normalizeConnectionRecord);
  if (records.some((record) => record === null)) return null;
  const normalizedRecords = records as ConnectionRecord[];
  const ids = new Set(normalizedRecords.map((record) => record.id));
  if (ids.size !== normalizedRecords.length) return null;
  const activeConnectionId = value.activeConnectionId === null
    ? null
    : readNonEmptyString(value.activeConnectionId);
  const freeConnectionId = value.freeConnectionId === null
    ? null
    : readNonEmptyString(value.freeConnectionId);
  if (normalizedRecords.length === 0) {
    if (activeConnectionId !== null || freeConnectionId !== null) return null;
  } else if (!activeConnectionId || !freeConnectionId || !ids.has(activeConnectionId) || !ids.has(freeConnectionId)) {
    return null;
  }
  return { activeConnectionId, freeConnectionId, records: normalizedRecords };
}

function parsePersistedSnapshot(raw: string | null): PersistedRegistrySnapshot | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!isObject(value) || value.version !== STORAGE_VERSION) return null;
    const revision = typeof value.revision === 'number'
      && Number.isSafeInteger(value.revision)
      && value.revision >= 0
      ? value.revision
      : undefined;
    const state = normalizeRegistryState(value.state);
    return revision === undefined || !state
      ? null
      : { version: STORAGE_VERSION, revision, state };
  } catch {
    return null;
  }
}

function inferLegacyEnvironment(config: SavedGatewayConfig): ServiceEnvironment | undefined {
  if (!config.relay) return undefined;
  const candidate = config.relay.serverUrl;
  const openClawEnvironment = resolveOfficialRelayEnvironment(candidate);
  if (openClawEnvironment) return openClawEnvironment;
  try {
    const host = new URL(candidate).hostname.toLowerCase();
    if (host === 'hermes-registry.clawket.ai') return 'production';
    if (/^clawket-hermes-registry-preview\.[^.]+\.workers\.dev$/.test(host)) return 'preview';
  } catch {
    return undefined;
  }
  return undefined;
}

function readLegacySupplements(raw: string | null): Map<string, LegacyConnectionSupplement> {
  const supplements = new Map<string, LegacyConnectionSupplement>();
  if (!raw) return supplements;
  try {
    const value: unknown = JSON.parse(raw);
    if (!isObject(value) || !Array.isArray(value.configs)) return supplements;
    for (const item of value.configs) {
      if (!isObject(item)) continue;
      const id = readNonEmptyString(item.id);
      if (!id) continue;
      const environment = normalizeEnvironment(item.environment);
      const youmind = normalizeYouMind(item.youmind);
      supplements.set(id, {
        ...(environment ? { environment } : {}),
        ...(typeof item.debugMode === 'boolean' ? { debugMode: item.debugMode } : {}),
        ...(youmind ? { youmind } : {}),
      });
    }
  } catch {
    return supplements;
  }
  return supplements;
}

function migrateLegacyConfig(
  config: SavedGatewayConfig,
  supplement?: LegacyConnectionSupplement,
): ConnectionRecord {
  const backendKind = resolveGatewayBackendKind(config);
  const legacyTransport = resolveGatewayTransportKind(config);
  const transportKind = LEGACY_TRANSPORT_NORMALIZERS[backendKind](legacyTransport);
  const environment = supplement?.environment ?? inferLegacyEnvironment(config);
  const auth = config.token || config.password
    ? { token: config.token, password: config.password }
    : undefined;
  const youmind = supplement?.youmind ?? LEGACY_YOUMIND_METADATA[backendKind](config.id);
  return {
    id: config.id,
    backendKind,
    transportKind,
    label: config.name,
    ...(environment ? { environment } : {}),
    createdAt: config.createdAt,
    url: config.url,
    ...(auth ? { auth } : {}),
    ...(config.bootstrap ? { bootstrap: config.bootstrap } : {}),
    ...(config.relay ? { relay: config.relay } : {}),
    ...(config.hermes ? { hermes: config.hermes } : {}),
    ...(youmind ? { youmind } : {}),
    ...(supplement?.debugMode !== undefined ? { debugMode: supplement.debugMode } : {}),
  };
}

function migrateLegacyState(
  value: GatewayConfigsState,
  supplements: ReadonlyMap<string, LegacyConnectionSupplement>,
): RegistryState {
  const records = value.configs.map((config) => migrateLegacyConfig(config, supplements.get(config.id)));
  const ids = new Set(records.map((record) => record.id));
  const activeConnectionId = value.activeId && ids.has(value.activeId)
    ? value.activeId
    : (records[0]?.id ?? null);
  return {
    activeConnectionId,
    freeConnectionId: activeConnectionId,
    records,
  };
}

function cloneRecord(record: ConnectionRecord): ConnectionRecord {
  return JSON.parse(JSON.stringify(record)) as ConnectionRecord;
}

function patchRecord(record: ConnectionRecord, patch: ConnectionRecordPatch): ConnectionRecord | null {
  const next: Record<string, unknown> = { ...cloneRecord(record) };
  const requiredFields = ['backendKind', 'transportKind', 'label', 'url'] as const;
  const optionalFields = ['environment', 'auth', 'bootstrap', 'relay', 'hermes', 'youmind', 'debugMode'] as const;
  for (const field of requiredFields) {
    if (patch[field] !== undefined) next[field] = patch[field];
  }
  for (const field of optionalFields) {
    if (patch[field] === undefined) continue;
    if (patch[field] === null) delete next[field];
    else next[field] = patch[field];
  }
  return normalizeConnectionRecord(next);
}

function mergeConnectionCredential(
  next: string | undefined,
  existing: string | undefined,
): string | undefined {
  return readOptionalString(next) ?? readOptionalString(existing);
}

function mergeConnectionAuth(
  existing: ConnectionRecord['auth'],
  next: ConnectionRecord['auth'],
): ConnectionRecord['auth'] {
  const token = mergeConnectionCredential(next?.token, existing?.token);
  const password = mergeConnectionCredential(next?.password, existing?.password);
  return token || password ? { ...(token ? { token } : {}), ...(password ? { password } : {}) } : undefined;
}

function mergeConnectionRelay(
  existing: ConnectionRecord['relay'],
  next: ConnectionRecord['relay'],
): ConnectionRecord['relay'] {
  if (!next) return existing;
  const clientToken = mergeConnectionCredential(next.clientToken, existing?.clientToken);
  const displayName = readNonEmptyString(next.displayName) ?? readNonEmptyString(existing?.displayName);
  const protocolVersion = next.protocolVersion ?? existing?.protocolVersion;
  const supportsBootstrap = next.supportsBootstrap ?? existing?.supportsBootstrap;
  return {
    serverUrl: next.serverUrl,
    gatewayId: next.gatewayId,
    ...(clientToken ? { clientToken } : {}),
    ...(displayName ? { displayName } : {}),
    ...(protocolVersion !== undefined ? { protocolVersion } : {}),
    ...(supportsBootstrap !== undefined ? { supportsBootstrap } : {}),
  };
}

function mergeConnectionHermes(
  existing: ConnectionRecord['hermes'],
  next: ConnectionRecord['hermes'],
): ConnectionRecord['hermes'] {
  if (!next) return existing;
  const displayName = readNonEmptyString(next.displayName) ?? readNonEmptyString(existing?.displayName);
  return {
    bridgeUrl: next.bridgeUrl,
    ...(displayName ? { displayName } : {}),
  };
}

function normalizeConnectionIdentityUrl(value: string | undefined): string | null {
  const trimmed = value?.trim().replace(/\/+$/, '');
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    const pathname = parsed.pathname.replace(/\/+$/, '');
    return `${parsed.protocol.toLowerCase()}//${parsed.host.toLowerCase()}${pathname}${parsed.search}`;
  } catch {
    return trimmed;
  }
}

function findConnectionIdentityIndex(
  records: ReadonlyArray<ConnectionRecord>,
  input: NewConnectionRecord,
): number {
  const explicitId = readNonEmptyString(input.id);
  if (explicitId) {
    const explicitIndex = records.findIndex((record) => (
      record.id === explicitId
      && record.backendKind === input.backendKind
      && (record.transportKind === 'relay') === (input.transportKind === 'relay')
    ));
    if (explicitIndex >= 0) return explicitIndex;
  }
  if (input.transportKind === 'relay' && input.relay) {
    const serverUrl = normalizeConnectionIdentityUrl(input.relay.serverUrl);
    const gatewayId = input.relay.gatewayId.trim();
    return records.findIndex((record) => (
      record.backendKind === input.backendKind
      && record.transportKind === 'relay'
      && normalizeConnectionIdentityUrl(record.relay?.serverUrl) === serverUrl
      && record.relay?.gatewayId.trim() === gatewayId
    ));
  }
  if (input.backendKind === 'openclaw' || input.backendKind === 'hermes') {
    const endpointUrl = normalizeConnectionIdentityUrl(
      input.backendKind === 'hermes' ? input.hermes?.bridgeUrl ?? input.url : input.url,
    );
    return records.findIndex((record) => (
      record.backendKind === input.backendKind
      && record.transportKind !== 'relay'
      && normalizeConnectionIdentityUrl(
        record.backendKind === 'hermes' ? record.hermes?.bridgeUrl ?? record.url : record.url,
      ) === endpointUrl
    ));
  }
  return -1;
}

function mergeConnectionRecord(
  existing: ConnectionRecord,
  input: NewConnectionRecord,
): ConnectionRecord | null {
  return normalizeConnectionRecord({
    ...existing,
    backendKind: input.backendKind,
    transportKind: input.transportKind,
    // Re-pairing refreshes connection material, but must not erase a name the
    // person may have customized after the original pairing.
    label: existing.label,
    environment: input.environment ?? existing.environment,
    url: input.url,
    auth: mergeConnectionAuth(existing.auth, input.auth),
    bootstrap: input.bootstrap ?? existing.bootstrap,
    relay: mergeConnectionRelay(existing.relay, input.relay),
    hermes: mergeConnectionHermes(existing.hermes, input.hermes),
    youmind: input.youmind ?? existing.youmind,
    debugMode: input.debugMode ?? existing.debugMode,
    id: existing.id,
    createdAt: existing.createdAt,
  });
}

function createDescriptor(
  record: ConnectionRecord,
  freeConnectionId: string | null,
  bridgeOutdated: boolean,
): ConnectionDescriptor {
  return Object.freeze({
    id: record.id,
    backendKind: record.backendKind,
    transportKind: record.transportKind,
    label: record.label,
    ...(record.environment ? { environment: record.environment } : {}),
    createdAt: record.createdAt,
    ...(bridgeOutdated ? { bridgeOutdated: true } : {}),
    isFreeSlot: record.id === freeConnectionId,
  });
}

function serializeSnapshot(revision: number, state: RegistryState): string {
  return JSON.stringify({ version: STORAGE_VERSION, revision, state } satisfies PersistedRegistrySnapshot);
}

export function createConnectionId(now: number, randomValue: number): string {
  const safeNow = Number.isFinite(now) && now >= 0 ? Math.trunc(now) : 0;
  const boundedRandom = Number.isFinite(randomValue)
    ? Math.min(Math.max(randomValue, 0), 0.9999999999999999)
    : 0;
  const randomPart = Math.floor(boundedRandom * 0x100000000)
    .toString(36)
    .padStart(7, '0');
  return `connection_${safeNow.toString(36)}_${randomPart}`;
}

export class ConnectionStore {
  private readonly secureStorage: SecureConnectionStorage;
  private readonly legacyStorage: LegacyConnectionStorage;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly listeners = new Set<() => void>();
  private readonly bridgeOutdated = new Map<string, boolean>();
  private operation: Promise<void> = Promise.resolve();
  private state: RegistryState | null = null;
  private snapshot: ConnectionStoreSnapshot = Object.freeze({
    revision: 0,
    activeConnectionId: null,
    freeConnectionId: null,
    connections: Object.freeze([]),
  });

  constructor(options: ConnectionStoreOptions = {}) {
    this.secureStorage = options.secureStorage ?? SecureStore;
    this.legacyStorage = options.legacyStorage ?? StorageService;
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;
  }

  getSnapshot = (): ConnectionStoreSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  async load(): Promise<ConnectionStoreSnapshot> {
    return this.enqueue(async () => {
      const persisted = await this.readOrMigrate();
      this.publish(persisted.state, persisted.revision);
      return this.snapshot;
    });
  }

  async add(input: NewConnectionRecord): Promise<ConnectionDescriptor> {
    return this.mutate((state) => {
      let id = readNonEmptyString(input.id) ?? createConnectionId(this.now(), this.random());
      let suffix = 2;
      const usedIds = new Set(state.records.map((record) => record.id));
      const baseId = id;
      while (usedIds.has(id)) {
        id = `${baseId}_${suffix}`;
        suffix += 1;
      }
      const createdAt = input.createdAt ?? this.now();
      const record = normalizeConnectionRecord({ ...input, id, createdAt });
      if (!record) throw new Error('Invalid connection record.');
      const nextRecords = [...state.records, record];
      const nextState: RegistryState = {
        activeConnectionId: state.activeConnectionId ?? record.id,
        freeConnectionId: state.freeConnectionId ?? state.activeConnectionId ?? record.id,
        records: nextRecords,
      };
      return {
        state: nextState,
        result: () => createDescriptor(record, nextState.freeConnectionId, false),
      };
    });
  }

  async upsert(input: NewConnectionRecord): Promise<ConnectionUpsertResult> {
    return this.mutate<ConnectionUpsertResult>((state) => {
      const index = findConnectionIdentityIndex(state.records, input);
      if (index < 0) {
        let id = readNonEmptyString(input.id) ?? createConnectionId(this.now(), this.random());
        let suffix = 2;
        const usedIds = new Set(state.records.map((record) => record.id));
        const baseId = id;
        while (usedIds.has(id)) {
          id = `${baseId}_${suffix}`;
          suffix += 1;
        }
        const record = normalizeConnectionRecord({
          ...input,
          id,
          createdAt: input.createdAt ?? this.now(),
        });
        if (!record) throw new Error('Invalid connection record.');
        const nextState: RegistryState = {
          activeConnectionId: state.activeConnectionId ?? record.id,
          freeConnectionId: state.freeConnectionId ?? state.activeConnectionId ?? record.id,
          records: [...state.records, record],
        };
        return {
          state: nextState,
          result: () => ({
            connection: createDescriptor(record, nextState.freeConnectionId, false),
            created: true,
          }),
        };
      }

      const existing = state.records[index];
      const record = mergeConnectionRecord(existing, input);
      if (!record) throw new Error('Invalid connection record.');
      const records = [...state.records];
      records[index] = record;
      const changed = JSON.stringify(existing) !== JSON.stringify(record);
      return {
        state: changed ? { ...state, records } : state,
        changed,
        result: () => ({
          connection: createDescriptor(
            record,
            state.freeConnectionId,
            this.bridgeOutdated.get(record.id) === true,
          ),
          created: false,
        }),
      };
    });
  }

  async replace(
    connectionId: string,
    replacement: ConnectionRecordReplacement,
  ): Promise<ConnectionDescriptor> {
    return this.mutate((state) => {
      const index = state.records.findIndex((record) => record.id === connectionId);
      if (index < 0) throw new ConnectionNotFoundError(connectionId);
      const existing = state.records[index];
      const record = normalizeConnectionRecord({
        ...replacement,
        id: existing.id,
        createdAt: existing.createdAt,
      });
      if (!record) throw new Error('Invalid connection record.');
      const records = [...state.records];
      records[index] = record;
      return {
        state: { ...state, records },
        result: () => createDescriptor(
          record,
          state.freeConnectionId,
          this.bridgeOutdated.get(record.id) === true,
        ),
      };
    });
  }

  async update(
    connectionId: string,
    patch: ConnectionRecordPatch,
  ): Promise<ConnectionDescriptor> {
    return this.mutate((state) => {
      const index = state.records.findIndex((record) => record.id === connectionId);
      if (index < 0) throw new ConnectionNotFoundError(connectionId);
      const record = patchRecord(state.records[index], patch);
      if (!record) throw new Error('Invalid connection record patch.');
      const records = [...state.records];
      records[index] = record;
      return {
        state: { ...state, records },
        result: () => createDescriptor(
          record,
          state.freeConnectionId,
          this.bridgeOutdated.get(record.id) === true,
        ),
      };
    });
  }

  async remove(connectionId: string): Promise<boolean> {
    const removed = await this.mutate((state) => {
      const index = state.records.findIndex((record) => record.id === connectionId);
      if (index < 0) return { state, changed: false, result: () => false };
      const records = state.records.filter((record) => record.id !== connectionId);
      const fallbackId = records[Math.min(index, Math.max(records.length - 1, 0))]?.id ?? null;
      const activeConnectionId = state.activeConnectionId === connectionId
        ? fallbackId
        : state.activeConnectionId;
      const freeConnectionId = state.freeConnectionId === connectionId
        ? (activeConnectionId ?? fallbackId)
        : state.freeConnectionId;
      return {
        state: { activeConnectionId, freeConnectionId, records },
        result: () => true,
      };
    });
    if (removed) {
      this.bridgeOutdated.delete(connectionId);
    }
    return removed;
  }

  async setActive(connectionId: string): Promise<ActiveConnectionChange> {
    return this.mutate((state) => {
      if (!state.records.some((record) => record.id === connectionId)) {
        throw new ConnectionNotFoundError(connectionId);
      }
      const previousConnectionId = state.activeConnectionId;
      const changed = previousConnectionId !== connectionId;
      return {
        state: changed ? { ...state, activeConnectionId: connectionId } : state,
        changed,
        result: () => ({
          previousConnectionId,
          activeConnectionId: connectionId,
          changed,
          snapshot: this.snapshot,
        }),
      };
    });
  }

  async setFreeConnection(connectionId: string): Promise<ConnectionStoreSnapshot> {
    return this.mutate((state) => {
      if (!state.records.some((record) => record.id === connectionId)) {
        throw new ConnectionNotFoundError(connectionId);
      }
      const changed = state.freeConnectionId !== connectionId;
      return {
        state: changed ? { ...state, freeConnectionId: connectionId } : state,
        changed,
        result: () => this.snapshot,
      };
    });
  }

  async rollback(): Promise<ConnectionStoreSnapshot> {
    return this.enqueue(async () => {
      const currentRaw = await this.secureStorage.getItemAsync(CURRENT_STORAGE_KEY, SECURE_OPTIONS);
      const rollbackRaw = await this.secureStorage.getItemAsync(ROLLBACK_STORAGE_KEY, SECURE_OPTIONS);
      const current = parsePersistedSnapshot(currentRaw);
      const previous = parsePersistedSnapshot(rollbackRaw);
      if (!previous) {
        const resolved = current ?? await this.readOrMigrate();
        this.publish(resolved.state, resolved.revision);
        return this.snapshot;
      }
      const revision = Math.max(current?.revision ?? 0, previous.revision) + 1;
      const serializedPrevious = currentRaw && current
        ? currentRaw
        : serializeSnapshot(previous.revision, previous.state);
      await this.secureStorage.setItemAsync(ROLLBACK_STORAGE_KEY, serializedPrevious, SECURE_OPTIONS);
      await this.secureStorage.setItemAsync(
        CURRENT_STORAGE_KEY,
        serializeSnapshot(revision, previous.state),
        SECURE_OPTIONS,
      );
      this.publish(previous.state, revision);
      return this.snapshot;
    });
  }

  async createAdapter(
    connectionId: string,
    factory: ConnectionAdapterFactory,
  ): Promise<AgentAdapter> {
    return this.enqueue(async () => {
      const persisted = await this.readOrMigrate();
      const record = persisted.state.records.find((candidate) => candidate.id === connectionId);
      if (!record) throw new ConnectionNotFoundError(connectionId);
      const descriptor = createDescriptor(
        record,
        persisted.state.freeConnectionId,
        this.bridgeOutdated.get(record.id) === true,
      );
      return factory(Object.freeze(cloneRecord(record)), descriptor);
    });
  }

  /**
   * Returns credential-bearing connection material for trusted runtime
   * sidecars. Credentials deliberately remain absent from getSnapshot().
   */
  async getRuntimeRecord(connectionId: string): Promise<ConnectionRecord> {
    return this.enqueue(async () => {
      const persisted = await this.readOrMigrate();
      const record = persisted.state.records.find((candidate) => candidate.id === connectionId);
      if (!record) throw new ConnectionNotFoundError(connectionId);
      return cloneRecord(record);
    });
  }

  setBridgeOutdated(connectionId: string, outdated: boolean): void {
    if (!this.state?.records.some((record) => record.id === connectionId)) return;
    if (outdated) this.bridgeOutdated.set(connectionId, true);
    else this.bridgeOutdated.delete(connectionId);
    this.publish(this.state, this.snapshot.revision);
  }

  private async mutate<T>(
    reducer: (state: RegistryState) => {
      state: RegistryState;
      result: () => T;
      changed?: boolean;
    },
  ): Promise<T> {
    return this.enqueue(async () => {
      const persisted = await this.readOrMigrate();
      const reduced = reducer(persisted.state);
      const changed = reduced.changed ?? reduced.state !== persisted.state;
      if (changed) {
        const revision = persisted.revision + 1;
        await this.persist(persisted, reduced.state, revision);
        this.publish(reduced.state, revision);
      } else {
        this.publish(persisted.state, persisted.revision);
      }
      return reduced.result();
    });
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.operation.then(operation, operation);
    this.operation = pending.then(() => undefined, () => undefined);
    return pending;
  }

  private async readOrMigrate(): Promise<PersistedRegistrySnapshot> {
    const currentRaw = await this.secureStorage.getItemAsync(CURRENT_STORAGE_KEY, SECURE_OPTIONS);
    const current = parsePersistedSnapshot(currentRaw);
    if (current) return current;

    const rollbackRaw = await this.secureStorage.getItemAsync(ROLLBACK_STORAGE_KEY, SECURE_OPTIONS);
    const rollback = parsePersistedSnapshot(rollbackRaw);
    if (rollback) return rollback;

    const legacyRaw = await this.secureStorage.getItemAsync(LEGACY_CONFIGS_STORAGE_KEY, SECURE_OPTIONS);
    const legacy = await this.legacyStorage.readLegacyGatewayConfigsState();
    const state = migrateLegacyState(legacy, readLegacySupplements(legacyRaw));
    for (const record of state.records) {
      if (record.backendKind === 'youmind') {
        await this.legacyStorage.migrateLegacyYouMindState(
          record.url,
          record.youmind?.authScopeKey ?? record.id,
        );
      }
    }
    const migrated: PersistedRegistrySnapshot = {
      version: STORAGE_VERSION,
      revision: 1,
      state,
    };
    const serialized = JSON.stringify(migrated);
    await this.secureStorage.setItemAsync(ROLLBACK_STORAGE_KEY, serialized, SECURE_OPTIONS);
    await this.secureStorage.setItemAsync(CURRENT_STORAGE_KEY, serialized, SECURE_OPTIONS);
    return migrated;
  }

  private async persist(
    current: PersistedRegistrySnapshot,
    state: RegistryState,
    revision: number,
  ): Promise<void> {
    await this.secureStorage.setItemAsync(
      ROLLBACK_STORAGE_KEY,
      JSON.stringify(current),
      SECURE_OPTIONS,
    );
    await this.secureStorage.setItemAsync(
      CURRENT_STORAGE_KEY,
      serializeSnapshot(revision, state),
      SECURE_OPTIONS,
    );
  }

  private publish(state: RegistryState, revision: number): void {
    this.state = {
      activeConnectionId: state.activeConnectionId,
      freeConnectionId: state.freeConnectionId,
      records: state.records.map(cloneRecord),
    };
    const connections = Object.freeze(state.records.map((record) => createDescriptor(
      record,
      state.freeConnectionId,
      this.bridgeOutdated.get(record.id) === true,
    )));
    this.snapshot = Object.freeze({
      revision,
      activeConnectionId: state.activeConnectionId,
      freeConnectionId: state.freeConnectionId,
      connections,
    });
    for (const listener of this.listeners) listener();
  }
}

export const connectionStore = new ConnectionStore();
