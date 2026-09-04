import React, { useMemo } from 'react';
import { CommonActions, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { ChevronRight, Shield } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { useAppContext } from '../../contexts/AppContext';
import { useProPaywall } from '../../contexts/ProPaywallContext';
import { ScreenHeader, SettingsIcon, ThemedSwitch } from '../../components/ui';
import { useAppTheme, AppTheme } from '../../theme';
import {
  FontSize,
  FontWeight,
  Radius,
  Space,
  createSurfaceStyle,
} from '../../theme/tokens';
import type { ConsoleStackParamList } from '../ConsoleScreen/ConsoleTab';
import { useGatewayToolSettings } from './hooks/useGatewayToolSettings';

type Colors = AppTheme['colors'];

export function openOpenClawPermissions(navigation: {
  getState?: () => { routeNames?: string[] } | undefined;
  getParent?: () => any;
  dispatch: (...args: any[]) => void;
}): void {
  let current: any = navigation;
  while (current) {
    const state = current.getState?.();
    if (state?.routeNames?.includes('OpenClawPermissions')) {
      current.dispatch(CommonActions.navigate({ name: 'OpenClawPermissions' }));
      return;
    }
    current = current.getParent?.();
  }
}

/**
 * Standalone scrollable content for tool settings.
 * Used both by GatewayToolsRouteScreen (standalone page)
 * and ToolsScreen (embedded in a tab).
 */
export function ToolSettingsContent({
  colors,
  scheme,
  toolSettings,
  hasActiveGateway,
  onOpenPermissions,
}: {
  colors: Colors;
  scheme: AppTheme['scheme'];
  toolSettings: ReturnType<typeof useGatewayToolSettings>;
  hasActiveGateway: boolean;
  onOpenPermissions: () => void;
}): React.JSX.Element {
  const { t } = useTranslation('console');
  const styles = useMemo(() => createStyles(colors, scheme), [colors, scheme]);
  const disabled = !hasActiveGateway || toolSettings.loadingToolSettings;

  return (
    <ScrollView
      contentContainerStyle={[styles.container, { paddingBottom: Space.xxxl }]}
    >
      {/* Web */}
      <View style={styles.card}>
        <View style={[styles.row, styles.toggleRow]}>
          <View style={styles.toggleLabels}>
            <Text style={styles.rowLabel}>{t('Web Search')}</Text>
            <Text style={styles.rowMeta}>{t('Search the internet for information')}</Text>
          </View>
          <ThemedSwitch
            value={toolSettings.webSearchEnabled}
            onValueChange={toolSettings.setWebSearchEnabled}
            disabled={disabled}
          />
        </View>
        <View style={styles.divider} />
        <View style={[styles.row, styles.toggleRow]}>
          <View style={styles.toggleLabels}>
            <Text style={styles.rowLabel}>{t('Web Fetch')}</Text>
            <Text style={styles.rowMeta}>{t('Read content from a specific URL')}</Text>
          </View>
          <ThemedSwitch
            value={toolSettings.webFetchEnabled}
            onValueChange={toolSettings.setWebFetchEnabled}
            disabled={disabled}
          />
        </View>
      </View>

      {/* Media Understanding */}
      <View style={[styles.card, styles.cardGap]}>
        <View style={[styles.row, styles.toggleRow]}>
          <View style={styles.toggleLabels}>
            <Text style={styles.rowLabel}>{t('Images')}</Text>
            <Text style={styles.rowMeta}>{t('Understand image content')}</Text>
          </View>
          <ThemedSwitch
            value={toolSettings.mediaImageEnabled}
            onValueChange={toolSettings.setMediaImageEnabled}
            disabled={disabled}
          />
        </View>
        <View style={styles.divider} />
        <View style={[styles.row, styles.toggleRow]}>
          <View style={styles.toggleLabels}>
            <Text style={styles.rowLabel}>{t('Audio')}</Text>
            <Text style={styles.rowMeta}>{t('Understand audio content')}</Text>
          </View>
          <ThemedSwitch
            value={toolSettings.mediaAudioEnabled}
            onValueChange={toolSettings.setMediaAudioEnabled}
            disabled={disabled}
          />
        </View>
        <View style={styles.divider} />
        <View style={[styles.row, styles.toggleRow]}>
          <View style={styles.toggleLabels}>
            <Text style={styles.rowLabel}>{t('Video')}</Text>
            <Text style={styles.rowMeta}>{t('Understand video content')}</Text>
          </View>
          <ThemedSwitch
            value={toolSettings.mediaVideoEnabled}
            onValueChange={toolSettings.setMediaVideoEnabled}
            disabled={disabled}
          />
        </View>
      </View>

      <Pressable
        onPress={onOpenPermissions}
        style={({ pressed }) => [
          styles.rowCard,
          styles.cardGap,
          pressed && styles.rowPressed,
        ]}
      >
        <View style={styles.rowLead}>
          <SettingsIcon icon={Shield} tone="info" />
          <View style={styles.rowText}>
            <Text style={styles.rowTitle}>{t('OpenClaw Permission Management')}</Text>
            <Text style={styles.rowSubtitle}>{t('View and adjust common OpenClaw permissions')}</Text>
          </View>
        </View>
        <ChevronRight size={16} color={colors.textSubtle} strokeWidth={2} />
      </Pressable>

      {toolSettings.toolSettingsError ? (
        <Text style={styles.errorText}>{toolSettings.toolSettingsError}</Text>
      ) : null}
    </ScrollView>
  );
}

export function GatewayToolsRouteScreen(): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation('console');
  const { theme } = useAppTheme();
  const { gateway, gatewayEpoch, config: initialConfig } = useAppContext();
  const { requirePro } = useProPaywall();
  const navigation =
    useNavigation<NativeStackNavigationProp<ConsoleStackParamList>>();

  const hasActiveGateway = Boolean(initialConfig?.url);
  const toolSettings = useGatewayToolSettings({
    gateway,
    gatewayEpoch,
    hasActiveGateway,
  });

  const handleOpenPermissions = React.useCallback(() => {
    if (!requirePro('openclawPermissions')) return;
    openOpenClawPermissions(navigation);
  }, [navigation, requirePro]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <ScreenHeader title={t('Tools')} topInset={insets.top} onBack={() => navigation.goBack()} />
      <ToolSettingsContent
        colors={theme.colors}
        scheme={theme.scheme}
        toolSettings={toolSettings}
        hasActiveGateway={hasActiveGateway}
        onOpenPermissions={handleOpenPermissions}
      />
    </View>
  );
}

function createStyles(colors: Colors, scheme: AppTheme['scheme']) {
  return StyleSheet.create({
    container: {
      paddingHorizontal: Space.lg,
      paddingTop: Space.lg,
      backgroundColor: colors.background,
    },
    card: {
      borderRadius: Radius.md,
      overflow: 'hidden',
      ...createSurfaceStyle(colors, scheme, 'flat'),
    },
    cardGap: {
      marginTop: Space.md,
    },
    rowCard: {
      borderRadius: Radius.md,
      overflow: 'hidden',
      ...createSurfaceStyle(colors, scheme, 'flat'),
      paddingHorizontal: Space.lg,
      paddingVertical: 16,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    rowPressed: {
      opacity: 0.82,
    },
    divider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.borderStrong,
      marginLeft: Space.lg,
    },
    row: {
      paddingHorizontal: Space.lg,
      paddingVertical: 13,
    },
    rowLead: {
      flexDirection: 'row',
      alignItems: 'center',
      flex: 1,
      marginRight: Space.md,
      gap: Space.md,
    },
    rowText: {
      flex: 1,
    },
    rowTitle: {
      color: colors.text,
      fontSize: FontSize.base,
      fontWeight: FontWeight.medium,
    },
    rowSubtitle: {
      color: colors.textSubtle,
      fontSize: FontSize.sm,
      marginTop: 3,
    },
    toggleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    toggleLabels: {
      flex: 1,
      marginRight: Space.md,
    },
    rowLabel: {
      color: colors.text,
      fontSize: FontSize.base,
      fontWeight: FontWeight.medium,
    },
    rowMeta: {
      color: colors.textSubtle,
      fontSize: FontSize.sm,
      marginTop: 3,
    },
    errorText: {
      color: colors.error,
      fontSize: FontSize.sm,
      marginTop: Space.md,
    },
  });
}
