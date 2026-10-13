import React from 'react';
import { Platform, StyleSheet, type NativeSyntheticEvent, type ViewProps } from 'react-native';
import { requireNativeViewManager, requireOptionalNativeModule } from 'expo-modules-core';
import type { ScannerRegionsSnapshot } from './scanner-available-rect';

type Props = ViewProps & { onRegionsChange: (event: NativeSyntheticEvent<ScannerRegionsSnapshot>) => void };
// Old development clients and non-iOS builds keep the existing safe-area path.
const NativeObserver = Platform.OS === 'ios' && requireOptionalNativeModule('ClawketReservedRegions')
  ? requireNativeViewManager<Props>('ClawketReservedRegions') : null;
export const hasScannerReservedRegions = NativeObserver !== null;

export function ScannerReservedRegions(props: Props): React.JSX.Element | null {
  return NativeObserver ? <NativeObserver {...props} style={StyleSheet.absoluteFill}
    pointerEvents="none" accessible={false} accessibilityElementsHidden testID="qr-scanner-reserved-regions" /> : null;
}
