import React, { useCallback, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { CameraView, BarcodeScanningResult, Camera } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
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
  const [torchEnabled, setTorchEnabled] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const lastScanRef = useRef<string>('');
  const scanAcceptedRef = useRef(false);

  const handleParsed = useCallback((result: QRScanResult, source: 'camera' | 'import' | 'paste') => {
    scanAcceptedRef.current = true;
    setScanned(true);
    setIsProcessing(false);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onScanned(result);
  }, [onScanned]);

  const handleInvalid = useCallback((raw: string, source: string) => {
    setIsProcessing(false);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    const truncated = raw.length > 200 ? `${raw.slice(0, 200)}…` : raw;
    Alert.alert(
      t('Invalid QR Code'),
      t('This QR code does not contain valid connection info.'),
      [
        { text: t('Copy Raw', { ns: 'common' }), onPress: () => Clipboard.setStringAsync(raw) },
        { text: t('Try Again', { ns: 'common' }), onPress: () => { lastScanRef.current = ''; scanAcceptedRef.current = false; } },
      ],
    );
  }, [t]);

  const handleBarCodeScanned = useCallback(
    (result: BarcodeScanningResult) => {
      if (scanned || scanAcceptedRef.current || isProcessing) return;
      if (result.data === lastScanRef.current) return;
      lastScanRef.current = result.data;
      setIsProcessing(true);

      const parsed = parseQRPayload(result.data);
      if (parsed) {
        handleParsed(parsed, 'camera');
      } else {
        handleInvalid(result.data, 'camera');
      }
    },
    [scanned, isProcessing, handleParsed, handleInvalid],
  );

  const handleImportFromPhotos = useCallback(async () => {
    try {
      const pickerResult = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        quality: 1,
      });
      if (pickerResult.canceled || !pickerResult.assets?.[0]?.uri) return;
      setIsProcessing(true);
      const barcodes = await Camera.scanFromURLAsync(pickerResult.assets[0].uri, ['qr']);
      if (barcodes.length === 0) {
        setIsProcessing(false);
        Alert.alert(t('No QR Code Found', { ns: 'config' }), t('The selected image does not contain a recognizable QR code.', { ns: 'config' }));
        return;
      }
      const raw = barcodes[0].data;
      const parsed = parseQRPayload(raw);
      if (parsed) {
        handleParsed(parsed, 'import');
      } else {
        handleInvalid(raw, 'import');
      }
    } catch {
      setIsProcessing(false);
      Alert.alert(t('Scan Failed', { ns: 'config' }), t('Could not decode the QR code from this image.', { ns: 'config' }));
    }
  }, [handleParsed, handleInvalid, t]);

  const handlePaste = useCallback(async () => {
    try {
      const raw = await Clipboard.getStringAsync();
      if (!raw.trim()) return;
      setIsProcessing(true);
      const parsed = parseQRPayload(raw.trim());
      if (parsed) {
        handleParsed(parsed, 'paste');
      } else {
        handleInvalid(raw.trim(), 'paste');
      }
    } catch {
      setIsProcessing(false);
      Alert.alert(t('Paste Failed', { ns: 'config' }), t('Could not read a pairing code from the clipboard.', { ns: 'config' }));
    }
  }, [handleParsed, handleInvalid, t]);

  const toggleTorch = useCallback(() => {
    setTorchEnabled((prev) => !prev);
  }, []);

  return (
    <View style={[styles.container, { backgroundColor: '#000' }]}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={scanned || isProcessing ? undefined : handleBarCodeScanned}
        enableTorch={torchEnabled}
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
            {isProcessing && (
              <View style={styles.processingBadge}>
                <Text style={styles.processingText}>{t('Processing...', { ns: 'common' })}</Text>
              </View>
            )}
          </View>
          <View style={styles.overlaySide} />
        </View>
        <View style={styles.overlayBottom}>
          <Text style={styles.hint}>{t('Scan the pairing QR code')}</Text>

          <View style={styles.actions}>
            <Pressable onPress={handleImportFromPhotos} style={[styles.actionButton, { borderColor: 'rgba(255,255,255,0.3)' }]}>
              <Text style={[styles.actionText, { color: '#fff' }]}>{t('Choose from Photos', { ns: 'common' })}</Text>
            </Pressable>
            <Pressable onPress={handlePaste} style={[styles.actionButton, { borderColor: 'rgba(255,255,255,0.3)' }]}>
              <Text style={[styles.actionText, { color: '#fff' }]}>{t('Paste Code', { ns: 'common' })}</Text>
            </Pressable>
            <Pressable onPress={toggleTorch} style={[styles.actionButton, { borderColor: 'rgba(255,255,255,0.3)' }]}>
              <Text style={[styles.actionText, { color: '#fff' }]}>{torchEnabled ? t('Torch Off', { ns: 'common' }) : t('Torch On', { ns: 'common' })}</Text>
            </Pressable>
          </View>

          <Pressable onPress={onCancel} style={[styles.cancelButton, { borderColor: 'rgba(255,255,255,0.3)', marginTop: Space.lg }]}>
            <Text style={[styles.cancelText, { color: '#fff' }]}>{t('Cancel', { ns: 'common' })}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const SCAN_SIZE = 280;

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  cancelButton: { borderRadius: Radius.md, borderWidth: 1, paddingHorizontal: Space.xl, paddingVertical: Space.sm },
  cancelText: { fontSize: FontSize.md },
  overlay: { ...StyleSheet.absoluteFillObject },
  overlayTop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' },
  overlayMiddle: { flexDirection: 'row', height: SCAN_SIZE },
  overlaySide: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' },
  scanArea: { width: SCAN_SIZE, height: SCAN_SIZE, justifyContent: 'center', alignItems: 'center' },
  overlayBottom: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', paddingTop: Space.xl, paddingHorizontal: Space.lg },
  hint: { color: '#fff', fontSize: FontSize.md, fontWeight: FontWeight.semibold, textAlign: 'center' },
  corner: { position: 'absolute', width: 24, height: 24, borderWidth: 3 },
  cornerTL: { top: 0, left: 0, borderRightWidth: 0, borderBottomWidth: 0 },
  cornerTR: { top: 0, right: 0, borderLeftWidth: 0, borderBottomWidth: 0 },
  cornerBL: { bottom: 0, left: 0, borderRightWidth: 0, borderTopWidth: 0 },
  cornerBR: { bottom: 0, right: 0, borderLeftWidth: 0, borderTopWidth: 0 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: Space.sm, marginTop: Space.lg },
  actionButton: { borderRadius: Radius.md, borderWidth: 1, paddingHorizontal: Space.md, paddingVertical: Space.sm, margin: Space.xs },
  actionText: { fontSize: FontSize.sm },
  processingBadge: { backgroundColor: 'rgba(0,0,0,0.7)', borderRadius: Radius.md, paddingHorizontal: Space.md, paddingVertical: Space.sm },
  processingText: { color: '#fff', fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
});
