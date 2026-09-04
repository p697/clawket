import React, { useCallback, useRef } from 'react';
import { InteractionManager } from 'react-native';
import { RouteProp, useIsFocused, useNavigation, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import i18n from '../../i18n';
import { ConfigScreenLayout } from './ConfigScreenLayout';
import { QRScanResult } from './qrPayload';
import { useGatewayOverlay } from '../../contexts/GatewayOverlayContext';
import { useGatewayScanner } from '../../contexts/GatewayScannerContext';
import { consumePendingConfigAddConnectionRequest } from '../../services/config-add-connection-request';
import { useConfigScreenController } from './hooks/useConfigScreenController';
import type { ConfigStackParamList } from './ConfigTab';

export function ConfigScreen(): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const controller = useConfigScreenController();
  const route = useRoute<RouteProp<ConfigStackParamList, 'ConfigHome'>>();
  const navigation = useNavigation();
  const isFocused = useIsFocused();
  const { showOverlay } = useGatewayOverlay();
  const { openGatewayScanner, importGatewayQrImage } = useGatewayScanner();
  const scanDispatchLockedRef = useRef(false);
  const editingIdBeforeScanRef = useRef<string | null>(null);
  const handledAddRequestRef = useRef<number | null>(null);

  const applyOrCreate = useCallback(
    (result: QRScanResult) => {
      if (editingIdBeforeScanRef.current) {
        void controller.applyScannedConfig(result);
      } else {
        void controller.createFromScan(result);
      }
    },
    [controller],
  );

  const dispatchImportedResult = useCallback((result: QRScanResult) => {
    if (scanDispatchLockedRef.current) return;
    scanDispatchLockedRef.current = true;
    showOverlay(i18n.t('Switching Gateway...', { ns: 'common' }));
    void applyOrCreate(result);
  }, [applyOrCreate, showOverlay]);

  const openRequestedAddConnection = useCallback((params?: {
    requestedAt?: number;
    tab?: 'quick' | 'manual';
    flow?: 'local' | 'youmind';
  }) => {
    const requestedAt = params?.requestedAt;
    if (!requestedAt) return;
    if (handledAddRequestRef.current === requestedAt) return;
    handledAddRequestRef.current = requestedAt;
    const preferredTab = params?.tab === 'manual' ? 'manual' : 'quick';
    controller.openCreateEditor(preferredTab, {
      quickStart: params?.flow === 'youmind'
        ? 'youmind'
        : params?.flow === 'local'
          ? 'local'
          : 'default',
    });
  }, [controller]);

  const handleScanQR = useCallback(() => {
    scanDispatchLockedRef.current = false;
    editingIdBeforeScanRef.current = controller.editingConfigId;
    controller.closeEditor();
    setTimeout(() => {
      openGatewayScanner({
        onScanned: (result) => {
          dispatchImportedResult(result);
        },
        onCancel: () => {
          scanDispatchLockedRef.current = false;
          const prevId = editingIdBeforeScanRef.current;
          if (prevId) {
            controller.openEditEditor(prevId);
          }
        },
      });
    }, 350);
  }, [controller, dispatchImportedResult, openGatewayScanner]);

  React.useEffect(() => {
    const requestedAt = route.params?.addConnectionRequestAt;
    if (!requestedAt) return;
    openRequestedAddConnection({
      requestedAt,
      tab: route.params?.addConnectionTab,
      flow: route.params?.addConnectionFlow,
    });
    (navigation as { setParams: (params: ConfigStackParamList['ConfigHome']) => void }).setParams({
      addConnectionRequestAt: undefined,
      addConnectionTab: undefined,
      addConnectionFlow: undefined,
    });
  }, [navigation, openRequestedAddConnection, route.params?.addConnectionFlow, route.params?.addConnectionRequestAt, route.params?.addConnectionTab]);

  React.useEffect(() => {
    if (!isFocused) return;
    const pendingRequest = consumePendingConfigAddConnectionRequest();
    if (!pendingRequest) return;
    let cancelled = false;
    const task = InteractionManager.runAfterInteractions(() => {
      requestAnimationFrame(() => {
        if (cancelled) return;
        openRequestedAddConnection(pendingRequest);
      });
    });
    return () => {
      cancelled = true;
      task.cancel();
    };
  }, [isFocused, openRequestedAddConnection]);

  const handleUploadQR = useCallback(() => {
    scanDispatchLockedRef.current = false;
    editingIdBeforeScanRef.current = controller.editingConfigId;
    controller.closeEditor();
    setTimeout(async () => {
      await importGatewayQrImage({
        onScanned: (result) => {
          dispatchImportedResult(result);
        },
        onCancel: () => {
          scanDispatchLockedRef.current = false;
          const prevId = editingIdBeforeScanRef.current;
          if (prevId) {
            controller.openEditEditor(prevId);
          }
        },
      });
    }, 350);
  }, [controller, dispatchImportedResult, importGatewayQrImage]);

  const extendedController = {
    ...controller,
    onScanQR: handleScanQR,
    onUploadQR: handleUploadQR,
  };

  return <ConfigScreenLayout insets={insets} controller={extendedController} />;
}
