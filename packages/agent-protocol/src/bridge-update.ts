/**
 * Phone-started update of every managed Bridge on one computer (owner decision 2026-10-06).
 * The phone may only start the official unified updater and read its progress: it never chooses a
 * version, package, path or command, and the private local owner control stays local.
 */
export const BRIDGE_REMOTE_UPDATE_CAPABILITY = 'bridge.remote-update.v1';
export const BRIDGE_UPDATE_START_METHOD = 'bridge.update.start';
export const BRIDGE_UPDATE_STATUS_METHOD = 'bridge.update.status';

export type BridgeUpdateState = 'checking' | 'installing' | 'restarting' | 'updated' | 'failed';
/** Fixed failure categories; never native errors, paths or command output. */
export type BridgeUpdateFailure = 'download' | 'unsupported' | 'running' | 'interrupted' | 'not_confirmed' | 'error';
export type BridgeUpdateBackend = 'openclaw' | 'hermes' | 'hermes-relay' | 'codex' | 'claude-code' | 'pi' | 'local-model';
export type BridgeUpdateOutcome = Readonly<{
  backend: BridgeUpdateBackend;
  state: 'updated' | 'stopped' | 'restored' | 'failed' | 'manual';
  reason?: string;
  version?: string;
}>;
export type BridgeUpdateStatus = Readonly<{
  id: string;
  state: BridgeUpdateState;
  startedAt: number;
  finishedAt?: number;
  /** Target release once the official npm metadata has been read. */
  version?: string;
  reason?: BridgeUpdateFailure;
  results?: readonly BridgeUpdateOutcome[];
}>;
export type BridgeUpdateStart = Readonly<
  | { accepted: true; status: BridgeUpdateStatus }
  | { accepted: false; reason: 'running' | 'disabled'; status?: BridgeUpdateStatus }
>;

/** Adapter member exposed only while the connected Bridge negotiated the capability. */
export interface BridgeUpdateOperations {
  start(): Promise<BridgeUpdateStart>;
  status(): Promise<BridgeUpdateStatus | null>;
}

const STATES: readonly BridgeUpdateState[] = ['checking', 'installing', 'restarting', 'updated', 'failed'];
const FAILURES: readonly BridgeUpdateFailure[] = ['download', 'unsupported', 'running', 'interrupted', 'not_confirmed', 'error'];
const BACKENDS: readonly BridgeUpdateBackend[] = ['openclaw', 'hermes', 'hermes-relay', 'codex', 'claude-code', 'pi', 'local-model'];
const OUTCOMES: readonly BridgeUpdateOutcome['state'][] = ['updated', 'stopped', 'restored', 'failed', 'manual'];
const OUTCOME_REASONS = new Set(['stop_unverified', 'update_not_applied', 'restore_unverified', 'replacement_stop_unverified',
  'registration_update_unverified', 'registration_restore_unverified']);
const ID = /^[a-f0-9-]{36}$/;
const VERSION = /^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/;
const time = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const includes = <T extends string>(values: readonly T[], value: unknown): value is T => typeof value === 'string' && (values as readonly string[]).includes(value);

function parseOutcome(value: unknown): BridgeUpdateOutcome | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if (!includes(BACKENDS, row.backend) || !includes(OUTCOMES, row.state)) return null;
  return {
    backend: row.backend, state: row.state,
    ...(typeof row.reason === 'string' && OUTCOME_REASONS.has(row.reason) ? { reason: row.reason } : {}),
    ...(typeof row.version === 'string' && VERSION.test(row.version) ? { version: row.version } : {}),
  };
}

/** Strict, bounded projection; anything unexpected is dropped rather than shown. */
export function parseBridgeUpdateStatus(value: unknown): BridgeUpdateStatus | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const status = value as Record<string, unknown>;
  if (typeof status.id !== 'string' || !ID.test(status.id) || !includes(STATES, status.state) || !time(status.startedAt)) return null;
  const results = Array.isArray(status.results) && status.results.length <= 16
    ? status.results.map(parseOutcome).filter((row): row is BridgeUpdateOutcome => row !== null) : undefined;
  return {
    id: status.id, state: status.state, startedAt: status.startedAt,
    ...(time(status.finishedAt) ? { finishedAt: status.finishedAt } : {}),
    ...(typeof status.version === 'string' && VERSION.test(status.version) ? { version: status.version } : {}),
    ...(includes(FAILURES, status.reason) ? { reason: status.reason } : {}),
    ...(results ? { results } : {}),
  };
}

export function parseBridgeUpdateStart(value: unknown): BridgeUpdateStart | null {
  if (!value || typeof value !== 'object') return null;
  const result = value as Record<string, unknown>;
  const status = result.status === undefined ? undefined : parseBridgeUpdateStatus(result.status);
  if (result.accepted === true) return status ? { accepted: true, status } : null;
  if (result.accepted === false && (result.reason === 'running' || result.reason === 'disabled')) {
    return { accepted: false, reason: result.reason, ...(status ? { status } : {}) };
  }
  return null;
}

export function isBridgeUpdateFinished(status: BridgeUpdateStatus): boolean {
  return status.state === 'updated' || status.state === 'failed';
}
