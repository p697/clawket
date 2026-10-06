import type { ConnectionDescriptor } from '@clawket/agent-protocol';
import type { ConnectionCoordinator } from '../index';
import type { NewConnectionRecord } from '../registry/connection-store';

export type OpenClawDirectMode = 'local' | 'tailscale' | 'custom';
export type OpenClawDirectDraft = Readonly<{
  mode: OpenClawDirectMode;
  url: string;
  authMethod: 'token' | 'password';
  credential: string;
}>;

export class DirectConnectionInputError extends Error {
  constructor(readonly field: 'url' | 'credential') {
    super(field === 'url' ? 'invalid_direct_url' : 'missing_direct_credential');
  }
}

/** Credentials belong in SecureStore, never in a URL, navigation params or diagnostics. */
export function normalizeOpenClawDirectUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed || /\s/.test(trimmed)) throw new DirectConnectionInputError('url');
  const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `ws://${trimmed}`;
  let url: URL;
  try { url = new URL(candidate); } catch { throw new DirectConnectionInputError('url'); }
  if (!['ws:', 'wss:', 'http:', 'https:'].includes(url.protocol)
    || !url.hostname || url.username || url.password || url.search || url.hash) {
    throw new DirectConnectionInputError('url');
  }
  url.protocol = url.protocol === 'https:' || url.protocol === 'wss:' ? 'wss:' : 'ws:';
  return url.toString();
}

export function buildOpenClawDirectRecord(draft: OpenClawDirectDraft): NewConnectionRecord {
  const url = normalizeOpenClawDirectUrl(draft.url);
  const credential = draft.credential.trim();
  if (!credential) throw new DirectConnectionInputError('credential');
  return {
    backendKind: 'openclaw', transportKind: draft.mode, label: 'OpenClaw', url,
    auth: draft.authMethod === 'token' ? { token: credential } : { password: credential },
  };
}

type DirectRuntime = Pick<ConnectionCoordinator,
  'getSnapshot' | 'getRuntimeConnectionRecord' | 'replaceConnection' | 'addConnection'
  | 'activate' | 'probeActive' | 'pauseConnection'>;
const attemptOwners = new WeakMap<DirectRuntime, Map<string, symbol>>();
const endpointKey = (url: string) => normalizeOpenClawDirectUrl(url).replace(/\/$/, '');

/** Credential-free result for entitlement checks; only the connection layer reads saved URLs. */
export async function findOpenClawDirectConnection(input: Readonly<{
  runtime: DirectRuntime; url: string; isCurrent: () => boolean; retryConnectionId?: string;
}>): Promise<ConnectionDescriptor | undefined> {
  const key = endpointKey(input.url);
  for (const candidate of input.runtime.getSnapshot().connections) {
    if (candidate.backendKind !== 'openclaw' || candidate.transportKind === 'relay') continue;
    const saved = await input.runtime.getRuntimeConnectionRecord(candidate.id);
    if (!input.isCurrent()) return undefined;
    let matches = false;
    try { matches = endpointKey(saved.url) === key; } catch { /* Historical malformed URLs cannot match. */ }
    if (candidate.id === input.retryConnectionId || matches) return candidate;
  }
  return undefined;
}

/** Retry replaces authentication rather than merging an obsolete token with a new password. */
export async function connectOpenClawDirect(input: Readonly<{
  runtime: DirectRuntime;
  draft: OpenClawDirectDraft;
  retryConnectionId?: string;
  isCurrent: () => boolean;
  onSaved: (connection: ConnectionDescriptor) => void;
}>): Promise<ConnectionDescriptor | null> {
  const { runtime, isCurrent } = input;
  const record = buildOpenClawDirectRecord(input.draft);
  const existing = await findOpenClawDirectConnection({ runtime, url: record.url, isCurrent, retryConnectionId: input.retryConnectionId });
  if (!isCurrent()) return null;
  const owners = attemptOwners.get(runtime) ?? new Map<string, symbol>();
  attemptOwners.set(runtime, owners);
  const owner = Symbol('direct-attempt');
  if (existing) owners.set(existing.id, owner);
  const saved = (connection: ConnectionDescriptor) => {
    if (existing && owners.get(connection.id) !== owner) return;
    if (!existing) owners.set(connection.id, owner);
    if (isCurrent()) input.onSaved(connection);
  };
  const connection = existing
    ? await runtime.replaceConnection(existing.id, { ...record, label: existing.label }, saved)
    : await runtime.addConnection(record, saved);
  const retire = async () => {
    if (owners.get(connection.id) === owner && runtime.getSnapshot().activeConnectionId === connection.id) await runtime.pauseConnection(connection.id);
  };
  if (!isCurrent() || owners.get(connection.id) !== owner) { await retire(); return null; }
  await runtime.activate(connection.id);
  if (!isCurrent()) { await retire(); return null; }
  await runtime.probeActive(12_000);
  if (!isCurrent()) { await retire(); return null; }
  return connection;
}

/** Fixed presentation categories only; raw Gateway error text never reaches the page or telemetry. */
export function classifyOpenClawDirectFailure(error: unknown): 'unauthorized' | 'pairing_required' | 'network' | 'server' {
  const fields = typeof error === 'object' && error !== null ? error as { code?: unknown; message?: unknown } : {};
  const text = [fields.code, fields.message, typeof error === 'string' ? error : undefined]
    .filter((value): value is string => typeof value === 'string').join(' ').toLowerCase();
  if (/pairing[_ ]required|device.*approv/.test(text)) return 'pairing_required';
  if (/unauthorized|auth[_ ](?:rejected|required)|invalid[_ ]token|token[_ ](?:revoked|mismatch)|password.*(?:mismatch|invalid)/.test(text)) return 'unauthorized';
  if (/timeout|timed out|network|offline|reach|connect.*(?:fail|refus)/.test(text)) return 'network';
  return 'server';
}
