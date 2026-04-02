import React, { useMemo } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation, CommonActions } from '@react-navigation/native';
import { ChevronRight } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { ModalSheet, ThemedSwitch } from '../ui';
import { useAppTheme } from '../../theme';
import { useAppContext } from '../../contexts/AppContext';
import { useProPaywall } from '../../contexts/ProPaywallContext';
import { useGatewayToolSettings } from '../../screens/ConfigScreen/hooks/useGatewayToolSettings';
import { openOpenClawPermissions } from '../../screens/ConfigScreen/GatewayToolsScreen';
import { FontSize, FontWeight, Radius, Space } from '../../theme/tokens';

type Props = {
  visible: boolean;
  onClose: () => void;
};

export function WebSearchModal({ visible, onClose }: Props): React.JSX.Element {
  const { t } = useTranslation(['chat', 'config']);

  return (
    <ModalSheet visible={visible} onClose={onClose} title={t('Tools')} maxHeight="60%">
      {visible ? <WebSearchModalContent onClose={onClose} /> : null}
    </ModalSheet>
  );
}

function WebSearchModalContent({ onClose }: { onClose: () => void }): React.JSX.Element {
  const { t } = useTranslation(['chat', 'config']);
  const { theme } = useAppTheme();
  const { gateway, gatewayEpoch, config } = useAppContext();
  const { requirePro } = useProPaywall();
  const navigation = useNavigation();
  const hasActiveGateway = Boolean(config?.url);
  const toolSettings = useGatewayToolSettings({ gateway, gatewayEpoch, hasActiveGateway });
  const styles = useMemo(() => createStyles(theme.colors), [theme]);
  const { colors } = theme;
  const loading = toolSettings.loadingToolSettings;
  const disabled = !hasActiveGateway || loading;

  const handleOpenToolSettings = () => {
    onClose();
    // Navigate to ToolList on root stack (registered globally)
    // Drawer → Tab → RootStack
    const root = navigation.getParent()?.getParent();
    if (root) {
      root.dispatch(CommonActions.navigate({ name: 'ToolList' }));
    }
  };

  const handleOpenPermissions = () => {
    if (!requirePro('openclawPermissions')) return;
    onClose();
    openOpenClawPermissions(navigation);
  };

  return (
    <View style={styles.content}>
      {/* Web Tools */}
      <View style={[styles.row, styles.toggleRow]}>
        <View style={styles.labels}>
          <Text style={styles.rowLabel}>{t('Web Search')}</Text>
          <Text style={styles.rowMeta}>{t('Search the internet for information')}</Text>
        </View>
        <ThemedSwitch
          value={toolSettings.webSearchEnabled}
          onValueChange={toolSettings.setWebSearchEnabled}
          trackColor={{ false: colors.borderStrong, true: colors.primarySoft }}
          thumbColor={toolSettings.webSearchEnabled ? colors.primary : colors.surfaceMuted}
          disabled={disabled}
        />
      </View>
      <View style={styles.divider} />
      <View style={[styles.row, styles.toggleRow]}>
        <View style={styles.labels}>
          <Text style={styles.rowLabel}>{t('Web Fetch')}</Text>
          <Text style={styles.rowMeta}>{t('Read content from a specific URL')}</Text>
        </View>
        <ThemedSwitch
          value={toolSettings.webFetchEnabled}
          onValueChange={toolSettings.setWebFetchEnabled}
          trackColor={{ false: colors.borderStrong, true: colors.primarySoft }}
          thumbColor={toolSettings.webFetchEnabled ? colors.primary : colors.surfaceMuted}
          disabled={disabled}
        />
      </View>

      {/* OpenClaw permissions */}
      <View style={styles.divider} />
      <TouchableOpacity
        style={styles.moreButton}
        onPress={handleOpenPermissions}
        activeOpacity={0.7}
        disabled={disabled}
      >
        <Text style={styles.rowLabel}>{t('OpenClaw Permission Management', { ns: 'config' })}</Text>
        <ChevronRight size={16} color={colors.textMuted} strokeWidth={2} />
      </TouchableOpacity>

      {/* More Tool Settings */}
      <View style={styles.divider} />
      <TouchableOpacity
        style={styles.moreButton}
        onPress={handleOpenToolSettings}
        activeOpacity={0.7}
      >
        <Text style={styles.moreButtonText}>{t('More Tool Settings')}</Text>
        <ChevronRight size={16} color={colors.textMuted} strokeWidth={2} />
      </TouchableOpacity>

      {toolSettings.toolSettingsError ? (
        <Text style={styles.errorText}>{toolSettings.toolSettingsError}</Text>
      ) : null}

      {/* Loading overlay */}
      {loading ? (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator color={colors.textMuted} />
        </View>
      ) : null}
    </View>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    content: {
      paddingBottom: Space.md,
    },
    row: {
      paddingHorizontal: Space.lg,
      paddingVertical: 13,
    },
    toggleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    labels: {
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
    divider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.borderStrong,
      marginLeft: Space.lg,
    },
    moreButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: Space.lg,
      paddingVertical: 13,
      marginVertical: Space.sm,
    },
    moreButtonText: {
      color: colors.textMuted,
      fontSize: FontSize.base,
      fontWeight: FontWeight.medium,
    },
    errorText: {
      color: colors.error,
      fontSize: FontSize.sm,
      marginTop: Space.md,
      paddingHorizontal: Space.lg,
    },
    loadingOverlay: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: colors.background + 'AA',
      alignItems: 'center',
      justifyContent: 'center',
      paddingBottom: Space.xxxl,
      borderRadius: Radius.md,
    },
  });
}
