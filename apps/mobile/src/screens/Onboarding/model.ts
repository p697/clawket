import type { AdapterErrorCode, BackendKind, TransportKind } from '@clawket/agent-protocol';

export const PAIRING_COMMAND = 'npx @p697/clawket pair';

/**
 * Message the user pastes to the agent already running on their computer so it
 * runs the pairing command for them and replies with the printed pairing code.
 */
export function buildAgentPairingPrompt(
  t: (key: string, options: { ns: 'config'; pairCommand: string }) => string,
  pairCommand: string = PAIRING_COMMAND,
): string {
  return t('Please run {{pairCommand}} on my computer to set up the open-source Clawket CLI and pair it with my phone. I authorize you to reply in this conversation with the temporary pairing code it prints (the line starting with "Pairing code:"). Send only the code and backend name, without other credentials.', { ns: 'config', pairCommand });
}
export const VERIFICATION_CODE_LENGTH = 6;

const LEGACY_PAIRING_CODE = /^[ABCDEFGHJKMNPQRSTVWXYZ2-9]{12}$/;

export type PairableBackendKind = Extract<BackendKind, 'openclaw' | 'hermes' | 'local-model' | 'pi' | 'codex' | 'claude-code'>;

/** Model servers the local-model Bridge can discover; mirrors the CLI `--engine` values. */
export type LocalModelEngine = 'llamacpp' | 'ollama' | 'openai-compatible';

export const LOCAL_MODEL_ENGINES: ReadonlyArray<LocalModelEngine> = ['llamacpp', 'ollama', 'openai-compatible'];

/**
 * The CLI defaults to llama.cpp on port 8080, so other servers need their
 * engine and address spelled out; Ollama listens on 11434, LM Studio on 1234.
 * No `--preview`: the CLI always pairs local models through their dedicated
 * Registry, whichever Relay environment the app has selected.
 */
export function buildLocalModelPairingCommand(engine: LocalModelEngine): string {
  const base = `${PAIRING_COMMAND} --backend local-model`;
  switch (engine) {
    case 'ollama':
      return `${base} --engine ollama --base-url http://127.0.0.1:11434`;
    case 'openai-compatible':
      return `${base} --engine openai-compatible --base-url http://127.0.0.1:1234`;
    default:
      return base;
  }
}

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
  codex: 'Codex is not responding',
  'claude-code': 'Claude Code is not responding',
  pi: 'Pi is not responding',
  'local-model': 'Local model is not responding',
};

export function normalizeVerificationCode(
  value: string,
  _backendKind: PairableBackendKind = 'openclaw',
): string {
  // Strip presentation separators only. Never turn malformed pasted content
  // into a different valid invitation by dropping characters or truncating it.
  return value.toUpperCase().replace(/[\s-]/g, '');
}

export function formatVerificationCode(
  value: string,
  backendKind: PairableBackendKind = 'openclaw',
): string {
  const normalized = normalizeVerificationCode(value, backendKind);
  if (backendKind === 'openclaw' && LEGACY_PAIRING_CODE.test(normalized)) {
    return normalized.match(/.{4}/g)!.join(' ');
  }
  if (normalized.length <= 3) return normalized;
  return `${normalized.slice(0, 3)} ${normalized.slice(3)}`;
}

export function isVerificationCodeComplete(
  value: string,
  backendKind: PairableBackendKind = 'openclaw',
): boolean {
  const code = normalizeVerificationCode(value, backendKind);
  if (backendKind === 'local-model' || backendKind === 'pi' || backendKind === 'codex' || backendKind === 'claude-code') return /^\d{6}$/.test(code);
  return backendKind === 'openclaw'
    ? /^\d{6}$/.test(code) || LEGACY_PAIRING_CODE.test(code)
    : /^[A-HJ-KM-NP-TV-Z2-9]{6}$/.test(code);
}

export function createPairingSubmission(
  backendKind: PairableBackendKind,
  value: string,
): PairingSubmission | null {
  const code = normalizeVerificationCode(value, backendKind);
  if (!isVerificationCodeComplete(code, backendKind)) return null;
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
