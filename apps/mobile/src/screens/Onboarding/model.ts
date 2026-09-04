import type { AdapterErrorCode, BackendKind, TransportKind } from '@clawket/agent-protocol';

export const PAIRING_COMMAND = 'npx @p697/clawket pair';
export const VERIFICATION_CODE_LENGTH = 6;

export type PairableBackendKind = Extract<BackendKind, 'openclaw' | 'hermes'>;

export type PairingSubmission = Readonly<{
  backendKind: PairableBackendKind;
  transportKind: Extract<TransportKind, 'relay'>;
  code: string;
}>;

export type OnboardingConnectionPhase = 'relay_connected' | 'waiting_bridge' | 'ready';

export type OnboardingStatus =
  | Readonly<{ kind: 'idle' }>
  | Readonly<{ kind: 'loading' }>
  | Readonly<{ kind: 'offline' }>
  | Readonly<{ kind: 'connecting'; phase: OnboardingConnectionPhase }>
  | Readonly<{ kind: 'error'; code: AdapterErrorCode }>;

export type OnboardingErrorPresentation = Readonly<{
  messageKey: string;
  actionKey?: string;
}>;

const BACKEND_OFFLINE_MESSAGE: Record<PairableBackendKind, string> = {
  openclaw: 'OpenClaw is not responding',
  hermes: 'Hermes is not responding',
};

export function normalizeVerificationCode(value: string): string {
  return value.replace(/\D/g, '').slice(0, VERIFICATION_CODE_LENGTH);
}

export function formatVerificationCode(value: string): string {
  const normalized = normalizeVerificationCode(value);
  if (normalized.length <= 3) return normalized;
  return `${normalized.slice(0, 3)} ${normalized.slice(3)}`;
}

export function isVerificationCodeComplete(value: string): boolean {
  return normalizeVerificationCode(value).length === VERIFICATION_CODE_LENGTH;
}

export function createPairingSubmission(
  backendKind: PairableBackendKind,
  value: string,
): PairingSubmission | null {
  const code = normalizeVerificationCode(value);
  if (!isVerificationCodeComplete(code)) return null;
  return {
    backendKind,
    transportKind: 'relay',
    code,
  };
}

export function normalizeEmail(value: string): string {
  return value.trim();
}

export function isPlausibleEmail(value: string): boolean {
  const normalized = normalizeEmail(value);
  const at = normalized.indexOf('@');
  return at > 0 && at === normalized.lastIndexOf('@') && normalized.indexOf('.', at + 2) > at + 1;
}

export function resolveOnboardingError(
  code: AdapterErrorCode,
  backendKind: PairableBackendKind,
): OnboardingErrorPresentation {
  switch (code) {
    case 'bridge_offline':
      return {
        messageKey: 'Bridge is not running on your computer',
        actionKey: 'See how to start it',
      };
    case 'gateway_offline':
      return {
        messageKey: BACKEND_OFFLINE_MESSAGE[backendKind],
        actionKey: 'Retry',
      };
    case 'pairing_required':
    case 'pairing_expired':
      return {
        messageKey: 'Pairing expired, pair again',
        actionKey: 'Pair again',
      };
    case 'unauthorized':
      return {
        messageKey: 'Sign-in expired',
        actionKey: 'Sign in again',
      };
    case 'network':
      return {
        messageKey: 'No network',
        actionKey: 'Retry',
      };
    case 'timeout':
      return {
        messageKey: 'Connection timed out',
        actionKey: 'Retry',
      };
    case 'rate_limited':
      return { messageKey: 'Too many requests, try again later' };
    case 'frame_too_large':
      return { messageKey: 'Message too large to send' };
    case 'unsupported':
      return { messageKey: 'Not supported by this backend' };
    case 'server':
      return {
        messageKey: 'Server error',
        actionKey: 'Retry',
      };
  }
}
