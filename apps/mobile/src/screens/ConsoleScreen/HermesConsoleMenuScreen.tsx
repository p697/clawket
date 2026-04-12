import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { BarChart3, BookOpen, Brain, Clock3, FolderCog, MessageCircle, MessageSquareText, RefreshCw, ScrollText, Sparkles, Wrench } from 'lucide-react-native';
import { useFocusEffect, useIsFocused, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { IconButton } from '../../components/ui';
import { useAppContext } from '../../contexts/AppContext';
import { analyticsEvents } from '../../services/analytics/events';
import {
  buildHermesConsoleActionDescriptors,
  type HermesConsoleActionIcon,
} from '../../services/hermes-console-entry-descriptors';
import { resolveHermesModelDisplayState } from '../../services/gateway-hermes-model-display';
import { loadGatewayHermesConsoleDashboard } from '../../services/gateway-hermes-console-dashboard';
import { resolveGatewayDocumentationDescriptor } from '../../services/gateway-doc-links';
import { resolveUsageCostSummaryDisplay } from '../../services/usage-cost-display';
import { useAppTheme } from '../../theme';
import { FontSize, FontWeight, Radius, Space } from '../../theme/tokens';
import { getDisplayAgentEmoji } from '../../utils/agent-emoji';
import { formatConsoleHeartbeatAge } from '../../utils/console-heartbeat';
import { formatTokens } from '../../utils/usage-format';
import type { ConsoleStackParamList } from './ConsoleTab';

type ConsoleMenuNavigation = NativeStackNavigationProp<ConsoleStackParamList, 'ConsoleMenu'>;

type HermesDashboardState = {
  agentName: string;
  agentEmoji: string;
  skillCount: number | null;
  todayNewSkills: number | null;
  currentModel: string | null;
  currentProvider: string | null;
  modelCount: number | null;
  sessions: number | null;
  memoryFiles: number | null;
  cronTotal: number | null;
  cronTodayRuns: number | null;
  todayUsageValue: string | null;
  todayUsageNote: string | null;
  lastHeartbeat: string | null;
  apiReachable: boolean | null;
  note: string | null;
};

const EMPTY_STATE: HermesDashboardState = {
  agentName: 'Hermes',
  agentEmoji: '🪽',
  skillCount: null,
  todayNewSkills: null,
  currentModel: null,
  currentProvider: null,
  modelCount: null,
  sessions: null,
  memoryFiles: null,
  cronTotal: null,
  cronTodayRuns: null,
  todayUsageValue: null,
  todayUsageNote: null,
  lastHeartbeat: null,
  apiReachable: null,
  note: null,
};

export function HermesConsoleMenuScreen(): React.JSX.Element {
  const { theme } = useAppTheme();
  const { t, i18n } = useTranslation('console');
  const { t: tCommon } = useTranslation('common');
  const { gateway, gatewayEpoch, foregroundEpoch, currentAgentId, config } = useAppContext();
  const navigation = useNavigation<ConsoleMenuNavigation>();
  const insets = useSafeAreaInsets();
  const isFocused = useIsFocused();
  const styles = useMemo(() => createStyles(theme.colors), [theme]);
  const [state, setState] = useState<HermesDashboardState>(EMPTY_STATE);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [pullRefreshing, setPullRefreshing] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const lastForegroundEpochRef = useRef<number | null>(null);
  const lastForegroundRefreshRef = useRef(0);
  const refreshSpin = useRef(new Animated.Value(0)).current;

  const todayDateKey = useMemo(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }, []);

  const load = useCallback(async (mode: 'initial' | 'refresh' | 'silent' = 'initial') => {
    if (mode === 'initial') setLoading(true);
    if (mode === 'refresh') setRefreshing(true);
    setLoadFailed(false);
    try {
      const bundle = await loadGatewayHermesConsoleDashboard(gateway, currentAgentId);
      const heartbeatTs = bundle.heartbeat?.ts;
      const heartbeatText = typeof heartbeatTs === 'number'
        ? (() => {
          const mins = Math.floor((Date.now() - heartbeatTs) / 60_000);
          const formatted = formatConsoleHeartbeatAge(
            mins,
            i18n.resolvedLanguage ?? i18n.language ?? 'en',
          );
          if (formatted.compactText) return formatted.compactText;
          if (formatted.count == null) return t(formatted.key);
          return t(formatted.key, { count: formatted.count });
        })()
        : null;
      const costSummaryDisplay = resolveUsageCostSummaryDisplay({
        usageResult: bundle.usage,
        costSummary: bundle.cost,
        t,
      });
      const totalCost = bundle.cost?.totals?.totalCost ?? bundle.usage?.totals?.totalCost ?? 0;
      const totalTokens = bundle.cost?.totals?.totalTokens ?? bundle.usage?.totals?.totalTokens ?? null;
      const formattedTokens = typeof totalTokens === 'number'
        ? t('{{count}} tokens', { count: formatTokens(totalTokens) })
        : null;
      const todayUsageValue = totalCost > 0
        ? costSummaryDisplay.valueLabel
        : formattedTokens;
      const todayUsageNote = costSummaryDisplay.subtitle;
      const skillEntries = bundle.skills?.skills ?? [];
      const todayNewSkills = skillEntries.filter((item) => {
        if (typeof item.createdAtMs !== 'number') return false;
        const created = new Date(item.createdAtMs);
        const createdKey = `${created.getFullYear()}-${String(created.getMonth() + 1).padStart(2, '0')}-${String(created.getDate()).padStart(2, '0')}`;
        return createdKey === todayDateKey;
      }).length;
      const cronOutputs = bundle.cronOutputs ?? [];
      const cronTodayRuns = cronOutputs.filter((item) => {
        const created = new Date(item.createdAt);
        const createdKey = `${created.getFullYear()}-${String(created.getMonth() + 1).padStart(2, '0')}-${String(created.getDate()).padStart(2, '0')}`;
        return createdKey === todayDateKey;
      }).length;

      setState({
        agentName: bundle.identity?.name || 'Hermes',
        agentEmoji: bundle.identity?.emoji || '🪽',
        skillCount: skillEntries.length,
        todayNewSkills,
        currentModel: bundle.modelState?.currentModel || null,
        currentProvider: bundle.modelState?.currentProvider || null,
        modelCount: bundle.modelCount,
        sessions: Array.isArray(bundle.sessions) ? bundle.sessions.length : null,
        memoryFiles: Array.isArray(bundle.files) ? bundle.files.length : null,
        cronTotal: Array.isArray(bundle.cronJobs) ? bundle.cronJobs.length : null,
        cronTodayRuns,
        todayUsageValue,
        todayUsageNote,
        lastHeartbeat: heartbeatText,
        apiReachable: typeof bundle.heartbeat?.hermesApiReachable === 'boolean'
          ? bundle.heartbeat.hermesApiReachable
          : null,
        note: bundle.modelState?.note ?? null,
      });
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
      setState((prev) => (prev.apiReachable === false ? prev : {
        ...prev,
        apiReachable: false,
      }));
    } finally {
      if (mode === 'initial') setLoading(false);
      if (mode === 'refresh') setRefreshing(false);
    }
  }, [currentAgentId, gateway, i18n.language, i18n.resolvedLanguage, t, todayDateKey]);

  useEffect(() => {
    if (!isFocused) return;
    void load('initial');
  }, [gatewayEpoch, isFocused, load]);

  useFocusEffect(useCallback(() => {
    void load('silent');
  }, [load]));

  useEffect(() => {
    if (!isFocused) return;
    if (lastForegroundEpochRef.current === foregroundEpoch) return;
    lastForegroundEpochRef.current = foregroundEpoch;
    const now = Date.now();
    if (now - lastForegroundRefreshRef.current < 2000) return;
    lastForegroundRefreshRef.current = now;
    void load('silent');
  }, [foregroundEpoch, isFocused, load]);

  const docsDescriptor = useMemo(() => resolveGatewayDocumentationDescriptor(config), [config]);
  const modelDisplay = resolveHermesModelDisplayState({
    currentModel: state.currentModel,
    currentProvider: state.currentProvider,
    loading: loading && !state.currentModel,
    error: loadFailed,
  });
  const heroProviderValue = modelDisplay.status === 'loading'
    ? tCommon('Loading...')
    : modelDisplay.provider || t('Unavailable');
  const heroModelValue = modelDisplay.status === 'loading'
    ? tCommon('Loading...')
    : modelDisplay.model || t('Unavailable');
  const heroSkillValue = loading && state.skillCount == null
    ? tCommon('Loading...')
    : t('{{count}} skills', { count: state.skillCount ?? 0 });
  const heroSkillMeta = typeof state.todayNewSkills === 'number'
    ? t('{{count}} added today', { count: state.todayNewSkills })
    : t('Tap to review Hermes skills');
  const statusText = loading && !state.currentModel
    ? t('Loading Hermes models...')
    : state.apiReachable == null
    ? t('Hermes bridge connected')
    : state.apiReachable
      ? t('Hermes API reachable')
      : t('Hermes API is degraded');

  const nav = useCallback((screen: keyof ConsoleStackParamList, source: string, params?: object) => {
    analyticsEvents.consoleEntryTapped({
      destination: screen,
      source,
    });
    if (params) {
      navigation.navigate(screen as any, params as any);
      return;
    }
    navigation.navigate(screen as any);
  }, [navigation]);

  const actionDescriptors = useMemo(
    () => buildHermesConsoleActionDescriptors({
      tConsole: t,
      tCommon,
      docsUrl: docsDescriptor.url,
    }),
    [docsDescriptor.url, t, tCommon],
  );
  const quickActions = useMemo(
    () => ({
      usage: actionDescriptors.find((item) => item.key === 'usage') ?? null,
      memory: actionDescriptors.find((item) => item.key === 'memory') ?? null,
    }),
    [actionDescriptors],
  );
  const listActions = useMemo(
    () => actionDescriptors.filter((item) => !['memory', 'usage', 'skills', 'cron'].includes(item.key)),
    [actionDescriptors],
  );
  const refreshIconStyle = useMemo(
    () => ({
      transform: [
        {
          rotate: refreshSpin.interpolate({
            inputRange: [0, 1],
            outputRange: ['0deg', '360deg'],
          }),
        },
      ],
    }),
    [refreshSpin],
  );

  useEffect(() => {
    if (!refreshing) {
      refreshSpin.stopAnimation();
      refreshSpin.setValue(0);
      return;
    }

    refreshSpin.setValue(0);
    const spinLoop = Animated.loop(
      Animated.timing(refreshSpin, {
        toValue: 1,
        duration: 900,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    spinLoop.start();

    return () => {
      spinLoop.stop();
      refreshSpin.stopAnimation();
      refreshSpin.setValue(0);
    };
  }, [refreshSpin, refreshing]);

  const handlePullToRefresh = useCallback(() => {
    void (async () => {
      setPullRefreshing(true);
      try {
        await load('refresh');
      } finally {
        setPullRefreshing(false);
      }
    })();
  }, [load]);

  const handleHeaderRefresh = useCallback(() => {
    void load('refresh');
  }, [load]);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.headerRow}>
        <View style={styles.headerIdentity}>
          <Text style={styles.headerEmoji}>{getDisplayAgentEmoji(state.agentEmoji)}</Text>
          <View style={styles.headerTextWrap}>
            <Text style={styles.headerName}>{state.agentName}</Text>
            <Text style={styles.headerMeta}>{statusText}</Text>
          </View>
        </View>
        <IconButton
          icon={(
            <Animated.View style={refreshing ? refreshIconStyle : undefined}>
              <RefreshCw size={20} color={theme.colors.textMuted} strokeWidth={2} />
            </Animated.View>
          )}
          onPress={handleHeaderRefresh}
          disabled={refreshing}
        />
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={(
          <RefreshControl
            refreshing={pullRefreshing}
            onRefresh={handlePullToRefresh}
            tintColor={theme.colors.primary}
          />
        )}
      >
        <View style={styles.heroCard}>
          <Text style={styles.heroProviderValue} numberOfLines={1}>
            {t('Skills')}
          </Text>
          <View style={styles.heroSkillRow}>
            <Text style={styles.heroValue} numberOfLines={2}>
              {heroSkillValue}
            </Text>
            <Text style={styles.heroMetaInline} numberOfLines={1}>
              {heroSkillMeta}
            </Text>
          </View>
          <TouchableOpacity
            style={styles.primaryButton}
            activeOpacity={0.75}
            onPress={() => nav('SkillList', 'hermes_console_skill_card')}
          >
            <FolderCog size={16} color={theme.colors.primary} strokeWidth={2} />
            <Text style={styles.primaryButtonText}>{t('Manage Skills')}</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.quickGrid}>
          {quickActions.usage ? (
            <TouchableOpacity
              style={styles.quickCard}
              activeOpacity={0.75}
              onPress={() => nav(quickActions.usage!.screen, quickActions.usage!.source, quickActions.usage!.params)}
            >
              <View style={styles.quickHeader}>
                <View style={styles.quickIconWrap}>
                  {renderHermesActionIcon(quickActions.usage.icon, theme.colors.primary)}
                </View>
                <Text style={styles.quickLabel}>{quickActions.usage.title}</Text>
              </View>
              <Text style={styles.quickValue} numberOfLines={2}>{state.todayUsageValue ?? '—'}</Text>
              <Text style={styles.quickMeta} numberOfLines={2}>
                {state.todayUsageNote ?? t('View usage details')}
              </Text>
            </TouchableOpacity>
          ) : null}

          {quickActions.memory ? (
            <TouchableOpacity
              style={styles.quickCard}
              activeOpacity={0.75}
              onPress={() => nav(quickActions.memory!.screen, quickActions.memory!.source, quickActions.memory!.params)}
            >
              <View style={styles.quickHeader}>
                <View style={styles.quickIconWrap}>
                  {renderHermesActionIcon(quickActions.memory.icon, theme.colors.primary)}
                </View>
                <Text style={styles.quickLabel}>{quickActions.memory.title}</Text>
              </View>
              <Text style={styles.quickValue} numberOfLines={2}>
                {state.memoryFiles != null ? t('{{count}} files', { count: state.memoryFiles }) : tCommon('Loading...')}
              </Text>
              <Text style={styles.quickMeta} numberOfLines={2}>{t('View and edit directly')}</Text>
            </TouchableOpacity>
          ) : null}

          <TouchableOpacity
            style={styles.quickCard}
            activeOpacity={0.75}
            onPress={() => nav('ModelList', 'hermes_console_model_card')}
          >
            <View style={styles.quickHeader}>
              <View style={styles.quickIconWrap}>
                <Sparkles size={18} color={theme.colors.primary} strokeWidth={2} />
              </View>
              <Text style={styles.quickLabel}>{t('Models')}</Text>
            </View>
            <Text style={styles.quickValue} numberOfLines={2}>{heroModelValue}</Text>
            <Text style={styles.quickMeta} numberOfLines={2}>
              {heroProviderValue}
              {state.modelCount != null ? ` · ${t('{{count}} models', { count: state.modelCount })}` : ''}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.quickCard}
            activeOpacity={0.75}
            onPress={() => nav('CronList', 'hermes_console_cron_card')}
          >
            <View style={styles.quickHeader}>
              <View style={styles.quickIconWrap}>
                <Clock3 size={18} color={theme.colors.primary} strokeWidth={2} />
              </View>
              <Text style={styles.quickLabel}>{t('Scheduled Tasks')}</Text>
            </View>
            <Text style={styles.quickValue} numberOfLines={2}>
              {state.cronTotal != null ? t('{{count}} tasks', { count: state.cronTotal }) : tCommon('Loading...')}
            </Text>
            <Text style={styles.quickMeta} numberOfLines={2}>
              {t('{{count}} runs today', { count: typeof state.cronTodayRuns === 'number' ? state.cronTodayRuns : 0 })}
            </Text>
          </TouchableOpacity>

        </View>

        {listActions.map((item) => (
          <TouchableOpacity
            key={item.key}
            style={styles.actionCard}
            activeOpacity={0.75}
            onPress={() => nav(item.screen, item.source, item.params)}
          >
            <View style={styles.actionIconWrap}>
              {renderHermesActionIcon(item.icon, theme.colors.primary)}
            </View>
            <View style={styles.actionTextWrap}>
              <Text style={styles.actionTitle}>{item.title}</Text>
              <Text style={styles.actionDescription}>{item.description}</Text>
            </View>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

function renderHermesActionIcon(icon: HermesConsoleActionIcon, color: string): React.JSX.Element {
  switch (icon) {
    case 'sessions':
      return <MessageSquareText size={18} color={color} strokeWidth={2} />;
    case 'history':
      return <MessageCircle size={18} color={color} strokeWidth={2} />;
    case 'memory':
      return <Brain size={18} color={color} strokeWidth={2} />;
    case 'usage':
      return <BarChart3 size={18} color={color} strokeWidth={2} />;
    case 'cron':
      return <Clock3 size={18} color={color} strokeWidth={2} />;
    case 'skills':
      return <Wrench size={18} color={color} strokeWidth={2} />;
    case 'docs':
      return <BookOpen size={18} color={color} strokeWidth={2} />;
    case 'sparkles':
    default:
      return <Sparkles size={18} color={color} strokeWidth={2} />;
  }
}

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: colors.background,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: Space.lg,
      paddingTop: Space.lg,
      paddingBottom: Space.md,
    },
    headerIdentity: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.md,
      flex: 1,
    },
    headerEmoji: {
      fontSize: 34,
    },
    headerTextWrap: {
      flex: 1,
    },
    headerName: {
      fontSize: 22,
      fontWeight: FontWeight.bold,
      color: colors.text,
    },
    headerMeta: {
      marginTop: 2,
      fontSize: FontSize.sm,
      color: colors.textMuted,
    },
    content: {
      paddingHorizontal: Space.lg,
      paddingTop: Space.sm,
      paddingBottom: Space.xxxl,
      gap: Space.md,
    },
    heroCard: {
      borderRadius: Radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      padding: Space.lg,
      gap: Space.xs,
    },
    heroModelBlock: {
      marginTop: Space.xs,
      gap: 2,
    },
    heroSkillRow: {
      flexDirection: 'row',
      alignItems: 'baseline',
      justifyContent: 'space-between',
      gap: Space.md,
    },
    heroProviderValue: {
      fontSize: FontSize.sm,
      fontWeight: FontWeight.semibold,
      color: colors.primary,
      letterSpacing: 0.2,
    },
    heroValue: {
      fontSize: 22,
      fontWeight: FontWeight.bold,
      color: colors.text,
      lineHeight: 28,
    },
    heroMetaInline: {
      flexShrink: 1,
      textAlign: 'right',
      fontSize: FontSize.sm,
      color: colors.textMuted,
      lineHeight: 20,
    },
    note: {
      marginTop: Space.xs,
      fontSize: FontSize.sm,
      color: colors.textSubtle,
      lineHeight: 20,
    },
    primaryButton: {
      marginTop: Space.sm,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: Space.xs,
      paddingVertical: 12,
      borderRadius: Radius.md,
      backgroundColor: colors.primarySoft,
    },
    primaryButtonText: {
      fontSize: FontSize.base,
      fontWeight: FontWeight.semibold,
      color: colors.primary,
    },
    quickGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: Space.sm,
    },
    quickCard: {
      width: '48.5%',
      borderRadius: Radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      padding: Space.md,
      gap: Space.sm,
    },
    quickHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.sm,
    },
    quickIconWrap: {
      width: 30,
      height: 30,
      borderRadius: 15,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.primarySoft,
    },
    quickLabel: {
      flex: 1,
      fontSize: FontSize.sm,
      fontWeight: FontWeight.semibold,
      color: colors.textMuted,
    },
    quickValue: {
      fontSize: FontSize.lg,
      fontWeight: FontWeight.semibold,
      color: colors.text,
      lineHeight: 24,
    },
    quickMeta: {
      fontSize: FontSize.sm,
      color: colors.textSubtle,
      lineHeight: 20,
    },
    actionCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.md,
      borderRadius: Radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      paddingHorizontal: Space.md,
      paddingVertical: Space.md + 2,      
    },
    actionIconWrap: {
      width: 38,
      height: 38,
      borderRadius: 19,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.primarySoft,
    },
    actionTextWrap: {
      flex: 1,
      gap: 2,
    },
    actionTitle: {
      fontSize: FontSize.base,
      fontWeight: FontWeight.semibold,
      color: colors.text,
    },
    actionDescription: {
      fontSize: FontSize.sm,
      color: colors.textMuted,
      lineHeight: 20,
    },
  });
}
