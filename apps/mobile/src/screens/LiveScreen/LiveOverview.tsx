import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  Easing,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  AlertCircle,
  Bot,
  CheckCircle2,
  ChevronRight,
  Clock3,
  MessagesSquare,
  Radio,
  Sparkles,
  TerminalSquare,
  UsersRound,
  Workflow,
} from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Card } from '../../components/ui';
import { useAppTheme } from '../../theme';
import { FontSize, FontWeight, LineHeight, Radius, Space, TimingPreset } from '../../theme/tokens';
import type { ConnectionState } from '../../types';
import type {
  LiveAttentionItem,
  LiveDashboardSnapshot,
  LiveMember,
} from '../../services/live-dashboard';

type Props = {
  snapshot: LiveDashboardSnapshot;
  connectionState: ConnectionState;
  topInset: number;
  loading: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  onOpenSession: (member: LiveMember) => void;
  onOpenAttention: (item: LiveAttentionItem) => void;
  onOpenConnection: () => void;
};

function formatCompactNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

function formatCost(value: number): string {
  if (value >= 100) return `$${value.toFixed(0)}`;
  if (value >= 10) return `$${value.toFixed(1)}`;
  return `$${value.toFixed(2)}`;
}

function formatRelativeTime(value: number | null, t: ReturnType<typeof useTranslation<'common'>>['t']): string {
  if (!value) return t('Standby');
  const diff = Math.max(0, Date.now() - value);
  if (diff < 60_000) return t('just now');
  if (diff < 3_600_000) return t('{{count}}m ago', { count: Math.floor(diff / 60_000) });
  if (diff < 86_400_000) return t('{{count}}h ago', { count: Math.floor(diff / 3_600_000) });
  return t('{{count}}d ago', { count: Math.floor(diff / 86_400_000) });
}

function memberTitle(member: LiveMember, t: ReturnType<typeof useTranslation<'common'>>['t']): string {
  if (member.label) return member.label;
  if (member.role === 'main') return t('Main Agent');
  if (member.role === 'subagent') return t('Sub-Agent');
  if (member.role === 'cron') return t('Cron');
  if (member.role === 'channel') return member.channel || t('Channel');
  return t('Session');
}

function memberDetail(member: LiveMember, t: ReturnType<typeof useTranslation<'common'>>['t']): string {
  if (member.status === 'error') return t('Needs attention');
  if (member.status === 'completed') return t('Completed just now');
  if (member.status === 'working' && member.tool?.name) {
    return t('Using {{tool}}', { tool: member.tool.name });
  }
  if (member.status === 'working') return t('Working now');
  if (member.status === 'recent') return t('Updated {{time}}', { time: formatRelativeTime(member.updatedAt, t) });
  return t('Standby');
}

function memberIcon(member: LiveMember, color: string): React.ReactNode {
  const props = { size: 18, color, strokeWidth: 2 };
  if (member.role === 'main') return <Bot {...props} />;
  if (member.role === 'subagent') return <Workflow {...props} />;
  if (member.role === 'cron') return <Clock3 {...props} />;
  if (member.role === 'channel') return <MessagesSquare {...props} />;
  return <TerminalSquare {...props} />;
}

function useReduceMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (mounted) setReduceMotion(enabled);
      })
      .catch(() => {});
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  return reduceMotion;
}

export function LiveOverview({
  snapshot,
  connectionState,
  topInset,
  loading,
  refreshing,
  onRefresh,
  onOpenSession,
  onOpenAttention,
  onOpenConnection,
}: Props): React.JSX.Element {
  const { t } = useTranslation('common');
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);
  const connected = connectionState === 'ready';

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[styles.content, { paddingTop: topInset + Space.md }]}
      showsVerticalScrollIndicator={false}
      refreshControl={(
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={theme.colors.primary}
          colors={[theme.colors.primary]}
        />
      )}
    >
      {!connected ? (
        <Card onPress={onOpenConnection} style={styles.connectionCard}>
          <View style={styles.connectionIcon}>
            <Radio size={18} color={theme.colors.warning} strokeWidth={2} />
          </View>
          <View style={styles.flex}>
            <Text style={styles.cardTitle}>{t('Live connection unavailable')}</Text>
            <Text style={styles.cardBody}>{t('Open connection settings to bring live activity back.')}</Text>
          </View>
          <ChevronRight size={18} color={theme.colors.textSubtle} strokeWidth={2} />
        </Card>
      ) : null}

      <LivePresenceCard snapshot={snapshot} styles={styles} />

      <View style={styles.summaryRow}>
        <SummaryCard
          icon={<Sparkles size={18} color={theme.colors.primary} strokeWidth={2} />}
          value={snapshot.workingCount}
          label={t('Working')}
          styles={styles}
        />
        <SummaryCard
          icon={<AlertCircle size={18} color={snapshot.attentionCount > 0 ? theme.colors.error : theme.colors.textSubtle} strokeWidth={2} />}
          value={snapshot.attentionCount}
          label={t('Needs you')}
          styles={styles}
        />
        <SummaryCard
          icon={<UsersRound size={18} color={theme.colors.success} strokeWidth={2} />}
          value={snapshot.activeTodayCount}
          label={t('Active today')}
          styles={styles}
        />
      </View>

      {snapshot.attentionItems.length > 0 ? (
        <Section title={t('Needs attention')} styles={styles}>
          <Card style={styles.listCard}>
            {snapshot.attentionItems.map((item, index) => (
              <AttentionRow
                key={item.id}
                item={item}
                isLast={index === snapshot.attentionItems.length - 1}
                onPress={() => onOpenAttention(item)}
                styles={styles}
              />
            ))}
          </Card>
        </Section>
      ) : null}

      {!snapshot.hasActivity && !loading ? (
        <Card style={styles.emptyCard}>
          <View style={styles.emptyIcon}>
            <Bot size={24} color={theme.colors.primary} strokeWidth={2} />
          </View>
          <Text style={styles.emptyTitle}>{t('No activity yet')}</Text>
          <Text style={styles.emptyBody}>{t('Start a chat or run a task. Live will show what your agent is doing here.')}</Text>
        </Card>
      ) : null}

      <Section title={t('Team activity')} styles={styles}>
        {loading && snapshot.members.length === 0 ? (
          <Card style={styles.loadingCard}>
            <ActivityIndicator color={theme.colors.primary} />
            <Text style={styles.cardBody}>{t('Loading live activity...')}</Text>
          </Card>
        ) : snapshot.members.length > 0 ? (
          <Card style={styles.listCard}>
            {snapshot.members.map((member, index) => (
              <MemberRow
                key={member.id}
                member={member}
                isLast={index === snapshot.members.length - 1}
                onPress={() => onOpenSession(member)}
                styles={styles}
              />
            ))}
          </Card>
        ) : (
          <Card style={styles.emptyCard}>
            <View style={styles.emptyIcon}>
              <Bot size={24} color={theme.colors.primary} strokeWidth={2} />
            </View>
            <Text style={styles.emptyTitle}>{t('No activity yet')}</Text>
            <Text style={styles.emptyBody}>{t('Start a chat or run a task. Live will show what your agent is doing here.')}</Text>
          </Card>
        )}
      </Section>

      <Section title={t('Today')} styles={styles}>
        <Card style={styles.metricsCard}>
          <Metric
            label={t('Tokens')}
            value={snapshot.usage.todayTokens == null ? '—' : formatCompactNumber(snapshot.usage.todayTokens)}
            styles={styles}
          />
          <Metric
            label={t('Messages')}
            value={snapshot.totalMessages == null ? '—' : formatCompactNumber(snapshot.totalMessages)}
            styles={styles}
          />
          <Metric
            label={t('Tool calls')}
            value={snapshot.usage.toolCalls == null ? '—' : formatCompactNumber(snapshot.usage.toolCalls)}
            styles={styles}
          />
          <Metric
            label={t('Cost')}
            value={snapshot.usage.todayCost == null ? '—' : formatCost(snapshot.usage.todayCost)}
            styles={styles}
          />
        </Card>
      </Section>

      {snapshot.recentSessions.length > 0 ? (
        <Section title={t('Recent activity')} styles={styles}>
          <Card style={styles.listCard}>
            {snapshot.recentSessions.map((member, index) => (
              <Pressable
                key={`recent:${member.id}`}
                onPress={() => onOpenSession(member)}
                style={({ pressed }) => [
                  styles.recentRow,
                  index !== snapshot.recentSessions.length - 1 ? styles.rowBorder : null,
                  pressed ? styles.rowPressed : null,
                ]}
              >
                <View style={styles.recentDot} />
                <Text style={styles.recentTitle} numberOfLines={1}>{memberTitle(member, t)}</Text>
                <Text style={styles.recentTime}>{formatRelativeTime(member.updatedAt, t)}</Text>
              </Pressable>
            ))}
          </Card>
        </Section>
      ) : null}

    </ScrollView>
  );
}

function SummaryCard({
  icon,
  value,
  label,
  styles,
}: {
  icon: React.ReactNode;
  value: number;
  label: string;
  styles: ReturnType<typeof createStyles>;
}): React.JSX.Element {
  return (
    <Card style={styles.summaryCard}>
      {icon}
      <Text style={styles.summaryValue}>{value}</Text>
      <Text style={styles.summaryLabel} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>{label}</Text>
    </Card>
  );
}

function LivePresenceCard({
  snapshot,
  styles,
}: {
  snapshot: LiveDashboardSnapshot;
  styles: ReturnType<typeof createStyles>;
}): React.JSX.Element {
  const { t } = useTranslation('common');
  const { theme } = useAppTheme();
  const featuredMember = snapshot.members.find((member) => member.status === 'working')
    ?? snapshot.members.find((member) => member.status === 'completed')
    ?? snapshot.members.find((member) => member.status === 'error')
    ?? snapshot.members[0];
  const active = featuredMember?.status === 'working';
  const statusColor = featuredMember?.status === 'error'
    ? theme.colors.error
    : active
      ? theme.colors.success
      : featuredMember?.status === 'completed'
        ? theme.colors.primary
        : theme.colors.textSubtle;
  const crew = snapshot.members.slice(0, 4);

  return (
    <Card style={styles.presenceCard}>
      <View style={styles.presenceMain}>
        <LiveAgentAvatar
          member={featuredMember}
          active={active}
          color={statusColor}
          styles={styles}
        />
        <View style={styles.flex}>
          <View style={styles.presenceTitleRow}>
            <Text style={styles.presenceTitle} numberOfLines={1}>
              {featuredMember ? memberTitle(featuredMember, t) : t('Main Agent')}
            </Text>
            {featuredMember?.status === 'completed' ? (
              <Sparkles size={16} color={theme.colors.primary} strokeWidth={2} />
            ) : null}
          </View>
          <Text style={[styles.presenceDetail, { color: statusColor }]} numberOfLines={1}>
            {featuredMember ? memberDetail(featuredMember, t) : t('Standby')}
          </Text>
        </View>
        {featuredMember?.status === 'completed' ? (
          <CheckCircle2 size={22} color={theme.colors.success} strokeWidth={2} />
        ) : null}
      </View>

      <View style={styles.presenceFooter}>
        <View style={styles.crewGroup}>
          {crew.map((member, index) => {
            const color = member.status === 'error'
              ? theme.colors.error
              : member.status === 'working'
                ? theme.colors.success
                : theme.colors.textSubtle;
            return (
              <View
                key={`crew:${member.id}`}
                style={[styles.crewAvatar, index > 0 ? styles.crewAvatarOverlap : null]}
              >
                {memberIcon(member, color)}
              </View>
            );
          })}
          {snapshot.members.length > crew.length ? (
            <View style={[styles.crewAvatar, styles.crewAvatarOverlap]}>
              <Text style={styles.crewMore}>+{snapshot.members.length - crew.length}</Text>
            </View>
          ) : null}
        </View>
        <View style={styles.presenceBadge}>
          <LiveStatusDot active={snapshot.workingCount > 0} color={snapshot.workingCount > 0 ? theme.colors.success : theme.colors.textSubtle} styles={styles} />
          <Text style={styles.presenceBadgeText}>
            {snapshot.workingCount > 0 ? t('Live') : t('Standby')}
          </Text>
        </View>
      </View>
    </Card>
  );
}

function LiveAgentAvatar({
  member,
  active,
  color,
  styles,
}: {
  member: LiveMember | undefined;
  active: boolean;
  color: string;
  styles: ReturnType<typeof createStyles>;
}): React.JSX.Element {
  const reduceMotion = useReduceMotion();
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!active || reduceMotion) {
      progress.stopAnimation();
      progress.setValue(0);
      return undefined;
    }
    const animation = Animated.loop(Animated.timing(progress, {
      toValue: 1,
      duration: TimingPreset.slow * 4,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }));
    animation.start();
    return () => animation.stop();
  }, [active, progress, reduceMotion]);

  const pulseStyle = {
    opacity: progress.interpolate({ inputRange: [0, 0.45, 1], outputRange: [0, 0.42, 0] }),
    transform: [{
      scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1.38] }),
    }],
  };

  return (
    <View style={styles.presenceAvatarShell}>
      {active ? (
        <Animated.View style={[styles.presencePulse, { borderColor: color }, pulseStyle]} />
      ) : null}
      <View style={styles.presenceAvatar}>
        {member ? memberIcon(member, color) : <Bot size={22} color={color} strokeWidth={2} />}
      </View>
      <View style={[styles.presenceStatus, { backgroundColor: color }]} />
    </View>
  );
}

function LiveStatusDot({
  active,
  color,
  styles,
}: {
  active: boolean;
  color: string;
  styles: ReturnType<typeof createStyles>;
}): React.JSX.Element {
  const reduceMotion = useReduceMotion();
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!active || reduceMotion) {
      opacity.stopAnimation();
      opacity.setValue(1);
      return undefined;
    }
    const animation = Animated.loop(Animated.sequence([
      Animated.timing(opacity, {
        toValue: 0.35,
        duration: TimingPreset.slow * 2,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 1,
        duration: TimingPreset.slow * 2,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: true,
      }),
    ]));
    animation.start();
    return () => animation.stop();
  }, [active, opacity, reduceMotion]);

  return <Animated.View style={[styles.statusDot, { backgroundColor: color, opacity }]} />;
}

function Section({
  title,
  children,
  styles,
}: {
  title: string;
  children: React.ReactNode;
  styles: ReturnType<typeof createStyles>;
}): React.JSX.Element {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function MemberRow({
  member,
  isLast,
  onPress,
  styles,
}: {
  member: LiveMember;
  isLast: boolean;
  onPress: () => void;
  styles: ReturnType<typeof createStyles>;
}): React.JSX.Element {
  const { t } = useTranslation('common');
  const { theme } = useAppTheme();
  const statusColor = member.status === 'error'
    ? theme.colors.error
    : member.status === 'working'
      ? theme.colors.success
      : member.status === 'completed'
        ? theme.colors.primary
        : theme.colors.textSubtle;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.memberRow,
        !isLast ? styles.rowBorder : null,
        pressed ? styles.rowPressed : null,
      ]}
    >
      <View style={styles.memberIcon}>{memberIcon(member, statusColor)}</View>
      <View style={styles.flex}>
        <Text style={styles.memberTitle} numberOfLines={1}>{memberTitle(member, t)}</Text>
        <Text style={[styles.memberDetail, { color: statusColor }]} numberOfLines={1}>{memberDetail(member, t)}</Text>
      </View>
      <LiveStatusDot active={member.status === 'working'} color={statusColor} styles={styles} />
      <ChevronRight size={17} color={theme.colors.textSubtle} strokeWidth={2} />
    </Pressable>
  );
}

function AttentionRow({
  item,
  isLast,
  onPress,
  styles,
}: {
  item: LiveAttentionItem;
  isLast: boolean;
  onPress: () => void;
  styles: ReturnType<typeof createStyles>;
}): React.JSX.Element {
  const { t } = useTranslation('common');
  const { theme } = useAppTheme();
  const title = item.kind === 'cron_failures'
    ? t('{{count}} scheduled job failures', { count: item.count })
    : item.kind === 'pair_requests'
      ? t('{{count}} pending device requests', { count: item.count })
      : t('{{name}} run failed', { name: item.label || t('Agent') });
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.attentionRow,
        !isLast ? styles.rowBorder : null,
        pressed ? styles.rowPressed : null,
      ]}
    >
      <AlertCircle size={19} color={theme.colors.error} strokeWidth={2} />
      <Text style={styles.attentionTitle} numberOfLines={2}>{title}</Text>
      <ChevronRight size={18} color={theme.colors.textSubtle} strokeWidth={2} />
    </Pressable>
  );
}

function Metric({ label, value, styles }: { label: string; value: string; styles: ReturnType<typeof createStyles> }): React.JSX.Element {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    scroll: { flex: 1 },
    content: {
      paddingHorizontal: Space.lg,
      paddingBottom: Space.xxxl,
      gap: Space.lg,
    },
    flex: { flex: 1 },
    connectionCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.md,
      backgroundColor: colors.surface,
    },
    connectionIcon: {
      width: 36,
      height: 36,
      borderRadius: Radius.full,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surfaceMuted,
    },
    presenceCard: {
      gap: Space.lg,
      backgroundColor: colors.primarySoft,
      overflow: 'visible',
    },
    presenceMain: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.md,
    },
    presenceAvatarShell: {
      width: 52,
      height: 52,
      alignItems: 'center',
      justifyContent: 'center',
    },
    presencePulse: {
      position: 'absolute',
      width: 52,
      height: 52,
      borderRadius: Radius.full,
      borderWidth: StyleSheet.hairlineWidth,
    },
    presenceAvatar: {
      width: 44,
      height: 44,
      borderRadius: Radius.full,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    presenceStatus: {
      position: 'absolute',
      right: 2,
      bottom: 2,
      width: 12,
      height: 12,
      borderRadius: Radius.full,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.surface,
    },
    presenceTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.xs,
    },
    presenceTitle: {
      flexShrink: 1,
      color: colors.text,
      fontSize: FontSize.lg,
      lineHeight: LineHeight.lg,
      fontWeight: FontWeight.semibold,
    },
    presenceDetail: {
      marginTop: 2,
      fontSize: FontSize.md,
      lineHeight: LineHeight.md,
      fontWeight: FontWeight.medium,
    },
    presenceFooter: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    crewGroup: {
      minHeight: 30,
      flexDirection: 'row',
      alignItems: 'center',
      paddingLeft: 1,
    },
    crewAvatar: {
      width: 30,
      height: 30,
      borderRadius: Radius.full,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.primarySoft,
    },
    crewAvatarOverlap: { marginLeft: -7 },
    crewMore: {
      color: colors.textMuted,
      fontSize: FontSize.xs,
      lineHeight: LineHeight.xs,
      fontWeight: FontWeight.semibold,
    },
    presenceBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.sm,
      paddingHorizontal: Space.md,
      paddingVertical: Space.sm,
      borderRadius: Radius.full,
      backgroundColor: colors.surface,
    },
    presenceBadgeText: {
      color: colors.textMuted,
      fontSize: FontSize.sm,
      lineHeight: LineHeight.sm,
      fontWeight: FontWeight.semibold,
    },
    summaryRow: { flexDirection: 'row', gap: Space.sm },
    summaryCard: {
      flex: 1,
      minWidth: 0,
      alignItems: 'center',
      gap: Space.xs,
      paddingVertical: Space.md,
      paddingHorizontal: Space.xs,
    },
    summaryValue: {
      color: colors.text,
      fontSize: FontSize.xxl,
      lineHeight: LineHeight.xxl,
      fontWeight: FontWeight.bold,
    },
    summaryLabel: {
      color: colors.textMuted,
      fontSize: FontSize.xs,
      lineHeight: LineHeight.xs,
      fontWeight: FontWeight.medium,
    },
    section: { gap: Space.sm },
    sectionTitle: {
      color: colors.text,
      fontSize: FontSize.lg,
      lineHeight: LineHeight.lg,
      fontWeight: FontWeight.semibold,
    },
    listCard: { padding: 0, overflow: 'hidden' },
    loadingCard: {
      minHeight: 112,
      alignItems: 'center',
      justifyContent: 'center',
      gap: Space.md,
    },
    emptyCard: { alignItems: 'center', gap: Space.sm, paddingVertical: Space.xl },
    emptyIcon: {
      width: 48,
      height: 48,
      borderRadius: Radius.full,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.primarySoft,
    },
    emptyTitle: {
      color: colors.text,
      fontSize: FontSize.base,
      lineHeight: LineHeight.base,
      fontWeight: FontWeight.semibold,
    },
    emptyBody: {
      maxWidth: 280,
      color: colors.textMuted,
      textAlign: 'center',
      fontSize: FontSize.md,
      lineHeight: LineHeight.md,
    },
    memberRow: {
      minHeight: 64,
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.md,
      paddingHorizontal: Space.md,
    },
    memberIcon: {
      width: 36,
      height: 36,
      borderRadius: Radius.full,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surfaceMuted,
    },
    memberTitle: {
      color: colors.text,
      fontSize: FontSize.base,
      lineHeight: LineHeight.base,
      fontWeight: FontWeight.semibold,
    },
    memberDetail: {
      marginTop: 2,
      fontSize: FontSize.sm,
      lineHeight: LineHeight.sm,
      fontWeight: FontWeight.medium,
    },
    statusDot: { width: 7, height: 7, borderRadius: Radius.full },
    rowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
    rowPressed: { backgroundColor: colors.surfaceMuted },
    attentionRow: {
      minHeight: 54,
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.md,
      paddingHorizontal: Space.md,
    },
    attentionTitle: {
      flex: 1,
      color: colors.text,
      fontSize: FontSize.md,
      lineHeight: LineHeight.md,
      fontWeight: FontWeight.medium,
    },
    metricsCard: { flexDirection: 'row', paddingVertical: Space.lg, paddingHorizontal: Space.xs },
    metric: { flex: 1, minWidth: 0, alignItems: 'center', gap: Space.xs },
    metricValue: {
      color: colors.text,
      fontSize: FontSize.lg,
      lineHeight: LineHeight.lg,
      fontWeight: FontWeight.semibold,
    },
    metricLabel: {
      color: colors.textMuted,
      fontSize: FontSize.xs,
      lineHeight: LineHeight.xs,
      fontWeight: FontWeight.medium,
    },
    recentRow: {
      minHeight: 48,
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.sm,
      paddingHorizontal: Space.md,
    },
    recentDot: { width: 6, height: 6, borderRadius: Radius.full, backgroundColor: colors.primary },
    recentTitle: {
      flex: 1,
      color: colors.text,
      fontSize: FontSize.md,
      lineHeight: LineHeight.md,
      fontWeight: FontWeight.medium,
    },
    recentTime: {
      color: colors.textMuted,
      fontSize: FontSize.sm,
      lineHeight: LineHeight.sm,
    },
    cardTitle: {
      color: colors.text,
      fontSize: FontSize.base,
      lineHeight: LineHeight.base,
      fontWeight: FontWeight.semibold,
    },
    cardBody: {
      marginTop: 2,
      color: colors.textMuted,
      fontSize: FontSize.sm,
      lineHeight: LineHeight.sm,
    },
  });
}
