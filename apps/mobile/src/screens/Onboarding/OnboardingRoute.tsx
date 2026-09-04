import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as Clipboard from 'expo-clipboard';
import * as Linking from 'expo-linking';
import type { MutableRefObject } from 'react';
import {
  getConnectionRuntime,
  useConnections,
} from '../../connection';
import {
  claimRelayPairing,
  createGatewayConfigFromScan,
  toRuntimeConfig,
  type GatewayScanPayload,
} from '../../connection/pairing/gateway-scan-flow';
import { useAppContext } from '../../contexts/AppContext';
import { useGatewayScanner } from '../../contexts/GatewayScannerContext';
import { useProPaywall } from '../../contexts/ProPaywallContext';
import type { RootStackParamList } from '../../navigation/root-stack';
import {
  assessRelayEnvironmentSelection,
  getOfficialRelayRegistryUrl,
} from '../../services/relay-environment';
import { parsePairingLink } from '../../services/pairing-session';
import type { RelayServiceEnvironment } from '../../types';
import { OnboardingScreen } from './OnboardingScreen';
import type {
  OnboardingConnectionPhase,
  PairableBackendKind,
  PairingSubmission,
} from './model';
import {
  assessOnboardingQr,
  getOnboardingPairingCommand,
  normalizePairableBackendKind,
  ONBOARDING_DOCUMENTATION_URLS,
  resolveOnboardingAdapterError,
  resolveOnboardingRouteStatus,
} from './route-model';

type NavigationProps = NativeStackScreenProps<RootStackParamList, 'Onboarding'>;

export type OnboardingConnectedResult = Readonly<{
  connectionId: string;
  backendKind: PairableBackendKind;
}>;

export type OnboardingRouteProps = NavigationProps & Readonly<{
  onConnected?: (result: OnboardingConnectedResult) => void;
  onOpenYouMind?: () => void;
  onViewed?: () => void;
  onDocsOpened?: (backendKind: PairableBackendKind) => void;
  onPairingCodeSubmitted?: (input: {
    backendKind: PairableBackendKind;
    lengthOk: boolean;
  }) => void;
  onClose?: () => void;
}>;

type PairingOperation = Readonly<{
  active: boolean;
  backendKind: PairableBackendKind;
  phase: OnboardingConnectionPhase;
  targetConnectionId: string | null;
  errorCode?: ReturnType<typeof resolveOnboardingAdapterError>;
}>;

const INITIAL_OPERATION: PairingOperation = Object.freeze({
  active: false,
  backendKind: 'openclaw',
  phase: 'relay_connected',
  targetConnectionId: null,
});

export function OnboardingRoute({
  navigation,
  route,
  onConnected,
  onOpenYouMind,
  onViewed,
  onDocsOpened,
  onPairingCodeSubmitted,
  onClose,
}: OnboardingRouteProps): React.JSX.Element {
  const runtime = useConnections();
  const { gateway, debugMode, onSaved } = useAppContext();
  const {
    connectPairingCode,
    connectPairingLink,
    openGatewayScanner,
  } = useGatewayScanner();
  const { isPro, requirePro } = useProPaywall();
  const environment: RelayServiceEnvironment = debugMode ? 'preview' : 'production';
  const initialBackend = normalizePairableBackendKind(route.params?.initialBackend);
  const [operation, setOperation] = useState<PairingOperation>(() => ({
    ...INITIAL_OPERATION,
    backendKind: initialBackend,
  }));
  const requestIdRef = useRef(0);
  const claimInFlightRef = useRef<Map<string, Promise<GatewayScanPayload>>>(new Map());
  const handledPairingUrlRef = useRef<string | null>(null);
  const announcedConnectionRef = useRef<string | null>(null);
  const lastActionRef = useRef<(() => void) | null>(null);

  const canBeginPairing = useCallback((): boolean => {
    if (runtime.connections.length === 0 || isPro) return true;
    return requirePro('gatewayConnections');
  }, [isPro, requirePro, runtime.connections.length]);

  const beginOperation = useCallback((backendKind: PairableBackendKind): number => {
    const requestId = ++requestIdRef.current;
    announcedConnectionRef.current = null;
    setOperation({
      active: true,
      backendKind,
      phase: 'relay_connected',
      targetConnectionId: null,
    });
    return requestId;
  }, []);

  const failOperation = useCallback((requestId: number, error: unknown) => {
    if (requestId !== requestIdRef.current) return;
    setOperation((current) => ({
      ...current,
      active: false,
      errorCode: resolveOnboardingAdapterError(error),
    }));
  }, []);

  const awaitRuntimeConnection = useCallback(async (
    requestId: number,
    backendKind: PairableBackendKind,
    preferredConnectionId?: string,
  ) => {
    const snapshot = await getConnectionRuntime().syncLegacyConnections();
    if (requestId !== requestIdRef.current) return;
    const connectionId = preferredConnectionId ?? snapshot.activeConnectionId;
    const descriptor = snapshot.connections.find((connection) => connection.id === connectionId);
    if (!connectionId || !descriptor || descriptor.backendKind !== backendKind) {
      failOperation(requestId, new Error('Pairing did not create the expected backend connection.'));
      return;
    }
    setOperation({
      active: true,
      backendKind,
      phase: snapshot.activeState === 'ready' ? 'ready' : 'waiting_bridge',
      targetConnectionId: connectionId,
    });
  }, [failOperation]);

  const submitPairing = useCallback(async (submission: PairingSubmission) => {
    onPairingCodeSubmitted?.({
      backendKind: submission.backendKind,
      lengthOk: submission.code.length === 6,
    });
    if (!canBeginPairing()) return;
    if (submission.backendKind === 'hermes') {
      const requestId = beginOperation('hermes');
      failOperation(requestId, { code: 'unsupported' });
      return;
    }

    const action = () => { void submitPairing(submission); };
    lastActionRef.current = action;
    const requestId = beginOperation('openclaw');
    try {
      const connected = await connectPairingCode({
        serverUrl: getOfficialRelayRegistryUrl(environment),
        pairingCode: submission.code,
      });
      if (!connected) {
        failOperation(requestId, { code: 'pairing_expired' });
        return;
      }
      await awaitRuntimeConnection(requestId, 'openclaw');
    } catch (error) {
      failOperation(requestId, error);
    }
  }, [
    awaitRuntimeConnection,
    beginOperation,
    canBeginPairing,
    connectPairingCode,
    environment,
    failOperation,
    onPairingCodeSubmitted,
  ]);

  const connectScannedPayload = useCallback(async (
    payload: GatewayScanPayload,
    expectedBackendKind: PairableBackendKind,
  ) => {
    const assessment = assessOnboardingQr(payload, expectedBackendKind);
    if (assessment.kind === 'rejected') {
      const requestId = beginOperation(expectedBackendKind);
      failOperation(requestId, { code: 'unsupported' });
      return;
    }

    const relayIssue = payload.relay?.serverUrl
      ? assessRelayEnvironmentSelection({
        serverUrl: payload.relay.serverUrl,
        selectedEnvironment: environment,
        debugMode,
      })
      : null;
    if (relayIssue) {
      const requestId = beginOperation(expectedBackendKind);
      failOperation(requestId, { code: 'unsupported' });
      return;
    }

    const action = () => { void connectScannedPayload(payload, expectedBackendKind); };
    lastActionRef.current = action;
    const requestId = beginOperation(expectedBackendKind);
    try {
      const resolved = payload.relay?.accessCode
        ? await claimRelayPairing(
          payload,
          claimInFlightRef as MutableRefObject<Map<string, Promise<GatewayScanPayload>>>,
        )
        : payload;
      if (requestId !== requestIdRef.current) return;
      const { created } = await createGatewayConfigFromScan({
        payload: resolved,
        debugMode,
      });
      if (requestId !== requestIdRef.current) return;
      const nextConfig = toRuntimeConfig(created, debugMode);
      gateway.disconnect();
      onSaved(nextConfig, `cfg:${created.id}`);
      gateway.configure(nextConfig);
      gateway.connect();
      await awaitRuntimeConnection(requestId, expectedBackendKind, created.id);
    } catch (error) {
      failOperation(requestId, error);
    }
  }, [
    awaitRuntimeConnection,
    beginOperation,
    debugMode,
    environment,
    failOperation,
    gateway,
    onSaved,
  ]);

  const scanQr = useCallback((expectedBackendKind: PairableBackendKind) => {
    if (!canBeginPairing()) return;
    setOperation((current) => ({
      ...current,
      active: false,
      backendKind: expectedBackendKind,
      errorCode: undefined,
    }));
    openGatewayScanner({
      onScanned: (result) => connectScannedPayload(result, expectedBackendKind),
    });
  }, [canBeginPairing, connectScannedPayload, openGatewayScanner]);

  const connectFromPairingLink = useCallback(async (url: string) => {
    if (!canBeginPairing()) return;
    if (initialBackend === 'hermes') {
      const requestId = beginOperation('hermes');
      failOperation(requestId, { code: 'unsupported' });
      return;
    }
    const descriptor = parsePairingLink(url);
    if (!descriptor) {
      const requestId = beginOperation('openclaw');
      failOperation(requestId, { code: 'pairing_expired' });
      return;
    }
    const relayIssue = assessRelayEnvironmentSelection({
      serverUrl: descriptor.serverUrl,
      selectedEnvironment: environment,
      debugMode,
    });
    if (relayIssue) {
      const requestId = beginOperation('openclaw');
      failOperation(requestId, { code: 'unsupported' });
      return;
    }
    const requestId = beginOperation('openclaw');
    try {
      const connected = await connectPairingLink(url);
      if (!connected) {
        failOperation(requestId, { code: 'pairing_expired' });
        return;
      }
      await awaitRuntimeConnection(requestId, 'openclaw');
    } catch (error) {
      failOperation(requestId, error);
    }
  }, [
    awaitRuntimeConnection,
    beginOperation,
    canBeginPairing,
    connectPairingLink,
    debugMode,
    environment,
    failOperation,
    initialBackend,
  ]);

  useEffect(() => {
    const pairingUrl = route.params?.pairingUrl?.trim();
    if (!runtime.initialized || !pairingUrl || handledPairingUrlRef.current === pairingUrl) return;
    handledPairingUrlRef.current = pairingUrl;
    void connectFromPairingLink(pairingUrl);
  }, [connectFromPairingLink, route.params?.pairingUrl, runtime.initialized]);

  useEffect(() => {
    const connectionId = operation.targetConnectionId;
    if (
      !operation.active
      || !connectionId
      || runtime.activeConnectionId !== connectionId
      || runtime.activeState !== 'ready'
      || announcedConnectionRef.current === connectionId
    ) {
      return;
    }
    announcedConnectionRef.current = connectionId;
    setOperation((current) => ({ ...current, phase: 'ready' }));
    onConnected?.({ connectionId, backendKind: operation.backendKind });
  }, [
    onConnected,
    operation.active,
    operation.backendKind,
    operation.targetConnectionId,
    runtime.activeConnectionId,
    runtime.activeState,
  ]);

  const status = useMemo(() => resolveOnboardingRouteStatus({
    initialized: runtime.initialized,
    connectionCount: runtime.connections.length,
    activeState: runtime.activeState,
    runtimeError: runtime.error?.message,
    operation,
  }), [
    operation,
    runtime.activeState,
    runtime.connections.length,
    runtime.error?.message,
    runtime.initialized,
  ]);

  const retry = useCallback(() => {
    if (operation.targetConnectionId || runtime.activeConnectionId) {
      void getConnectionRuntime().probeActive().catch((error) => {
        setOperation((current) => ({
          ...current,
          active: false,
          errorCode: resolveOnboardingAdapterError(error),
        }));
      });
      return;
    }
    lastActionRef.current?.();
  }, [operation.targetConnectionId, runtime.activeConnectionId]);

  const openDocs = useCallback((backendKind: PairableBackendKind) => {
    onDocsOpened?.(backendKind);
    void Linking.openURL(ONBOARDING_DOCUMENTATION_URLS[backendKind]);
  }, [onDocsOpened]);

  const close = onClose
    ?? (route.params?.presentation === 'modal' ? navigation.goBack : undefined);

  return (
    <OnboardingScreen
      initialBackend={initialBackend}
      status={status}
      environment={environment}
      pairingCommand={getOnboardingPairingCommand(environment)}
      onViewed={onViewed}
      onClose={close}
      onCopyCommand={async (command) => {
        await Clipboard.setStringAsync(command);
      }}
      onPastePairingCode={() => Clipboard.getStringAsync()}
      onSubmitPairing={(submission) => { void submitPairing(submission); }}
      onScanQr={scanQr}
      onOpenPairingHelp={openDocs}
      onOpenYouMind={() => onOpenYouMind?.()}
      onOpenDocs={openDocs}
      onErrorAction={(code) => {
        if (code === 'bridge_offline') {
          openDocs(operation.backendKind);
          return;
        }
        retry();
      }}
      onRetry={retry}
    />
  );
}
