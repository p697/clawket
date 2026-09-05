import * as SecureStore from 'expo-secure-store';
import { sha256 } from 'js-sha256';

import {
  FIRST_3_0_GRACE_PERIOD_MS,
  FREE_CONNECTION_SWITCH_INTERVAL_MS,
  type Entitlement,
} from '../utils/pro';

const STORAGE_KEY_PREFIX = 'clawket.proEntitlement.v1';
const SECURE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export type PersistedProEntitlementState = Readonly<{
  version: 1;
  freeConnectionId: string | null;
  lastFreeConnectionSwitchAt: number | null;
  graceEvaluatedAt: number;
  graceUntil: number | null;
}>;

export type ResolveProEntitlementInput = Readonly<{
  deviceId: string;
  isPro: boolean;
  connectionIds: readonly string[];
  activeConnectionId: string | null;
  hasNonMainAgentSession: boolean;
  now?: number;
}>;

export type ResolvedProEntitlement = Readonly<{
  state: PersistedProEntitlementState;
  entitlement: Entitlement;
  graceGranted: boolean;
  recoveredCorruptState: boolean;
}>;

export type FreeConnectionSwitchFailureReason =
  | 'not_initialized'
  | 'corrupt_state'
  | 'pro_active'
  | 'unknown_connection'
  | 'cooldown';

export type FreeConnectionSwitchResult =
  | Readonly<{
      ok: true;
      changed: boolean;
      state: PersistedProEntitlementState;
      nextSwitchAt: number | null;
    }>
  | Readonly<{
      ok: false;
      reason: FreeConnectionSwitchFailureReason;
      retryAt: number | null;
      state: PersistedProEntitlementState | null;
    }>;

export interface ProEntitlementSecureStorage {
  getItemAsync(
    key: string,
    options?: SecureStore.SecureStoreOptions,
  ): Promise<string | null>;
  setItemAsync(
    key: string,
    value: string,
    options?: SecureStore.SecureStoreOptions,
  ): Promise<void>;
}

type StoredReadResult =
  | Readonly<{ kind: 'missing' }>
  | Readonly<{ kind: 'corrupt' }>
  | Readonly<{ kind: 'ready'; state: PersistedProEntitlementState }>;

function normalizeRequiredString(value: string, name: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${name} must not be empty.`);
  return normalized;
}

function normalizeTimestamp(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer.`);
  }
  return value;
}

function normalizeConnectionIds(values: readonly string[]): string[] {
  const ids = new Set<string>();
  for (const value of values) {
    const normalized = value.trim();
    if (normalized) ids.add(normalized);
  }
  return [...ids];
}

function selectDefaultFreeConnectionId(
  connectionIds: readonly string[],
  activeConnectionId: string | null,
): string | null {
  const active = activeConnectionId?.trim() || null;
  if (active && connectionIds.includes(active)) return active;
  return connectionIds[0] ?? null;
}

function isNullableTimestamp(value: unknown): value is number | null {
  return value === null || (Number.isSafeInteger(value) && (value as number) >= 0);
}

function parsePersistedState(raw: string | null): StoredReadResult {
  if (raw === null) return { kind: 'missing' };
  try {
    const value = JSON.parse(raw) as Record<string, unknown> | null;
    if (!value || typeof value !== 'object' || Array.isArray(value) || value.version !== 1) {
      return { kind: 'corrupt' };
    }
    const freeConnectionId = value.freeConnectionId === null
      ? null
      : typeof value.freeConnectionId === 'string' && value.freeConnectionId.trim()
        ? value.freeConnectionId.trim()
        : undefined;
    if (freeConnectionId === undefined) return { kind: 'corrupt' };
    if (!isNullableTimestamp(value.lastFreeConnectionSwitchAt)) return { kind: 'corrupt' };
    if (!Number.isSafeInteger(value.graceEvaluatedAt) || (value.graceEvaluatedAt as number) < 0) {
      return { kind: 'corrupt' };
    }
    if (!isNullableTimestamp(value.graceUntil)) return { kind: 'corrupt' };
    if (
      value.graceUntil !== null
      && (value.graceUntil as number) < (value.graceEvaluatedAt as number)
    ) {
      return { kind: 'corrupt' };
    }
    return {
      kind: 'ready',
      state: {
        version: 1,
        freeConnectionId,
        lastFreeConnectionSwitchAt: value.lastFreeConnectionSwitchAt,
        graceEvaluatedAt: value.graceEvaluatedAt as number,
        graceUntil: value.graceUntil,
      },
    };
  } catch {
    return { kind: 'corrupt' };
  }
}

function statesEqual(
  left: PersistedProEntitlementState,
  right: PersistedProEntitlementState,
): boolean {
  return left.freeConnectionId === right.freeConnectionId
    && left.lastFreeConnectionSwitchAt === right.lastFreeConnectionSwitchAt
    && left.graceEvaluatedAt === right.graceEvaluatedAt
    && left.graceUntil === right.graceUntil;
}

export function createInitialProEntitlementState(input: Readonly<{
  isPro: boolean;
  connectionIds: readonly string[];
  activeConnectionId: string | null;
  hasNonMainAgentSession: boolean;
  now: number;
  allowGrace?: boolean;
}>): PersistedProEntitlementState {
  const now = normalizeTimestamp(input.now, 'now');
  const connectionIds = normalizeConnectionIds(input.connectionIds);
  const graceEligible = input.allowGrace !== false
    && !input.isPro
    && (connectionIds.length > 1 || input.hasNonMainAgentSession);
  return {
    version: 1,
    freeConnectionId: selectDefaultFreeConnectionId(connectionIds, input.activeConnectionId),
    lastFreeConnectionSwitchAt: null,
    graceEvaluatedAt: now,
    graceUntil: graceEligible ? now + FIRST_3_0_GRACE_PERIOD_MS : null,
  };
}

export function reconcileProEntitlementState(
  state: PersistedProEntitlementState,
  input: Readonly<{
    isPro: boolean;
    connectionIds: readonly string[];
    activeConnectionId: string | null;
  }>,
): PersistedProEntitlementState {
  const connectionIds = normalizeConnectionIds(input.connectionIds);
  const currentIsAvailable = state.freeConnectionId !== null
    && connectionIds.includes(state.freeConnectionId);
  let freeConnectionId = currentIsAvailable ? state.freeConnectionId : null;
  if (freeConnectionId === null && !input.isPro) {
    freeConnectionId = selectDefaultFreeConnectionId(connectionIds, input.activeConnectionId);
  }
  if (freeConnectionId === state.freeConnectionId) return state;
  return { ...state, freeConnectionId };
}

export function resolveFreeConnectionSwitch(
  state: PersistedProEntitlementState,
  input: Readonly<{
    isPro: boolean;
    connectionIds: readonly string[];
    targetConnectionId: string;
    now: number;
  }>,
): FreeConnectionSwitchResult {
  const now = normalizeTimestamp(input.now, 'now');
  const connectionIds = normalizeConnectionIds(input.connectionIds);
  const targetConnectionId = input.targetConnectionId.trim();
  if (input.isPro) {
    return { ok: false, reason: 'pro_active', retryAt: null, state };
  }
  if (!targetConnectionId || !connectionIds.includes(targetConnectionId)) {
    return { ok: false, reason: 'unknown_connection', retryAt: null, state };
  }
  if (state.freeConnectionId === targetConnectionId) {
    return {
      ok: true,
      changed: false,
      state,
      nextSwitchAt: state.lastFreeConnectionSwitchAt === null
        ? null
        : state.lastFreeConnectionSwitchAt + FREE_CONNECTION_SWITCH_INTERVAL_MS,
    };
  }
  const retryAt = state.lastFreeConnectionSwitchAt === null
    ? null
    : state.lastFreeConnectionSwitchAt + FREE_CONNECTION_SWITCH_INTERVAL_MS;
  if (retryAt !== null && now < retryAt) {
    return { ok: false, reason: 'cooldown', retryAt, state };
  }
  const nextState: PersistedProEntitlementState = {
    ...state,
    freeConnectionId: targetConnectionId,
    lastFreeConnectionSwitchAt: now,
  };
  return {
    ok: true,
    changed: true,
    state: nextState,
    nextSwitchAt: now + FREE_CONNECTION_SWITCH_INTERVAL_MS,
  };
}

export function createProEntitlementStorageKey(deviceId: string): string {
  return `${STORAGE_KEY_PREFIX}.${sha256(normalizeRequiredString(deviceId, 'deviceId'))}`;
}

export class ProEntitlementStore {
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly secureStorage: ProEntitlementSecureStorage = SecureStore,
  ) {}

  resolve(input: ResolveProEntitlementInput): Promise<ResolvedProEntitlement> {
    return this.enqueue(async () => {
      const now = normalizeTimestamp(input.now ?? Date.now(), 'now');
      const key = createProEntitlementStorageKey(input.deviceId);
      const read = parsePersistedState(await this.secureStorage.getItemAsync(key, SECURE_OPTIONS));
      const recoveredCorruptState = read.kind === 'corrupt';
      const graceGranted = read.kind === 'missing'
        && !input.isPro
        && (normalizeConnectionIds(input.connectionIds).length > 1 || input.hasNonMainAgentSession);
      const initial = read.kind === 'ready'
        ? read.state
        : createInitialProEntitlementState({
          ...input,
          now,
          allowGrace: read.kind === 'missing',
        });
      const state = reconcileProEntitlementState(initial, input);
      if (read.kind !== 'ready' || !statesEqual(read.state, state)) {
        await this.secureStorage.setItemAsync(key, JSON.stringify(state), SECURE_OPTIONS);
      }
      return {
        state,
        entitlement: {
          isPro: input.isPro,
          graceUntil: state.graceUntil,
          now,
          freeConnectionId: state.freeConnectionId,
        },
        graceGranted,
        recoveredCorruptState,
      };
    });
  }

  switchFreeConnection(input: Readonly<{
    deviceId: string;
    isPro: boolean;
    connectionIds: readonly string[];
    targetConnectionId: string;
    now?: number;
  }>): Promise<FreeConnectionSwitchResult> {
    return this.enqueue(async () => {
      const now = normalizeTimestamp(input.now ?? Date.now(), 'now');
      const key = createProEntitlementStorageKey(input.deviceId);
      const read = parsePersistedState(await this.secureStorage.getItemAsync(key, SECURE_OPTIONS));
      if (read.kind !== 'ready') {
        return {
          ok: false,
          reason: read.kind === 'missing' ? 'not_initialized' : 'corrupt_state',
          retryAt: null,
          state: null,
        };
      }
      const result = resolveFreeConnectionSwitch(read.state, { ...input, now });
      if (result.ok && result.changed) {
        await this.secureStorage.setItemAsync(key, JSON.stringify(result.state), SECURE_OPTIONS);
      }
      return result;
    });
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation, operation);
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }
}

export const ProEntitlementStorageService = new ProEntitlementStore();
