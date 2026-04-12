import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { ChevronRight, Plus } from 'lucide-react-native';
import { useFocusEffect, useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  Card,
  EmptyState,
  HeaderActionButton,
  LoadingState,
  createListContentStyle,
} from '../../components/ui';
import { CreateAgentModal } from '../../components/agents/CreateAgentModal';
import { scheduleAutomaticAppReview } from '../../services/auto-app-review';
import { useTranslation } from 'react-i18next';
import { useAppContext } from '../../contexts/AppContext';
import { useProPaywall } from '../../contexts/ProPaywallContext';
import { useNativeStackModalHeader } from '../../hooks/useNativeStackModalHeader';
import { analyticsEvents } from '../../services/analytics/events';
import { resolveAgentDisplayName } from '../../services/agent-display-name';
import { enrichAgentsWithIdentity } from '../../services/agent-identity';
import { useAppTheme } from '../../theme';
import { FontSize, FontWeight, Radius, Space } from '../../theme/tokens';
import { getDisplayAgentEmoji } from '../../utils/agent-emoji';
import type { AgentInfo } from '../../types/agent';
import type { ConsoleStackParamList } from './ConsoleTab';
import { canAddAgent } from '../../utils/pro';

type AgentListNavigation = NativeStackNavigationProp<ConsoleStackParamList, 'AgentList'>;
type AgentListRoute = RouteProp<ConsoleStackParamList, 'AgentList'>;

/** Module-level set shared with AgentDetailScreen to track pending deletes. */
export const pendingAgentDeletes = new Set<string>();

export function AgentListScreen(): React.JSX.Element {
  const { gateway, gatewayEpoch, currentAgentId, setAgents } = useAppContext();
  const { theme } = useAppTheme();
  const { t } = useTranslation('console');
  const { isPro, showPaywall } = useProPaywall();
  const navigation = useNavigation<AgentListNavigation>();
  const route = useRoute<AgentListRoute>();
  const styles = useMemo(() => createStyles(theme.colors), [theme]);
  const capabilities = gateway.getBackendCapabilities();
  const canOpenAgentDetail = capabilities.consoleAgentDetail;
  const canEditAgents = capabilities.consoleAgentDetail && capabilities.configWrite;

  const [agents, setLocalAgents] = useState<AgentInfo[]>([]);
  const [mainKey, setMainKey] = useState('main');
  const [loading, setLoading] = useState(true);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Create modal state
  const [createVisible, setCreateVisible] = useState(false);

  const openCreateModal = useCallback((source: string) => {
    if (!canAddAgent(agents.length, isPro)) {
      showPaywall('agents');
      return;
    }
    analyticsEvents.agentCreateStarted({ source });
    setCreateVisible(true);
  }, [agents.length, isPro, showPaywall]);

  const headerRight = useMemo(
    () => canEditAgents ? (
      <HeaderActionButton
        icon={Plus}
        onPress={() => {
          openCreateModal('agent_header');
        }}
        size={22}
      />
    ) : null,
    [canEditAgents, openCreateModal],
  );

  useNativeStackModalHeader({
    navigation,
    title: t('common:Agents'),
    rightContent: headerRight,
    onClose: () => navigation.goBack(),
  });

  // IDs of agents pending server-side deletion — filtered from fetch results
  // until the gateway confirms removal.
  const pendingDeleteIdsRef = useRef<Set<string>>(new Set());

  // Auto-open create modal when navigated with openCreate param
  useEffect(() => {
    if (route.params?.openCreate) {
      if (!canEditAgents) {
        navigation.setParams({ openCreate: undefined });
        return;
      }
      openCreateModal('agent_route_param');
      // Clear the param so it doesn't re-trigger on focus
      navigation.setParams({ openCreate: undefined });
    }
  }, [canEditAgents, navigation, openCreateModal, route.params?.openCreate]);

  // On focus, drain the shared pendingAgentDeletes set into the local ref
  // and immediately remove those agents from the displayed list.
  useFocusEffect(
    useCallback(() => {
      if (pendingAgentDeletes.size === 0) return;
      for (const id of pendingAgentDeletes) {
        pendingDeleteIdsRef.current.add(id);
      }
      pendingAgentDeletes.clear();
      setLocalAgents(prev => prev.filter(a => !pendingDeleteIdsRef.current.has(a.id)));
    }, []),
  );

  const loadAgents = useCallback(async (mode: 'initial' | 'refresh' | 'background' = 'initial') => {
    if (mode === 'initial') setLoading(true);
    if (mode === 'refresh') setRefreshing(true);

    try {
      const result = await gateway.listAgents();
      const serverIds = new Set(result.agents.map(a => a.id));
      for (const id of pendingDeleteIdsRef.current) {
        if (!serverIds.has(id)) pendingDeleteIdsRef.current.delete(id);
      }
      const filtered = pendingDeleteIdsRef.current.size > 0
        ? result.agents.filter(a => !pendingDeleteIdsRef.current.has(a.id))
        : result.agents;
      const enriched = await enrichAgentsWithIdentity(gateway, filtered);
      setLocalAgents(enriched);
      setMainKey(result.mainKey);
      setAgents(enriched);
      setHasLoadedOnce(true);
    } catch {
      // Silently handle — empty state will show
    } finally {
      if (mode === 'initial') setLoading(false);
      if (mode === 'refresh') setRefreshing(false);
    }
  }, [gateway, gatewayEpoch, setAgents]);

  useFocusEffect(
    useCallback(() => {
      loadAgents(hasLoadedOnce ? 'background' : 'initial').catch(() => {});
    }, [hasLoadedOnce, loadAgents]),
  );
  const renderItem = ({ item }: { item: AgentInfo }) => {
    const isCurrent = item.id === currentAgentId;
    const isMain = item.id === mainKey;
    const displayName = resolveAgentDisplayName(item) ?? item.id;
    const emoji = getDisplayAgentEmoji(item.identity?.emoji);

    return (
      <Card
        style={styles.card}
        onPress={canOpenAgentDetail ? () => navigation.navigate('AgentDetail', { agentId: item.id }) : undefined}
      >
        <View style={styles.cardRow}>
          <Text style={styles.cardEmoji}>{emoji}</Text>
          <View style={styles.cardTextWrap}>
            <Text style={styles.cardTitle} numberOfLines={1}>{displayName}</Text>
            <Text style={styles.cardSubtitle} numberOfLines={1}>{item.id}</Text>
          </View>
          <View style={styles.cardRight}>
            {isCurrent && (
              <View style={styles.activeBadge}>
                <Text style={styles.activeBadgeText}>{t('Active')}</Text>
              </View>
            )}
            {isMain && (
              <View style={styles.defaultBadge}>
                <Text style={styles.defaultBadgeText}>{t('Default')}</Text>
              </View>
            )}
            {canOpenAgentDetail ? (
              <ChevronRight size={16} color={theme.colors.textSubtle} strokeWidth={2} />
            ) : null}
          </View>
        </View>
      </Card>
    );
  };

  return (
    <View style={styles.root}>
      {loading ? (
        <LoadingState message={t('Loading agents...')} />
      ) : (
        <FlatList
          data={agents}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={[styles.content, { flexGrow: 1 }]}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => loadAgents('refresh')}
              tintColor={theme.colors.primary}
            />
          }
          ListEmptyComponent={
            <EmptyState icon="🤖" title={t('No agents found')} />
          }
        />
      )}

      <CreateAgentModal
        visible={createVisible}
        onClose={() => setCreateVisible(false)}
        onCreated={() => {
          scheduleAutomaticAppReview('agent_created');
          void loadAgents('background');
        }}
      />
    </View>
  );
}

function createStyles(colors: ReturnType<typeof import('../../theme').useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: colors.background,
    },
    content: {
      ...createListContentStyle({ grow: true, bottom: Space.xxxl }),
    },
    card: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: Radius.md,
      padding: Space.lg - 2,
      marginBottom: Space.md - 2,
    },
    cardRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    cardEmoji: {
      fontSize: 24,
    },
    cardTextWrap: {
      flex: 1,
      minWidth: 0,
    },
    cardTitle: {
      fontSize: FontSize.base,
      fontWeight: FontWeight.semibold,
      color: colors.text,
    },
    cardSubtitle: {
      fontSize: FontSize.sm,
      color: colors.textMuted,
      marginTop: 2,
    },
    cardRight: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.sm,
    },
    activeBadge: {
      backgroundColor: colors.success + '20',
      borderRadius: Radius.sm,
      paddingHorizontal: Space.sm,
      paddingVertical: 3,
    },
    activeBadgeText: {
      color: colors.success,
      fontSize: FontSize.xs,
      fontWeight: FontWeight.semibold,
    },
    defaultBadge: {
      borderRadius: Radius.sm,
      borderWidth: 1,
      borderColor: colors.borderStrong,
      backgroundColor: colors.surfaceMuted,
      paddingHorizontal: Space.sm,
      paddingVertical: 3,
    },
    defaultBadgeText: {
      color: colors.textMuted,
      fontSize: FontSize.xs,
      fontWeight: FontWeight.semibold,
    },
  });
}
