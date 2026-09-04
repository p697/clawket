import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Image,
  LayoutChangeEvent,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from 'react-native';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { CreditCard, LogOut, RefreshCw } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { EmptyState, Card, HeaderTextAction, IconButton } from '../../components/ui';
import { useAppContext } from '../../contexts/AppContext';
import {
  YouMindClient,
  getYouMindAuthFailureReason,
  type YouMindCreditAccount,
  type YouMindCreditCategory,
  type YouMindCreditUsageLast30Days,
  type YouMindCreditUsagePeriod,
  type YouMindCurrentUser,
  type YouMindPermanentCreditGrant,
} from '../../services/youmind';
import { resolveGatewayBackendKind } from '../../services/gateway-backends';
import { useAppTheme } from '../../theme';
import { FontSize, FontWeight, PresentationColor, Radius, Space } from '../../theme/tokens';
import type { ProfileStackParamList } from './ProfileTab';

type ProfileData = {
  user: YouMindCurrentUser | null;
  creditAccount: YouMindCreditAccount | null;
  currentPeriodUsage: YouMindCreditUsagePeriod;
  last30DaysUsage: YouMindCreditUsageLast30Days;
  grants: YouMindPermanentCreditGrant[];
};

type ScreenState =
  | { kind: 'loading' }
  | { kind: 'authRequired' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; data: ProfileData; partialError: string | null };

const CATEGORY_META: Array<{
  key: YouMindCreditCategory;
  label: string;
  color: string;
}> = [
  { key: 'chat', label: 'Chat', color: PresentationColor.creditCategory.chat },
  { key: 'writing', label: 'Writing', color: PresentationColor.creditCategory.writing },
  { key: 'search', label: 'Search', color: PresentationColor.creditCategory.search },
  { key: 'image', label: 'Image', color: PresentationColor.creditCategory.image },
  { key: 'audio', label: 'Audio', color: PresentationColor.creditCategory.audio },
  { key: 'parsing', label: 'Parsing', color: PresentationColor.creditCategory.parsing },
  { key: 'video', label: 'Video', color: PresentationColor.creditCategory.video },
];

function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(value);
}

function formatDate(valueMs: number | null): string {
  if (!valueMs) return 'Unknown';
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(new Date(valueMs));
  } catch {
    return new Date(valueMs).toLocaleDateString();
  }
}

function formatDateTime(valueMs: number): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(valueMs));
  } catch {
    return new Date(valueMs).toLocaleString();
  }
}

function formatRelativeDays(targetMs: number): string {
  const diffMs = targetMs - Date.now();
  const days = Math.max(0, Math.ceil(diffMs / 86_400_000));
  if (days <= 1) return '1 day';
  return `${days} days`;
}

function formatTier(value: string | null | undefined): string {
  if (value === 'max') return 'Max';
  if (value === 'pro') return 'Pro';
  return 'Free';
}

function buildInitials(name: string | null, email: string | null): string {
  const source = (name || email || 'Y').trim();
  if (!source) return 'Y';
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]?.[0] || ''}${parts[1]?.[0] || ''}`.toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
}

function getTopCategory(usage: YouMindCreditUsagePeriod): string | null {
  const ranked = CATEGORY_META
    .map((item) => ({ ...item, value: usage.summary.byCategory[item.key] }))
    .sort((left, right) => right.value - left.value);
  return ranked[0] && ranked[0].value > 0 ? ranked[0].label : null;
}

function buildEmptyProfileData(): ProfileData {
  return {
    user: null,
    creditAccount: null,
    currentPeriodUsage: {
      summary: {
        totalConsumed: 0,
        byCategory: {
          chat: 0,
          writing: 0,
          search: 0,
          image: 0,
          audio: 0,
          parsing: 0,
          video: 0,
        },
      },
      dailyBreakdown: [],
      currentPeriodStartMs: Date.now(),
      currentPeriodEndMs: Date.now(),
    },
    last30DaysUsage: {
      summary: {
        totalConsumed: 0,
        byCategory: {
          chat: 0,
          writing: 0,
          search: 0,
          image: 0,
          audio: 0,
          parsing: 0,
          video: 0,
        },
      },
      dailyBreakdown: [],
      currentPeriodStartDate: '',
      currentPeriodEndDate: '',
    },
    grants: [],
  };
}

function useSkeletonOpacity(): Animated.Value {
  const opacity = useRef(new Animated.Value(0.5)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.5, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);

  return opacity;
}

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    root: {
      flex: 1,
    },
    content: {
      paddingHorizontal: Space.lg,
      paddingBottom: Space.xxxl,
      gap: Space.lg,
    },
    topSpacer: {
      gap: Space.xs,
    },
    pageTitle: {
      fontSize: FontSize.xxl,
      fontWeight: FontWeight.bold,
      color: colors.text,
    },
    pageHeaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: Space.md,
    },
    headerMeta: {
      fontSize: FontSize.sm,
      color: colors.textSubtle,
      marginTop: Space.xs,
    },
    sectionTitle: {
      fontSize: FontSize.lg,
      fontWeight: FontWeight.semibold,
      color: colors.text,
      marginBottom: Space.md,
    },
    accountRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.md,
    },
    accountCard: {
      marginTop: -Space.sm,
    },
    avatar: {
      width: 64,
      height: 64,
      borderRadius: Radius.full,
      backgroundColor: colors.primarySoft,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },
    avatarImage: {
      width: '100%',
      height: '100%',
    },
    avatarFallback: {
      fontSize: FontSize.xl,
      fontWeight: FontWeight.bold,
      color: colors.primary,
    },
    accountCopy: {
      flex: 1,
      gap: 2,
    },
    accountNameRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.sm,
      flexWrap: 'wrap',
    },
    accountName: {
      fontSize: FontSize.xxl,
      fontWeight: FontWeight.bold,
      color: colors.text,
    },
    accountEmail: {
      fontSize: FontSize.base,
      color: colors.textMuted,
    },
    badge: {
      borderRadius: Radius.full,
      paddingHorizontal: Space.sm + 2,
      paddingVertical: Space.xs,
      backgroundColor: colors.primarySoft,
    },
    badgeText: {
      fontSize: FontSize.xs,
      fontWeight: FontWeight.semibold,
      color: colors.primary,
    },
    metaList: {
      gap: Space.xs,
      marginTop: Space.md,
    },
    metaText: {
      fontSize: FontSize.sm,
      color: colors.textMuted,
    },
    heroValue: {
      fontSize: FontSize.displayHero,
      fontWeight: FontWeight.bold,
      color: colors.text,
    },
    heroValueRow: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: Space.xs,
    },
    heroLabel: {
      fontSize: FontSize.base,
      color: colors.textMuted,
      marginBottom: 4,
    },
    progressTrack: {
      height: 10,
      borderRadius: Radius.full,
      backgroundColor: colors.surfaceMuted,
      overflow: 'hidden',
      marginTop: Space.md,
    },
    progressFill: {
      height: '100%',
      borderRadius: Radius.full,
      backgroundColor: colors.primary,
    },
    summaryGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: Space.md,
      marginTop: Space.md,
    },
    summaryTile: {
      minWidth: '47%',
      flexGrow: 1,
      borderRadius: Radius.md,
      backgroundColor: colors.surfaceMuted,
      paddingHorizontal: Space.md,
      paddingVertical: Space.md,
    },
    summaryTileLabel: {
      fontSize: FontSize.sm,
      color: colors.textMuted,
      marginBottom: Space.xs,
    },
    summaryTileValue: {
      fontSize: FontSize.lg,
      fontWeight: FontWeight.semibold,
      color: colors.text,
    },
    infoText: {
      fontSize: FontSize.sm,
      color: colors.textMuted,
      marginTop: Space.md,
      lineHeight: 18,
    },
    insightRow: {
      flexDirection: 'row',
      gap: Space.md,
      marginBottom: Space.md,
    },
    insightPill: {
      flex: 1,
      borderRadius: Radius.md,
      backgroundColor: colors.surfaceMuted,
      paddingHorizontal: Space.md,
      paddingVertical: Space.md,
    },
    insightLabel: {
      fontSize: FontSize.sm,
      color: colors.textMuted,
      marginBottom: Space.xs,
    },
    insightValue: {
      fontSize: FontSize.lg,
      fontWeight: FontWeight.semibold,
      color: colors.text,
    },
    chartWrap: {
      paddingRight: Space.sm,
      marginTop: Space.sm,
    },
    chartBarsRow: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      justifyContent: 'space-between',
      gap: Space.sm,
      minHeight: 154,
      paddingTop: 2,
    },
    chartBarItem: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'flex-end',
      gap: Space.xs,
    },
    chartBarTrack: {
      width: '100%',
      height: 114,
      borderRadius: Radius.md,
      backgroundColor: colors.surfaceMuted,
      justifyContent: 'flex-end',
      overflow: 'hidden',
    },
    chartBarFill: {
      width: '100%',
      minHeight: 4,
      borderRadius: Radius.md,
      backgroundColor: colors.primary,
    },
    chartBarLabel: {
      fontSize: FontSize.xs,
      color: colors.textMuted,
    },
    chartBarValue: {
      fontSize: FontSize.xs,
      color: colors.textSubtle,
    },
    chartMeta: {
      fontSize: FontSize.sm,
      color: colors.textMuted,
      marginBottom: Space.sm,
    },
    categoryList: {
      marginTop: Space.lg,
      gap: Space.sm,
    },
    categoryRow: {
      gap: Space.xs,
    },
    categoryHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: Space.md,
    },
    categoryLabel: {
      fontSize: FontSize.base,
      color: colors.text,
      fontWeight: FontWeight.medium,
    },
    categoryValue: {
      fontSize: FontSize.sm,
      color: colors.textMuted,
    },
    categoryTrack: {
      height: 8,
      borderRadius: Radius.full,
      backgroundColor: colors.surfaceMuted,
      overflow: 'hidden',
    },
    categoryFill: {
      height: '100%',
      borderRadius: Radius.full,
    },
    grantRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: Space.md,
      paddingVertical: Space.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    grantRowLast: {
      borderBottomWidth: 0,
    },
    grantCopy: {
      flex: 1,
      gap: 2,
    },
    grantReason: {
      fontSize: FontSize.base,
      color: colors.text,
      fontWeight: FontWeight.medium,
    },
    grantDate: {
      fontSize: FontSize.sm,
      color: colors.textMuted,
    },
    grantAmount: {
      fontSize: FontSize.base,
      color: colors.primary,
      fontWeight: FontWeight.semibold,
    },
    inlineBanner: {
      borderRadius: Radius.md,
      paddingHorizontal: Space.md,
      paddingVertical: Space.sm,
      backgroundColor: colors.primarySoft,
    },
    inlineBannerText: {
      fontSize: FontSize.sm,
      color: colors.text,
    },
    cardHeaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: Space.md,
      marginBottom: Space.sm,
    },
    emptyList: {
      fontSize: FontSize.sm,
      color: colors.textMuted,
      marginTop: Space.sm,
    },
    signOutButton: {
      marginTop: Space.sm,
      borderRadius: Radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.borderStrong,
      paddingVertical: Space.md,
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'row',
      gap: Space.sm,
    },
    signOutText: {
      fontSize: FontSize.base,
      fontWeight: FontWeight.semibold,
      color: colors.text,
    },
    skeletonBlock: {
      backgroundColor: colors.border,
    },
    skeletonChartRow: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      justifyContent: 'space-between',
      gap: Space.sm,
      minHeight: 154,
      marginTop: Space.sm,
    },
    skeletonChartItem: {
      flex: 1,
      alignItems: 'center',
      gap: Space.xs,
    },
    skeletonButton: {
      height: 50,
      borderRadius: Radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.borderStrong,
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: Space.lg,
    },
  });
}

type SkeletonLineProps = {
  width?: number | `${number}%`;
  height: number;
  radius?: number;
  style?: ViewStyle;
};

function SkeletonLine({ width = '100%', height, radius = Radius.sm, style }: SkeletonLineProps): React.JSX.Element {
  const styles = useProfileSkeletonStyles();
  const opacity = useSkeletonOpacity();

  return (
    <Animated.View
      style={[
        styles.skeletonBlock,
        {
          width,
          height,
          borderRadius: radius,
          opacity,
        },
        style,
      ]}
    />
  );
}

function useProfileSkeletonStyles() {
  const { theme } = useAppTheme();
  return useMemo(() => createStyles(theme.colors), [theme.colors]);
}

function YouMindProfileSkeleton({
  insetsTop,
}: {
  insetsTop: number;
}): React.JSX.Element {
  const styles = useProfileSkeletonStyles();

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="never"
      scrollEnabled={false}
    >
      <View style={[styles.topSpacer, { paddingTop: insetsTop + Space.md }]}>
        <View style={styles.pageHeaderRow}>
          <SkeletonLine width={112} height={32} radius={Radius.md} />
          <SkeletonLine width={36} height={36} radius={Radius.full} />
        </View>
      </View>

      <Card style={styles.accountCard}>
        <View style={styles.accountRow}>
          <SkeletonLine width={64} height={64} radius={Radius.full} />
          <View style={styles.accountCopy}>
            <View style={styles.accountNameRow}>
              <SkeletonLine width="44%" height={28} radius={Radius.md} />
              <SkeletonLine width={56} height={24} radius={Radius.full} />
            </View>
            <SkeletonLine width="58%" height={18} style={{ marginTop: 4 }} />
            <SkeletonLine width="36%" height={14} style={{ marginTop: 8 }} />
          </View>
        </View>
      </Card>

      <Card>
        <SkeletonLine width={84} height={24} style={{ marginBottom: Space.md }} />
        <View style={styles.heroValueRow}>
          <SkeletonLine width={104} height={36} radius={Radius.md} />
          <SkeletonLine width={88} height={18} style={{ marginBottom: 4 }} />
        </View>
        <SkeletonLine width="100%" height={10} radius={Radius.full} style={{ marginTop: Space.md }} />
        <SkeletonLine width="82%" height={16} style={{ marginTop: Space.md }} />
        <View style={styles.summaryGrid}>
          <View style={styles.summaryTile}>
            <SkeletonLine width="42%" height={14} style={{ marginBottom: Space.xs }} />
            <SkeletonLine width="54%" height={24} radius={Radius.md} />
          </View>
          <View style={styles.summaryTile}>
            <SkeletonLine width="46%" height={14} style={{ marginBottom: Space.xs }} />
            <SkeletonLine width="50%" height={24} radius={Radius.md} />
          </View>
        </View>
        <SkeletonLine width="64%" height={16} style={{ marginTop: Space.md }} />
      </Card>

      <Card>
        <SkeletonLine width={126} height={24} style={{ marginBottom: Space.md }} />
        <View style={styles.insightRow}>
          <View style={styles.insightPill}>
            <SkeletonLine width="62%" height={14} style={{ marginBottom: Space.xs }} />
            <SkeletonLine width="48%" height={24} radius={Radius.md} />
          </View>
          <View style={styles.insightPill}>
            <SkeletonLine width="56%" height={14} style={{ marginBottom: Space.xs }} />
            <SkeletonLine width="60%" height={24} radius={Radius.md} />
          </View>
        </View>
        <SkeletonLine width="52%" height={16} style={{ marginBottom: Space.sm }} />
        <View style={styles.skeletonChartRow}>
          {[68, 96, 52, 82, 112, 74, 88].map((height, index) => (
            <View key={index} style={styles.skeletonChartItem}>
              <SkeletonLine width="70%" height={12} />
              <SkeletonLine width="100%" height={height} radius={Radius.md} />
              <SkeletonLine width="66%" height={12} />
            </View>
          ))}
        </View>
        <View style={styles.categoryList}>
          {Array.from({ length: 5 }).map((_, index) => (
            <View key={index} style={styles.categoryRow}>
              <View style={styles.categoryHeader}>
                <SkeletonLine width="24%" height={16} />
                <SkeletonLine width="22%" height={14} />
              </View>
              <SkeletonLine width="100%" height={8} radius={Radius.full} />
            </View>
          ))}
        </View>
      </Card>

      <Card>
        <View style={styles.cardHeaderRow}>
          <SkeletonLine width={128} height={24} />
          <SkeletonLine width={64} height={18} />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: Space.sm, marginBottom: Space.sm }}>
          <SkeletonLine width={18} height={18} radius={Radius.full} />
          <SkeletonLine width="68%" height={16} />
        </View>
        {Array.from({ length: 3 }).map((_, index, array) => (
          <View
            key={index}
            style={[styles.grantRow, index === array.length - 1 ? styles.grantRowLast : null]}
          >
            <View style={styles.grantCopy}>
              <SkeletonLine width="52%" height={16} />
              <SkeletonLine width="34%" height={14} />
            </View>
            <SkeletonLine width={48} height={18} />
          </View>
        ))}
      </Card>

      <View style={styles.skeletonButton}>
        <SkeletonLine width={160} height={18} />
      </View>
    </ScrollView>
  );
}

export function YouMindProfileScreen(): React.JSX.Element {
  const navigation = useNavigation<NativeStackNavigationProp<ProfileStackParamList, 'ProfileHome'>>();
  const isFocused = useIsFocused();
  const { theme } = useAppTheme();
  const { config, activeGatewayConfigId } = useAppContext();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);
  const backendKind = resolveGatewayBackendKind(config);
  const client = useMemo(
    () => new YouMindClient(config?.url || 'https://youmind.com', { authScopeKey: activeGatewayConfigId }),
    [activeGatewayConfigId, config?.url],
  );
  const [state, setState] = useState<ScreenState>({ kind: 'loading' });
  const [pullRefreshing, setPullRefreshing] = useState(false);
  const [buttonRefreshing, setButtonRefreshing] = useState(false);
  const [chartWidth, setChartWidth] = useState(0);
  const refreshSpin = useState(() => new Animated.Value(0))[0];
  const lastLoadKeyRef = useRef<string | null>(null);
  const loadKey = `${backendKind}:${config?.url ?? ''}`;

  useEffect(() => {
    if (!buttonRefreshing) {
      refreshSpin.stopAnimation();
      refreshSpin.setValue(0);
      return;
    }

    const loop = Animated.loop(
      Animated.timing(refreshSpin, {
        toValue: 1,
        duration: 800,
        useNativeDriver: true,
      }),
    );
    loop.start();

    return () => {
      loop.stop();
      refreshSpin.stopAnimation();
      refreshSpin.setValue(0);
    };
  }, [buttonRefreshing, refreshSpin]);

  const load = useCallback(async (mode: 'initial' | 'focus' | 'pull' | 'button' = 'initial') => {
    if (mode === 'pull') setPullRefreshing(true);
    if (mode === 'button') setButtonRefreshing(true);
    if (mode === 'initial') setState({ kind: 'loading' });
    try {
      if (backendKind !== 'youmind') {
        setState({ kind: 'error', message: 'Profile is only available for YouMind connections.' });
        return;
      }
      const session = await client.getValidSession();
      if (!session) {
        setState({ kind: 'authRequired' });
        return;
      }
      const [
        userResult,
        creditAccountResult,
        currentPeriodResult,
        last30DaysResult,
        grantsResult,
      ] = await Promise.allSettled([
        client.getCurrentUser(),
        client.getCreditAccount(),
        client.listCreditsConsumeTransactionsInCurrentPeriod(),
        client.listCreditsConsumeTransactionsInLast30Days(),
        client.listPermanentCreditGrants({ current: 0, pageSize: 5 }),
      ]);

      const baseData = buildEmptyProfileData();
      baseData.user = userResult.status === 'fulfilled'
        ? userResult.value
        : (session.user
            ? {
                id: session.user.id || '',
                email: session.user.email || null,
                name: session.user.name || null,
                avatarUrl: session.user.avatarUrl || null,
                timeZone: null,
                subscription: null,
              }
            : null);
      baseData.creditAccount = creditAccountResult.status === 'fulfilled' ? creditAccountResult.value : null;
      baseData.currentPeriodUsage = currentPeriodResult.status === 'fulfilled'
        ? currentPeriodResult.value
        : baseData.currentPeriodUsage;
      baseData.last30DaysUsage = last30DaysResult.status === 'fulfilled'
        ? last30DaysResult.value
        : baseData.last30DaysUsage;
      baseData.grants = grantsResult.status === 'fulfilled' ? grantsResult.value.data : [];

      const partialErrors = [
        userResult,
        creditAccountResult,
        currentPeriodResult,
        last30DaysResult,
        grantsResult,
      ]
        .filter((item): item is PromiseRejectedResult => item.status === 'rejected')
        .map((item) => (item.reason instanceof Error ? item.reason.message : 'Some profile data failed to load.'));

      setState({
        kind: 'ready',
        data: baseData,
        partialError: partialErrors[0] ?? null,
      });
    } catch (error) {
      if (getYouMindAuthFailureReason(error, { hadStoredSession: true })) {
        setState({ kind: 'authRequired' });
        return;
      }
      setState({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Failed to load your YouMind profile.',
      });
    } finally {
      setPullRefreshing(false);
      setButtonRefreshing(false);
    }
  }, [backendKind, client]);

  useEffect(() => {
    if (!isFocused) return;
    const isFirstLoadForConnection = lastLoadKeyRef.current !== loadKey;
    lastLoadKeyRef.current = loadKey;
    void load(isFirstLoadForConnection ? 'initial' : 'focus');
  }, [isFocused, load, loadKey]);

  const handleOpenChat = useCallback(() => {
    navigation.getParent()?.navigate('Chat');
  }, [navigation]);

  const handleSignOut = useCallback(() => {
    Alert.alert('Sign out', 'Sign out of YouMind on this device?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            await client.signOut();
            setState({ kind: 'authRequired' });
          })();
        },
      },
    ]);
  }, [client]);

  const handleOpenAddOnCredits = useCallback(() => {
    navigation.navigate('AddOnCredits');
  }, [navigation]);

  const handleChartLayout = useCallback((event: LayoutChangeEvent) => {
    const nextWidth = event.nativeEvent.layout.width;
    setChartWidth((current) => (Math.abs(current - nextWidth) > 1 ? nextWidth : current));
  }, []);

  if (state.kind === 'loading') {
    return (
      <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
        <YouMindProfileSkeleton insetsTop={insets.top} />
      </View>
    );
  }

  if (state.kind === 'authRequired') {
    return (
      <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
        <EmptyState
          icon="🪪"
          title="YouMind sign-in required"
          subtitle="Sign in to YouMind in Chat first, then come back here for your account and credits."
          actionLabel="Open Chat"
          onAction={handleOpenChat}
        />
      </View>
    );
  }

  if (state.kind === 'error') {
    return (
      <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
        <EmptyState
          icon="⚠️"
          title="Failed to load profile"
          subtitle={state.message}
          actionLabel="Try again"
          onAction={() => {
            void load('initial');
          }}
        />
      </View>
    );
  }

  const { user, creditAccount, currentPeriodUsage, last30DaysUsage, grants } = state.data;
  const tierLabel = formatTier(user?.subscription?.productTier || creditAccount?.productTier);
  const spendableCredits = (creditAccount?.monthlyBalance ?? 0)
    + (creditAccount?.permanentBalance ?? 0)
    + (creditAccount?.dailyBalance ?? 0);
  const monthlyUsed = Math.max(
    0,
    (creditAccount?.monthlyQuota ?? 0) - (creditAccount?.monthlyBalance ?? 0),
  );
  const monthlyUsagePercent = creditAccount && creditAccount.monthlyQuota > 0
    ? Math.min(100, Math.round((monthlyUsed / creditAccount.monthlyQuota) * 100))
    : null;
  const recentUsageBars = last30DaysUsage.dailyBreakdown.slice(-7).map((item) => ({
    date: item.date,
    value: CATEGORY_META.reduce((sum, category) => sum + item[category.key], 0),
  }));
  const recentUsageMax = Math.max(1, ...recentUsageBars.map((item) => item.value));
  const sortedCategories = CATEGORY_META
    .map((category) => ({
      ...category,
      value: currentPeriodUsage.summary.byCategory[category.key],
    }))
    .sort((left, right) => right.value - left.value);
  const topCategory = getTopCategory(currentPeriodUsage);
  const refreshSpinStyle = {
    transform: [{
      rotate: refreshSpin.interpolate({
        inputRange: [0, 1],
        outputRange: ['0deg', '360deg'],
      }),
    }],
  };
  const resolvedChartWidth = Math.max(220, chartWidth - Space.sm);

  return (
    <ScrollView
      style={[styles.root, { backgroundColor: theme.colors.background }]}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="never"
      refreshControl={(
        <RefreshControl
          refreshing={pullRefreshing}
          tintColor={theme.colors.primary}
          progressViewOffset={insets.top}
          onRefresh={() => {
            void load('pull');
          }}
        />
      )}
    >
      <View style={[styles.topSpacer, { paddingTop: insets.top + Space.md }]}>
        <View style={styles.pageHeaderRow}>
          <Text style={styles.pageTitle}>Profile</Text>
          <IconButton
            icon={(
              <Animated.View style={refreshSpinStyle}>
                <RefreshCw
                  size={18}
                  color={buttonRefreshing ? theme.colors.primary : theme.colors.textMuted}
                  strokeWidth={2}
                />
              </Animated.View>
            )}
            onPress={() => {
              void load('button');
            }}
          />
        </View>
      </View>

      {state.partialError ? (
        <View style={styles.inlineBanner}>
          <Text style={styles.inlineBannerText}>{state.partialError}</Text>
        </View>
      ) : null}

      <Card style={styles.accountCard}>
        <View style={styles.accountRow}>
          <View style={styles.avatar}>
            {user?.avatarUrl ? (
              <Image source={{ uri: user.avatarUrl }} style={styles.avatarImage} />
            ) : (
              <Text style={styles.avatarFallback}>{buildInitials(user?.name || null, user?.email || null)}</Text>
            )}
          </View>
          <View style={styles.accountCopy}>
            <View style={styles.accountNameRow}>
              <Text style={styles.accountName}>{user?.name || user?.email?.split('@')[0] || 'YouMind'}</Text>
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{tierLabel}</Text>
              </View>
            </View>
            <Text style={styles.accountEmail}>{user?.email || 'No email available'}</Text>
            {user?.subscription?.renewAtMs ? (
              <Text style={styles.headerMeta}>
                Next renewal: {formatDate(user.subscription.renewAtMs)}
              </Text>
            ) : null}
          </View>
        </View>
      </Card>

      <Card>
        <Text style={styles.sectionTitle}>Credits</Text>
        <View style={styles.heroValueRow}>
          <Text style={styles.heroValue}>{formatNumber(spendableCredits)}</Text>
          <Text style={styles.heroLabel}>Credits left</Text>
        </View>
        {monthlyUsagePercent !== null ? (
          <>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${monthlyUsagePercent}%` }]} />
            </View>
            <Text style={styles.infoText}>
              {formatNumber(creditAccount?.monthlyQuota ?? 0)} credits per month, refresh in {formatRelativeDays(creditAccount?.currentPeriodEndMs ?? Date.now())}.
            </Text>
          </>
        ) : null}
        <View style={styles.summaryGrid}>
          <View style={styles.summaryTile}>
            <Text style={styles.summaryTileLabel}>Monthly</Text>
            <Text style={styles.summaryTileValue}>{formatNumber(creditAccount?.monthlyBalance ?? 0)}</Text>
          </View>
          <View style={styles.summaryTile}>
            <Text style={styles.summaryTileLabel}>Permanent</Text>
            <Text style={styles.summaryTileValue}>{formatNumber(creditAccount?.permanentBalance ?? 0)}</Text>
          </View>
        </View>
        {(creditAccount?.freeMonthlyDailyGrantCount ?? 0) > 0 || (creditAccount?.freeMonthlyDailyGrantMax ?? 0) > 0 ? (
          <Text style={styles.infoText}>
            Daily grants this month: {creditAccount?.freeMonthlyDailyGrantCount ?? 0} / {creditAccount?.freeMonthlyDailyGrantMax ?? 0}.
          </Text>
        ) : null}
      </Card>

      <Card>
        <Text style={styles.sectionTitle}>Usage Insights</Text>
        <View style={styles.insightRow}>
          <View style={styles.insightPill}>
            <Text style={styles.insightLabel}>Current cycle spent</Text>
            <Text style={styles.insightValue}>{formatNumber(currentPeriodUsage.summary.totalConsumed)}</Text>
          </View>
          <View style={styles.insightPill}>
            <Text style={styles.insightLabel}>Top category</Text>
            <Text style={styles.insightValue}>{topCategory || 'No usage yet'}</Text>
          </View>
        </View>
        <Text style={styles.chartMeta}>Last 7 days total credit consumption.</Text>
        <View style={styles.chartWrap} onLayout={handleChartLayout}>
          <View style={[styles.chartBarsRow, { width: resolvedChartWidth }]}>
            {recentUsageBars.map((item) => {
              const barHeightPercent = item.value <= 0 ? 0 : Math.max(4, Math.round((item.value / recentUsageMax) * 100));
              const label = item.date.slice(5);
              return (
                <View key={item.date} style={styles.chartBarItem}>
                  <Text style={styles.chartBarValue}>{formatNumber(item.value)}</Text>
                  <View style={styles.chartBarTrack}>
                    <View style={[styles.chartBarFill, { height: `${barHeightPercent}%` }]} />
                  </View>
                  <Text style={styles.chartBarLabel}>{label}</Text>
                </View>
              );
            })}
          </View>
        </View>
        <View style={styles.categoryList}>
          {sortedCategories.map((category) => {
            const percent = currentPeriodUsage.summary.totalConsumed > 0
              ? Math.round((category.value / currentPeriodUsage.summary.totalConsumed) * 100)
              : 0;
            return (
              <View key={category.key} style={styles.categoryRow}>
                <View style={styles.categoryHeader}>
                  <Text style={styles.categoryLabel}>{category.label}</Text>
                  <Text style={styles.categoryValue}>
                    {formatNumber(category.value)} · {percent}%
                  </Text>
                </View>
                <View style={styles.categoryTrack}>
                  <View
                    style={[
                      styles.categoryFill,
                      {
                        width: `${percent}%`,
                        backgroundColor: category.color,
                      },
                    ]}
                  />
                </View>
              </View>
            );
          })}
        </View>
      </Card>

      <Card>
        <View style={styles.cardHeaderRow}>
          <Text style={[styles.sectionTitle, { marginBottom: 0 }]}>Add-on Credits</Text>
          {grants.length > 0 ? (
            <HeaderTextAction
              label="View all"
              minWidth={72}
              onPress={handleOpenAddOnCredits}
            />
          ) : null}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: Space.sm, marginBottom: Space.sm }}>
          <CreditCard size={18} color={theme.colors.primary} strokeWidth={2} />
          <Text style={styles.headerMeta}>Permanent credits that were granted to this account.</Text>
        </View>
        {grants.length === 0 ? (
          <Text style={styles.emptyList}>No permanent credit grants yet.</Text>
        ) : (
          grants.map((grant, index) => (
            <View
              key={grant.id}
              style={[styles.grantRow, index === grants.length - 1 ? styles.grantRowLast : null]}
            >
              <View style={styles.grantCopy}>
                <Text style={styles.grantReason}>{grant.reason}</Text>
                <Text style={styles.grantDate}>{formatDateTime(grant.createdAtMs)}</Text>
              </View>
              <Text style={styles.grantAmount}>+{formatNumber(grant.amount)}</Text>
            </View>
          ))
        )}
      </Card>

      <Pressable style={styles.signOutButton} onPress={handleSignOut}>
        <LogOut size={18} color={theme.colors.text} strokeWidth={2} />
        <Text style={styles.signOutText}>Sign out of YouMind</Text>
      </Pressable>
    </ScrollView>
  );
}
