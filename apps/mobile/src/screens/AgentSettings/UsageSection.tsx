import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type {
  AgentAdapter,
  AgentDescriptor,
  CostSummary,
  UsageResult,
} from '@clawket/agent-protocol';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { SegmentedTabs } from '../../components/ui/SegmentedTabs';
import {
  SettingsDivider,
  SettingsGroup,
  SettingsRow,
} from '../../components/ui/SettingsGroup';
import { Skeleton } from '../../components/ui/Skeleton';
import { useAppTheme } from '../../theme';
import {
  ControlSize,
  FontSize,
  FontWeight,
  LineHeight,
  Space,
} from '../../theme/tokens';
import {
  buildUsageSummary,
  formatUsageCost,
  formatUsageTokens,
  getUsageDateRange,
  hasUsageData,
  type UsageRangeKey,
} from './usage-model';
import { UsagePosterSheet } from './UsagePosterSheet';

export type UsageSectionProps = Readonly<{
  adapter: AgentAdapter;
  agent: AgentDescriptor;
  online: boolean;
}>;

export function UsageSection({
  adapter,
  agent,
}: UsageSectionProps): React.JSX.Element {
  const { t } = useTranslation(['common', 'settings']);
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);
  const operations = adapter.management?.usage;
  const canShowCost = adapter.capabilities.cost && Boolean(operations?.cost);
  const [rangeKey, setRangeKey] = useState<UsageRangeKey>('today');
  const [usage, setUsage] = useState<UsageResult | null>(null);
  const [cost, setCost] = useState<CostSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [posterVisible, setPosterVisible] = useState(false);
  const range = useMemo(() => getUsageDateRange(rangeKey), [rangeKey]);

  const load = useCallback(async () => {
    if (!operations?.sessions) {
      setLoading(false);
      setUsage(null);
      setCost(null);
      return;
    }
    setLoading(true);
    try {
      const [nextUsage, nextCost] = await Promise.all([
        operations.sessions(range),
        canShowCost && operations.cost ? operations.cost(range) : Promise.resolve(null),
      ]);
      setUsage(nextUsage);
      setCost(nextCost);
      setError(null);
    } catch (loadError: unknown) {
      setError(errorMessage(loadError, t('Failed to refresh usage data', { ns: 'settings' })));
    } finally {
      setLoading(false);
    }
  }, [canShowCost, operations, range, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const summary = useMemo(() => buildUsageSummary(usage, cost), [cost, usage]);
  const hasData = hasUsageData(summary);
  const presentation = cost?.costPresentation ?? usage?.costPresentation;
  const costLabel = presentation?.mode === 'included'
    ? t('Included', { ns: 'settings' })
    : formatUsageCost(summary.totals?.totalCost ?? 0);
  const tabs = useMemo(() => [
    { key: 'today' as const, label: t('Today', { ns: 'settings' }) },
    { key: '7d' as const, label: '7D' },
    { key: '30d' as const, label: '30D' },
  ], [t]);

  if (loading && !usage && !cost) return <UsageLoading />;

  return (
    <>
      <View testID="agent-usage-section" style={styles.root}>
        <SegmentedTabs
          testID="agent-usage-range"
          tabs={tabs}
          active={rangeKey}
          onSwitch={setRangeKey}
        />
        {error ? (
          <Banner
            testID="agent-usage-error"
            tone="bad"
            message={error}
            actionLabel={t('Retry', { ns: 'common' })}
            onAction={() => { void load(); }}
          />
        ) : null}
        {hasData ? (
          <View style={styles.groups}>
            <SettingsGroup testID="agent-usage-summary">
              <SettingsRow
                title={t('Tokens', { ns: 'common' })}
                value={formatUsageTokens(summary.totals?.totalTokens ?? 0)}
              />
              <SettingsDivider inset="content" />
              <SettingsRow title={t('Messages', { ns: 'common' })} value={String(summary.messages)} />
              <SettingsDivider inset="content" />
              <SettingsRow title={t('Tool calls', { ns: 'common' })} value={String(summary.toolCalls)} />
              <SettingsDivider inset="content" />
              <SettingsRow title={t('Sessions', { ns: 'common' })} value={String(summary.sessions)} />
              {canShowCost ? (
                <>
                  <SettingsDivider inset="content" />
                  <SettingsRow title={t('Cost', { ns: 'common' })} value={costLabel} />
                </>
              ) : null}
            </SettingsGroup>

            {canShowCost && summary.totals ? (
              <View style={styles.groupWrap}>
                <Text style={styles.groupTitle}>{t('Cost Breakdown', { ns: 'settings' })}</Text>
                <SettingsGroup testID="agent-usage-cost-breakdown">
                  <SettingsRow
                    title={t('Input', { ns: 'settings' })}
                    value={formatUsageCost(summary.totals.inputCost)}
                  />
                  <SettingsDivider inset="content" />
                  <SettingsRow
                    title={t('Output', { ns: 'settings' })}
                    value={formatUsageCost(summary.totals.outputCost)}
                  />
                  <SettingsDivider inset="content" />
                  <SettingsRow
                    title={t('Cache Read', { ns: 'settings' })}
                    value={formatUsageCost(summary.totals.cacheReadCost)}
                  />
                  <SettingsDivider inset="content" />
                  <SettingsRow
                    title={t('Cache Write', { ns: 'settings' })}
                    value={formatUsageCost(summary.totals.cacheWriteCost)}
                  />
                </SettingsGroup>
              </View>
            ) : null}

            {summary.topModels.length ? (
              <View style={styles.groupWrap}>
                <Text style={styles.groupTitle}>{t('Top Models', { ns: 'settings' })}</Text>
                <SettingsGroup testID="agent-usage-models">
                  {summary.topModels.map((entry, index) => (
                    <React.Fragment key={`${entry.provider ?? ''}:${entry.model ?? ''}:${index}`}>
                      {index ? <SettingsDivider inset="content" /> : null}
                      <SettingsRow
                        title={entry.model ?? entry.provider ?? t('Unknown model', { ns: 'settings' })}
                        value={formatUsageTokens(entry.totals.totalTokens)}
                      />
                    </React.Fragment>
                  ))}
                </SettingsGroup>
              </View>
            ) : null}

            {summary.daily.length ? (
              <View style={styles.groupWrap}>
                <Text style={styles.groupTitle}>{t('Daily Usage', { ns: 'settings' })}</Text>
                <SettingsGroup testID="agent-usage-daily">
                  {summary.daily.slice(0, 10).map((entry, index) => (
                    <React.Fragment key={entry.date}>
                      {index ? <SettingsDivider inset="content" /> : null}
                      <SettingsRow
                        title={entry.date}
                        value={entry.tokens > 0
                          ? formatUsageTokens(entry.tokens)
                          : formatUsageCost(entry.cost)}
                      />
                    </React.Fragment>
                  ))}
                </SettingsGroup>
              </View>
            ) : null}

            <Button
              testID="agent-usage-open-poster"
              label={t('Stats Poster', { ns: 'settings' })}
              variant="secondary"
              onPress={() => setPosterVisible(true)}
            />
          </View>
        ) : (
          <Text testID="agent-usage-empty" style={styles.emptyText}>
            {t('No usage data', { ns: 'settings' })}
          </Text>
        )}
      </View>

      <UsagePosterSheet
        visible={posterVisible}
        agent={agent}
        data={{
          cost: canShowCost ? costLabel : '—',
          tokens: formatUsageTokens(summary.totals?.totalTokens ?? 0),
          messages: String(summary.messages),
          toolCalls: String(summary.toolCalls),
        }}
        onClose={() => setPosterVisible(false)}
      />
    </>
  );
}

function UsageLoading(): React.JSX.Element {
  return (
    <View testID="agent-usage-loading" style={stylesStatic.loading}>
      {[0, 1, 2, 3].map((row) => (
        <View key={row} style={stylesStatic.skeletonRow}>
          <Skeleton style={stylesStatic.skeletonTitle} />
          <Skeleton style={stylesStatic.skeletonValue} />
        </View>
      ))}
    </View>
  );
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  return fallback;
}

const stylesStatic = StyleSheet.create({
  loading: { gap: Space.sm },
  skeletonRow: {
    minHeight: ControlSize.settingsRow,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.lg,
  },
  skeletonTitle: { flex: 1, height: LineHeight.body },
  skeletonValue: { width: '20%', height: LineHeight.secondary },
});

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    root: { gap: Space.lg },
    groups: { gap: Space.xl },
    groupWrap: { gap: Space.sm },
    groupTitle: {
      paddingHorizontal: Space.xs,
      color: colors.inkSecondary,
      fontSize: FontSize.secondary,
      lineHeight: LineHeight.secondary,
      fontWeight: FontWeight.regular,
    },
    emptyText: {
      paddingVertical: Space.xxl,
      color: colors.inkSecondary,
      fontSize: FontSize.secondary,
      lineHeight: LineHeight.secondary,
      fontWeight: FontWeight.regular,
      textAlign: 'center',
    },
  });
}
