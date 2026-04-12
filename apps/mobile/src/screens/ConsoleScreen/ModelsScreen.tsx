import React, { useMemo } from 'react';
import { RefreshCw } from 'lucide-react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { HeaderActionButton } from '../../components/ui';
import { HermesModelSelectionView } from '../../components/console/HermesModelSelectionView';
import { ModelsView } from '../../components/console/ModelsView';
import { useAppContext } from '../../contexts/AppContext';
import { useNativeStackModalHeader } from '../../hooks/useNativeStackModalHeader';
import { analyticsEvents } from '../../services/analytics/events';
import { selectByBackend } from '../../services/gateway-backends';
import { useGatewayRuntimeSettings } from '../ConfigScreen/hooks/useGatewayRuntimeSettings';
import type { ConsoleStackParamList } from './ConsoleTab';

type ModelsNavigation = NativeStackNavigationProp<ConsoleStackParamList, 'ModelList'>;

export function ModelsScreen(): React.JSX.Element {
  const { gateway, gatewayEpoch, config } = useAppContext();
  const { t } = useTranslation('console');
  const navigation = useNavigation<ModelsNavigation>();
  const hasActiveGateway = Boolean(config?.url);

  const settings = useGatewayRuntimeSettings({
    gateway,
    gatewayEpoch,
    hasActiveGateway,
  });

  const modelConfig = useMemo(() => ({
    defaultModel: settings.defaultModel,
    setDefaultModel: settings.setDefaultModel,
    fallbackModels: settings.fallbackModels,
    setFallbackModels: settings.setFallbackModels,
    thinkingDefault: settings.thinkingDefault,
    setThinkingDefault: settings.setThinkingDefault,
    availableModels: settings.availableModels,
    loadingSettings: settings.loadingGatewaySettings,
    savingSettings: settings.savingGatewaySettings,
    settingsError: settings.gatewaySettingsError,
    hasActiveGateway,
    supportsRuntimeSettings: settings.supportsRuntimeSettings,
    supportsModelSelection: settings.supportsModelSelection,
    onLoadSettings: settings.loadGatewaySettings,
    onSaveSettings: async () => {
      if (!settings.supportsModelSelection) return;
      analyticsEvents.modelsSaveTapped({
        fallback_count: settings.fallbackModels.length,
        has_primary_model: Boolean(settings.defaultModel),
        has_thinking_default: Boolean(settings.thinkingDefault),
      });
      await settings.saveGatewaySettings();
    },
  }), [settings, hasActiveGateway]);

  const headerRight = useMemo(
    () => (
      <HeaderActionButton
        icon={RefreshCw}
        onPress={() => { void settings.loadGatewaySettings(); }}
        disabled={settings.loadingGatewaySettings || settings.savingGatewaySettings || !settings.supportsRuntimeSettings}
      />
    ),
    [
      settings.loadGatewaySettings,
      settings.loadingGatewaySettings,
      settings.savingGatewaySettings,
    ],
  );

  useNativeStackModalHeader({
    navigation,
    title: t('Models'),
    // The refresh button reloads gateway runtime config; only show it
    // when the backend exposes runtime settings read capability. This is
    // capability-driven rather than backend-identity-driven so future
    // backends automatically do the right thing.
    rightContent: settings.supportsRuntimeSettings ? headerRight : null,
    onClose: () => navigation.goBack(),
  });

  // Per-backend Models body. ModelsView (OpenClaw) and
  // HermesModelSelectionView take different prop shapes, so instead of an
  // inline `if (backendKind === 'hermes')` branch we dispatch through the
  // capability registry's `selectByBackend` helper, which returns the
  // React element for whichever backend is active. This keeps ModelsScreen
  // free of screen-level `backend === 'hermes'` checks — all backend
  // decisions flow through `src/services/gateway-backends.ts`.
  return selectByBackend(config, {
    openclaw: (
      <ModelsView
        gateway={gateway}
        topInset={0}
        onBack={() => navigation.goBack()}
        modelConfig={modelConfig}
        hideHeader
      />
    ),
    hermes: (
      <HermesModelSelectionView
        gateway={gateway}
        topInset={0}
        onBack={() => navigation.goBack()}
        hideHeader
      />
    ),
  });
}
