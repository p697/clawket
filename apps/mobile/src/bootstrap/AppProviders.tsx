import React, { useCallback } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AccentColorId, ThemeMode } from '../types';
import { AppThemeProvider } from '../theme';
import { AnalyticsProvider } from '../services/analytics/AnalyticsProvider';
import { AppLanguageProvider } from '../i18n/AppLanguageProvider';
import { StorageService } from '../services/storage';

type Props = {
  accentId: AccentColorId;
  children: React.ReactNode;
  mode: ThemeMode;
  onAccentChange: (nextAccentId: AccentColorId) => void;
  onModeChange: (nextMode: ThemeMode) => void;
};

export function AppProviders({
  accentId,
  children,
  mode,
  onAccentChange,
  onModeChange,
}: Props): React.JSX.Element {
  const setMode = useCallback((nextMode: ThemeMode) => {
    onModeChange(nextMode);
    void StorageService.setThemeMode(nextMode);
  }, [onModeChange]);
  const setAccentId = useCallback((nextAccentId: AccentColorId) => {
    onAccentChange(nextAccentId);
    void StorageService.setAccentColor(nextAccentId);
  }, [onAccentChange]);
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <KeyboardProvider>
        <SafeAreaProvider>
          <AnalyticsProvider>
            <AppThemeProvider
              mode={mode}
              accentId={accentId}
              setMode={setMode}
              setAccentId={setAccentId}
            >
              <AppLanguageProvider>{children}</AppLanguageProvider>
            </AppThemeProvider>
          </AnalyticsProvider>
        </SafeAreaProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}
