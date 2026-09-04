import type {
  AdapterErrorCode,
  Capabilities,
  ConnectionState as AdapterConnectionState,
} from '@clawket/agent-protocol';
import type { ConnectionState as LegacyConnectionState } from '../../types';

export type ThreadContentState =
  | Readonly<{ kind: 'loading' }>
  | Readonly<{ kind: 'empty' }>
  | Readonly<{ kind: 'ready' }>
  | Readonly<{ kind: 'offline' }>
  | Readonly<{ kind: 'locked' }>
  | Readonly<{
    kind: 'error';
    code: AdapterErrorCode;
    message: string;
    actionLabel?: string;
  }>;

export type ThreadErrorInput = Readonly<{
  code: AdapterErrorCode;
  message: string;
  actionLabel?: string;
}>;

export type ThreadConnectionState = AdapterConnectionState | LegacyConnectionState;

export type DeriveThreadContentStateInput = Readonly<{
  locked?: boolean;
  switching?: boolean;
  targetSessionReady?: boolean;
  historyLoaded: boolean;
  hasMessages: boolean;
  connectionState: ThreadConnectionState;
  error?: ThreadErrorInput | null;
}>;

export function deriveThreadContentState({
  locked = false,
  switching = false,
  targetSessionReady = true,
  historyLoaded,
  hasMessages,
  connectionState,
  error,
}: DeriveThreadContentStateInput): ThreadContentState {
  if (locked) return { kind: 'locked' };
  if (error) return { kind: 'error', ...error };

  const offline = connectionState === 'offline'
    || connectionState === 'error'
    || connectionState === 'closed'
    || connectionState === 'reconnecting';
  if (offline) return { kind: 'offline' };

  if (
    switching
    || !targetSessionReady
    || !historyLoaded
    || connectionState !== 'ready'
  ) {
    return { kind: 'loading' };
  }
  return hasMessages ? { kind: 'ready' } : { kind: 'empty' };
}

export function resolveContextRemainingPercent(
  contextUsed?: number,
  contextWindow?: number,
): number | null {
  if (
    typeof contextUsed !== 'number'
    || !Number.isFinite(contextUsed)
    || typeof contextWindow !== 'number'
    || !Number.isFinite(contextWindow)
    || contextWindow <= 0
  ) {
    return null;
  }
  const remaining = 1 - (Math.max(0, contextUsed) / contextWindow);
  return Math.round(Math.min(1, Math.max(0, remaining)) * 100);
}

export function resolveThreadHeaderName(
  agentName: string,
  sessionTitle: string | null | undefined,
  isMainSession: boolean,
): string {
  const normalizedTitle = sessionTitle?.trim();
  if (!normalizedTitle || isMainSession || normalizedTitle === agentName.trim()) {
    return agentName;
  }
  return `${agentName} · ${normalizedTitle}`;
}

export type ThreadHeaderSubtitleInput = Readonly<{
  capabilities: Capabilities;
  state: ThreadContentState;
  isRunning: boolean;
  activityLabel?: string | null;
  model?: string | null;
  contextUsed?: number;
  contextWindow?: number;
  offlineLabel: string;
  thinkingLabel: string;
  formatModelContext: (model: string, remainingPercent: number) => string;
}>;

export function resolveThreadHeaderSubtitle({
  capabilities,
  state,
  isRunning,
  activityLabel,
  model,
  contextUsed,
  contextWindow,
  offlineLabel,
  thinkingLabel,
  formatModelContext,
}: ThreadHeaderSubtitleInput): string {
  if (state.kind === 'offline') return offlineLabel;
  if (isRunning) return activityLabel?.trim() || thinkingLabel;
  if (!capabilities.models) return '';

  const normalizedModel = model?.trim() ?? '';
  if (!normalizedModel) return '';
  const remainingPercent = resolveContextRemainingPercent(contextUsed, contextWindow);
  return remainingPercent === null
    ? normalizedModel
    : formatModelContext(normalizedModel, remainingPercent);
}

export const THREAD_ERROR_COPY: Readonly<Record<AdapterErrorCode, Readonly<{
  messageKey: string;
  actionKey?: string;
}>>> = {
  bridge_offline: {
    messageKey: 'Bridge is not running on your computer',
    actionKey: 'Help',
  },
  pairing_required: {
    messageKey: 'Pairing required',
    actionKey: 'Pair again',
  },
  gateway_offline: {
    messageKey: 'Agent is not responding',
    actionKey: 'Retry',
  },
  pairing_expired: {
    messageKey: 'Pairing expired, pair again',
    actionKey: 'Pair again',
  },
  unauthorized: {
    messageKey: 'Sign-in expired',
    actionKey: 'Sign in',
  },
  network: {
    messageKey: 'No network',
    actionKey: 'Retry',
  },
  timeout: {
    messageKey: 'Connection timed out',
    actionKey: 'Retry',
  },
  rate_limited: {
    messageKey: 'Too many requests, try again later',
  },
  frame_too_large: {
    messageKey: 'Message too large to send',
  },
  unsupported: {
    messageKey: 'Not supported by this backend',
  },
  server: {
    messageKey: 'Server error',
    actionKey: 'Retry',
  },
};

export function isThreadErrorCode(value: unknown): value is AdapterErrorCode {
  return typeof value === 'string'
    && Object.prototype.hasOwnProperty.call(THREAD_ERROR_COPY, value);
}

export function resolveThreadErrorCode(error: unknown): AdapterErrorCode {
  if (!error || typeof error !== 'object' || !('code' in error)) return 'network';
  const code = (error as { code?: unknown }).code;
  return isThreadErrorCode(code) ? code : 'network';
}

export function resolveThreadErrorDetail(error: unknown): string | undefined {
  if (typeof error === 'string') return error.trim() || undefined;
  if (error instanceof Error) return error.message.trim() || undefined;
  if (!error || typeof error !== 'object' || !('message' in error)) return undefined;
  const message = (error as { message?: unknown }).message;
  return typeof message === 'string' ? message.trim() || undefined : undefined;
}
