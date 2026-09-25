import type {
  AdapterErrorCode,
  BackendKind,
  ConnectionState,
} from '@clawket/agent-protocol';
import type { RelayServiceEnvironment } from '../../types';
import type {
  OnboardingConnectionPhase,
  OnboardingStatus,
  PairableBackendKind,
} from './model';

export const ONBOARDING_DOCUMENTATION_URLS: Readonly<Record<PairableBackendKind, string>> = Object.freeze({
  openclaw: 'https://docs.openclaw.ai/install',
  hermes: 'https://hermes-agent.nousresearch.com/docs/getting-started/quickstart',
  pi: 'https://github.com/p697/clawket/blob/main/docs/3.1/pi.md',
  'local-model': 'https://github.com/p697/clawket/blob/main/docs/3.0/15-local-model.md',
});

/**
 * Backends with a product to install; a local model is a server the user already
 * runs, so it has no "No agent yet?" destination.
 */
export type OnboardingWebsiteBackendKind = Exclude<BackendKind, 'local-model'>;

/** Official product homepages for the "No agent yet?" entry; pairing help keeps the documentation URLs above. */
export const ONBOARDING_WEBSITE_URLS: Readonly<Record<OnboardingWebsiteBackendKind, string>> = Object.freeze({
  openclaw: 'https://openclaw.ai',
  hermes: 'https://hermes-agent.nousresearch.com',
  youmind: 'https://youmind.com',
  pi: 'https://pi.dev',
});

const ADAPTER_ERROR_CODES = new Set<AdapterErrorCode>([
  'unauthorized',
  'pairing_required',
  'pairing_expired',
  'bridge_offline',
  'gateway_offline',
  'network',
  'timeout',
  'rate_limited',
  'frame_too_large',
  'unsupported',
  'server',
]);

export type OnboardingRouteOperation = Readonly<{
  active: boolean;
  phase: OnboardingConnectionPhase;
  /** Connection created by this pairing, once it exists; null before then. */
  targetConnectionId?: string | null;
  errorCode?: AdapterErrorCode;
}>;

export function normalizePairableBackendKind(
  backendKind: BackendKind | null | undefined,
): PairableBackendKind {
  const normalized: Readonly<Record<BackendKind, PairableBackendKind>> = {
    openclaw: 'openclaw',
    hermes: 'hermes',
    youmind: 'openclaw',
    'local-model': 'local-model',
    pi: 'pi',
  };
  return normalized[backendKind ?? 'openclaw'];
}

export function getOnboardingPairingCommand(
  environment: RelayServiceEnvironment,
): string {
  return environment === 'preview'
    ? 'npx @p697/clawket pair --preview'
    : 'npx @p697/clawket pair';
}

export function resolveOnboardingAdapterError(error: unknown): AdapterErrorCode {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' && ADAPTER_ERROR_CODES.has(code as AdapterErrorCode)) {
      return code as AdapterErrorCode;
    }
  }

  const message = error instanceof Error
    ? error.message.toLowerCase()
    : String(error ?? '').toLowerCase();
  if (/\brate[\s_-]*limit|\btoo many\b|\b429\b/u.test(message)) return 'rate_limited';
  if (message.includes('timeout') || message.includes('timed out')) return 'timeout';
  if (message.includes('expired') || message.includes('already been used') || message.includes('invalid')) {
    return 'pairing_expired';
  }
  if (message.includes('unauthorized') || message.includes('sign-in')) return 'unauthorized';
  if (message.includes('bridge')) return 'bridge_offline';
  if (message.includes('network') || message.includes('fetch') || message.includes('reach')) return 'network';
  if (message.includes('too large') || message.includes('frame_too_large')) return 'frame_too_large';
  if (message.includes('unsupported') || message.includes('not supported')) return 'unsupported';
  return 'server';
}

export function resolveOnboardingRouteStatus(input: {
  initialized: boolean;
  activeConnectionId?: string | null;
  activeState: ConnectionState;
  runtimeError?: unknown;
  operation: OnboardingRouteOperation;
}): OnboardingStatus {
  if (input.operation.errorCode) {
    return { kind: 'error', code: input.operation.errorCode };
  }
  if (!input.initialized && !input.operation.active) return { kind: 'loading' };
  if (!input.operation.active) return { kind: 'idle' };

  // Runtime state only describes the connection this pairing created. Before
  // it exists, or when a modal "add connection" is opened while an unrelated
  // existing connection is offline, the pairing form must stay clean.
  const pairedConnectionActive = Boolean(input.operation.targetConnectionId)
    && input.activeConnectionId === input.operation.targetConnectionId;
  if (!pairedConnectionActive) {
    return { kind: 'connecting', phase: input.operation.phase };
  }
  if (input.activeState === 'offline' || input.activeState === 'reconnecting') {
    return { kind: 'offline' };
  }
  if (input.activeState === 'error' && input.runtimeError) {
    return { kind: 'error', code: resolveOnboardingAdapterError(input.runtimeError) };
  }
  return {
    kind: 'connecting',
    phase: input.activeState === 'ready' ? 'ready' : input.operation.phase,
  };
}
