import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { BackendKind } from '@clawket/agent-protocol';
import * as Clipboard from 'expo-clipboard';
import * as Linking from 'expo-linking';
import { useTranslation } from 'react-i18next';
import {
  connectBackendPairingCode,
  connectBackendPairingLink,
  connectBackendPairingPayload,
  createYouMindOnboardingConnection,
  getConnectionRuntime,
  resolvePairingPayloadBackend,
  resolvePairingValidationReason,
  type BackendPairingPayload,
  type BackendPairingResult,
  type PairingValidationReason,
  type YouMindOnboardingAuthSession,
  type YouMindOnboardingConnection,
  useConnections,
} from '../../connection';
import { useAppContext } from '../../contexts/AppContext';
import { useGatewayScanner } from '../../contexts/GatewayScannerContext';
import { useProPaywall } from '../../contexts/ProPaywallContext';
import type { RootStackParamList } from '../../navigation/root-stack';
import type { RelayServiceEnvironment } from '../../types';
import { showNoticeAlert } from '../../utils/notice-alert';
import { OnboardingScreen } from './OnboardingScreen';
import { WelcomeScreen } from './WelcomeScreen';
import { YouMindOnboardingScreen } from './YouMindOnboardingScreen';
import type {
  OnboardingConnectionPhase,
  PairableBackendKind,
  PairingSubmission,
} from './model';
import {
  getOnboardingPairingCommand,
  normalizePairableBackendKind,
  ONBOARDING_DOCUMENTATION_URLS,
  ONBOARDING_WEBSITE_URLS,
  type OnboardingWebsiteBackendKind,
  resolveOnboardingAdapterError,
  resolveOnboardingRouteStatus,
} from './route-model';
import { isVerificationCodeComplete } from './model';

type NavigationProps = NativeStackScreenProps<RootStackParamList, 'Onboarding'>;

export type OnboardingConnectedResult = Readonly<{
  connectionId: string;
  backendKind: BackendKind;
}>;

export type OnboardingRouteProps = NavigationProps & Readonly<{
  onConnected?: (result: OnboardingConnectedResult) => void;
  onOpenYouMind?: () => void;
  onViewed?: () => void;
  onDocsOpened?: (backendKind: BackendKind) => void;
  onAgentPromptCopied?: (backendKind: PairableBackendKind) => void;
  onPairingCodeSubmitted?: (input: {
    backendKind: PairableBackendKind;
    lengthOk: boolean;
  }) => void;
  onScanQrTapped?: (backendKind: PairableBackendKind) => void;
  onOpenPaywall?: (reason: 'gatewayConnections', onContinue?: () => void) => void;
  onClose?: () => void;
}>;

type PairingOperation = Readonly<{
  active: boolean;
  backendKind: PairableBackendKind;
  phase: OnboardingConnectionPhase;
  targetConnectionId: string | null;
  errorCode?: ReturnType<typeof resolveOnboardingAdapterError>;
  pairingReason?: PairingValidationReason;
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
  onAgentPromptCopied,
  onPairingCodeSubmitted,
  onScanQrTapped,
  onOpenPaywall,
  onClose,
}: OnboardingRouteProps): React.JSX.Element {
  const { t } = useTranslation('config');
  const runtime = useConnections();
  const { debugMode } = useAppContext();
  const {
    connectPairingCode: connectSecurePairingCode,
    connectPairingLink: connectSecurePairingLink,
    openGatewayScanner,
    importGatewayQrImage,
  } = useGatewayScanner();
  const { isPro, requirePro } = useProPaywall();
  const environment: RelayServiceEnvironment = debugMode ? 'preview' : 'production';
  const initialBackend = normalizePairableBackendKind(route.params?.initialBackend);
  const [setupVisible, setSetupVisible] = useState(Boolean(route.params?.presentation === 'modal' || route.params?.initialBackend || route.params?.pairingUrl));
  const [operation, setOperation] = useState<PairingOperation>(() => ({
    ...INITIAL_OPERATION,
    backendKind: initialBackend,
  }));
  const [youMindDraft, setYouMindDraft] = useState<YouMindOnboardingConnection | null>(null);
  const requestIdRef = useRef(0);
  const pairingRequestInFlightRef = useRef(false);
  const handledPairingUrlRef = useRef<string | null>(null);
  const announcedConnectionRef = useRef<string | null>(null);
  const lastActionRef = useRef<(() => void) | null>(null);

  const canBeginPairing = useCallback((onContinue?: () => void): boolean => {
    if (runtime.connections.length === 0 || isPro) return true;
    if (onOpenPaywall) {
      onOpenPaywall('gatewayConnections', onContinue);
      return false;
    }
    return requirePro('gatewayConnections');
  }, [isPro, onOpenPaywall, requirePro, runtime.connections.length]);

  const acquirePairingRequest = useCallback((): boolean => {
    if (pairingRequestInFlightRef.current) return false;
    pairingRequestInFlightRef.current = true;
    return true;
  }, []);

  const releasePairingRequest = useCallback(() => {
    pairingRequestInFlightRef.current = false;
  }, []);

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
      pairingReason: resolvePairingValidationReason(error),
    }));
  }, []);

  const awaitRuntimeConnection = useCallback(async (
    requestId: number,
    result: BackendPairingResult | null,
  ) => {
    const snapshot = getConnectionRuntime().getSnapshot();
    if (requestId !== requestIdRef.current) return;
    if (!result) {
      setOperation((current) => ({ ...current, active: false, errorCode: undefined }));
      return;
    }
    const connectionId = result.connectionId;
    const descriptor = snapshot.connections.find((connection) => connection.id === connectionId);
    if (!descriptor) {
      failOperation(requestId, new Error('Pairing did not create the expected backend connection.'));
      return;
    }
    setOperation({
      active: true,
      backendKind: result.backendKind,
      phase: snapshot.activeState === 'ready' ? 'ready' : 'waiting_bridge',
      targetConnectionId: connectionId,
    });
  }, [failOperation]);

  const submitPairing = useCallback(async (submission: PairingSubmission) => {
    const perform = async () => {
      if (!acquirePairingRequest()) return;
      onPairingCodeSubmitted?.({
        backendKind: submission.backendKind,
        lengthOk: isVerificationCodeComplete(submission.code, submission.backendKind),
      });
      lastActionRef.current = () => { void perform(); };
      const requestId = beginOperation(submission.backendKind);
      try {
        const result = await connectBackendPairingCode({
          backendKind: submission.backendKind,
          environment,
          debugMode,
          runtime: getConnectionRuntime(),
          pairingCode: submission.code,
          secureInvitation: {
            connectCode: connectSecurePairingCode,
            connectLink: connectSecurePairingLink,
          },
        });
        if (requestId !== requestIdRef.current) return;
        await awaitRuntimeConnection(requestId, result);
      } catch (error) {
        failOperation(requestId, error);
      } finally {
        releasePairingRequest();
      }
    };
    if (!canBeginPairing(() => { void perform(); })) return;
    await perform();
  }, [
    acquirePairingRequest,
    awaitRuntimeConnection,
    beginOperation,
    canBeginPairing,
    connectSecurePairingCode,
    connectSecurePairingLink,
    debugMode,
    environment,
    failOperation,
    onPairingCodeSubmitted,
    releasePairingRequest,
  ]);

  const connectScannedPayload = useCallback(async (
    payload: BackendPairingPayload,
    expectedBackendKind: PairableBackendKind,
  ) => {
    if (pairingRequestInFlightRef.current) return;
    if (!acquirePairingRequest()) return;
    const action = () => { void connectScannedPayloadRef.current(payload, expectedBackendKind); };
    lastActionRef.current = action;
    const requestId = beginOperation(expectedBackendKind);
    try {
      const result = await connectBackendPairingPayload({
        runtime: getConnectionRuntime(),
        payload,
        backendKind: expectedBackendKind,
        environment,
        debugMode,
      });
      if (requestId !== requestIdRef.current) return;
      await awaitRuntimeConnection(requestId, result);
    } catch (error) {
      failOperation(requestId, error);
    } finally {
      releasePairingRequest();
    }
  }, [
    acquirePairingRequest,
    awaitRuntimeConnection,
    beginOperation,
    debugMode,
    environment,
    failOperation,
    releasePairingRequest,
  ]);

  // Camera permission/modal work is asynchronous. Validate a delivered result
  // against the current environment, rather than the render which opened it.
  const connectScannedPayloadRef = useRef(connectScannedPayload);
  useLayoutEffect(() => {
    connectScannedPayloadRef.current = connectScannedPayload;
  }, [connectScannedPayload]);

  const scanQr = useCallback((expectedBackendKind: PairableBackendKind, importImage = false) => {
    const perform = () => {
      if (pairingRequestInFlightRef.current) return;
      onScanQrTapped?.(expectedBackendKind);
      setOperation((current) => ({
        ...current,
        active: false,
        backendKind: expectedBackendKind,
        errorCode: undefined,
        pairingReason: undefined,
      }));
      const openScanner = importImage ? importGatewayQrImage : openGatewayScanner;
      void openScanner({
        onScanned: (result) => connectScannedPayloadRef.current(result, expectedBackendKind),
      });
    };
    if (!canBeginPairing(perform)) return;
    perform();
  }, [canBeginPairing, onScanQrTapped, openGatewayScanner, importGatewayQrImage]);

  // The chooser's generic scan (owner request 2026-09-28): every pairing QR names its backend, so
  // the scanned payload selects the step and then runs the same backend-checked claim path.
  const scanAnyQr = useCallback((importImage = false) => {
    const perform = () => {
      if (pairingRequestInFlightRef.current) return;
      setOperation((current) => ({ ...current, active: false, errorCode: undefined }));
      const openScanner = importImage ? importGatewayQrImage : openGatewayScanner;
      void openScanner({
        onScanned: (result) => {
          const backendKind = resolvePairingPayloadBackend(result);
          if (!backendKind) {
            showNoticeAlert(t('Invalid QR Code'), t('This QR code does not contain valid connection info.'));
            return;
          }
          return connectScannedPayloadRef.current(result, backendKind);
        },
      });
    };
    if (!canBeginPairing(perform)) return;
    perform();
  }, [canBeginPairing, importGatewayQrImage, openGatewayScanner, t]);

  const connectFromPairingLink = useCallback(async (url: string, expectedBackendKind = initialBackend) => {
    const perform = async () => {
      if (!acquirePairingRequest()) return;
      const requestId = beginOperation(expectedBackendKind);
      try {
        const result = await connectBackendPairingLink({
          backendKind: expectedBackendKind,
          environment,
          debugMode,
          runtime: getConnectionRuntime(),
          url,
          secureInvitation: {
            connectCode: connectSecurePairingCode,
            connectLink: connectSecurePairingLink,
          },
        });
        if (requestId !== requestIdRef.current) return;
        await awaitRuntimeConnection(requestId, result);
      } catch (error) {
        failOperation(requestId, error);
      } finally {
        releasePairingRequest();
      }
    };
    if (!canBeginPairing(() => { void perform(); })) return;
    await perform();
  }, [
    acquirePairingRequest,
    awaitRuntimeConnection,
    beginOperation,
    canBeginPairing,
    connectSecurePairingCode,
    connectSecurePairingLink,
    debugMode,
    environment,
    failOperation,
    initialBackend,
    releasePairingRequest,
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
    activeConnectionId: runtime.activeConnectionId,
    activeState: runtime.activeState,
    runtimeError: runtime.error?.message,
    operation,
  }), [
    operation,
    runtime.activeConnectionId,
    runtime.activeState,
    runtime.error?.message,
    runtime.initialized,
  ]);

  const retry = useCallback(() => {
    // Only the connection this pairing created is probed; a failed claim
    // replays the pairing instead of probing an unrelated existing connection.
    if (operation.targetConnectionId) {
      void getConnectionRuntime().probeActive().catch((error) => {
        setOperation((current) => ({
          ...current,
          active: false,
          errorCode: resolveOnboardingAdapterError(error),
          pairingReason: resolvePairingValidationReason(error),
        }));
      });
      return;
    }
    lastActionRef.current?.();
  }, [operation.targetConnectionId]);

  const openDocs = useCallback((backendKind: PairableBackendKind) => {
    onDocsOpened?.(backendKind);
    void Linking.openURL(ONBOARDING_DOCUMENTATION_URLS[backendKind]);
  }, [onDocsOpened]);

  const openWebsite = useCallback((backendKind: OnboardingWebsiteBackendKind) => {
    onDocsOpened?.(backendKind);
    void Linking.openURL(ONBOARDING_WEBSITE_URLS[backendKind]);
  }, [onDocsOpened]);

  const openYouMind = useCallback(() => {
    const perform = () => {
      onOpenYouMind?.();
      setYouMindDraft(createYouMindOnboardingConnection({
        runtime: getConnectionRuntime(),
        debugMode,
      }));
    };
    if (!canBeginPairing(perform)) return;
    perform();
  }, [canBeginPairing, debugMode, onOpenYouMind]);

  const closeYouMind = useCallback(() => {
    const draft = youMindDraft;
    setYouMindDraft(null);
    if (draft) void draft.discard();
  }, [youMindDraft]);

  const finishYouMindSignIn = useCallback(async (
    session: YouMindOnboardingAuthSession,
  ) => {
    const draft = youMindDraft;
    if (!draft) throw new Error('YouMind sign-in session is no longer active.');
    const result = await draft.finish(session);
    setYouMindDraft(null);
    onConnected?.(result);
  }, [onConnected, youMindDraft]);

  const close = onClose
    ?? (route.params?.presentation === 'modal' ? navigation.goBack : undefined);

  if (youMindDraft) {
    return (
      <YouMindOnboardingScreen
        client={youMindDraft.client}
        onBack={closeYouMind}
        onSignedIn={finishYouMindSignIn}
      />
    );
  }

  if (!setupVisible && !operation.active && !operation.errorCode && !route.params?.pairingUrl) {
    return <WelcomeScreen onSettings={() => navigation.navigate('AccountSettings')} onConnect={() => setSetupVisible(true)} onClose={close} />;
  }

  return (
    <OnboardingScreen
      initialBackend={operation.active || operation.errorCode ? operation.backendKind : route.params?.initialBackend ? initialBackend : undefined}
      status={status}
      environment={environment}
      pairingCommand={getOnboardingPairingCommand(environment)}
      onViewed={onViewed}
      onClose={close ?? (() => {
        requestIdRef.current += 1;
        setOperation({ ...INITIAL_OPERATION, backendKind: initialBackend });
        setSetupVisible(false);
      })}
      onCopyCommand={async (command) => {
        await Clipboard.setStringAsync(command);
      }}
      onCopyAgentPrompt={async (prompt, backend) => {
        await Clipboard.setStringAsync(prompt);
        onAgentPromptCopied?.(backend);
      }}
      onPastePairingCode={async (backend) => {
        const pasted = (await Clipboard.getStringAsync()).trim();
        if (/^(https?:\/\/|clawket:\/\/)/i.test(pasted)) {
          await connectFromPairingLink(pasted, backend);
          return null;
        }
        return pasted;
      }}
      onSubmitPairing={submitPairing}
      onScanQr={scanQr}
      onScanAnyQr={() => scanAnyQr()}
      onImportAnyQr={() => scanAnyQr(true)}
      onImportQr={(backend) => scanQr(backend, true)}
      onOpenYouMind={openYouMind}
      onOpenWebsite={openWebsite}
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
