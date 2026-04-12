import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  RefreshControl,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  Card,
  EmptyState,
  LoadingState,
  ScreenHeader,
  createListContentStyle,
  createListHeaderSpacing,
} from '../ui';
import { useTranslation } from 'react-i18next';
import { useAppContext } from '../../contexts/AppContext';
import { useGatewayPatch } from '../../hooks/useGatewayPatch';
import { loadGatewayChannelsBundle } from '../../services/gateway-channels';
import { GatewayClient } from '../../services/gateway';
import { useAppTheme } from '../../theme';
import { FontSize, FontWeight, Radius, Space } from '../../theme/tokens';
import type {
  ChannelStatusAccount,
  ChannelSummary,
  ChannelsStatusResult,
} from '../../types';
import { relativeTime } from '../../utils/chat-message';
import { DM_SCOPES, type DmScope, buildDmScopePatch, parseDmScope } from '../../utils/gateway-settings';

type Props = {
  gateway: GatewayClient;
  topInset: number;
  onBack: () => void;
  hideHeader?: boolean;
};

type ChannelCardData = {
  id: string;
  label: string;
  detailLabel: string;
  summary: ChannelSummary;
  accounts: ChannelStatusAccount[];
  defaultAccountId?: string;
};

const CHANNEL_ICONS: Record<string, string> = {
  telegram: '✈️',
  discord: '💬',
  slack: '💼',
  whatsapp: '🟢',
  imessage: '💭',
  signal: '🔐',
  sms: '✉️',
  matrix: '🔷',
};

type TFn = (key: string, opts?: Record<string, unknown>) => string;

function getDmScopeLabels(t: TFn): Record<DmScope, string> {
  return {
    'main': t('Global'),
    'per-peer': t('Per Sender'),
    'per-channel-peer': t('Per Channel + Sender'),
    'per-account-channel-peer': t('Per Account + Channel + Sender'),
  };
}

function getDmScopeDescriptions(t: TFn): Record<DmScope, string> {
  return {
    'main': t('All DMs share a single session'),
    'per-peer': t('Isolated by sender across channels'),
    'per-channel-peer': t('Isolated by channel + sender (recommended)'),
    'per-account-channel-peer': t('Isolated by account + channel + sender'),
  };
}

function formatAgo(timestampMs: number | null | undefined, t: TFn): string | null {
  if (!timestampMs) return null;
  const relative = relativeTime(timestampMs);
  if (!relative) return null;
  if (relative === 'now') return t('just now');
  if (relative === 'Yesterday') return t('Yesterday');
  return t('{{time}} ago', { time: relative });
}

function buildChannelCards(status: ChannelsStatusResult | null): ChannelCardData[] {
  if (!status) return [];

  const idSet = new Set<string>();
  for (const id of status.channelOrder) idSet.add(id);
  for (const id of Object.keys(status.channelLabels)) idSet.add(id);
  for (const id of Object.keys(status.channelAccounts)) idSet.add(id);

  const orderIndex = new Map<string, number>();
  status.channelOrder.forEach((id, index) => {
    orderIndex.set(id, index);
  });

  const cards = Array.from(idSet).map((id) => {
    const fallbackLabel = id.length > 0 ? `${id.charAt(0).toUpperCase()}${id.slice(1)}` : 'Channel';
    const label = status.channelLabels[id] ?? fallbackLabel;
    const detailLabel = status.channelDetailLabels[id] ?? label;
    return {
      id,
      label,
      detailLabel,
      summary: status.channels[id] ?? {},
      accounts: status.channelAccounts[id] ?? [],
      defaultAccountId: status.channelDefaultAccountId[id],
    };
  });

  cards.sort((a, b) => {
    const aOrder = orderIndex.get(a.id) ?? Number.MAX_SAFE_INTEGER;
    const bOrder = orderIndex.get(b.id) ?? Number.MAX_SAFE_INTEGER;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return a.label.localeCompare(b.label);
  });

  return cards;
}

function resolveChannelState(card: ChannelCardData, t: TFn): {
  text: string;
  tone: 'success' | 'warning' | 'muted';
} {
  const anyConnected =
    card.accounts.some((account) => account.connected === true) || card.summary.connected === true;
  const anyRunning =
    card.accounts.some((account) => account.running === true) || card.summary.running === true;
  const anyLinked = card.accounts.some((account) => account.linked === true) || card.summary.linked === true;
  const anyConfigured =
    card.accounts.some((account) => account.configured === true) || card.summary.configured === true;

  if (anyConnected) return { text: t('Connected'), tone: 'success' };
  if (anyRunning) return { text: t('Running'), tone: 'success' };
  if (anyLinked) return { text: t('Linked'), tone: 'warning' };
  if (anyConfigured) return { text: t('Configured'), tone: 'warning' };
  return { text: t('Not configured'), tone: 'muted' };
}

function formatChannelActivity(account: ChannelStatusAccount, t: TFn): string | null {
  const inbound = formatAgo(account.lastInboundAt, t);
  const outbound = formatAgo(account.lastOutboundAt, t);
  if (inbound && outbound) return t('In {{inbound}} · Out {{outbound}}', { inbound, outbound });
  if (inbound) return t('In {{time}}', { time: inbound });
  if (outbound) return t('Out {{time}}', { time: outbound });
  return null;
}

function formatAccountTitle(account: ChannelStatusAccount, defaultAccountId: string | undefined, t: TFn): string {
  const base = account.name?.trim() || account.accountId || t('default');
  if (defaultAccountId && account.accountId === defaultAccountId) {
    return t('{{name}} (default)', { name: base });
  }
  return base;
}

export function ChannelsView({
  gateway,
  topInset,
  onBack,
  hideHeader = false,
}: Props): React.JSX.Element {
  const { gatewayEpoch } = useAppContext();
  const { t } = useTranslation('console');
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors), [theme]);

  const [channelsStatus, setChannelsStatus] = useState<ChannelsStatusResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dmScope, setDmScope] = useState<DmScope>('main');
  const [configHash, setConfigHash] = useState<string | null>(null);
  const [savingDmScope, setSavingDmScope] = useState(false);
  const { patchWithRestart } = useGatewayPatch(gateway);

  const loadData = useCallback(async (mode: 'initial' | 'refresh' = 'initial') => {
    if (mode === 'initial') setLoading(true);
    if (mode === 'refresh') setRefreshing(true);

    try {
      const bundle = await loadGatewayChannelsBundle(gateway);
      setChannelsStatus(bundle.channelsStatus);
      // Preserve previous dm-scope / config-hash when `getConfig()` fails
      // transiently. Matches the pre-refactor `Promise.allSettled` behavior
      // where channels could still render even if config fetch errored.
      if (bundle.config) {
        setDmScope(bundle.config.dmScope);
        setConfigHash(bundle.config.configHash);
      }
      setError(null);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('Failed to load channels');
      setError(message);
    } finally {
      if (mode === 'initial') setLoading(false);
      if (mode === 'refresh') setRefreshing(false);
    }
  }, [gateway, gatewayEpoch, t]);

  useEffect(() => {
    loadData('initial').catch(() => {
      // Error state is handled in loadData.
    });
  }, [loadData]);

  const handleRefresh = useCallback(() => {
    loadData('refresh').catch(() => {
      // Error state is handled in loadData.
    });
  }, [loadData]);

  const handleDmScopeChange = useCallback(async (newScope: DmScope) => {
    if (newScope === dmScope) return;
    if (!configHash) {
      Alert.alert(t('Unavailable'), t('Config hash is missing. Please refresh and try again.'));
      return;
    }
    setSavingDmScope(true);
    await patchWithRestart({
      patch: buildDmScopePatch(newScope),
      configHash,
      confirmation: true,
      onSuccess: async () => {
        // After a successful config patch we must see the new config back,
        // so we fetch channels + config strictly in parallel here. Any
        // failure from getConfig() propagates as-is and the existing
        // patchWithRestart failure Alert will surface the real RPC error
        // message (not a synthesized translation).
        const [refreshed, configRefresh] = await Promise.all([
          gateway.getChannelsStatus({ probe: false }),
          gateway.getConfig(),
        ]);
        setChannelsStatus(refreshed);
        if (configRefresh.config) setDmScope(parseDmScope(configRefresh.config));
        if (configRefresh.hash) setConfigHash(configRefresh.hash);
      },
    });
    setSavingDmScope(false);
  }, [configHash, dmScope, gateway, patchWithRestart]);

  const [togglingAccounts, setTogglingAccounts] = useState<Set<string>>(new Set());

  const handleAccountToggle = useCallback(async (channelId: string, accountId: string, enabled: boolean) => {
    if (!configHash) {
      Alert.alert(t('Unavailable'), t('Config hash is missing. Please refresh and try again.'));
      return;
    }
    const key = `${channelId}:${accountId}`;
    setTogglingAccounts((prev) => new Set(prev).add(key));
    await patchWithRestart({
      patch: { channels: { [channelId]: { accounts: { [accountId]: { enabled } } } } },
      configHash,
      confirmation: true,
      savingMessage: enabled ? t('Enabling account…') : t('Disabling account…'),
      errorTitle: t('Toggle Failed'),
      onSuccess: async () => {
        const refreshed = await gateway.getChannelsStatus({ probe: false });
        setChannelsStatus(refreshed);
      },
    });
    setTogglingAccounts((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  }, [configHash, gateway, patchWithRestart]);

  const channelCards = useMemo(
    () => buildChannelCards(channelsStatus),
    [channelsStatus],
  );

  const totalChannelAccounts = useMemo(
    () => channelCards.reduce((sum, card) => sum + card.accounts.length, 0),
    [channelCards],
  );

  const connectedChannelAccounts = useMemo(
    () => channelCards.reduce(
      (sum, card) => sum + card.accounts.filter((account) => account.connected === true).length,
      0,
    ),
    [channelCards],
  );

  const renderChannelCard = useCallback(({ item }: { item: ChannelCardData }) => {
    const channelIcon = CHANNEL_ICONS[item.id] ?? '💬';
    const state = resolveChannelState(item, t);
    const stateColor = state.tone === 'success'
      ? theme.colors.success
      : state.tone === 'warning'
        ? theme.colors.warning
        : theme.colors.textSubtle;

    return (
      <Card
        style={styles.channelCard}
      >
        <View style={styles.channelHeaderRow}>
          <View style={styles.channelTitleRow}>
            <Text style={styles.channelIcon}>{channelIcon}</Text>
            <View style={styles.channelTitleWrap}>
              <Text style={styles.cardTitle}>{item.label}</Text>
              <Text style={styles.cardSubtitle}>{item.detailLabel}</Text>
            </View>
          </View>

          <View style={[styles.channelStateBadge, { borderColor: stateColor }]}>
            <Text style={[styles.channelStateText, { color: stateColor }]}>{state.text}</Text>
          </View>
        </View>

        {item.accounts.length > 0 ? (
          <View style={styles.channelAccountsWrap}>
            {item.accounts.map((account) => {
              const activityText = formatChannelActivity(account, t);
              const toggleKey = `${item.id}:${account.accountId}`;
              const isToggling = togglingAccounts.has(toggleKey);
              const isEnabled = account.enabled !== false;
              return (
                <View key={`${item.id}:${account.accountId}`} style={styles.channelAccountCard}>
                  <View style={styles.channelAccountTitleRow}>
                    <Text style={styles.channelAccountTitle}>
                      {formatAccountTitle(account, item.defaultAccountId, t)}
                    </Text>
                    <Switch
                      value={isEnabled}
                      onValueChange={(value) => { void handleAccountToggle(item.id, account.accountId, value); }}
                      disabled={isToggling}
                      trackColor={{ false: theme.colors.border, true: theme.colors.primary }}
                      thumbColor={theme.colors.surface}
                    />
                  </View>

                  {activityText ? <Text style={styles.channelActivity}>{activityText}</Text> : null}
                </View>
              );
            })}
          </View>
        ) : (
          <View style={styles.placeholderCard}>
            <Text style={styles.placeholderText}>{t('No accounts configured.')}</Text>
          </View>
        )}
      </Card>
    );
  }, [handleAccountToggle, togglingAccounts, styles.cardSubtitle, styles.cardTitle, styles.channelAccountCard, styles.channelAccountTitle, styles.channelAccountTitleRow, styles.channelAccountsWrap, styles.channelActivity, styles.channelCard, styles.channelHeaderRow, styles.channelIcon, styles.channelStateBadge, styles.channelStateText, styles.channelTitleRow, styles.channelTitleWrap, styles.placeholderCard, styles.placeholderText, theme.colors.border, theme.colors.primary, theme.colors.success, theme.colors.surface, theme.colors.textSubtle, theme.colors.warning]);

  const channelsHeader = useMemo(() => (
    <View style={styles.listHeaderWrap}>
      <View style={styles.dmScopeCard}>
        <View style={styles.dmScopeLabelRow}>
          <Text style={styles.dmScopeLabel}>{t('DM Scope Settings')}</Text>
          {savingDmScope ? <Text style={styles.dmScopeSaving}>{t('common:Saving...')}</Text> : null}
        </View>
        <View style={styles.dmScopeOptions}>
          {DM_SCOPES.map((scope) => {
            const active = scope === dmScope;
            return (
              <TouchableOpacity
                key={scope}
                style={[styles.dmScopeOption, active ? styles.dmScopeOptionActive : null]}
                activeOpacity={0.7}
                disabled={savingDmScope}
                onPress={() => { void handleDmScopeChange(scope); }}
              >
                <View style={styles.dmScopeOptionHeader}>
                  <View style={[styles.dmScopeRadio, active ? styles.dmScopeRadioActive : null]}>
                    {active ? <View style={styles.dmScopeRadioDot} /> : null}
                  </View>
                  <Text style={[styles.dmScopeOptionTitle, active ? styles.dmScopeOptionTitleActive : null]}>
                    {getDmScopeLabels(t)[scope]}
                  </Text>
                </View>
                <Text style={styles.dmScopeOptionDesc}>{getDmScopeDescriptions(t)[scope]}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      <Text style={styles.summaryText}>
        {t('{{channels}} channels · {{accounts}} accounts ({{connected}} connected)', { channels: channelCards.length, accounts: totalChannelAccounts, connected: connectedChannelAccounts })}
      </Text>

      {error ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorTitle}>{t('Failed to refresh channels')}</Text>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}
    </View>
  ), [channelCards.length, connectedChannelAccounts, dmScope, error, handleDmScopeChange, savingDmScope, styles.dmScopeCard, styles.dmScopeLabel, styles.dmScopeLabelRow, styles.dmScopeOption, styles.dmScopeOptionActive, styles.dmScopeOptionDesc, styles.dmScopeOptionHeader, styles.dmScopeOptionTitle, styles.dmScopeOptionTitleActive, styles.dmScopeOptions, styles.dmScopeRadio, styles.dmScopeRadioActive, styles.dmScopeRadioDot, styles.dmScopeSaving, styles.errorBanner, styles.errorText, styles.errorTitle, styles.listHeaderWrap, styles.summaryText, totalChannelAccounts]);

  if (loading) {
    return (
      <View style={styles.root}>
        {!hideHeader ? <ScreenHeader title={t('Channels')} topInset={topInset} onBack={onBack} /> : null}
        <LoadingState message={t('Loading channels...')} />
      </View>
    );
  }

  if (error && channelCards.length === 0) {
    return (
      <View style={styles.root}>
        {!hideHeader ? <ScreenHeader title={t('Channels')} topInset={topInset} onBack={onBack} /> : null}
        <View style={styles.errorWrap}>
          <View style={styles.errorCard}>
            <Text style={styles.errorTitle}>{t('Failed to load channels')}</Text>
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity
              style={styles.retryButton}
              onPress={() => {
                loadData('initial').catch(() => {
                  // Error state is handled in loadData.
                });
              }}
              activeOpacity={0.7}
            >
              <Text style={styles.retryText}>{t('common:Retry')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {!hideHeader ? <ScreenHeader title={t('Channels')} topInset={topInset} onBack={onBack} /> : null}

      <FlatList
        data={channelCards}
        keyExtractor={(item) => item.id}
        renderItem={renderChannelCard}
        contentContainerStyle={[
          styles.content,
          channelCards.length === 0 ? styles.contentEmpty : null,
        ]}
        refreshControl={(
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={theme.colors.primary}
          />
        )}
        ListHeaderComponent={channelsHeader}
        ListEmptyComponent={
          <EmptyState
            icon="💬"
            title={t('No channels configured')}
            subtitle={t('Configure Telegram, Discord, Slack or other providers on your Gateway.')}
          />
        }
      />
    </View>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: colors.background,
    },
    content: {
      ...createListContentStyle(),
      gap: Space.md,
    },
    contentEmpty: {
      flexGrow: 1,
    },
    listHeaderWrap: {
      ...createListHeaderSpacing(),
    },
    dmScopeCard: {
      borderRadius: Radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      padding: Space.md,
      gap: Space.sm,
    },
    dmScopeLabelRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    dmScopeLabel: {
      fontSize: FontSize.base,
      fontWeight: FontWeight.semibold,
      color: colors.text,
    },
    dmScopeSaving: {
      fontSize: FontSize.xs,
      color: colors.textSubtle,
    },
    dmScopeOptions: {
      gap: Space.sm,
    },
    dmScopeOption: {
      borderRadius: Radius.sm,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceMuted,
      paddingHorizontal: Space.md,
      paddingVertical: Space.sm,
      gap: Space.xs,
    },
    dmScopeOptionActive: {
      borderColor: colors.primary,
      backgroundColor: colors.primarySoft,
    },
    dmScopeOptionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.sm,
    },
    dmScopeRadio: {
      width: 16,
      height: 16,
      borderRadius: Radius.full,
      borderWidth: 1.5,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    dmScopeRadioActive: {
      borderColor: colors.primary,
    },
    dmScopeRadioDot: {
      width: 8,
      height: 8,
      borderRadius: Radius.full,
      backgroundColor: colors.primary,
    },
    dmScopeOptionTitle: {
      fontSize: FontSize.md,
      fontWeight: FontWeight.semibold,
      color: colors.text,
    },
    dmScopeOptionTitleActive: {
      color: colors.primary,
    },
    dmScopeOptionDesc: {
      fontSize: FontSize.sm,
      color: colors.textMuted,
      marginLeft: 24,
    },
    summaryText: {
      fontSize: FontSize.sm,
      color: colors.textMuted,
      paddingTop: Space.sm,
      paddingHorizontal: Space.xs,
    },
    cardTitle: {
      fontSize: FontSize.base,
      fontWeight: FontWeight.semibold,
      color: colors.text,
    },
    cardSubtitle: {
      fontSize: FontSize.sm,
      color: colors.textMuted,
    },
    placeholderCard: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: Radius.md,
      padding: Space.md,
      backgroundColor: colors.surface,
    },
    placeholderText: {
      fontSize: FontSize.sm,
      color: colors.textSubtle,
    },
    channelCard: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: Radius.md,
      padding: Space.md,
      gap: Space.sm,
    },
    channelHeaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: Space.sm,
    },
    channelTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.sm,
      flex: 1,
    },
    channelIcon: {
      fontSize: FontSize.lg,
    },
    channelTitleWrap: {
      flex: 1,
    },
    channelStateBadge: {
      borderRadius: Radius.full,
      borderWidth: 1,
      paddingHorizontal: Space.sm,
      paddingVertical: 2,
      backgroundColor: colors.surface,
    },
    channelStateText: {
      fontSize: FontSize.xs,
      fontWeight: FontWeight.semibold,
    },
    channelAccountsWrap: {
      gap: Space.sm,
    },
    channelAccountCard: {
      borderRadius: Radius.sm,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceMuted,
      padding: Space.sm,
      gap: Space.xs,
    },
    channelAccountTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: Space.sm,
    },
    channelAccountTitle: {
      fontSize: FontSize.sm,
      fontWeight: FontWeight.semibold,
      color: colors.text,
      flex: 1,
    },
    channelActivity: {
      fontSize: FontSize.xs,
      color: colors.textSubtle,
    },
    errorWrap: {
      flex: 1,
      justifyContent: 'center',
      paddingHorizontal: Space.xl,
    },
    errorBanner: {
      borderRadius: Radius.sm,
      borderWidth: 1,
      borderColor: colors.error,
      backgroundColor: colors.surfaceElevated,
      paddingHorizontal: Space.md,
      paddingVertical: Space.sm,
      gap: Space.xs,
    },
    errorCard: {
      borderRadius: Radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      padding: Space.lg,
      gap: Space.sm,
    },
    errorTitle: {
      fontSize: FontSize.base,
      fontWeight: FontWeight.semibold,
      color: colors.text,
    },
    errorText: {
      fontSize: FontSize.sm,
      color: colors.textMuted,
    },
    retryButton: {
      marginTop: Space.sm,
      borderRadius: Radius.sm,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: Space.sm,
    },
    retryText: {
      fontSize: FontSize.base,
      fontWeight: FontWeight.semibold,
      color: colors.primaryText,
    },
  });
}
