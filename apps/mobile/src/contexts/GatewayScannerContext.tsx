import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Linking, Modal } from 'react-native';
import { Camera } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import i18n from '../i18n';
import { useAppContext } from './AppContext';
import { useGatewayOverlay } from './GatewayOverlayContext';
import { QRScannerScreen } from '../screens/ConfigScreen/QRScannerScreen';
import { parseQRPayload, type QRScanResult } from '../screens/ConfigScreen/qrPayload';
import {
  claimRelayPairing,
  createGatewayConfigFromScan,
  reconnectGatewayWithOverlay,
  toRuntimeConfig,
  type GatewayScanPayload,
} from '../hooks/gatewayScanFlow';
import { isUnsupportedDirectLocalTlsConfig, shouldSuppressDuplicatePairingAlert } from '../hooks/gatewayConfigForm.utils';
import { getGatewayCameraPermissionAction } from '../utils/gateway-camera-permission';
import { isMacCatalyst } from '../utils/platform';
import {
  parsePairingLink,
  PairingSessionError,
  resolvePairingCode,
  resolvePairingLink,
  type ResolvedPairingSession,
} from '../services/pairing-session';
import { resolveOfficialRelayEnvironment } from '../services/relay-environment';
import { analyticsEvents } from '../services/analytics/events';

type GatewayScannerOptions = {
  onScanned: (result: QRScanResult) => void | Promise<void>;
  onCancel?: () => void;
};

type GatewayScannerContextType = {
  openGatewayScanner: (options: GatewayScannerOptions) => void;
  importGatewayQrImage: (options?: GatewayScannerOptions) => Promise<void>;
  connectPairingLink: (url: string) => Promise<boolean>;
  connectPairingCode: (input: { serverUrl: string; pairingCode: string }) => Promise<boolean>;
};

const GatewayScannerContext = React.createContext<GatewayScannerContextType | null>(null);

export function GatewayScannerProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [scannerVisible, setScannerVisible] = useState(false);
  const [scannerOptions, setScannerOptions] = useState<GatewayScannerOptions | null>(null);
  const relayClaimInFlightRef = useRef<Map<string, Promise<GatewayScanPayload>>>(new Map());
  const lastPairingAlertRef = useRef<{ message: string; atMs: number }>({ message: '', atMs: 0 });
  const switchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const {
    pendingAddGateway,
    clearPendingAddGateway,
    gateway,
    debugMode,
    onSaved,
  } = useAppContext();
  const { showOverlay, hideOverlay } = useGatewayOverlay();

  const showPairingFailedAlert = useCallback((message: string) => {
    const now = Date.now();
    if (
      shouldSuppressDuplicatePairingAlert(
        lastPairingAlertRef.current.message,
        lastPairingAlertRef.current.atMs,
        message,
        now,
      )
    ) {
      return;
    }
    lastPairingAlertRef.current = { message, atMs: now };
    hideOverlay();
    Alert.alert('Pairing Failed', message);
  }, [hideOverlay]);

  const connectFromScan = useCallback(async (payload: GatewayScanPayload): Promise<boolean> => {
    let resolved = payload;
    showOverlay(i18n.t('Switching Gateway...', { ns: 'common' }));
    try {
      resolved = payload.relay?.accessCode ? await claimRelayPairing(payload, relayClaimInFlightRef) : payload;
    } catch (error) {
      showPairingFailedAlert(error instanceof Error ? error.message : 'Could not claim this Bridge pairing code.');
      return false;
    }
    if (!resolved.url.trim()) {
      hideOverlay();
      return false;
    }
    if (isUnsupportedDirectLocalTlsConfig({
      url: resolved.url,
      hasRelayConfig: Boolean(resolved.relay?.gatewayId),
    })) {
      showPairingFailedAlert(i18n.t('Direct local TLS gateway connections are not supported in Clawket mobile yet. Disable OpenClaw gateway TLS for LAN pairing, or use Relay/Tailscale instead.', { ns: 'chat' }));
      return false;
    }

    let created;
    try {
      ({ created } = await createGatewayConfigFromScan({
        payload: resolved,
        debugMode,
      }));
    } catch {
      showPairingFailedAlert(i18n.t('Could not save this connection. Try again.', { ns: 'config' }));
      return false;
    }

    reconnectGatewayWithOverlay({
      gateway,
      runtimeConfig: toRuntimeConfig(created, debugMode),
      onSaved,
      showOverlay,
      hideOverlay,
      message: i18n.t('Switching Gateway...', { ns: 'common' }),
      switchTimerRef,
    });
    return true;
  }, [debugMode, gateway, hideOverlay, onSaved, showOverlay, showPairingFailedAlert]);

  const createFromScan = useCallback(async (payload: GatewayScanPayload): Promise<void> => {
    await connectFromScan(payload);
  }, [connectFromScan]);

  const confirmResolvedPairing = useCallback((resolved: ResolvedPairingSession): Promise<boolean> => {
    const parsed = parseQRPayload(resolved.rawQrPayload);
    if (!parsed) {
      showPairingFailedAlert(i18n.t('This pairing invitation does not contain valid connection info.', { ns: 'config' }));
      return Promise.resolve(false);
    }
    if (resolveOfficialRelayEnvironment(resolved.serverUrl) === 'preview' && !debugMode) {
      showPairingFailedAlert(i18n.t('Enable Debug Mode before pairing with the Preview environment.', { ns: 'config' }));
      return Promise.resolve(false);
    }
    const displayName = resolved.displayName?.trim()
      || parsed.relay?.displayName?.trim()
      || i18n.t('your computer', { ns: 'config' });
    return new Promise((resolve) => {
      Alert.alert(
        i18n.t('Connect to {{name}}?', { ns: 'config', name: displayName }),
        i18n.t('This secure pairing invitation will add the computer to Clawket.', { ns: 'config' }),
        [
          { text: i18n.t('Cancel', { ns: 'common' }), style: 'cancel', onPress: () => resolve(false) },
          {
            text: i18n.t('Connect', { ns: 'config' }),
            onPress: () => {
              void connectFromScan(parsed).then(resolve);
            },
          },
        ],
        { onDismiss: () => resolve(false) },
      );
    });
  }, [connectFromScan, debugMode, showPairingFailedAlert]);

  const connectPairingLink = useCallback(async (url: string): Promise<boolean> => {
    const descriptor = parsePairingLink(url);
    if (!descriptor) return false;
    const environment = resolveOfficialRelayEnvironment(descriptor.serverUrl) ?? 'production';
    showOverlay(i18n.t('Opening secure pairing invitation...', { ns: 'config' }));
    try {
      const resolved = await resolvePairingLink(url);
      hideOverlay();
      const connected = await confirmResolvedPairing(resolved);
      analyticsEvents.gatewaySecurePairingFinished({ method: 'link', environment, connected });
      return connected;
    } catch (error) {
      hideOverlay();
      analyticsEvents.gatewaySecurePairingFinished({ method: 'link', environment, connected: false });
      showPairingFailedAlert(pairingFailureMessage(error));
      return false;
    }
  }, [confirmResolvedPairing, hideOverlay, showOverlay, showPairingFailedAlert]);

  const connectPairingCode = useCallback(async (input: {
    serverUrl: string;
    pairingCode: string;
  }): Promise<boolean> => {
    const environment = resolveOfficialRelayEnvironment(input.serverUrl) ?? 'production';
    try {
      const connected = await confirmResolvedPairing(await resolvePairingCode(input));
      analyticsEvents.gatewaySecurePairingFinished({ method: 'code', environment, connected });
      return connected;
    } catch (error) {
      analyticsEvents.gatewaySecurePairingFinished({ method: 'code', environment, connected: false });
      showPairingFailedAlert(pairingFailureMessage(error));
      return false;
    }
  }, [confirmResolvedPairing, showPairingFailedAlert]);

  const importGatewayQrImage = useCallback(async (options?: GatewayScannerOptions) => {
    const resolvedOptions: GatewayScannerOptions = options ?? { onScanned: createFromScan };

    const pickerResult = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: false,
      quality: 1,
    });

    if (pickerResult.canceled || !pickerResult.assets?.[0]?.uri) {
      resolvedOptions.onCancel?.();
      return;
    }

    try {
      const barcodes = await Camera.scanFromURLAsync(pickerResult.assets[0].uri, ['qr']);
      if (barcodes.length === 0) {
        Alert.alert(
          i18n.t('No QR Code Found', { ns: 'config' }),
          i18n.t('The selected image does not contain a recognizable QR code.', { ns: 'config' }),
        );
        return;
      }

      const parsed = parseQRPayload(barcodes[0].data);
      if (!parsed) {
        Alert.alert(
          i18n.t('Invalid QR Code', { ns: 'config' }),
          i18n.t('This QR code does not contain valid connection info.', { ns: 'config' }),
        );
        return;
      }

      await resolvedOptions.onScanned(parsed);
    } catch {
      Alert.alert(
        i18n.t('Scan Failed', { ns: 'config' }),
        i18n.t('Could not decode the QR code from this image.', { ns: 'config' }),
      );
    }
  }, [createFromScan]);

  const openGatewayScanner = useCallback(async (options: GatewayScannerOptions) => {
    if (isMacCatalyst) {
      await importGatewayQrImage(options);
      return;
    }

    const currentPermission = await Camera.getCameraPermissionsAsync();
    const action = getGatewayCameraPermissionAction(currentPermission);

    if (action === 'show-settings') {
      Alert.alert(
        i18n.t('Camera Access Required', { ns: 'config' }),
        i18n.t('Camera access is required to scan a pairing QR code. Enable Camera in Settings and try again.', { ns: 'config' }),
        [
          {
            text: i18n.t('Cancel', { ns: 'common' }),
            style: 'cancel',
            onPress: () => {
              options.onCancel?.();
            },
          },
          {
            text: i18n.t('Open Settings', { ns: 'common' }),
            onPress: () => {
              options.onCancel?.();
              void Linking.openSettings();
            },
          },
        ],
      );
      return;
    }

    if (action === 'request-system-permission') {
      const requestedPermission = await Camera.requestCameraPermissionsAsync();
      if (!requestedPermission.granted) {
        options.onCancel?.();
        return;
      }
    }

    setScannerOptions(options);
    setScannerVisible(true);
  }, [importGatewayQrImage]);

  useEffect(() => {
    if (!pendingAddGateway || scannerVisible) return;
    clearPendingAddGateway();
    const openPendingFlow = isMacCatalyst ? importGatewayQrImage : openGatewayScanner;
    void openPendingFlow({ onScanned: createFromScan });
  }, [clearPendingAddGateway, createFromScan, importGatewayQrImage, openGatewayScanner, pendingAddGateway, scannerVisible]);

  const handleScanned = useCallback((result: QRScanResult) => {
    const options = scannerOptions;
    setScannerVisible(false);
    setScannerOptions(null);
    setTimeout(() => {
      if (!options) return;
      void options.onScanned(result);
    }, 350);
  }, [scannerOptions]);

  const handleCancel = useCallback(() => {
    const options = scannerOptions;
    setScannerVisible(false);
    setScannerOptions(null);
    setTimeout(() => {
      options?.onCancel?.();
    }, 350);
  }, [scannerOptions]);

  const value = useMemo(
    () => ({ openGatewayScanner, importGatewayQrImage, connectPairingLink, connectPairingCode }),
    [connectPairingCode, connectPairingLink, importGatewayQrImage, openGatewayScanner],
  );

  return (
    <GatewayScannerContext.Provider value={value}>
      {children}
      <Modal visible={scannerVisible} animationType="slide" presentationStyle="fullScreen">
        <QRScannerScreen onScanned={handleScanned} onCancel={handleCancel} />
      </Modal>
    </GatewayScannerContext.Provider>
  );
}

export function useGatewayScanner(): GatewayScannerContextType {
  const context = React.useContext(GatewayScannerContext);
  if (!context) {
    throw new Error('useGatewayScanner must be used within GatewayScannerProvider');
  }
  return context;
}

function pairingFailureMessage(error: unknown): string {
  if (!(error instanceof PairingSessionError)) {
    return i18n.t('Could not load this pairing invitation.', { ns: 'config' });
  }
  switch (error.code) {
    case 'PAIRING_NETWORK_ERROR':
      return i18n.t('Could not reach the pairing service. Check your connection and try again.', { ns: 'config' });
    case 'INVALID_PAIRING_CODE':
      return i18n.t('Enter the 6-digit pairing code shown on your computer.', { ns: 'config' });
    case 'PAIRING_CODE_RATE_LIMITED':
      return i18n.t('Too many pairing attempts. Wait a few minutes and try again.', { ns: 'config' });
    case 'PAIRING_SESSION_NOT_FOUND':
    case 'PAIRING_SESSION_EXPIRED':
    case 'ACCESS_CODE_EXPIRED':
      return i18n.t('This pairing invitation is invalid or has expired. Create a new one on your computer.', { ns: 'config' });
    case 'PAIRING_HANDSHAKE_TIMEOUT':
    case 'PAIRING_HANDSHAKE_FAILED':
    case 'PAIRING_HANDSHAKE_REJECTED':
      return i18n.t('The computer did not complete the secure pairing request. Create a new code and try again.', { ns: 'config' });
    case 'INVALID_PAIRING_LINK':
    case 'INVALID_PAIRING_SECRET':
    case 'PAIRING_DECRYPT_FAILED':
    case 'UNTRUSTED_PAIRING_SERVER':
      return i18n.t('This pairing invitation is invalid or was copied incompletely.', { ns: 'config' });
    default:
      return i18n.t('Could not load this pairing invitation.', { ns: 'config' });
  }
}
