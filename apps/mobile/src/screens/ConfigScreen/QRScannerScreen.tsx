import React, { useCallback, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { CameraView, BarcodeScanningResult } from 'expo-camera';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '../../theme';
import { FontSize, FontWeight, Radius, Space } from '../../theme/tokens';
import { parseQRPayload, QRScanResult } from './qrPayload';

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

  const handleBarCodeScanned = useCallback(
    (result: BarcodeScanningResult) => {
      if (scanned || scanAcceptedRef.current) return;
      if (result.data === lastScanRef.current) return;
      lastScanRef.current = result.data;

      const parsed = parseQRPayload(result.data);
      if (parsed) {
        scanAcceptedRef.current = true;
        setScanned(true);
        onScanned(parsed);
      } else {
        Alert.alert(
          t('Invalid QR Code'),
          t('This QR code does not contain valid connection info.'),
          [{ text: t('Try Again', { ns: 'common' }), onPress: () => { lastScanRef.current = ''; scanAcceptedRef.current = false; } }],
        );
      }
    },
    [onScanned, scanned, t],
  );

  return (
    <View style={[styles.container, { backgroundColor: '#000' }]}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
      />

      {/* Overlay with cutout */}
      <View style={styles.overlay}>
        <View style={styles.overlayTop} />
        <View style={styles.overlayMiddle}>
          <View style={styles.overlaySide} />
          <View style={styles.scanArea}>
            {/* Corner markers */}
            <View style={[styles.corner, styles.cornerTL, { borderColor: colors.primary }]} />
            <View style={[styles.corner, styles.cornerTR, { borderColor: colors.primary }]} />
            <View style={[styles.corner, styles.cornerBL, { borderColor: colors.primary }]} />
            <View style={[styles.corner, styles.cornerBR, { borderColor: colors.primary }]} />
          </View>
          <View style={styles.overlaySide} />
        </View>
        <View style={styles.overlayBottom}>
          <Text style={styles.hint}>{t('Scan the pairing QR code')}</Text>
          <Pressable onPress={onCancel} style={[styles.cancelButton, { borderColor: 'rgba(255,255,255,0.3)', marginTop: Space.lg }]}>
            <Text style={[styles.cancelText, { color: '#fff' }]}>{t('Cancel', { ns: 'common' })}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const SCAN_SIZE = 250;

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  cancelButton: { borderRadius: Radius.md, borderWidth: 1, paddingHorizontal: Space.xl, paddingVertical: Space.sm },
  cancelText: { fontSize: FontSize.md },
  overlay: { ...StyleSheet.absoluteFillObject },
  overlayTop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' },
  overlayMiddle: { flexDirection: 'row', height: SCAN_SIZE },
  overlaySide: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' },
  scanArea: { width: SCAN_SIZE, height: SCAN_SIZE },
  overlayBottom: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', paddingTop: Space.xl },
  hint: { color: '#fff', fontSize: FontSize.md, fontWeight: FontWeight.semibold },
  corner: { position: 'absolute', width: 24, height: 24, borderWidth: 3 },
  cornerTL: { top: 0, left: 0, borderRightWidth: 0, borderBottomWidth: 0 },
  cornerTR: { top: 0, right: 0, borderLeftWidth: 0, borderBottomWidth: 0 },
  cornerBL: { bottom: 0, left: 0, borderRightWidth: 0, borderTopWidth: 0 },
  cornerBR: { bottom: 0, right: 0, borderLeftWidth: 0, borderTopWidth: 0 },
});
