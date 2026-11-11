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
  getConnectionRuntime,
  resolvePairingPayloadBackend,
  resolvePairingValidationReason,
  type BackendPairingPayload,
  type BackendPairingResult,
  type PairingValidationReason,
  useConnections,
} from '../../connection';
import { useAppContext } from '../../contexts/AppContext';
import { useGatewayScanner } from '../../contexts/GatewayScannerContext';
import { useProPaywall } from '../../contexts/ProPaywallContext';
import type { RootStackParamList } from '../../navigation/root-stack';
import type { RelayServiceEnvironment } from '../../types';
import { triggerSuccessHaptic, triggerWarningHaptic } from '../../services/haptics';
import { showNoticeAlert } from '../../utils/notice-alert';
import { OnboardingScreen } from './OnboardingScreen';
import { WelcomeScreen } from './WelcomeScreen';
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
  onViewed?: () => void;
  onDocsOpened?: (backendKind: BackendKind) => void;
  onAgentPromptCopied?: (backendKind: PairableBackendKind) => void;
  onPairingCodeSubmitted?: (input: {
    backendKind: PairableBackendKind;
    lengthOk: boolean;
  }) => void;
  onScanQrTapped?: (backendKind: PairableBackendKind) => void;
  /** A pairing started here ended in an error the page shows. Fixed categories only. */
  onPairingFailed?: (input: {
    backendKind: PairableBackendKind;
    method: PairingActionKind;
    code: ReturnType<typeof resolveOnboardingAdapterError>;
    reason?: PairingValidationReason;
  }) => void;
  onOpenPaywall?: (reason: 'gatewayConnections', onContinue?: () => void) => void;
  onClose?: () => void;
}>;

/** How the last pairing was started; decides what a fresh attempt offers. */
type PairingActionKind = 'code' | 'scan' | 'link';

/**
 * Errors that mean the invitation itself is spent. Before a connection exists, replaying the same
 * code or QR can only fail again, so their action starts a fresh attempt instead.
 */
const SPENT_INVITATION_ERRORS: ReadonlySet<string> = new Set(['pairing_expired', 'pairing_required', 'unauthorized']);

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
  onViewed,
  onDocsOpened,
  onAgentPromptCopied,
  onPairingCodeSubmitted,
  onScanQrTapped,
  onPairingFailed,
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
  } = useGatewayScanner();
  const { isPro, requirePro } = useProPaywall();
  const environment: RelayServiceEnvironment = debugMode ? 'preview' : 'production';
  const initialBackend = normalizePairableBackendKind(route.params?.initialBackend);
  const [setupVisible, setSetupVisible] = useState(Boolean(route.params?.presentation === 'modal' || route.params?.initialBackend || route.params?.pairingUrl));
  const [operation, setOperation] = useState<PairingOperation>(() => ({
    ...INITIAL_OPERATION,
    backendKind: initialBackend,
  }));
  const requestIdRef = useRef(0);
  const pairingRequestInFlightRef = useRef(false);
  const handledPairingUrlRef = useRef<string | null>(null);
  const announcedConnectionRef = useRef<string | null>(null);
  const lastActionRef = useRef<(() => void) | null>(null);
  const lastActionKindRef = useRef<PairingActionKind | null>(null);
  // The scanner entry that delivered the last QR: a backend step's scoped scan, or the home's.
  const lastScanEntryRef = useRef<'backend' | 'any'>('backend');
  const [freshAttempt, setFreshAttempt] = useState(0);

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

  const failOperation = useCallback((requestId: number, error: unknown, backendKind: PairableBackendKind) => {
    if (requestId !== requestIdRef.current) return;
    const errorCode = resolveOnboardingAdapterError(error);
    const pairingReason = resolvePairingValidationReason(error);
    triggerWarningHaptic();
    setOperation((current) => ({
      ...current,
      active: false,
      errorCode,
      pairingReason,
    }));
    onPairingFailed?.({
      backendKind,
      method: lastActionKindRef.current ?? 'code',
      code: errorCode,
      ...(pairingReason ? { reason: pairingReason } : {}),
    });
  }, [onPairingFailed]);

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
      failOperation(requestId, new Error('Pairing did not create the expected backend connection.'), result.backendKind);
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
      lastActionKindRef.current = 'code';
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
        failOperation(requestId, error, submission.backendKind);
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
    lastActionKindRef.current = 'scan';
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
      failOperation(requestId, error, expectedBackendKind);
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

  // The scanner's own photo action delivers a saved QR through these same callbacks.
  const scanQr = useCallback((expectedBackendKind: PairableBackendKind) => {
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
      void openGatewayScanner({
        onScanned: (result) => {
          lastScanEntryRef.current = 'backend';
          return connectScannedPayloadRef.current(result, expectedBackendKind);
        },
      });
    };
    if (!canBeginPairing(perform)) return;
    perform();
  }, [canBeginPairing, onScanQrTapped, openGatewayScanner]);

  // The chooser's generic scan (owner request 2026-09-28): every pairing QR names its backend, so
  // the scanned payload selects the step and then runs the same backend-checked claim path.
  const scanAnyQr = useCallback(() => {
    const perform = () => {
      if (pairingRequestInFlightRef.current) return;
      setOperation((current) => ({ ...current, active: false, errorCode: undefined }));
      void openGatewayScanner({
        onScanned: (result) => {
          const backendKind = resolvePairingPayloadBackend(result);
          if (!backendKind) {
            showNoticeAlert(t('Invalid QR Code'), t('This QR code does not contain valid connection info.'));
            return;
          }
          lastScanEntryRef.current = 'any';
          return connectScannedPayloadRef.current(result, backendKind);
        },
      });
    };
    if (!canBeginPairing(perform)) return;
    perform();
  }, [canBeginPairing, openGatewayScanner, t]);

  const connectFromPairingLink = useCallback(async (url: string, expectedBackendKind = initialBackend) => {
    const perform = async () => {
      if (!acquirePairingRequest()) return;
      // A failed link used to leave Retry on whatever was submitted before it.
      lastActionRef.current = () => { void perform(); };
      lastActionKindRef.current = 'link';
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
        failOperation(requestId, error, expectedBackendKind);
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
    // The one moment the whole flow builds to: the paired Agent answered.
    triggerSuccessHaptic();
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

  // A spent code or QR cannot be claimed twice. Its action asks for a new one where the last one came
  // from: the scanner for a QR, the emptied code field otherwise (funnel review 2026-11-11: "Pair
  // again" resubmitted the same invitation and failed the same way).
  const startFreshPairing = useCallback(() => {
    if (lastActionKindRef.current === 'scan') {
      if (lastScanEntryRef.current === 'any') scanAnyQr();
      else scanQr(operation.backendKind);
      return;
    }
    setFreshAttempt((count) => count + 1);
  }, [operation.backendKind, scanAnyQr, scanQr]);

  const openDocs = useCallback((backendKind: PairableBackendKind) => {
    onDocsOpened?.(backendKind);
    void Linking.openURL(ONBOARDING_DOCUMENTATION_URLS[backendKind]);
  }, [onDocsOpened]);

  const openWebsite = useCallback((backendKind: OnboardingWebsiteBackendKind) => {
    onDocsOpened?.(backendKind);
    void Linking.openURL(ONBOARDING_WEBSITE_URLS[backendKind]);
  }, [onDocsOpened]);

  const close = onClose
    ?? (route.params?.presentation === 'modal' ? navigation.goBack : undefined);

  if (!setupVisible && !operation.active && !operation.errorCode && !route.params?.pairingUrl) {
    return <WelcomeScreen onSettings={() => navigation.navigate('AccountSettings')} onConnect={() => setSetupVisible(true)} onClose={close} />;
  }

  return (
    <OnboardingScreen
      initialBackend={operation.active || operation.errorCode ? operation.backendKind : route.params?.initialBackend ? initialBackend : undefined}
      status={status}
      environment={environment}
      pairingCommand={getOnboardingPairingCommand(environment)}
      freshAttempt={freshAttempt}
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
      onPastePairingCode={async (backend, isCurrent) => {
        const pasted = (await Clipboard.getStringAsync()).trim();
        if (isCurrent && !isCurrent()) return null;
        if (/^(https?:\/\/|clawket:\/\/)/i.test(pasted)) {
          await connectFromPairingLink(pasted, backend);
          return null;
        }
        return pasted;
      }}
      onSubmitPairing={submitPairing}
      onScanQr={scanQr}
      onScanAnyQr={() => scanAnyQr()}
      onOpenWebsite={openWebsite}
      onErrorAction={(code) => {
        if (code === 'bridge_offline') {
          openDocs(operation.backendKind);
          return;
        }
        if (!operation.targetConnectionId && SPENT_INVITATION_ERRORS.has(code)) {
          startFreshPairing();
          return;
        }
        retry();
      }}
      onRetry={retry}
      onOpenCustomConnection={() => navigation.navigate('OpenClawDirect')}
    />
  );
}
