import { ConnectionState, GatewayConfig } from '../../../types';
import { selectByBackend } from '../../../services/gateway-backends';

export type ChatHeaderStatusKind =
  | 'starting_hermes'
  | 'connecting_gateway'
  | 'reconnecting'
  | 'connecting'
  | 'waiting_for_approval'
  | 'refreshing_conversation'
  | 'syncing_conversation';

type ChatHeaderSyncStateInput = {
  config: GatewayConfig | null;
  sessionKey: string | null;
  connectionState: ConnectionState;
  refreshing: boolean;
  historyLoaded: boolean;
  isSending: boolean;
};

export function hasActiveGatewayConfig(config: GatewayConfig | null | undefined): boolean {
  return typeof config?.url === 'string' && config.url.trim().length > 0;
}

export function getChatHeaderSyncState(input: ChatHeaderSyncStateInput): {
  isConnecting: boolean;
  status: ChatHeaderStatusKind | null;
  busy: boolean;
} {
  if (!hasActiveGatewayConfig(input.config)) {
    return {
      isConnecting: false,
      status: null,
      busy: false,
    };
  }

  const isConnecting = input.connectionState !== 'ready' || !input.sessionKey;
  // The "no session yet" status label depends on whether the backend
  // still needs to start a local Hermes bridge (Hermes) or just needs to
  // establish the gateway socket (OpenClaw). Resolution lives in the
  // shared backend selector so this file has no inline backend check.
  const awaitingSessionStatus: ChatHeaderStatusKind = selectByBackend(input.config, {
    openclaw: 'connecting_gateway',
    hermes: 'starting_hermes',
  });
  const status = !input.sessionKey
    ? awaitingSessionStatus
    : input.connectionState === 'reconnecting'
      ? 'reconnecting'
      : input.connectionState === 'connecting' || input.connectionState === 'challenging'
        ? 'connecting'
        : input.connectionState === 'pairing_pending'
          ? 'waiting_for_approval'
          : input.refreshing
            ? 'refreshing_conversation'
            : !input.historyLoaded
              ? 'syncing_conversation'
              : null;

  return {
    isConnecting,
    status,
    busy: input.refreshing || (!!status && !input.isSending),
  };
}
