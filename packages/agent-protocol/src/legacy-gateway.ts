import type { BackendKind, HermesGatewayConfig, RelayGatewayConfig } from './descriptors';
import type { ThinkingLevel } from './management';

/**
 * Temporary M1 facade for the pre-3.0 mobile UI. It intentionally preserves
 * old feature flags until M4 moves every caller to canonical `Capabilities`.
 */
export type GatewayBackendKind = BackendKind;
export type GatewayTransportKind = 'local' | 'tailscale' | 'cloudflare' | 'custom' | 'relay';
export type GatewayMode = GatewayTransportKind | 'hermes';

export interface LegacyGatewayLike {
  backendKind?: GatewayBackendKind;
  transportKind?: GatewayTransportKind;
  mode?: GatewayMode;
  relay?: RelayGatewayConfig;
  hermes?: HermesGatewayConfig;
}

export interface GatewayBackendCapabilities {
  consoleRoot: boolean;
  gatewayConnection: boolean;
  chatAbort: boolean;
  chatAttachments: boolean;
  consoleDiscover: boolean;
  consoleClawHub: boolean;
  modelCatalog: boolean;
  modelSelection: boolean;
  configRead: boolean;
  configWrite: boolean;
  consoleChannels: boolean;
  consoleCron: boolean;
  consoleCronCreate: boolean;
  consoleSkills: boolean;
  consoleUsage: boolean;
  consoleCost: boolean;
  consoleTools: boolean;
  consoleNodes: boolean;
  consoleFiles: boolean;
  consoleLogs: boolean;
  consoleAgentList: boolean;
  consoleAgentDetail: boolean;
  consoleAgentSessionsBoard: boolean;
  consoleHeartbeat: boolean;
  openClawConfigScreens: boolean;
}

export interface GatewayBackendDescriptor {
  kind: GatewayBackendKind;
  label: string;
  capabilities: GatewayBackendCapabilities;
}

const OPENCLAW_LEGACY_CAPABILITIES: GatewayBackendCapabilities = {
  consoleRoot: true,
  gatewayConnection: true,
  chatAbort: true,
  chatAttachments: true,
  consoleDiscover: true,
  consoleClawHub: true,
  modelCatalog: true,
  modelSelection: true,
  configRead: true,
  configWrite: true,
  consoleChannels: true,
  consoleCron: true,
  consoleCronCreate: true,
  consoleSkills: true,
  consoleUsage: true,
  consoleCost: true,
  consoleTools: true,
  consoleNodes: true,
  consoleFiles: true,
  consoleLogs: true,
  consoleAgentList: true,
  consoleAgentDetail: true,
  consoleAgentSessionsBoard: true,
  consoleHeartbeat: true,
  openClawConfigScreens: true,
};

const HERMES_LEGACY_CAPABILITIES: GatewayBackendCapabilities = {
  consoleRoot: true,
  gatewayConnection: true,
  chatAbort: false,
  chatAttachments: false,
  consoleDiscover: true,
  consoleClawHub: false,
  modelCatalog: true,
  modelSelection: true,
  configRead: false,
  configWrite: false,
  consoleChannels: false,
  consoleCron: true,
  consoleCronCreate: false,
  consoleSkills: true,
  consoleUsage: true,
  consoleCost: true,
  consoleTools: false,
  consoleNodes: false,
  consoleFiles: true,
  consoleLogs: false,
  consoleAgentList: true,
  consoleAgentDetail: false,
  consoleAgentSessionsBoard: false,
  consoleHeartbeat: false,
  openClawConfigScreens: false,
};

const YOUMIND_LEGACY_CAPABILITIES: GatewayBackendCapabilities = {
  consoleRoot: true,
  gatewayConnection: false,
  chatAbort: true,
  chatAttachments: false,
  consoleDiscover: false,
  consoleClawHub: false,
  modelCatalog: false,
  modelSelection: false,
  configRead: false,
  configWrite: false,
  consoleChannels: false,
  consoleCron: false,
  consoleCronCreate: false,
  consoleSkills: false,
  consoleUsage: false,
  consoleCost: false,
  consoleTools: false,
  consoleNodes: false,
  consoleFiles: false,
  consoleLogs: false,
  consoleAgentList: false,
  consoleAgentDetail: false,
  consoleAgentSessionsBoard: false,
  consoleHeartbeat: false,
  openClawConfigScreens: false,
};

const LEGACY_BACKENDS: Record<GatewayBackendKind, GatewayBackendDescriptor> = {
  openclaw: { kind: 'openclaw', label: 'OpenClaw', capabilities: OPENCLAW_LEGACY_CAPABILITIES },
  hermes: { kind: 'hermes', label: 'Hermes', capabilities: HERMES_LEGACY_CAPABILITIES },
  youmind: { kind: 'youmind', label: 'YouMind', capabilities: YOUMIND_LEGACY_CAPABILITIES },
  'local-model': { kind: 'local-model', label: 'Local model', capabilities: { ...YOUMIND_LEGACY_CAPABILITIES, modelCatalog: true, modelSelection: true, chatAttachments: true } },
};

const OPENCLAW_THINKING_LEVELS: ThinkingLevel[] = [
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'adaptive',
];
const HERMES_THINKING_LEVELS: ThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'];

export function isGatewayTransportKind(value: unknown): value is GatewayTransportKind {
  return value === 'local'
    || value === 'tailscale'
    || value === 'cloudflare'
    || value === 'custom'
    || value === 'relay';
}

export function isGatewayBackendKind(value: unknown): value is GatewayBackendKind {
  return value === 'openclaw' || value === 'hermes' || value === 'youmind' || value === 'local-model';
}

export function resolveGatewayBackendKind(value: LegacyGatewayLike | null | undefined): GatewayBackendKind {
  if (isGatewayBackendKind(value?.backendKind)) return value.backendKind;
  if (value?.mode === 'hermes' || value?.hermes) return 'hermes';
  return 'openclaw';
}

export function resolveGatewayTransportKind(value: LegacyGatewayLike | null | undefined): GatewayTransportKind {
  if (isGatewayTransportKind(value?.transportKind)) return value.transportKind;
  if (value?.mode && isGatewayTransportKind(value.mode)) return value.mode;
  if (value?.relay) return 'relay';
  return 'custom';
}

export function toLegacyGatewayMode(value: {
  backendKind?: GatewayBackendKind;
  transportKind?: GatewayTransportKind;
}): GatewayMode {
  if (value.backendKind === 'hermes') return 'hermes';
  return value.transportKind ?? 'custom';
}

export function getGatewayBackendDescriptor(
  value: LegacyGatewayLike | GatewayBackendKind | null | undefined,
): GatewayBackendDescriptor {
  if (typeof value === 'string') return LEGACY_BACKENDS[value];
  return LEGACY_BACKENDS[resolveGatewayBackendKind(value)];
}

export function getGatewayBackendCapabilities(
  value: LegacyGatewayLike | GatewayBackendKind | null | undefined,
): GatewayBackendCapabilities {
  return getGatewayBackendDescriptor(value).capabilities;
}

export function getGatewayThinkingLevels(
  input: LegacyGatewayLike | GatewayBackendKind | null | undefined,
): ThinkingLevel[] {
  return selectByBackend(input, {
    openclaw: [...OPENCLAW_THINKING_LEVELS],
    hermes: [...HERMES_THINKING_LEVELS],
  });
}

export function selectByBackend<T>(
  input: LegacyGatewayLike | GatewayBackendKind | null | undefined,
  options: { openclaw: T; hermes: T; youmind?: T },
): T {
  const kind = typeof input === 'string' && isGatewayBackendKind(input)
    ? input
    : resolveGatewayBackendKind(input as LegacyGatewayLike | null | undefined);
  if (kind === 'hermes') return options.hermes;
  if (kind === 'youmind') return options.youmind ?? options.openclaw;
  return options.openclaw;
}

export function resolveGlobalMainSessionKey(
  input: LegacyGatewayLike | GatewayBackendKind | null | undefined,
): string | null {
  if (resolveGatewayBackendKind(typeof input === 'string' ? { backendKind: input } : input) === 'local-model') return 'main';
  return selectByBackend(input, { openclaw: null, hermes: 'main', youmind: 'main' });
}

export function getGatewayModeLabel(input: LegacyGatewayLike): string {
  const backendKind = resolveGatewayBackendKind(input);
  const transportKind = resolveGatewayTransportKind(input);
  if (backendKind === 'hermes') return 'Hermes';
  if (backendKind === 'youmind') return 'YouMind';
  switch (transportKind) {
    case 'relay':
      return 'Remote';
    case 'local':
      return 'Local';
    case 'tailscale':
      return 'Tailscale';
    case 'cloudflare':
      return 'Cloudflare';
    default:
      return 'Custom';
  }
}

export function buildGatewayDefaultName(input: {
  backendKind?: GatewayBackendKind;
  transportKind?: GatewayTransportKind;
  url: string;
  index: number;
}): string {
  const backendKind = input.backendKind ?? 'openclaw';
  const transportKind = input.transportKind ?? 'custom';
  const host = parseHost(input.url);
  const baseLabel = backendKind === 'hermes'
    ? 'Hermes'
    : backendKind === 'youmind'
      ? 'YouMind'
      : transportKind === 'relay'
        ? 'Relay'
        : 'Custom';
  if (host) return `${baseLabel} (${host})`;
  return `${baseLabel} Gateway ${input.index}`;
}

export function toGatewayConfigIdentity(
  config: LegacyGatewayLike | null | undefined,
): { backendKind: GatewayBackendKind; transportKind: GatewayTransportKind } {
  return {
    backendKind: resolveGatewayBackendKind(config),
    transportKind: resolveGatewayTransportKind(config),
  };
}

function parseHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}
