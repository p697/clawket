import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import type { AgentAdapter, AgentDescriptor } from '@clawket/agent-protocol';
import { SegmentBar } from '../../components/charts/SegmentBar';
import { ShareRow } from '../../components/charts/ShareRow';
import { UsageBarChart } from '../../components/charts/UsageBarChart';
import { ProGate } from '../../components/pro/ProGate';
import { Banner } from '../../components/ui/Banner';
import { SegmentedTabs } from '../../components/ui/SegmentedTabs';
import { SettingsGroup, SettingsRow } from '../../components/ui/SettingsGroup';
import { Skeleton } from '../../components/ui/Skeleton';
import { analyticsEvents } from '../../services/analytics/events';
import { useAppTheme } from '../../theme';
import {
  ControlSize,
  FontSize,
  FontWeight,
  LineHeight,
  Motion,
  Space,
} from '../../theme/tokens';
import {
  buildUsageDailySeries,
  buildUsageSegments,
  buildUsageSummary,
  computeCacheHitRate,
  formatUsageCost,
  formatUsageDayLabel,
  formatUsageTokens,
  formatUsageValue,
  getUsageDateRange,
  hasUsageData,
  rankUsageModels,
  resolveUsageMeasure,
  usageModelValue,
  type UsageMeasure,
  type UsageRangeKey,
  type UsageSegmentKey,
  type UsageSummary,
} from './usage-model';
import { UsagePosterSheet } from './UsagePosterSheet';
import { useUsageDashboard } from './useUsageDashboard';

export type UsageSectionProps = Readonly<{
  adapter: AgentAdapter;
  agent: AgentDescriptor;
  online: boolean;
  /** Incremented by the page header's share action to open the stats poster. */
  posterRequest?: number;
  isPro?: boolean;
  onOpenPaywall?: (reason: 'usage', onContinue?: () => void) => void;
}>;

const WEEK_BARS = 7;
const MONTH_BARS = 30;
/** The veil covers the hero card and both tile rows so the numbers are seen but not read. */
const USAGE_GATE_TEASER_HEIGHT = ControlSize.settingsRow * 6;

export function UsageSection({
  adapter,
  agent,
  online,
  posterRequest = 0,
  isPro = false,
  onOpenPaywall,
}: UsageSectionProps): React.JSX.Element {
  const { t } = useTranslation(['common', 'settings']);
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);
  const dashboard = useUsageDashboard(adapter, agent, online);
  const { rangeKey, setRangeKey, range, today, canShowCost, data, weekData, showSkeleton, failed, error } = dashboard;
  const [posterVisible, setPosterVisible] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const previousRange = useRef(rangeKey);
  // Today is free; the week and month are the Pro value of this page.
  const locked = !isPro && rangeKey !== 'today';

  useEffect(() => {
    if (posterRequest > 0) setPosterVisible(true);
  }, [posterRequest]);

  useEffect(() => {
    if (previousRange.current === rangeKey) return;
    previousRange.current = rangeKey;
    analyticsEvents.usageRangeChanged({ range: rangeKey, cached: dashboard.cached, locked });
  }, [dashboard.cached, locked, rangeKey]);

  const summary = useMemo(() => (data ? buildUsageSummary(data.usage, data.cost) : null), [data]);
  const weekSummary = useMemo(() => (weekData ? buildUsageSummary(weekData.usage, weekData.cost) : null), [weekData]);
  const measure: UsageMeasure = summary ? resolveUsageMeasure(summary, canShowCost) : 'tokens';
  const trendSummary = rangeKey === 'today' ? weekSummary : summary;
  const trendRange = useMemo(
    () => (rangeKey === 'today' ? getUsageDateRange('7d', new Date(`${today}T12:00:00`)) : range),
    [range, rangeKey, today],
  );
  const points = useMemo(
    () => (trendSummary ? buildUsageDailySeries(trendSummary.daily, trendRange, measure, today) : []),
    [measure, today, trendRange, trendSummary],
  );
  const selectedIndex = points.length
    ? (() => {
      const index = selectedDate ? points.findIndex((point) => point.date === selectedDate) : -1;
      return index >= 0 ? index : points.length - 1;
    })()
    : null;

  const tabs = useMemo(() => [
    { key: 'today' as const, label: t('Today', { ns: 'settings' }) },
    { key: '7d' as const, label: '7D' },
    { key: '30d' as const, label: '30D' },
  ], [t]);
  const segmentLabels: Record<UsageSegmentKey, string> = {
    input: t('Input', { ns: 'settings' }),
    output: t('Output', { ns: 'settings' }),
    cacheRead: t('Cache Read', { ns: 'settings' }),
    cacheWrite: t('Cache Write', { ns: 'settings' }),
  };
  const measureLabel = measure === 'cost' ? t('Cost', { ns: 'common' }) : t('Tokens', { ns: 'common' });
  const costLabel = summary ? resolveCostLabel(summary, canShowCost, t) : '—';
  const costCaption = summary?.presentation?.mode === 'estimated'
    ? t('Estimated', { ns: 'settings' })
    : summary?.presentation?.mode === 'mixed'
      ? t('Partial', { ns: 'settings' })
      : summary?.presentation?.mode === 'unknown'
        ? t('Unpriced', { ns: 'settings' }) : null;
  const errorMessage = error ?? t('Failed to refresh usage data', { ns: 'settings' });
  const hasData = summary ? hasUsageData(summary) : false;
  const contentKey = summary ? `${rangeKey}:${summaryKey(summary)}:${weekSummary ? summaryKey(weekSummary) : ''}` : rangeKey;

  let content: React.ReactNode;
  if (showSkeleton) {
    content = <UsageSkeleton bars={rangeKey === '30d' ? MONTH_BARS : WEEK_BARS} />;
  } else if (!summary) {
    content = (
      <Banner
        testID="agent-usage-error"
        tone={failed ? 'bad' : 'neutral'}
        message={failed ? errorMessage : t('No usage data', { ns: 'settings' })}
        actionLabel={t('Retry', { ns: 'common' })}
        onAction={() => { void dashboard.refresh(); }}
      />
    );
  } else if (!hasData) {
    content = (
      <Text testID="agent-usage-empty" style={styles.emptyText}>
        {t('No usage data', { ns: 'settings' })}
      </Text>
    );
  } else {
    const segments = buildUsageSegments(summary.totals, measure).map((segment) => ({
      key: segment.key,
      label: segmentLabels[segment.key],
      value: segment.value,
      display: formatUsageValue(segment.value, measure),
    }));
    const cacheHit = computeCacheHitRate(summary.totals);
    const models = rankUsageModels(summary.topModels, measure);
    const topModelValue = models.length ? usageModelValue(models[0], measure) : 0;
    const topToolCount = summary.topTools.length ? summary.topTools[0].count : 0;
    const primaryValue = measure === 'cost'
      ? formatUsageCost(summary.totals?.totalCost ?? 0)
      : formatUsageTokens(summary.totals?.totalTokens ?? 0);
    const secondaryValue = measure === 'cost'
      ? formatUsageTokens(summary.totals?.totalTokens ?? 0)
      : costLabel;
    const secondaryLabel = measure === 'cost'
      ? t('Tokens', { ns: 'common' })
      : costCaption ?? t('Cost', { ns: 'common' });

    content = (
      <Animated.View key={contentKey} entering={FadeIn.duration(Motion.duration.normal)} style={styles.groups}>
        <UsageCard testID="agent-usage-summary">
          <View style={styles.heroRow}>
            <View style={styles.heroCell}>
              <Text testID="agent-usage-primary" style={styles.statValue} numberOfLines={1}>{primaryValue}</Text>
              <Text style={styles.statLabel} numberOfLines={1}>
                {measure === 'cost' ? (costCaption ?? t('Cost', { ns: 'common' })) : t('Tokens', { ns: 'common' })}
              </Text>
            </View>
            {canShowCost || measure === 'cost' ? (
              <View style={[styles.heroCell, styles.heroCellTrailing]}>
                <Text testID="agent-usage-secondary" style={styles.statValue} numberOfLines={1}>{secondaryValue}</Text>
                <Text style={styles.statLabel} numberOfLines={1}>{secondaryLabel}</Text>
              </View>
            ) : null}
          </View>
          <SegmentBar
            testID={measure === 'cost' ? 'agent-usage-cost-breakdown' : 'agent-usage-token-composition'}
            segments={segments}
            accessibilityLabel={measureLabel}
          />
        </UsageCard>

        <View style={styles.tileRow}>
          <UsageTile testID="agent-usage-messages" value={String(summary.messages)} label={t('Messages', { ns: 'common' })} />
          <UsageTile testID="agent-usage-tool-calls" value={String(summary.toolCalls)} label={t('Tool calls', { ns: 'common' })} />
        </View>
        <View style={styles.tileRow}>
          <UsageTile testID="agent-usage-sessions" value={String(summary.sessions)} label={t('Sessions', { ns: 'common' })} />
          <UsageTile
            testID="agent-usage-cache-hit"
            value={cacheHit === null ? '—' : `${cacheHit}%`}
            label={t('Cache hit', { ns: 'settings' })}
          />
        </View>

        <UsageCard testID="agent-usage-trend">
          <View style={styles.cardTitleRow}>
            <Text style={styles.cardTitle} numberOfLines={1}>
              {rangeKey === 'today' ? t('Last 7 days', { ns: 'settings' }) : t('Daily', { ns: 'settings' })}
            </Text>
            <Text style={styles.cardCaption} numberOfLines={1}>{measureLabel}</Text>
          </View>
          {points.length ? (
            <UsageBarChart
              testID="agent-usage-chart"
              points={points}
              selectedIndex={selectedIndex}
              onSelect={(index) => {
                const point = points[index];
                if (!point) return;
                // Past days belong to the week view: a free user who reaches for one meets the paywall.
                if (!isPro && !point.today) {
                  onOpenPaywall?.('usage');
                  return;
                }
                setSelectedDate(point.date);
              }}
              formatValue={(value) => formatUsageValue(value, measure)}
              formatDayLabel={formatUsageDayLabel}
              todayLabel={t('Today', { ns: 'settings' })}
              accessibilityLabel={measureLabel}
            />
          ) : (
            <UsageChartSkeleton bars={WEEK_BARS} />
          )}
        </UsageCard>

        {models.length ? (
          <UsageCard testID="agent-usage-models">
            <View style={styles.cardTitleRow}>
              <Text style={styles.cardTitle} numberOfLines={1}>{t('Models', { ns: 'settings' })}</Text>
              <Text style={styles.cardCaption} numberOfLines={1}>{measureLabel}</Text>
            </View>
            {models.map((entry, index) => {
              const value = usageModelValue(entry, measure);
              return (
                <ShareRow
                  key={`${entry.provider ?? ''}:${entry.model ?? ''}:${index}`}
                  testID={`agent-usage-model-${index}`}
                  name={entry.model ?? entry.provider ?? t('Unknown model', { ns: 'settings' })}
                  value={measure === 'cost' && entry.totals.missingCostEntries > 0 && value === 0
                    ? t('Unpriced', { ns: 'settings' }) : formatUsageValue(value, measure)}
                  share={topModelValue > 0 ? value / topModelValue : 0}
                />
              );
            })}
          </UsageCard>
        ) : null}

        {summary.topTools.length ? (
          <UsageCard testID="agent-usage-tools">
            <View style={styles.cardTitleRow}>
              <Text style={styles.cardTitle} numberOfLines={1}>{t('Tools', { ns: 'settings' })}</Text>
              <Text style={styles.cardCaption} numberOfLines={1}>{t('Tool calls', { ns: 'common' })}</Text>
            </View>
            {summary.topTools.map((entry, index) => (
              <ShareRow
                key={`${entry.name}:${index}`}
                testID={`agent-usage-tool-${index}`}
                name={entry.name}
                value={String(entry.count)}
                share={topToolCount > 0 ? entry.count / topToolCount : 0}
              />
            ))}
          </UsageCard>
        ) : null}
      </Animated.View>
    );
  }

  if (locked && summary) {
    content = (
      <ProGate
        testID="agent-usage-gate"
        title={t('See the whole week and month', { ns: 'settings' })}
        detail={t('Usage, cost and trends for 7 and 30 days.', { ns: 'settings' })}
        actionLabel={t('Unlock usage trends', { ns: 'settings' })}
        teaserHeight={USAGE_GATE_TEASER_HEIGHT}
        onUnlock={() => onOpenPaywall?.('usage')}
      >
        {hasData ? content : null}
      </ProGate>
    );
  }

  return (
    <>
      <View testID="agent-usage-section" style={styles.root}>
        <SegmentedTabs
          testID="agent-usage-range"
          tabs={tabs}
          active={rangeKey}
          onSwitch={(key: UsageRangeKey) => setRangeKey(key)}
        />
        {failed && summary ? (
          <Banner
            testID="agent-usage-error"
            tone="bad"
            message={errorMessage}
            actionLabel={t('Retry', { ns: 'common' })}
            onAction={() => { void dashboard.refresh(); }}
          />
        ) : null}
        {summary?.presentation?.mode === 'mixed' ? (
          <Banner testID="agent-usage-partial" tone="neutral"
            message={t('This range mixes priced usage with included or unpriced routes, so the dollar total is only a partial view.', { ns: 'settings' })} />
        ) : null}
        {content}
      </View>

      <UsagePosterSheet
        visible={posterVisible}
        agent={agent}
        data={{
          cost: costLabel,
          costCaption: costCaption ?? undefined,
          tokens: formatUsageTokens(summary?.totals?.totalTokens ?? 0),
          messages: String(summary?.messages ?? 0),
          toolCalls: String(summary?.toolCalls ?? 0),
        }}
        onClose={() => setPosterVisible(false)}
      />
    </>
  );
}

function resolveCostLabel(
  summary: UsageSummary,
  canShowCost: boolean,
  t: (key: string, options: { ns: 'settings' }) => string,
): string {
  if (!canShowCost) return '—';
  const mode = summary.presentation?.mode;
  if (mode === 'included') return t('Included', { ns: 'settings' });
  if (mode === 'unknown') return '—';
  return formatUsageCost(summary.totals?.totalCost ?? 0);
}

function summaryKey(summary: UsageSummary): string {
  return [
    summary.totals?.totalTokens ?? 0,
    summary.totals?.totalCost ?? 0,
    summary.messages,
    summary.toolCalls,
    summary.sessions,
    summary.daily.length,
    summary.topModels.length,
    summary.topTools.length,
  ].join(':');
}

function UsageCard({ children, testID }: Readonly<{ children: React.ReactNode; testID?: string }>): React.JSX.Element {
  return (
    <SettingsGroup testID={testID}>
      <SettingsRow layout="column">
        <View style={stylesStatic.cardBody}>{children}</View>
      </SettingsRow>
    </SettingsGroup>
  );
}

function UsageTile({ value, label, testID }: Readonly<{ value: string; label: string; testID?: string }>): React.JSX.Element {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);
  return (
    <SettingsGroup testID={testID} style={styles.tile}>
      <SettingsRow layout="column" accessibilityLabel={`${label} ${value}`}>
        <View style={stylesStatic.cardBody}>
          <Text testID={testID ? `${testID}-value` : undefined} style={styles.statValue} numberOfLines={1}>{value}</Text>
          <Text style={styles.statLabel} numberOfLines={1}>{label}</Text>
        </View>
      </SettingsRow>
    </SettingsGroup>
  );
}

function UsageSkeleton({ bars }: Readonly<{ bars: number }>): React.JSX.Element {
  return (
    <View testID="agent-usage-loading" style={stylesStatic.skeletonGroups}>
      <UsageCard>
        <View style={stylesStatic.heroRowSkeleton}>
          <View style={stylesStatic.skeletonCell}>
            <Skeleton style={stylesStatic.skeletonValue} />
            <Skeleton style={stylesStatic.skeletonLabel} />
          </View>
          <View style={[stylesStatic.skeletonCell, stylesStatic.skeletonCellTrailing]}>
            <Skeleton style={stylesStatic.skeletonValue} />
            <Skeleton style={stylesStatic.skeletonLabel} />
          </View>
        </View>
        <Skeleton style={stylesStatic.skeletonBar} />
        <View style={stylesStatic.skeletonLegend}>
          {[0, 1, 2, 3].map((item) => <Skeleton key={item} style={stylesStatic.skeletonLegendItem} />)}
        </View>
      </UsageCard>
      {[0, 1].map((row) => (
        <View key={row} style={stylesStatic.tileRow}>
          {[0, 1].map((tile) => (
            <SettingsGroup key={tile} style={stylesStatic.tile}>
              <SettingsRow layout="column">
                <View style={stylesStatic.cardBody}>
                  <Skeleton style={stylesStatic.skeletonTileValue} />
                  <Skeleton style={stylesStatic.skeletonLabel} />
                </View>
              </SettingsRow>
            </SettingsGroup>
          ))}
        </View>
      ))}
      <UsageCard>
        <View style={stylesStatic.skeletonTitleRow}>
          <Skeleton style={stylesStatic.skeletonTitle} />
          <Skeleton style={stylesStatic.skeletonCaption} />
        </View>
        <UsageChartSkeleton bars={bars} />
      </UsageCard>
      <UsageCard>
        <View style={stylesStatic.skeletonTitleRow}>
          <Skeleton style={stylesStatic.skeletonTitle} />
          <Skeleton style={stylesStatic.skeletonCaption} />
        </View>
        {[0, 1].map((row) => (
          <View key={row} style={stylesStatic.skeletonRow}>
            <Skeleton style={stylesStatic.skeletonRowName} />
            <Skeleton style={stylesStatic.skeletonRowValue} />
          </View>
        ))}
      </UsageCard>
    </View>
  );
}

function UsageChartSkeleton({ bars }: Readonly<{ bars: number }>): React.JSX.Element {
  const heights = [0.55, 0.8, 0.35, 0.9, 0.6, 0.25, 0.7];
  return (
    <View testID="agent-usage-chart-skeleton" style={stylesStatic.skeletonChart}>
      {Array.from({ length: bars }, (_, index) => (
        <Skeleton
          key={index}
          style={[stylesStatic.skeletonChartBar, { height: `${Math.round((heights[index % heights.length] ?? 0.5) * 100)}%` }]}
        />
      ))}
    </View>
  );
}

const CHART_SKELETON_HEIGHT = 120;
const CHART_SKELETON_BAR_MAX = 22;

const stylesStatic = StyleSheet.create({
  cardBody: { paddingVertical: Space.xs, gap: Space.md },
  tileRow: { flexDirection: 'row', gap: Space.md, alignItems: 'stretch' },
  tile: { flex: 1, minWidth: 0 },
  skeletonGroups: { gap: Space.md },
  heroRowSkeleton: { flexDirection: 'row', justifyContent: 'space-between', gap: Space.md },
  skeletonCell: { gap: Space.sm },
  skeletonCellTrailing: { alignItems: 'flex-end' },
  skeletonValue: { width: '32%', minWidth: Space.xxl, height: LineHeight.title },
  skeletonTileValue: { width: '40%', height: LineHeight.title },
  skeletonLabel: { width: Space.xxl, height: LineHeight.caption },
  skeletonBar: { height: Space.sm },
  skeletonLegend: { flexDirection: 'row', flexWrap: 'wrap', rowGap: Space.xs },
  skeletonLegendItem: { width: '46%', marginRight: '4%', height: LineHeight.caption },
  skeletonTitleRow: { flexDirection: 'row', justifyContent: 'space-between' },
  skeletonTitle: { width: '30%', height: LineHeight.secondary },
  skeletonCaption: { width: '16%', height: LineHeight.caption },
  skeletonChart: {
    height: CHART_SKELETON_HEIGHT,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingLeft: Space.xxl,
    gap: Space.xs,
  },
  skeletonChartBar: { flex: 1, maxWidth: CHART_SKELETON_BAR_MAX },
  skeletonRow: { flexDirection: 'row', justifyContent: 'space-between', gap: Space.lg },
  skeletonRowName: { flex: 1, height: LineHeight.secondary },
  skeletonRowValue: { width: '18%', height: LineHeight.secondary },
});

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    root: { gap: Space.lg },
    groups: { gap: Space.md },
    heroRow: { flexDirection: 'row', justifyContent: 'space-between', gap: Space.md },
    heroCell: { flexShrink: 1, gap: Space.xs },
    heroCellTrailing: { alignItems: 'flex-end' },
    tileRow: { flexDirection: 'row', gap: Space.md, alignItems: 'stretch' },
    tile: { flex: 1, minWidth: 0 },
    statValue: {
      color: colors.ink,
      fontSize: FontSize.title,
      lineHeight: LineHeight.title,
      fontWeight: FontWeight.semibold,
      fontVariant: ['tabular-nums'],
    },
    statLabel: {
      color: colors.inkSecondary,
      fontSize: FontSize.secondary,
      lineHeight: LineHeight.secondary,
      fontWeight: FontWeight.regular,
    },
    cardTitleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: Space.md },
    cardTitle: {
      flexShrink: 1,
      color: colors.inkSecondary,
      fontSize: FontSize.secondary,
      lineHeight: LineHeight.secondary,
      fontWeight: FontWeight.regular,
    },
    cardCaption: {
      color: colors.inkTertiary,
      fontSize: FontSize.caption,
      lineHeight: LineHeight.caption,
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
