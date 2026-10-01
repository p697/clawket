import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { CameraView, BarcodeScanningResult } from 'expo-camera';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '../../theme';
import { BorderWidth, ControlSize, FontSize, FontWeight, LineHeight, Motion, PresentationColor, Radius, Space } from '../../theme/tokens';
import { parseQRPayload, QRScanResult } from './qrPayload';
import { isBarcodeInsideScanFrame, type QrScanFrame } from './qr-scan-frame';

type Props = {
  onScanned: (result: QRScanResult) => void;
  onCancel: () => void;
};

export function QRScannerScreen({ onScanned, onCancel }: Props): React.JSX.Element {
  const { theme: { colors } } = useAppTheme();
  const { t } = useTranslation('config');
  const [scanned, setScanned] = useState(false);
  const lastScanRef = useRef<string>('');
  const scanAcceptedRef = useRef(false);
  const scanRetiredRef = useRef(false);
  const cameraContainerRef = useRef<View>(null);
  const scanAreaRef = useRef<View>(null);
  const scanFrameRef = useRef<QrScanFrame | null>(null);
  const measurementGenerationRef = useRef(0);

  const measureScanArea = useCallback(() => {
    if (scanRetiredRef.current) return;
    const generation = ++measurementGenerationRef.current;
    scanFrameRef.current = null;
    const container = cameraContainerRef.current;
    if (!container) return;
    scanAreaRef.current?.measureLayout(container, (x, y, width, height) => {
      if (generation !== measurementGenerationRef.current) return;
      scanFrameRef.current = { x, y, width, height };
    }, () => { /* Unmeasured geometry cannot select a QR. */ });
  }, []);

  useLayoutEffect(() => {
    scanRetiredRef.current = false;
    return () => {
      scanRetiredRef.current = true;
      ++measurementGenerationRef.current;
      scanFrameRef.current = null;
    };
  }, []);

  const cancelScan = useCallback(() => {
    scanRetiredRef.current = true;
    ++measurementGenerationRef.current;
    scanFrameRef.current = null;
    scanAcceptedRef.current = true;
    onCancel();
  }, [onCancel]);

  const handleBarCodeScanned = useCallback(
    (result: BarcodeScanningResult) => {
      if (scanned || scanAcceptedRef.current || scanRetiredRef.current) return;
      // Do this before parsing/deduplication: a QR moving into the frame must
      // remain eligible, and an unrelated off-frame QR must not end the scan.
      if (!isBarcodeInsideScanFrame(result, scanFrameRef.current)) return;
      if (result.data === lastScanRef.current) return;
      lastScanRef.current = result.data;

      const parsed = parseQRPayload(result.data);
      scanAcceptedRef.current = true;
      if (parsed) {
        setScanned(true);
        onScanned(parsed);
      } else {
        Alert.alert(
          t('Invalid QR Code'),
          t('This QR code does not contain valid connection info.'),
          [{ text: t('Try Again', { ns: 'common' }), onPress: () => {
            if (scanRetiredRef.current) return;
            lastScanRef.current = '';
            scanAcceptedRef.current = false;
          } }],
        );
      }
    },
    [onScanned, scanned, t],
  );

  return (
    <View ref={cameraContainerRef} collapsable={false} onLayout={measureScanArea} style={[styles.container, { backgroundColor: PresentationColor.cameraBackground }]}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
      />

      {/* Overlay with cutout */}
      <View style={styles.overlay}>
        <View style={styles.overlayTop} />
        <View onLayout={measureScanArea} style={styles.overlayMiddle}>
          <View style={styles.overlaySide} />
          <View ref={scanAreaRef} collapsable={false} onLayout={measureScanArea} style={styles.scanArea}>
            {/* Corner markers */}
            <View style={[styles.corner, styles.cornerTL, { borderColor: colors.accent }]} />
            <View style={[styles.corner, styles.cornerTR, { borderColor: colors.accent }]} />
            <View style={[styles.corner, styles.cornerBL, { borderColor: colors.accent }]} />
            <View style={[styles.corner, styles.cornerBR, { borderColor: colors.accent }]} />
          </View>
          <View style={styles.overlaySide} />
        </View>
        <View style={styles.overlayBottom}>
          <Text style={styles.hint}>{t('Scan the pairing QR code')}</Text>
          {/* A filled media capsule, like the viewer's image actions: buttons carry no outline (owner decision 2026-09-30). */}
          <Pressable testID="qr-scanner-cancel" accessibilityRole="button" onPress={cancelScan} style={({ pressed }) => [styles.cancelButton, pressed ? styles.cancelPressed : null]}>
            <Text style={styles.cancelText}>{t('Cancel', { ns: 'common' })}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const SCAN_SIZE = 250;

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  cancelButton: {
    minHeight: ControlSize.floatingButton,
    marginTop: Space.lg,
    paddingHorizontal: Space.xl,
    borderRadius: Radius.full,
    justifyContent: 'center',
    backgroundColor: PresentationColor.mediaControl,
  },
  cancelPressed: { opacity: Motion.pressedOpacity },
  cancelText: { color: PresentationColor.onMedia, fontSize: FontSize.secondary, lineHeight: LineHeight.secondary, fontWeight: FontWeight.semibold },
  overlay: { ...StyleSheet.absoluteFill },
  overlayTop: { flex: 1, backgroundColor: PresentationColor.mediaOverlayStrong },
  overlayMiddle: { flexDirection: 'row', height: SCAN_SIZE },
  overlaySide: { flex: 1, backgroundColor: PresentationColor.mediaOverlayStrong },
  scanArea: { width: SCAN_SIZE, height: SCAN_SIZE },
  overlayBottom: { flex: 1, backgroundColor: PresentationColor.mediaOverlayStrong, alignItems: 'center', paddingTop: Space.xl },
  hint: { color: PresentationColor.onMedia, fontSize: FontSize.caption, fontWeight: FontWeight.semibold },
  corner: { position: 'absolute', width: 24, height: 24, borderWidth: BorderWidth.emphasis },
  cornerTL: { top: 0, left: 0, borderRightWidth: 0, borderBottomWidth: 0 },
  cornerTR: { top: 0, right: 0, borderLeftWidth: 0, borderBottomWidth: 0 },
  cornerBL: { bottom: 0, left: 0, borderRightWidth: 0, borderTopWidth: 0 },
  cornerBR: { bottom: 0, right: 0, borderLeftWidth: 0, borderTopWidth: 0 },
});
