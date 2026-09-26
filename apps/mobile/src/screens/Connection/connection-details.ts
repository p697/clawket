import type { ConnectionDescriptor } from '@clawket/agent-protocol';
import type { ConnectionRuntimeDetails } from '../../connection/runtime-details';
import { getConnectionValueKeys } from '../AccountSettings/model';
import type { AccountSettingsNamespace, AccountSettingsTranslator } from '../AccountSettings/translation';

/**
 * How a connection stands for the person reading it. Only the active
 * connection owns a live adapter, so every other connection is "not
 * connected" rather than offline (owner decision 2026-09-26); "offline" is
 * kept for the active connection when it cannot be reached.
 */
export type ConnectionPresence = 'paused' | 'online' | 'connecting' | 'offline' | 'not_connected';

const CONNECTING_STATES: ReadonlySet<string> = new Set(['connecting', 'handshaking', 'reconnecting']);

export function resolveConnectionPresence(input: Readonly<{
  active: boolean;
  paused: boolean;
  /** The runtime's active adapter state; ignored for an inactive connection. */
  state: string;
}>): ConnectionPresence {
  if (input.paused) return 'paused';
  if (!input.active) return 'not_connected';
  if (input.state === 'ready') return 'online';
  return CONNECTING_STATES.has(input.state) ? 'connecting' : 'offline';
}

export function translateConnectionPresence(
  t: AccountSettingsTranslator,
  presence: ConnectionPresence,
): string {
  switch (presence) {
    case 'paused': return t('Connection paused', { ns: 'config' });
    case 'online': return t('Online', { ns: 'common' });
    case 'connecting': return t('Connecting', { ns: 'common' });
    case 'offline': return t('Offline', { ns: 'common' });
    case 'not_connected': return t('Not connected', { ns: 'common' });
  }
}

export type ConnectionDetailRow = Readonly<{
  id: 'backend' | 'transport' | 'environment' | 'server' | 'bridge-version' | 'bridge-capabilities' | 'last-ready';
  titleKey: string;
  titleNamespace: AccountSettingsNamespace;
  /** Translated through the account-settings key table. */
  valueKey?: string;
  /** Shown verbatim (hosts, versions, formatted dates). */
  value?: string;
}>;

export type BuildConnectionDetailRowsInput = Readonly<{
  connection: ConnectionDescriptor;
  serverHost?: string;
  details?: ConnectionRuntimeDetails;
  locale?: string;
}>;

/**
 * Read-only facts about one connection, in the order a person checks them when
 * something is wrong: what it is, how it connects, where, and what the Bridge
 * last said. Rows without a value are omitted rather than shown as blanks.
 */
export function buildConnectionDetailRows(
  input: BuildConnectionDetailRowsInput,
): ReadonlyArray<ConnectionDetailRow> {
  const [backend, transport, environment] = getConnectionValueKeys(input.connection);
  const rows: ConnectionDetailRow[] = [
    { id: 'backend', titleKey: 'Backend', titleNamespace: 'config', valueKey: backend },
    { id: 'transport', titleKey: 'Transport', titleNamespace: 'config', valueKey: transport },
    { id: 'environment', titleKey: 'Environment', titleNamespace: 'settings', valueKey: environment },
  ];
  const host = input.serverHost?.trim();
  if (host) rows.push({ id: 'server', titleKey: 'Server address', titleNamespace: 'settings', value: host });
  const bridgeVersion = input.details?.bridgeVersion?.trim();
  if (bridgeVersion) {
    rows.push({ id: 'bridge-version', titleKey: 'Bridge version', titleNamespace: 'settings', value: bridgeVersion });
  }
  const capabilities = input.details?.bridgeCapabilities ?? [];
  if (capabilities.length > 0) {
    rows.push({
      id: 'bridge-capabilities',
      titleKey: 'Bridge capabilities',
      titleNamespace: 'settings',
      value: capabilities.join(', '),
    });
  }
  rows.push({
    id: 'last-ready',
    titleKey: 'Last ready',
    titleNamespace: 'settings',
    value: formatConnectionLastReady(input.details?.lastReadyAt, input.locale),
  });
  return rows;
}

export function formatConnectionLastReady(
  timestampMs: number | null | undefined,
  locale?: string,
): string {
  if (!timestampMs || !Number.isFinite(timestampMs) || timestampMs < 0) return '—';
  try {
    return new Intl.DateTimeFormat(locale || undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(timestampMs));
  } catch {
    return new Date(timestampMs).toISOString();
  }
}

export function parseConnectionServerHost(url: string): string | undefined {
  try {
    return new URL(url).host || undefined;
  } catch {
    return undefined;
  }
}
