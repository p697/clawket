import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { Alert, I18nManager, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { CameraView, BarcodeScanningResult } from 'expo-camera';
import { useSafeAreaFrame, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { BorderWidth, ControlSize, FontSize, FontWeight, LineHeight, Motion, PresentationColor, Radius, Space } from '../../theme/tokens';
import { parseQRPayload, QRScanResult } from './qrPayload';
import { isBarcodeInsideScanFrame, type QrScanFrame } from './qr-scan-frame';
import { ScannerReservedRegions, hasScannerReservedRegions } from './ScannerReservedRegions';
import { availableScannerRect, type ScannerRegionsSnapshot } from './scanner-available-rect';

type Props = {
  onScanned: (result: QRScanResult) => void;
  onCancel: () => void;
  /** Reads the QR from a saved image instead; the scanner stops before handing over. */
  onChoosePhoto?: () => void;
};

export function QRScannerScreen({ onScanned, onCancel, onChoosePhoto }: Props): React.JSX.Element {
  const { t } = useTranslation('config');
  const frame = useSafeAreaFrame();
  const insets = useSafeAreaInsets();
  const [reservedRegions, setReservedRegions] = useState<ScannerRegionsSnapshot | null>(null);
  const [controlsHeight, setControlsHeight] = useState(0);
  const regionsReady = !hasScannerReservedRegions || (reservedRegions !== null &&
    Math.abs(reservedRegions.width - frame.width) < 1 && Math.abs(reservedRegions.height - frame.height) < 1);
  const activeRegions = regionsReady ? reservedRegions?.regions ?? [] : [];
  const available = availableScannerRect({ x: insets.left, y: insets.top,
    width: Math.max(0, frame.width - insets.left - insets.right),
    height: Math.max(0, frame.height - insets.top - insets.bottom) }, activeRegions);
  const contentEdges = { top: available.y, left: available.x,
    bottom: frame.height - available.y - available.height, right: frame.width - available.x - available.width };
  const safeWidth = available.width;
  const safeHeight = available.height;
  const gap = Math.min(Space.xl, Math.max(0, (safeHeight - ControlSize.floatingButton) / 2));
  const scanSize = Math.max(0, Math.min(SCAN_SIZE, safeWidth - Space.xl * 2, safeHeight - controlsHeight - gap * 2));
  const physicalLeft = contentEdges.left + (safeWidth - scanSize) / 2;
  const physicalRight = frame.width - physicalLeft - scanSize;
  const controlsRegionHeight = Math.min(
    Math.max(controlsHeight + gap + contentEdges.bottom, (safeHeight - scanSize) / 2 + contentEdges.bottom),
    Math.max(0, frame.height - contentEdges.top - gap - scanSize),
  );
  const controlsWidthRef = useRef(safeWidth);
  controlsWidthRef.current = safeWidth;
  const expectedScanRef = useRef<QrScanFrame | null>(null);
  expectedScanRef.current = regionsReady && scanSize > 0 ? {
    x: physicalLeft, y: frame.height - scanSize - controlsRegionHeight, width: scanSize, height: scanSize,
  } : null;
  const [scanned, setScanned] = useState(false);
  const lastScanRef = useRef<string>('');
  const scanAcceptedRef = useRef(false);
  const scanRetiredRef = useRef(false);
  const cameraContainerRef = useRef<View>(null);
  const scanAreaRef = useRef<View>(null);
  const scanFrameRef = useRef<QrScanFrame | null>(null);
  const measurementGenerationRef = useRef(0);
  const geometryKey = `${frame.width}:${frame.height}:${insets.top}:${insets.bottom}:${insets.left}:${insets.right}:${controlsHeight}:${regionsReady}:${JSON.stringify(activeRegions)}`;
  const geometryKeyRef = useRef(geometryKey);
  if (geometryKeyRef.current !== geometryKey) {
    geometryKeyRef.current = geometryKey;
    ++measurementGenerationRef.current;
    scanFrameRef.current = null;
  }

  const measureScanArea = useCallback(() => {
    if (scanRetiredRef.current) return;
    const generation = ++measurementGenerationRef.current;
    scanFrameRef.current = null;
    const container = cameraContainerRef.current;
    if (!container) return;
    scanAreaRef.current?.measureLayout(container, (x, y, width, height) => {
      if (generation !== measurementGenerationRef.current) return;
      const expected = expectedScanRef.current;
      if (!expected || Math.abs(x - expected.x) >= 1 || Math.abs(y - expected.y) >= 1 ||
          Math.abs(width - expected.width) >= 1 || Math.abs(height - expected.height) >= 1) return;
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

  useLayoutEffect(() => { measureScanArea(); }, [geometryKey, measureScanArea]);

  const retireScan = useCallback(() => {
    scanRetiredRef.current = true;
    ++measurementGenerationRef.current;
    scanFrameRef.current = null;
    scanAcceptedRef.current = true;
  }, []);

  const cancelScan = useCallback(() => {
    retireScan();
    onCancel();
  }, [onCancel, retireScan]);

  // One handover per scanner: a second tap or a QR already delivered must not open the library again.
  const choosePhoto = useCallback(() => {
    if (!onChoosePhoto || scanned || scanRetiredRef.current) return;
    retireScan();
    onChoosePhoto();
  }, [onChoosePhoto, retireScan, scanned]);

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
      <ScannerReservedRegions onRegionsChange={(event) => setReservedRegions(event.nativeEvent)} />

      {/* Overlay with cutout */}
      <View style={styles.overlay}>
        <View style={[styles.overlayTop, { minHeight: contentEdges.top + gap }]} />
        <View testID="qr-scanner-mask-row" onLayout={measureScanArea} style={[styles.overlayMiddle, { height: scanSize }]}>
          <View testID="qr-scanner-left-mask" style={[styles.overlaySide, { width: physicalLeft }]} />
          <View testID="qr-scanner-frame" ref={scanAreaRef} collapsable={false} onLayout={measureScanArea} style={{ width: scanSize, height: scanSize, overflow: 'hidden' }}>
            {/* Corner markers */}
            <View style={[styles.corner, styles.cornerTL, { borderColor: PresentationColor.onMedia }]} />
            <View style={[styles.corner, styles.cornerTR, { borderColor: PresentationColor.onMedia }]} />
            <View style={[styles.corner, styles.cornerBL, { borderColor: PresentationColor.onMedia }]} />
            <View style={[styles.corner, styles.cornerBR, { borderColor: PresentationColor.onMedia }]} />
          </View>
          <View testID="qr-scanner-right-mask" style={[styles.overlaySide, { width: physicalRight }]} />
        </View>
        <View testID="qr-scanner-controls-region" style={[styles.overlayBottom, {
          height: controlsRegionHeight,
          paddingTop: gap,
          paddingBottom: contentEdges.bottom,
          paddingStart: I18nManager.isRTL ? contentEdges.right : contentEdges.left,
          paddingEnd: I18nManager.isRTL ? contentEdges.left : contentEdges.right,
        }]}>
          <ScrollView testID="qr-scanner-controls-scroll" bounces={false} contentInsetAdjustmentBehavior="never" style={styles.controlsScroll} contentContainerStyle={styles.controlsScrollContent}>
          <View testID="qr-scanner-controls" style={styles.controls} onLayout={(event) => {
            const { width, height } = event.nativeEvent.layout;
            if (Math.abs(width - controlsWidthRef.current) < 1 && Number.isFinite(height) && height > 0) setControlsHeight(height);
          }}>
          <Text style={styles.hint}>{t('Scan the pairing QR code')}</Text>
          {/* Filled media capsules, like the viewer's image actions: buttons carry no outline (owner decision 2026-09-30).
              Photos lives here rather than on each pairing page (owner decision 2026-10-06), as in other scanners. */}
          <View style={styles.actions}>
            {onChoosePhoto ? <Pressable testID="qr-scanner-photos" accessibilityRole="button" onPress={choosePhoto} style={({ pressed }) => [styles.capsule, pressed ? styles.capsulePressed : null]}>
              <Text style={styles.capsuleText}>{t('Choose from photos')}</Text>
            </Pressable> : null}
            <Pressable testID="qr-scanner-cancel" accessibilityRole="button" onPress={cancelScan} style={({ pressed }) => [styles.capsule, pressed ? styles.capsulePressed : null]}>
              <Text style={styles.capsuleText}>{t('Cancel', { ns: 'common' })}</Text>
            </Pressable>
          </View>
          </View>
          </ScrollView>
        </View>
      </View>
    </View>
  );
}

const SCAN_SIZE = 250;

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: Space.md, marginTop: Space.lg, paddingHorizontal: Space.xl },
  capsule: {
    minHeight: ControlSize.floatingButton,
    maxWidth: '100%',
    paddingHorizontal: Space.xl,
    borderRadius: Radius.full,
    justifyContent: 'center',
    backgroundColor: PresentationColor.mediaControl,
  },
  capsulePressed: { opacity: Motion.pressedOpacity },
  capsuleText: { color: PresentationColor.onMedia, fontSize: FontSize.secondary, lineHeight: LineHeight.secondary, fontWeight: FontWeight.semibold },
  overlay: { ...StyleSheet.absoluteFill },
  overlayTop: { flex: 1, backgroundColor: PresentationColor.mediaOverlayStrong },
  overlayMiddle: { flexDirection: 'row', direction: 'ltr' },
  overlaySide: { backgroundColor: PresentationColor.mediaOverlayStrong },
  overlayBottom: { flexShrink: 1, minHeight: 0, backgroundColor: PresentationColor.mediaOverlayStrong },
  controlsScroll: { flexShrink: 1, minHeight: 0 },
  controlsScrollContent: { flexGrow: 1 },
  controls: { alignItems: 'center', flexShrink: 0 },
  hint: { textAlign: 'center', marginHorizontal: Space.xl, color: PresentationColor.onMedia, fontSize: FontSize.caption, fontWeight: FontWeight.semibold },
  corner: { position: 'absolute', width: 24, height: 24, borderWidth: BorderWidth.emphasis },
  cornerTL: { top: 0, left: 0, borderRightWidth: 0, borderBottomWidth: 0 },
  cornerTR: { top: 0, right: 0, borderLeftWidth: 0, borderBottomWidth: 0 },
  cornerBL: { bottom: 0, left: 0, borderRightWidth: 0, borderTopWidth: 0 },
  cornerBR: { bottom: 0, right: 0, borderLeftWidth: 0, borderTopWidth: 0 },
});
