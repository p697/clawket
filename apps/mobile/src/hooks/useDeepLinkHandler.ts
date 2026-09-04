import { useEffect, useRef } from 'react';
import { Alert } from 'react-native';
import * as Linking from 'expo-linking';
import { NavigationContainerRefWithCurrent } from '@react-navigation/native';
import { parseDeepLink, DeepLinkAction } from '../services/deepLinks';
import { resolveGatewayCacheScopeId } from '../services/gateway-cache-scope';
import { GatewayClient } from '../connection/protocol';
import { StorageService } from '../services/storage';
import { GatewayConfig } from '../types';
import type { RootStackParamList } from '../navigation/root-stack';
import { useGatewayScanner } from '../contexts/GatewayScannerContext';

export type DeepLinkDeps = {
  rootNavigationRef: NavigationContainerRefWithCurrent<RootStackParamList>;
  gateway: GatewayClient;
  activeConnectionId: string | null;
  currentAgentId: string;
  mainSessionKey: string;
  onSaved: (next: GatewayConfig, nextGatewayScopeId?: string | null) => void;
};

function describeAction(action: DeepLinkAction): { title: string; message: string } {
  switch (action.type) {
    case 'agent':
      return { title: 'Send Message', message: `Send "${action.message}" to agent?` };
    case 'session':
      return { title: 'Open Session', message: `Navigate to session "${action.key}"?` };
    case 'config':
      return { title: 'Open Settings', message: 'Open the settings screen?' };
    case 'connect':
      return {
        title: 'Connect to Server',
        message: `Connect to ${action.url}? This will change your active gateway connection.`,
      };
    case 'pair':
      return { title: 'Connect to Computer', message: 'Open this secure pairing invitation?' };
  }
}

function executeAction(action: DeepLinkAction, deps: DeepLinkDeps) {
  const {
    rootNavigationRef,
    gateway,
    activeConnectionId,
    currentAgentId,
    mainSessionKey,
    onSaved,
  } = deps;

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
          from: 'notification',
        });
      }
      Promise.resolve(gateway.sendChat(sessionKey, action.message)).catch(() => {
        Alert.alert('Send Failed', 'Connection is not ready. Please try again in the thread.');
      });
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
          from: 'notification',
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
      const config: GatewayConfig = { url: action.url, token: action.token, password: action.password };
      StorageService.setGatewayConfig(config);
      onSaved(config, resolveGatewayCacheScopeId({ config }));
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
      void connectPairingLink(action.url);
      return;
    }

    const { title, message } = describeAction(action);
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Confirm', onPress: () => executeAction(action, deps) },
    ]);
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
    deps.activeConnectionId,
    deps.currentAgentId,
    deps.gateway,
    deps.mainSessionKey,
    deps.onSaved,
    deps.rootNavigationRef,
  ]);
}
