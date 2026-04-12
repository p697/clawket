import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import {
  Bot,
  ChevronDown,
  CloudOff,
  Ellipsis,
  Gamepad2,
  MessageCircle,
  MessageSquare,
  Pin,
  PinOff,
  Send,
  Slack,
  Star,
  Table2,
  Timer,
  Users,
  X,
} from 'lucide-react-native';
import { useAppContext } from '../../contexts/AppContext';
import { CachedSessionMeta, ChatCacheService } from '../../services/chat-cache';
import { SessionPreferencesService } from '../../services/session-preferences';
import { SessionInfo } from '../../types';
import { useAppTheme } from '../../theme';
import { FontSize, FontWeight, HitSize, Radius, Space } from '../../theme/tokens';
import { getDisplayAgentEmoji } from '../../utils/agent-emoji';
import { relativeTime, sessionLabel } from '../../utils/chat-message';
import i18n from '../../i18n';
import { EmptyState, IconButton, ModalSheet, SearchInput } from '../ui';
import {
  buildChannelOptions,
  buildSidebarSessionItems,
  isCronSession,
  isMainSession,
  isSubagentSession,
  normalizeChannelId,
  SessionSidebarTabKey,
  SidebarSessionItem,
} from './session-sidebar-data';

type ThemeColors = ReturnType<typeof useAppTheme>['theme']['colors'];

type TabKey = SessionSidebarTabKey;

type SessionChannelOption = {
  key: string;
  label: string;
  count: number;
};

type ListRow =
  | { type: 'section'; key: string; label: string }
  | { type: 'session'; key: string; session: SidebarSessionItem };

const TABS: { key: TabKey; labelKey: string; ns: string }[] = [
  { key: 'sessions', labelKey: 'Sessions', ns: 'common' },
  { key: 'subagents', labelKey: 'Subagents', ns: 'chat' },
  { key: 'cron', labelKey: 'Cron Jobs', ns: 'chat' },
];

const CHANNEL_LABELS: Record<string, string> = {
  telegram: 'Telegram',
  discord: 'Discord',
  slack: 'Slack',
  feishu: 'Feishu',
  lark: 'Feishu',
  whatsapp: 'WhatsApp',
};

const SESSION_TAB_HEIGHT = HitSize.sm - Space.xs;

function channelLabel(channelId: string): string {
  return CHANNEL_LABELS[channelId] ?? `${channelId.charAt(0).toUpperCase()}${channelId.slice(1)}`;
}

function buttonTitleForAction(state: string): string {
  if (state === 'rename') return i18n.t('Saving...', { ns: 'common' });
  if (state === 'reset') return i18n.t('Resetting...', { ns: 'common' });
  if (state === 'delete') return i18n.t('Deleting...', { ns: 'common' });
  if (state === 'clear-cache') return i18n.t('Clearing cache...', { ns: 'common' });
  return '';
}

function resolveModelBadges(session: SidebarSessionItem): { provider?: string; model?: string } {
  const explicitProvider = session.modelProvider?.trim();
  const explicitModel = session.model?.trim();

  if (explicitProvider && explicitModel) {
    return { provider: explicitProvider, model: explicitModel };
  }

  if (explicitModel && explicitModel.includes('/')) {
    const [provider, ...rest] = explicitModel.split('/');
    const model = rest.join('/').trim();
    if (provider.trim() && model) {
      return { provider: provider.trim(), model };
    }
  }

  return { model: explicitModel || undefined };
}

type ChannelIconProps = {
  session: SidebarSessionItem;
  colors: ThemeColors;
  iconBadgeSize: number;
  styles: ReturnType<typeof createStyles>;
};

const ChannelIcon = React.memo(function ChannelIcon({
  session,
  colors,
  iconBadgeSize,
  styles,
}: ChannelIconProps) {
  type IconDef = { icon: React.ReactNode; bg: string };
  const size = FontSize.base;
  const strokeWidth = 1.8;
  const iconOnColor = colors.iconOnColor;
  const channelId = normalizeChannelId(session.channel);

  const resolve = (): IconDef => {
    if (isMainSession(session.key)) {
      return { icon: <Star size={size} color={iconOnColor} strokeWidth={strokeWidth} fill={iconOnColor} />, bg: colors.primary };
    }
    if (isSubagentSession(session.key)) {
      return { icon: <Bot size={size} color={iconOnColor} strokeWidth={strokeWidth} />, bg: colors.sessionBadgeSubagent };
    }
    if (isCronSession(session)) {
      return { icon: <Timer size={size} color={iconOnColor} strokeWidth={strokeWidth} />, bg: colors.sessionBadgeCron };
    }
    if (channelId === 'telegram') {
      return { icon: <Send size={size} color={iconOnColor} strokeWidth={strokeWidth} />, bg: colors.sessionBadgeTelegram };
    }
    if (channelId === 'discord') {
      return { icon: <Gamepad2 size={size} color={iconOnColor} strokeWidth={strokeWidth} />, bg: colors.sessionBadgeDiscord };
    }
    if (channelId === 'slack') {
      return { icon: <Slack size={size} color={iconOnColor} strokeWidth={strokeWidth} />, bg: colors.sessionBadgeSlack };
    }
    if (channelId === 'whatsapp') {
      return { icon: <MessageCircle size={size} color={iconOnColor} strokeWidth={strokeWidth} />, bg: colors.success };
    }
    if (session.kind === 'group') {
      return { icon: <Users size={size} color={iconOnColor} strokeWidth={strokeWidth} />, bg: colors.textMuted };
    }
    return { icon: <MessageSquare size={size} color={iconOnColor} strokeWidth={strokeWidth} />, bg: colors.textMuted };
  };

  const def = resolve();
  return (
    <View style={styles.iconBadgeWrap}>
      <View
        style={{
          width: iconBadgeSize,
          height: iconBadgeSize,
          borderRadius: Radius.full,
          backgroundColor: def.bg,
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        {def.icon}
      </View>
    </View>
  );
});

type SessionCardProps = {
  session: SidebarSessionItem;
  isActive: boolean;
  currentAgentName?: string | null;
  colors: ThemeColors;
  iconBadgeSize: number;
  styles: ReturnType<typeof createStyles>;
  onPress: (session: SessionInfo) => void;
  onTogglePin: (session: SidebarSessionItem) => void;
  onOpenActions: (session: SidebarSessionItem) => void;
};

const SessionCard = React.memo(function SessionCard({
  session,
  isActive,
  currentAgentName,
  colors,
  iconBadgeSize,
  styles,
  onPress,
  onTogglePin,
  onOpenActions,
}: SessionCardProps) {
  const { t } = useTranslation('chat');
  const title = sessionLabel(session, { currentAgentName });
  const time = relativeTime(session.updatedAt);
  const preview = session.previewText;
  const modelBadges = resolveModelBadges(session);

  const handlePress = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress(session);
  }, [onPress, session]);

  return (
    <TouchableOpacity
      style={[styles.sessionItem, isActive && styles.sessionItemActive]}
      onPress={handlePress}
      activeOpacity={0.7}
    >
      <View style={styles.sessionRow}>
        <ChannelIcon session={session} colors={colors} iconBadgeSize={iconBadgeSize} styles={styles} />
        <View style={styles.sessionContent}>
          <View style={styles.sessionTopRow}>
            <Text style={[styles.sessionTitle, isActive && styles.sessionTitleActive]} numberOfLines={1}>
              {title}
            </Text>
            <View style={styles.sessionTrailingRow}>
              {!!time && (
                <Text style={[styles.sessionTime, isActive && styles.sessionTimeActive]}>
                  {time}
                </Text>
              )}
              <IconButton
                icon={session.pinned
                  ? <PinOff size={16} color={colors.textMuted} strokeWidth={2} />
                  : <Pin size={16} color={colors.textMuted} strokeWidth={2} />}
                onPress={() => onTogglePin(session)}
                size={32}
              />
              <IconButton
                icon={<Ellipsis size={18} color={colors.textMuted} strokeWidth={2} />}
                onPress={() => onOpenActions(session)}
                size={32}
              />
            </View>
          </View>
          <Text style={styles.sessionPreview} numberOfLines={2}>
            {preview || (session.localOnly ? t('Open cached messages') : t('No messages yet'))}
          </Text>
          <View style={styles.sessionMetaRow}>
            {session.localOnly ? (
              <View style={[styles.metaBadge, { backgroundColor: colors.surfaceMuted }]}>
                <CloudOff size={11} color={colors.textMuted} strokeWidth={2} />
                <Text style={[styles.metaBadgeText, { color: colors.textMuted }]}>{t('Cached')}</Text>
              </View>
            ) : null}
            {!!modelBadges.provider ? (
              <View style={[styles.metaBadge, { backgroundColor: colors.surfaceMuted }]}>
                <Text style={[styles.metaBadgeText, { color: colors.textMuted }]} numberOfLines={1}>
                  {modelBadges.provider}
                </Text>
              </View>
            ) : null}
            {!!modelBadges.model ? (
              <View style={[styles.metaBadge, { backgroundColor: colors.surfaceMuted }]}>
                <Text style={[styles.metaBadgeText, { color: colors.textMuted }]} numberOfLines={1}>
                  {modelBadges.model}
                </Text>
              </View>
            ) : null}
          </View>
        </View>
      </View>
    </TouchableOpacity>
  );
});

type Props = {
  sessions: SessionInfo[];
  activeSessionKey: string | null;
  topPadding: number;
  bottomPadding: number;
  gatewayConfigId: string;
  onClose: () => void;
  onSelectSession: (session: SessionInfo) => void;
  onAgentSwitch?: () => void;
  onRefresh?: () => Promise<void>;
  onRenameSession: (session: SessionInfo, label: string | null) => Promise<void>;
  onResetSession: (session: SessionInfo) => Promise<void>;
  onDeleteSession: (session: SessionInfo) => Promise<void>;
  onCreateCronJob?: () => void;
  onOpenSessionsBoard?: () => void;
  externalSelection?: {
    requestedAt: number;
    tab?: TabKey;
    channel?: string;
  } | null;
};

export function SessionSidebar({
  sessions,
  activeSessionKey,
  topPadding,
  bottomPadding,
  gatewayConfigId,
  onClose,
  onSelectSession,
  onAgentSwitch,
  onRefresh,
  onRenameSession,
  onResetSession,
  onDeleteSession,
  onCreateCronJob,
  onOpenSessionsBoard,
  externalSelection,
}: Props): React.JSX.Element {
  const { t } = useTranslation('chat');
  const { agents, currentAgentId, isMultiAgent, mainSessionKey } = useAppContext();
  const { theme } = useAppTheme();
  const { colors } = theme;
  const styles = useMemo(() => createStyles(colors), [colors]);
  const currentAgent = agents.find((agent) => agent.id === currentAgentId);
  const currentAgentName = currentAgent?.identity?.name?.trim()
    || currentAgent?.name?.trim()
    || null;
  const [activeTab, setActiveTab] = useState<TabKey>('sessions');
  const [activeChannel, setActiveChannel] = useState<string>('all');
  const [refreshing, setRefreshing] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [cachedSessions, setCachedSessions] = useState<CachedSessionMeta[]>([]);
  const [pinnedSessionKeys, setPinnedSessionKeys] = useState<string[]>([]);
  const [selectedSession, setSelectedSession] = useState<SidebarSessionItem | null>(null);
  const [editingLabel, setEditingLabel] = useState('');
  const [actionState, setActionState] = useState<string | null>(null);

  const loadLocalState = useCallback(async () => {
    const [cacheIndex, pinnedKeys] = await Promise.all([
      ChatCacheService.listSessions(),
      SessionPreferencesService.getPinnedSessionKeys(gatewayConfigId, currentAgentId),
    ]);
    setCachedSessions(cacheIndex.filter((item) => item.gatewayConfigId === gatewayConfigId && item.agentId === currentAgentId));
    setPinnedSessionKeys(pinnedKeys);
  }, [currentAgentId, gatewayConfigId]);

  useEffect(() => {
    void loadLocalState();
  }, [loadLocalState, sessions.length, activeSessionKey]);

  const handleRefresh = useCallback(async () => {
    if (!onRefresh) return;
    setRefreshing(true);
    try {
      await onRefresh();
      await loadLocalState();
    } finally {
      setRefreshing(false);
    }
  }, [loadLocalState, onRefresh]);

  const sessionsBaseItems = useMemo(
    () => buildSidebarSessionItems({
      sessions,
      cachedSessions,
      currentAgentId,
      mainSessionKey,
      activeTab: 'sessions',
      activeChannel: 'all',
      searchText: '',
      pinnedSessionKeys,
    }),
    [cachedSessions, currentAgentId, mainSessionKey, pinnedSessionKeys, sessions],
  );

  const channelOptions = useMemo<SessionChannelOption[]>(
    () => buildChannelOptions(sessionsBaseItems, { allLabel: t('All') }).map((option) => ({
      ...option,
      label: option.key === 'all' ? option.label : channelLabel(option.key),
    })),
    [sessionsBaseItems, t],
  );

  const activeChannelLabel = useMemo(
    () => channelOptions.find((option) => option.key === activeChannel)?.label ?? channelLabel(activeChannel),
    [activeChannel, channelOptions],
  );

  const visibleSessions = useMemo(
    () => buildSidebarSessionItems({
      sessions,
      cachedSessions,
      currentAgentId,
      mainSessionKey,
      activeTab,
      activeChannel,
      searchText,
      pinnedSessionKeys,
    }),
    [activeChannel, activeTab, cachedSessions, currentAgentId, mainSessionKey, pinnedSessionKeys, searchText, sessions],
  );

  const rows = useMemo<ListRow[]>(() => {
    const pinned = visibleSessions.filter((session) => session.pinned);
    const recent = visibleSessions.filter((session) => !session.pinned);
    return [
      ...(pinned.length > 0 ? [{ type: 'section' as const, key: 'section:pinned', label: t('Pinned') }] : []),
      ...pinned.map((session) => ({ type: 'session' as const, key: session.key, session })),
      ...(recent.length > 0 ? [{ type: 'section' as const, key: 'section:recent', label: searchText.trim() ? t('Results') : t('Recent') }] : []),
      ...recent.map((session) => ({ type: 'session' as const, key: session.key, session })),
    ];
  }, [searchText, t, visibleSessions]);

  useEffect(() => {
    if (!externalSelection?.requestedAt) return;
    setActiveTab(externalSelection.tab ?? 'sessions');
    const targetChannel = normalizeChannelId(externalSelection.channel);
    setActiveChannel(targetChannel ?? 'all');
  }, [externalSelection]);

  useEffect(() => {
    if (activeChannel === 'all') return;
    const exists = channelOptions.some((option) => option.key === activeChannel);
    if (!exists) {
      setActiveChannel('all');
    }
  }, [activeChannel, channelOptions]);

  const iconBadgeSize = HitSize.sm - Space.sm;

  const handleTogglePin = useCallback(async (session: SidebarSessionItem) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const next = await SessionPreferencesService.togglePinnedSession(gatewayConfigId, currentAgentId, session.key);
    setPinnedSessionKeys(next);
    setSelectedSession((prev) => prev && prev.key === session.key ? { ...prev, pinned: next.includes(session.key) } : prev);
  }, [currentAgentId, gatewayConfigId]);

  const openSessionActions = useCallback((session: SidebarSessionItem) => {
    setSelectedSession(session);
    setEditingLabel(session.label ?? '');
  }, []);

  const dismissSessionActions = useCallback(() => {
    setSelectedSession(null);
    setEditingLabel('');
  }, []);

  const closeSessionActions = useCallback(() => {
    if (actionState) return;
    dismissSessionActions();
  }, [actionState, dismissSessionActions]);

  const handleSaveLabel = useCallback(async () => {
    if (!selectedSession || selectedSession.localOnly) return;
    const nextLabel = editingLabel.trim();
    const currentLabel = selectedSession.label?.trim() ?? '';
    if (nextLabel === currentLabel) {
      dismissSessionActions();
      return;
    }
    setActionState('rename');
    try {
      await onRenameSession(selectedSession, nextLabel ? nextLabel : null);
      await loadLocalState();
      dismissSessionActions();
    } finally {
      setActionState(null);
    }
  }, [dismissSessionActions, editingLabel, loadLocalState, onRenameSession, selectedSession]);

  const handleReset = useCallback(async () => {
    if (!selectedSession || selectedSession.localOnly) return;
    Alert.alert(t('Reset Session'), t('Reset "{{label}}" and start a fresh conversation?', {
      label: sessionLabel(selectedSession, { currentAgentName }),
    }), [
      { text: i18n.t('Cancel', { ns: 'common' }), style: 'cancel' },
      {
        text: t('Reset'),
        style: 'destructive',
        onPress: () => {
          setActionState('reset');
          onResetSession(selectedSession)
            .then(loadLocalState)
            .finally(() => {
              setActionState(null);
              dismissSessionActions();
            });
        },
      },
    ]);
  }, [currentAgentName, dismissSessionActions, loadLocalState, onResetSession, selectedSession, t]);

  const handleDelete = useCallback(async () => {
    if (!selectedSession || selectedSession.localOnly || isMainSession(selectedSession.key)) return;
    Alert.alert(t('Delete Session'), t('Delete "{{label}}" from the gateway?', {
      label: sessionLabel(selectedSession, { currentAgentName }),
    }), [
      { text: i18n.t('Cancel', { ns: 'common' }), style: 'cancel' },
      {
        text: i18n.t('Delete', { ns: 'common' }),
        style: 'destructive',
        onPress: () => {
          setActionState('delete');
          onDeleteSession(selectedSession)
            .then(async () => {
              await SessionPreferencesService.clearSession(gatewayConfigId, currentAgentId, selectedSession.key);
              await loadLocalState();
            })
            .finally(() => {
              setActionState(null);
              dismissSessionActions();
            });
        },
      },
    ]);
  }, [currentAgentId, currentAgentName, dismissSessionActions, gatewayConfigId, loadLocalState, onDeleteSession, selectedSession, t]);

  const renderRow = useCallback(
    ({ item }: { item: ListRow }) => {
      if (item.type === 'section') {
        return <Text style={styles.sectionLabel}>{item.label}</Text>;
      }
      return (
        <SessionCard
          session={item.session}
          isActive={item.session.key === activeSessionKey}
          currentAgentName={currentAgentName}
          colors={colors}
          iconBadgeSize={iconBadgeSize}
          styles={styles}
          onPress={onSelectSession}
          onTogglePin={handleTogglePin}
          onOpenActions={openSessionActions}
        />
      );
    },
    [activeSessionKey, colors, currentAgentName, handleTogglePin, iconBadgeSize, onSelectSession, openSessionActions, styles],
  );

  const renderEmpty = () => {
    const isSearch = !!searchText.trim();
    if (activeTab === 'subagents') {
      return (
        <EmptyState
          icon="🤖"
          title={t('No subagent sessions')}
          subtitle={isSearch ? t('Try a different search term.') : t('subagent_empty_hint')}
        />
      );
    }
    if (activeTab === 'cron') {
      return (
        <EmptyState
          icon="⏱️"
          title={t('No cron sessions')}
          subtitle={isSearch ? t('Try a different search term.') : undefined}
          actionLabel={isSearch ? undefined : t('Create Cron Job')}
          onAction={isSearch ? undefined : onCreateCronJob}
        />
      );
    }
    return (
      <EmptyState
        icon="💬"
        title={activeChannel === 'all' ? t('No sessions found') : t('No {{channel}} sessions', { channel: activeChannelLabel })}
        subtitle={isSearch ? t('Try a different search term.') : t('Pull to refresh or start a new conversation.')}
      />
    );
  };

  return (
    <View style={[styles.sidebarPanel, { paddingTop: topPadding, paddingBottom: bottomPadding }]}>
      <View style={styles.sidebarHeader}>
        {isMultiAgent ? (
          <TouchableOpacity
            style={styles.agentSelector}
            onPress={onAgentSwitch}
            activeOpacity={0.7}
          >
            <Text style={styles.agentEmoji}>
              {getDisplayAgentEmoji(currentAgent?.identity?.emoji)}
            </Text>
            <Text style={styles.sidebarTitle} numberOfLines={1}>
              {currentAgent?.identity?.name?.trim()
                || currentAgent?.name?.trim()
                || currentAgentId}
            </Text>
            <ChevronDown size={16} color={colors.textMuted} strokeWidth={2} />
          </TouchableOpacity>
        ) : (
          <Text style={styles.sidebarTitle}>{t('Chats')}</Text>
        )}
        <View style={styles.headerActions}>
          {onOpenSessionsBoard ? (
            <IconButton
              icon={<Table2 size={20} color={colors.textMuted} strokeWidth={2} />}
              onPress={onOpenSessionsBoard}
              size={40}
            />
          ) : null}
          <IconButton
            icon={<X size={22} color={colors.textMuted} strokeWidth={2} />}
            onPress={onClose}
            size={40}
          />
        </View>
      </View>

      <View style={styles.tabBarWrap}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tabBar}
          style={styles.tabBarScroll}
        >
          {TABS.map((tab) => {
            const isActive = activeTab === tab.key;
            return (
              <TouchableOpacity
                key={tab.key}
                style={[styles.tab, isActive && styles.tabActive]}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setActiveTab(tab.key);
                }}
                activeOpacity={0.7}
              >
                <Text style={[styles.tabText, isActive && styles.tabTextActive]}>{i18n.t(tab.labelKey, { ns: tab.ns })}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      <SearchInput
        value={searchText}
        onChangeText={setSearchText}
        placeholder={activeTab === 'sessions' ? t('Search sessions') : activeTab === 'subagents' ? t('Search subagents') : t('Search cron sessions')}
        style={styles.searchInput}
      />

      {activeTab === 'sessions' ? (
        <View style={styles.sessionsTopContent}>
          <View style={styles.channelFilterWrap}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.channelFilterBar}
              style={styles.channelFilterScroll}
            >
              {channelOptions.map((option) => {
                const isActive = activeChannel === option.key;
                return (
                  <TouchableOpacity
                    key={option.key}
                    style={[styles.channelFilterChip, isActive && styles.channelFilterChipActive]}
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      setActiveChannel(option.key);
                    }}
                    activeOpacity={0.75}
                  >
                    <Text style={[styles.channelFilterText, isActive && styles.channelFilterTextActive]}>
                      {option.label}
                    </Text>
                    <Text style={[styles.channelFilterCount, isActive && styles.channelFilterCountActive]}>
                      {option.count}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </View>
      ) : null}

      <FlatList
        data={rows}
        keyExtractor={(item) => item.key}
        renderItem={renderRow}
        ListEmptyComponent={renderEmpty}
        contentContainerStyle={[styles.sessionListContent, rows.length === 0 && styles.sessionListContentEmpty]}
        style={styles.sessionList}
        showsVerticalScrollIndicator={false}
        refreshControl={
          onRefresh ? (
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={colors.textMuted}
              colors={[colors.primary]}
            />
          ) : undefined
        }
      />

      <ModalSheet visible={!!selectedSession} onClose={closeSessionActions} title={t('Session Details')} maxHeight="78%">
        <ScrollView contentContainerStyle={styles.modalContent}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle} numberOfLines={2}>
              {selectedSession ? sessionLabel(selectedSession, { currentAgentName }) : ''}
            </Text>
            {selectedSession?.previewText ? (
              <Text style={styles.modalPreview} numberOfLines={5}>
                {selectedSession.previewText}
              </Text>
            ) : null}
          </View>

          <View style={styles.modalSection}>
            <Text style={styles.modalSectionTitle}>{t('Session Name')}</Text>
            <TextInput
              value={editingLabel}
              onChangeText={setEditingLabel}
              placeholder={t('Enter a session name')}
              placeholderTextColor={colors.textSubtle}
              editable={!actionState && !selectedSession?.localOnly}
              style={[styles.modalInput, selectedSession?.localOnly && styles.modalInputDisabled]}
            />
            <TouchableOpacity
              style={[
                styles.primaryActionButton,
                {
                  backgroundColor: selectedSession?.localOnly ? colors.surfaceMuted : colors.primary,
                  opacity: actionState || selectedSession?.localOnly ? 0.6 : 1,
                },
              ]}
              disabled={!!actionState || !!selectedSession?.localOnly}
              onPress={handleSaveLabel}
              activeOpacity={0.88}
            >
              <Text style={[styles.primaryActionText, { color: selectedSession?.localOnly ? colors.textMuted : colors.primaryText }]}>
                {actionState === 'rename' ? buttonTitleForAction(actionState) : t('Rename Session')}
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.modalActionDividerWrap}>
            <View style={styles.modalActionDivider} />
          </View>

          <View style={styles.modalSection}>
            <TouchableOpacity
              style={[styles.outlineActionButton, { borderColor: colors.warning }]}
              disabled={!!actionState || !selectedSession || !!selectedSession.localOnly}
              onPress={handleReset}
              activeOpacity={0.75}
            >
              <Text style={[styles.outlineActionText, { color: colors.warning, opacity: selectedSession?.localOnly ? 0.45 : 1 }]}>
                {actionState === 'reset' ? buttonTitleForAction(actionState) : t('Reset Remote Session')}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.outlineActionButton, { borderColor: colors.error }]}
              disabled={!!actionState || !selectedSession || !!selectedSession.localOnly || !!(selectedSession && isMainSession(selectedSession.key))}
              onPress={handleDelete}
              activeOpacity={0.75}
            >
              <Text
                style={[
                  styles.outlineActionText,
                  {
                    color: colors.error,
                    opacity: selectedSession?.localOnly || (selectedSession && isMainSession(selectedSession.key)) ? 0.45 : 1,
                  },
                ]}
              >
                {actionState === 'delete' ? buttonTitleForAction(actionState) : t('Delete Remote Session')}
              </Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </ModalSheet>
    </View>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    sidebarPanel: {
      flex: 1,
      backgroundColor: colors.surface,
      paddingHorizontal: Space.lg - 2,
    },
    sidebarHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: Space.sm,
      flexShrink: 0,
    },
    headerActions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.xs,
    },
    agentSelector: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.sm,
      flex: 1,
    },
    agentEmoji: {
      fontSize: FontSize.lg + 4,
    },
    sidebarTitle: {
      fontSize: FontSize.lg + 4,
      fontWeight: FontWeight.bold,
      color: colors.text,
      flexShrink: 1,
    },
    tabBarWrap: {
      marginBottom: Space.sm,
      marginTop: Space.sm,
      flexShrink: 0,
    },
    tabBarScroll: {
      flexGrow: 0,
    },
    tabBar: {
      flexDirection: 'row',
      gap: Space.xs,
      alignItems: 'center',
    },
    tab: {
      height: SESSION_TAB_HEIGHT,
      paddingHorizontal: Space.md,
      borderRadius: Radius.lg - Space.xs,
      backgroundColor: colors.surfaceMuted,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    tabActive: {
      backgroundColor: colors.primarySoft,
      borderColor: colors.primary,
    },
    tabText: {
      fontSize: FontSize.md,
      fontWeight: FontWeight.medium,
      color: colors.textMuted,
    },
    tabTextActive: {
      color: colors.primary,
      fontWeight: FontWeight.semibold,
    },
    searchInput: {
      marginBottom: Space.sm,
    },
    channelFilterWrap: {
      paddingTop: 2,
      flexShrink: 0,
      justifyContent: 'center',
      backgroundColor: colors.surface,
    },
    sessionsTopContent: {
      flexShrink: 0,
    },
    channelFilterScroll: {
      flexGrow: 0,
    },
    channelFilterBar: {
      gap: Space.xs,
      paddingBottom: Space.sm,
      paddingTop: 2,
      alignItems: 'center',
    },
    channelFilterChip: {
      height: SESSION_TAB_HEIGHT,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: Space.xs,
      borderRadius: Radius.full,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceMuted,
      paddingHorizontal: Space.md,
    },
    channelFilterChipActive: {
      borderColor: colors.primary,
      backgroundColor: colors.primarySoft,
    },
    channelFilterText: {
      fontSize: FontSize.md,
      color: colors.textMuted,
      fontWeight: FontWeight.medium,
    },
    channelFilterTextActive: {
      color: colors.primary,
      fontWeight: FontWeight.semibold,
    },
    channelFilterCount: {
      fontSize: FontSize.sm,
      color: colors.textSubtle,
      fontWeight: FontWeight.medium,
    },
    channelFilterCountActive: {
      color: colors.primary,
    },
    sectionLabel: {
      fontSize: FontSize.sm,
      fontWeight: FontWeight.semibold,
      color: colors.textSubtle,
      marginTop: Space.sm,
      marginBottom: Space.xs,
      paddingHorizontal: Space.xs,
      textTransform: 'uppercase',
    },
    sessionList: {
      flex: 1,
    },
    sessionListContent: {
      paddingBottom: Space.xxxl,
    },
    sessionListContentEmpty: {
      flexGrow: 1,
    },
    sessionItem: {
      borderRadius: Radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      paddingHorizontal: Space.md,
      paddingTop: 8,
      paddingBottom: 8,
      marginBottom: Space.sm,
    },
    sessionItemActive: {
      borderColor: colors.primary,
      backgroundColor: colors.primarySoft,
    },
    sessionRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: Space.sm,
    },
    iconBadgeWrap: {
      paddingTop: 2,
    },
    sessionContent: {
      flex: 1,
      minWidth: 0,
    },
    sessionTopRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: Space.sm,
    },
    sessionTitle: {
      flex: 1,
      fontSize: FontSize.base,
      fontWeight: FontWeight.semibold,
      color: colors.text,
      lineHeight: FontSize.base + 12,
    },
    sessionTitleActive: {
      color: colors.text,
    },
    sessionTrailingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 2,
      marginRight: -4,
      marginTop: -2,
      flexShrink: 0,
    },
    sessionTime: {
      fontSize: FontSize.sm,
      color: colors.textSubtle,
      fontWeight: FontWeight.medium,
      marginRight: 2,
    },
    sessionTimeActive: {
      color: colors.textMuted,
    },
    sessionPreview: {
      fontSize: FontSize.md,
      color: colors.textMuted,
      lineHeight: FontSize.md + 5,
      marginTop: 2,
    },
    sessionMetaRow: {
      flexDirection: 'row',
      gap: Space.xs,
      marginTop: Space.xs,
      flexWrap: 'wrap',
    },
    metaBadge: {
      borderRadius: Radius.full,
      paddingHorizontal: Space.sm,
      paddingVertical: 4,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    metaBadgeText: {
      fontSize: FontSize.xs,
      fontWeight: FontWeight.semibold,
    },
    modalContent: {
      paddingHorizontal: Space.lg,
      paddingBottom: Space.xxl,
      gap: Space.md,
    },
    modalCard: {
      backgroundColor: colors.surfaceMuted,
      borderRadius: Radius.md,
      padding: Space.lg,
      marginBottom: Space.md,
    },
    modalTitle: {
      fontSize: FontSize.lg,
      fontWeight: FontWeight.semibold,
      color: colors.text,
    },
    modalPreview: {
      fontSize: FontSize.md,
      color: colors.text,
      marginTop: Space.sm,
    },
    modalSection: {
      gap: Space.sm,
    },
    modalActionDividerWrap: {
      paddingVertical: Space.sm,
    },
    modalActionDivider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.border,
    },
    modalSectionTitle: {
      fontSize: FontSize.md,
      fontWeight: FontWeight.semibold,
      color: colors.text,
    },
    modalInput: {
      fontSize: FontSize.base,
      color: colors.text,
      backgroundColor: colors.inputBackground,
      borderRadius: Radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: Space.md,
      paddingVertical: Space.md,
    },
    modalInputDisabled: {
      backgroundColor: colors.surfaceMuted,
      color: colors.textMuted,
    },
    primaryActionButton: {
      paddingVertical: 11,
      borderRadius: Radius.md,
      alignItems: 'center',
      justifyContent: 'center',
    },
    primaryActionText: {
      fontSize: FontSize.base,
      fontWeight: FontWeight.semibold,
    },
    outlineActionButton: {
      paddingVertical: 11,
      borderRadius: Radius.md,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      backgroundColor: colors.surface,
    },
    outlineActionText: {
      fontSize: FontSize.base,
      fontWeight: FontWeight.semibold,
    },
  });
}
