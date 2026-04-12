import type {
  GatewayBackendKind,
  GatewayConfig,
  GatewayMode,
  GatewayTransportKind,
  SavedGatewayConfig,
} from '../types';
import { THINKING_LEVELS } from '../utils/gateway-settings';
import type { ThinkingLevel } from '../utils/gateway-settings';

type GatewayLike = Pick<GatewayConfig, 'backendKind' | 'transportKind' | 'mode' | 'relay' | 'hermes'>;

export type GatewayBackendCapabilities = {
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
  // Whether the backend supports creating new cron jobs from Clawket.
  // Hermes phase-1 can view/edit existing jobs but cannot create them.
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
};

export type GatewayBackendDescriptor = {
  kind: GatewayBackendKind;
  label: string;
  capabilities: GatewayBackendCapabilities;
};

const OPENCLAW_CAPABILITIES: GatewayBackendCapabilities = {
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

const HERMES_CAPABILITIES: GatewayBackendCapabilities = {
  chatAbort: false,
  chatAttachments: false,
  consoleDiscover: false,
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

const BACKENDS: Record<GatewayBackendKind, GatewayBackendDescriptor> = {
  openclaw: {
    kind: 'openclaw',
    label: 'OpenClaw',
    capabilities: OPENCLAW_CAPABILITIES,
  },
  hermes: {
    kind: 'hermes',
    label: 'Hermes',
    capabilities: HERMES_CAPABILITIES,
  },
};

const HERMES_THINKING_LEVELS: ThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'];

export function isGatewayTransportKind(value: unknown): value is GatewayTransportKind {
  return value === 'local'
    || value === 'tailscale'
    || value === 'cloudflare'
    || value === 'custom'
    || value === 'relay';
}

export function isGatewayBackendKind(value: unknown): value is GatewayBackendKind {
  return value === 'openclaw' || value === 'hermes';
}

export function resolveGatewayBackendKind(value: GatewayLike | null | undefined): GatewayBackendKind {
  if (isGatewayBackendKind(value?.backendKind)) return value.backendKind;
  if (value?.mode === 'hermes' || value?.hermes) return 'hermes';
  return 'openclaw';
}

export function resolveGatewayTransportKind(value: GatewayLike | null | undefined): GatewayTransportKind {
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

export function getGatewayBackendDescriptor(value: GatewayLike | GatewayBackendKind | null | undefined): GatewayBackendDescriptor {
  if (typeof value === 'string') return BACKENDS[value];
  return BACKENDS[resolveGatewayBackendKind(value)];
}

export function getGatewayBackendCapabilities(value: GatewayLike | GatewayBackendKind | null | undefined): GatewayBackendCapabilities {
  return getGatewayBackendDescriptor(value).capabilities;
}

export function getGatewayThinkingLevels(
  input: GatewayLike | GatewayBackendKind | null | undefined,
): ThinkingLevel[] {
  return selectByBackend<ThinkingLevel[]>(input, {
    openclaw: [...THINKING_LEVELS],
    hermes: [...HERMES_THINKING_LEVELS],
  });
}

/**
 * Declarative backend dispatch helper.
 *
 * Use this instead of inline `backend === 'hermes' ? ... : ...` ternaries in
 * screen/route components. Keeping the dispatch centralized in one helper
 * makes per-backend behavior explicit, keeps screen files free of scattered
 * `if (backend === 'hermes')` checks (see Backend Architecture Rule #3 in
 * apps/mobile/CLAUDE.md), and guarantees every call site lists both branches.
 *
 * For OpenClaw callers the behavior is identical to the previous ternary:
 * when the resolved backend is not `'hermes'` the helper returns the
 * `openclaw` branch, preserving existing render paths.
 */
export function selectByBackend<T>(
  input: GatewayLike | GatewayBackendKind | null | undefined,
  options: { openclaw: T; hermes: T },
): T {
  const kind = typeof input === 'string' && isGatewayBackendKind(input)
    ? input
    : resolveGatewayBackendKind(input as GatewayLike | null | undefined);
  return kind === 'hermes' ? options.hermes : options.openclaw;
}

/**
 * Returns the well-known global "main" session key for backends that
 * operate as a single logical session (Hermes phase 1 has one global
 * session), or `null` for backends that support multiple agents with
 * per-agent main sessions (OpenClaw).
 *
 * Centralizing this prevents callers from spreading
 * `backendKind === 'hermes' ? 'main' : null` across bootstrap, preview,
 * and session resolution code. For OpenClaw, the return value is
 * always `null`, preserving existing per-agent session behavior.
 */
export function resolveGlobalMainSessionKey(
  input: GatewayLike | GatewayBackendKind | null | undefined,
): string | null {
  return selectByBackend<string | null>(input, {
    openclaw: null,
    hermes: 'main',
  });
}

export function getGatewayModeLabel(input: GatewayLike): string {
  const backendKind = resolveGatewayBackendKind(input);
  const transportKind = resolveGatewayTransportKind(input);
  if (backendKind === 'hermes') return 'Hermes';
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
    : transportKind === 'relay'
      ? 'Relay'
      : 'Custom';
  if (host) return `${baseLabel} (${host})`;
  return `${baseLabel} Gateway ${input.index}`;
}

export function toGatewayConfigIdentity(config: GatewayConfig | SavedGatewayConfig | null | undefined): {
  backendKind: GatewayBackendKind;
  transportKind: GatewayTransportKind;
} {
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
