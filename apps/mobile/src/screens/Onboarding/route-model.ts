import type {
  AdapterErrorCode,
  BackendKind,
  ConnectionState,
} from '@clawket/agent-protocol';
import type { GatewayScanPayload } from '../../connection/pairing/gateway-scan-flow';
import type { RelayServiceEnvironment } from '../../types';
import type {
  OnboardingConnectionPhase,
  OnboardingStatus,
  PairableBackendKind,
} from './model';

export const ONBOARDING_DOCUMENTATION_URLS: Readonly<Record<PairableBackendKind, string>> = Object.freeze({
  openclaw: 'https://docs.openclaw.ai/install',
  hermes: 'https://hermes-agent.nousresearch.com/docs/getting-started/quickstart',
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

export type OnboardingQrAssessment =
  | Readonly<{ kind: 'accepted'; backendKind: PairableBackendKind }>
  | Readonly<{
      kind: 'rejected';
      reason: 'invalid_backend' | 'backend_mismatch';
      backendKind: PairableBackendKind | null;
    }>;

export type OnboardingRouteOperation = Readonly<{
  active: boolean;
  phase: OnboardingConnectionPhase;
  errorCode?: AdapterErrorCode;
}>;

export function normalizePairableBackendKind(
  backendKind: BackendKind | null | undefined,
): PairableBackendKind {
  return backendKind === 'hermes' ? 'hermes' : 'openclaw';
}

export function getOnboardingPairingCommand(
  environment: RelayServiceEnvironment,
): string {
  return environment === 'preview'
    ? 'npx @p697/clawket pair --preview'
    : 'npx @p697/clawket pair';
}

/**
 * Resolves every backend hint instead of trusting the legacy mode fallback.
 * Conflicting hints are rejected so a QR selected under one backend cannot be
 * silently saved as the other backend.
 */
export function resolveOnboardingQrBackend(
  payload: GatewayScanPayload,
): PairableBackendKind | null {
  const hints = new Set<PairableBackendKind>();

  if (payload.backendKind !== undefined) {
    if (payload.backendKind !== 'openclaw' && payload.backendKind !== 'hermes') {
      return null;
    }
    hints.add(payload.backendKind);
  }

  if (payload.mode === 'hermes') {
    hints.add('hermes');
  } else if (payload.mode !== undefined) {
    hints.add('openclaw');
  }

  if (payload.hermes) hints.add('hermes');

  if (hints.size === 0) {
    const hasLegacyOpenClawShape = Boolean(
      payload.relay
      || payload.token
      || payload.password
      || payload.bootstrap,
    );
    if (hasLegacyOpenClawShape) hints.add('openclaw');
  }

  return hints.size === 1 ? [...hints][0] : null;
}

export function assessOnboardingQr(
  payload: GatewayScanPayload,
  expectedBackendKind: PairableBackendKind,
): OnboardingQrAssessment {
  const backendKind = resolveOnboardingQrBackend(payload);
  if (!backendKind) {
    return { kind: 'rejected', reason: 'invalid_backend', backendKind: null };
  }
  if (backendKind !== expectedBackendKind) {
    return { kind: 'rejected', reason: 'backend_mismatch', backendKind };
  }
  return { kind: 'accepted', backendKind };
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
