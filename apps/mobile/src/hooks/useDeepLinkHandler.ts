import { useEffect, useRef } from 'react';
import { Alert } from 'react-native';
import * as Linking from 'expo-linking';
import { NavigationContainerRefWithCurrent } from '@react-navigation/native';
import {
  buildGatewayDefaultName,
  type AgentAdapter,
} from '@clawket/agent-protocol';
import { parseDeepLink, DeepLinkAction } from '../services/deepLinks';
import { createCompositeHash } from '../services/crypto-hash';
import { getConnectionRuntime } from '../connection';
import type { RootStackParamList } from '../navigation/root-stack';
import { useGatewayScanner } from '../contexts/GatewayScannerContext';
import { analyticsEvents } from '../services/analytics/events';
import { recordSuccessfulSendForAutomaticReview } from '../services/auto-app-review';

export type DeepLinkDeps = {
  rootNavigationRef: NavigationContainerRefWithCurrent<RootStackParamList>;
  activeAdapter?: AgentAdapter | null;
  activeConnectionId: string | null;
  currentAgentId: string;
  mainSessionKey: string;
  canAddConnection?: boolean;
  activeAccessDeniedReason?: 'gatewayConnections' | 'agents' | null;
  onOpenPaywall?: (
    reason: 'gatewayConnections' | 'agents',
    onContinue?: () => void | Promise<void>,
  ) => void;
  requestConfirmation: (request: DeepLinkConfirmationRequest) => void;
};

export type DeepLinkConfirmationRequest = Readonly<{
  action: Exclude<DeepLinkAction, { type: 'pair' }>;
  onConfirm: () => void;
}>;

export function createDeepLinkPromptIdempotencyKey(input: Readonly<{
  connectionId: string;
  agentId: string;
  sessionKey: string;
  message: string;
  receivedAtMs: number;
}>): string {
  const timestamp = Number.isFinite(input.receivedAtMs)
    ? Math.max(0, Math.trunc(input.receivedAtMs)).toString(36)
    : '0';
  const fingerprint = createCompositeHash([
    input.connectionId,
    input.agentId,
    input.sessionKey,
    input.message,
  ]);
  return `deeplink_${timestamp}_${fingerprint}`;
}

async function executeAction(
  action: DeepLinkAction,
  deps: DeepLinkDeps,
  promptIdempotencyKey?: string,
): Promise<void> {
  const {
    rootNavigationRef,
    activeAdapter,
    activeConnectionId,
    currentAgentId,
    mainSessionKey,
  } = deps;

  if ((action.type === 'agent' || action.type === 'session') && deps.activeAccessDeniedReason) {
    deps.onOpenPaywall?.(
      deps.activeAccessDeniedReason,
      () => executeAction(action, { ...deps, activeAccessDeniedReason: null }, promptIdempotencyKey),
    );
    return;
  }

  switch (action.type) {
    case 'agent': {
      if (!activeConnectionId) {
        Alert.alert('Connection Required', 'Connect to an Agent before sending this message.');
        break;
      }
      const sessionKey = action.sessionKey ?? mainSessionKey;
      if (rootNavigationRef.isReady()) {
        rootNavigationRef.navigate('Thread', {
          connectionId: activeConnectionId,
          agentId: currentAgentId,
          sessionKey,
          from: 'deeplink',
        });
      }
      const adapter = activeAdapter?.connection.id === activeConnectionId
        ? activeAdapter
        : getConnectionRuntime().getAdapter(activeConnectionId);
      if (!adapter) {
        Alert.alert('Send Failed', 'Connection is not ready. Please try again in the thread.');
        break;
      }
      try {
        await adapter.prompt(sessionKey, {
          text: action.message,
          idempotencyKey: promptIdempotencyKey ?? createDeepLinkPromptIdempotencyKey({
            connectionId: activeConnectionId,
            agentId: currentAgentId,
            sessionKey,
            message: action.message,
            receivedAtMs: Date.now(),
          }),
        });
        void recordSuccessfulSendForAutomaticReview();
      } catch {
        Alert.alert('Send Failed', 'Connection is not ready. Please try again in the thread.');
      }
      break;
    }
    case 'session': {
      if (!activeConnectionId) {
        Alert.alert('Connection Required', 'Connect to an Agent before opening this session.');
        break;
      }
      if (rootNavigationRef.isReady()) {
        rootNavigationRef.navigate('Thread', {
          connectionId: activeConnectionId,
          agentId: currentAgentId,
          sessionKey: action.key,
          from: 'deeplink',
        });
      }
      break;
    }
    case 'config': {
      if (rootNavigationRef.isReady()) {
        rootNavigationRef.navigate('AccountSettings');
      }
      break;
    }
    case 'connect': {
      if (deps.canAddConnection === false) {
        deps.onOpenPaywall?.(
          'gatewayConnections',
          () => executeAction(action, { ...deps, canAddConnection: true }, promptIdempotencyKey),
        );
        break;
      }
      const runtime = getConnectionRuntime();
      const url = action.url.trim();
      const auth = action.token || action.password
        ? {
          ...(action.token ? { token: action.token } : {}),
          ...(action.password ? { password: action.password } : {}),
        }
        : undefined;
      try {
        const saved = await runtime.upsertConnection({
          backendKind: 'openclaw',
          transportKind: 'custom',
          label: buildGatewayDefaultName({
            backendKind: 'openclaw',
            transportKind: 'custom',
            url,
            index: runtime.getSnapshot().connections.length + 1,
          }),
          url,
          ...(auth ? { auth } : {}),
        });
        await runtime.activate(saved.connection.id);
        analyticsEvents.gatewayConnectSaved({
          backend: 'openclaw',
          transport: 'custom',
          source: 'deeplink',
        });
      } catch {
        Alert.alert('Connection Failed', 'Could not save this connection. Try again.');
      }
      break;
    }
    case 'pair':
      break;
  }
}

export function useDeepLinkHandler(deps: DeepLinkDeps) {
  const processedRef = useRef<string | null>(null);
  const { connectPairingLink } = useGatewayScanner();

  const handleUrl = (url: string) => {
    // Deduplicate (same URL delivered via initial + event)
    if (processedRef.current === url) return;
    processedRef.current = url;

    const action = parseDeepLink(url);
    if (!action) return;
    if (action.type === 'pair') {
      if (deps.canAddConnection === false) {
        deps.onOpenPaywall?.(
          'gatewayConnections',
          async () => {
            await connectPairingLink(action.url);
          },
        );
        return;
      }
      void connectPairingLink(action.url);
      return;
    }

    const promptIdempotencyKey = action.type === 'agent' && deps.activeConnectionId
      ? createDeepLinkPromptIdempotencyKey({
        connectionId: deps.activeConnectionId,
        agentId: deps.currentAgentId,
        sessionKey: action.sessionKey ?? deps.mainSessionKey,
        message: action.message,
        receivedAtMs: Date.now(),
      })
      : undefined;
    deps.requestConfirmation({
      action,
      onConfirm: () => {
        void executeAction(action, deps, promptIdempotencyKey);
      },
    });
  };

  useEffect(() => {
    // Handle cold-start deep link
    Linking.getInitialURL().then((url) => {
      if (url) handleUrl(url);
    });

    // Handle deep links while app is running
    const sub = Linking.addEventListener('url', ({ url }) => {
      handleUrl(url);
    });

    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    connectPairingLink,
    deps.activeAdapter,
    deps.activeConnectionId,
    deps.activeAccessDeniedReason,
    deps.canAddConnection,
    deps.currentAgentId,
    deps.mainSessionKey,
    deps.requestConfirmation,
    deps.rootNavigationRef,
    deps.onOpenPaywall,
  ]);
}
