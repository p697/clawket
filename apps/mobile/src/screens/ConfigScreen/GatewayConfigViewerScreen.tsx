import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RefreshCw } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { JsonTree } from '../../components/chat/JsonTree';
import { EmptyState, HeaderActionButton, LoadingState, createCardContentStyle } from '../../components/ui';
import { useAppContext } from '../../contexts/AppContext';
import { useNativeStackModalHeader } from '../../hooks/useNativeStackModalHeader';
import { analyticsEvents } from '../../services/analytics/events';
import { useAppTheme } from '../../theme';
import { FontSize, FontWeight, Radius, Space } from '../../theme/tokens';
import type { ConfigStackParamList } from './ConfigTab';

type Navigation = NativeStackNavigationProp<ConfigStackParamList, 'GatewayConfigViewer'>;

export function GatewayConfigViewerScreen(): React.JSX.Element {
  const navigation = useNavigation<Navigation>();
  const { t } = useTranslation(['config', 'common']);
  const { theme } = useAppTheme();
  const { gateway, config: activeGatewayConfig, gatewayEpoch } = useAppContext();
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);
  const [loading, setLoading] = useState(true);
  const [configText, setConfigText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadConfig = useCallback(async () => {
    if (!activeGatewayConfig?.url) {
      setConfigText(null);
      setError(t('Please add and activate a gateway connection first.'));
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const result = await gateway.getConfig();
      if (!result.config) {
        setConfigText(null);
        setError(t('No config returned from Gateway.'));
      } else {
        setConfigText(JSON.stringify(result.config, null, 2));
        setError(null);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('Unable to load config');
      setConfigText(null);
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [activeGatewayConfig?.url, gateway, t]);

  useEffect(() => {
    analyticsEvents.gatewayConfigViewOpened({ source: 'config_screen' });
  }, []);

  useEffect(() => {
    void loadConfig();
  }, [gatewayEpoch, loadConfig]);

  const handleRefresh = useCallback(() => {
    void loadConfig();
  }, [loadConfig]);

  useNativeStackModalHeader({
    navigation,
    title: t('View Config'),
    onClose: () => navigation.goBack(),
    rightContent: (
      <HeaderActionButton
        icon={RefreshCw}
        onPress={handleRefresh}
        size={20}
      />
    ),
  });

  if (loading) {
    return <LoadingState message={t('Loading config...')} />;
  }

  if (!configText) {
    return (
      <View style={styles.emptyWrap}>
        <EmptyState
          icon="{}"
          title={t('View Config')}
          subtitle={error ?? t('No config returned from Gateway.')}
        />
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={createCardContentStyle()}>
      <View style={styles.headerBlock}>
        <Text style={styles.title}>{t('Current OpenClaw config')}</Text>
        <Text style={styles.subtitle}>
          {t('This page shows the current read-only JSON snapshot returned by Gateway.')}
        </Text>
      </View>
      <View style={styles.jsonCard}>
        <JsonTree text={configText} />
      </View>
    </ScrollView>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    emptyWrap: {
      flex: 1,
      backgroundColor: colors.background,
    },
    headerBlock: {
      marginBottom: Space.md,
      gap: Space.xs,
    },
    title: {
      fontSize: FontSize.base,
      fontWeight: FontWeight.semibold,
      color: colors.text,
    },
    subtitle: {
      fontSize: FontSize.md,
      color: colors.textMuted,
      lineHeight: 20,
    },
    jsonCard: {
      borderRadius: Radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      paddingHorizontal: Space.md,
      paddingVertical: Space.sm,
    },
  });
}
