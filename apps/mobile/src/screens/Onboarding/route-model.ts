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
  'local-model': 'https://github.com/p697/clawket',
});

/** Official product homepages for the "No agent yet?" entry; pairing help keeps the documentation URLs above. */
export const ONBOARDING_WEBSITE_URLS: Readonly<Record<BackendKind, string>> = Object.freeze({
  openclaw: 'https://openclaw.ai',
  hermes: 'https://hermes-agent.nousresearch.com',
  youmind: 'https://youmind.com',
  'local-model': 'https://github.com/p697/clawket',
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
  if (message.includes('rate') || message.includes('too many')) return 'rate_limited';
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
  connectionCount: number;
  activeState: ConnectionState;
  runtimeError?: unknown;
  operation: OnboardingRouteOperation;
}): OnboardingStatus {
  if (input.operation.errorCode) {
    return { kind: 'error', code: input.operation.errorCode };
  }
  if (!input.initialized && !input.operation.active) return { kind: 'loading' };

  const hasConnectionContext = input.connectionCount > 0 || input.operation.active;
  if (
    hasConnectionContext
    && (input.activeState === 'offline' || input.activeState === 'reconnecting')
  ) {
    return { kind: 'offline' };
  }
  if (input.operation.active) {
    if (input.activeState === 'error' && input.runtimeError) {
      return { kind: 'error', code: resolveOnboardingAdapterError(input.runtimeError) };
    }
    return {
      kind: 'connecting',
      phase: input.activeState === 'ready' ? 'ready' : input.operation.phase,
    };
  }
  if (input.runtimeError && hasConnectionContext) {
    return { kind: 'error', code: resolveOnboardingAdapterError(input.runtimeError) };
  }
  return { kind: 'idle' };
}
