import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Alert,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import {
  ChevronRight,
  MessageCircle,
  Search,
  Star,
  Trash2,
} from "lucide-react-native";
import { useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import {
  EmptyState,
  HeaderActionButton,
  IconButton,
  SearchInput,
  SegmentedTabs,
  createListContentStyle,
} from "../../components/ui";
import { useTranslation } from "react-i18next";
import { useProPaywall } from "../../contexts/ProPaywallContext";
import { useNativeStackModalHeader } from "../../hooks/useNativeStackModalHeader";
import {
  CachedMessage,
  CachedSessionMeta,
  ChatCacheService,
} from "../../services/chat-cache";
import {
  FavoritedMessage,
  MessageFavoritesService,
} from "../../services/message-favorites";
import { StorageService } from "../../services/storage";
import { useAppTheme } from "../../theme";
import { FontSize, FontWeight, Radius, Space } from "../../theme/tokens";
import { getDisplayAgentEmoji } from "../../utils/agent-emoji";
import { sessionLabel } from "../../utils/chat-message";
import { splitHighlightSegments } from "../../utils/text-highlight";
import type { ConsoleStackParamList } from "./ConsoleTab";
import {
  buildChatHistoryDisplayGroups,
  buildChatHistorySessionGroups,
  buildGroupedSearchMatches,
  countUniqueMessages,
  getChatHistorySessionGroupKey,
  getChatHistorySessionGroupKey as getLogicalSessionGroupKey,
  type ChatHistorySessionGroup,
  type ChatHistoryDisplayGroup,
} from "./chatHistoryGroups";
import type { GatewayNameMap } from "./chatHistoryFilters";

type Navigation = NativeStackNavigationProp<
  ConsoleStackParamList,
  "ChatHistory"
>;

const SEARCH_DEBOUNCE_MS = 400;
type MessageScreenTab = "history" | "favorites";

function formatRelativeTime(
  ts: number,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return t("just now");
  if (mins < 60) return t("{{count}}m ago", { count: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t("{{count}}h ago", { count: hours });
  const days = Math.floor(hours / 24);
  if (days < 7) return t("{{count}}d ago", { count: days });
  const date = new Date(ts);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function formatSessionLabel(
  meta: CachedSessionMeta,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (/^agent:[^:]+:main$/.test(meta.sessionKey)) {
    return sessionLabel(
      { key: meta.sessionKey, label: meta.sessionLabel } as any,
      {
        currentAgentName: meta.agentName,
      },
    );
  }
  if (meta.sessionLabel) return meta.sessionLabel;
  const key = meta.sessionKey;
  const channelMatch = key.match(/channel:(\w+):/);
  if (channelMatch)
    return channelMatch[1].charAt(0).toUpperCase() + channelMatch[1].slice(1);
  const cronMatch = key.match(/cron:(.+)$/);
  if (cronMatch) return t("Cron {{id}}", { id: cronMatch[1].slice(0, 8) });
  const subMatch = key.match(/subagent:(.+)$/);
  if (subMatch) return t("Subagent {{id}}", { id: subMatch[1].slice(0, 8) });
  return key.split(":").pop() ?? key;
}

/** List item — either a session card or a content-match result row. */
type ListItem =
  | {
      type: "session";
      group: ChatHistoryDisplayGroup;
      contentMatchCount?: number;
    }
  | { type: "match"; group: ChatHistoryDisplayGroup; message: CachedMessage };

function renderHighlightedText(
  text: string,
  query: string,
  colors: { searchHighlightBg: string; text: string },
  keyPrefix: string,
): React.ReactNode[] {
  return splitHighlightSegments(text, query).map((segment, index) => (
    <Text
      key={`${keyPrefix}_${index}`}
      style={
        segment.match
          ? [
              { backgroundColor: colors.searchHighlightBg, color: colors.text },
              styles.highlightInline,
            ]
          : undefined
      }
    >
      {segment.text}
    </Text>
  ));
}

function formatAbsoluteDateTime(ts: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(ts));
}

export function ChatHistoryScreen(): React.JSX.Element {
  const { theme } = useAppTheme();
  const { t } = useTranslation("console");
  const { isPro } = useProPaywall();
  const colors = theme.colors;
  const navigation = useNavigation<Navigation>();
  const [activeTab, setActiveTab] = useState<MessageScreenTab>("history");
  const [sessions, setSessions] = useState<CachedSessionMeta[]>([]);
  const [favorites, setFavorites] = useState<FavoritedMessage[]>([]);
  const [gatewayNames, setGatewayNames] = useState<GatewayNameMap>({});
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [loadingFavorites, setLoadingFavorites] = useState(true);
  const [searchText, setSearchText] = useState("");
  const [agentFilter, setAgentFilter] = useState<string | null>(null);
  const [groupMessageCounts, setGroupMessageCounts] = useState<
    Record<string, number>
  >({});

  // Content search results (debounced)
  const [contentResults, setContentResults] = useState<
    Array<{ meta: CachedSessionMeta; matches: CachedMessage[] }>
  >([]);
  const [searching, setSearching] = useState(false);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const tabs = useMemo(
    () => [
      { key: "history" as const, label: t("History") },
      { key: "favorites" as const, label: t("Favorites") },
    ],
    [t],
  );

  const loadData = useCallback(async () => {
    setLoadingHistory(true);
    setLoadingFavorites(true);
    const [list, storedFavorites, gatewayState] = await Promise.all([
      ChatCacheService.listSessions(),
      MessageFavoritesService.listFavorites(),
      StorageService.getGatewayConfigsState().catch(() => ({
        activeId: null,
        configs: [],
      })),
    ]);
    setSessions(list);
    setFavorites(storedFavorites);
    setGatewayNames(
      gatewayState.configs.reduce<GatewayNameMap>((acc, config) => {
        acc[config.id] = config.name;
        return acc;
      }, {}),
    );
    setLoadingHistory(false);
    setLoadingFavorites(false);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const groupedSessions = useMemo(
    () => buildChatHistorySessionGroups(sessions),
    [sessions],
  );
  const displayGroups = useMemo(
    () =>
      buildChatHistoryDisplayGroups(groupedSessions, {
        resolveAgentLabel: (meta) => meta.agentName?.trim() || meta.agentId,
        resolveSessionLabel: (meta) => formatSessionLabel(meta, t),
      }),
    [groupedSessions, t],
  );
  const agents = useMemo(
    () =>
      Array.from(
        displayGroups.reduce(
          (map, group) => {
            const agentKey = group.agentLabel.trim().toLowerCase();
            const existing = map.get(agentKey);
            if (existing) {
              existing.sessionCount += 1;
              existing.lastUpdatedAt = Math.max(
                existing.lastUpdatedAt,
                group.latestMeta.updatedAt,
              );
            } else {
              map.set(agentKey, {
                key: agentKey,
                label: group.agentLabel,
                emoji: group.latestMeta.agentEmoji,
                sessionCount: 1,
                lastUpdatedAt: group.latestMeta.updatedAt,
              });
            }
            return map;
          },
          new Map<
            string,
            {
              key: string;
              label: string;
              emoji?: string;
              sessionCount: number;
              lastUpdatedAt: number;
            }
          >(),
        ),
      )
        .map(([, value]) => value)
        .sort(
          (a, b) =>
            b.lastUpdatedAt - a.lastUpdatedAt ||
            a.label.localeCompare(b.label),
        ),
    [displayGroups],
  );
  useEffect(() => {
    let cancelled = false;

    const loadGroupMessageCounts = async () => {
      if (displayGroups.length === 0) {
        setGroupMessageCounts({});
        return;
      }

      const entries = await Promise.all(
        displayGroups.map(async (group) => {
          const lineageParts = await Promise.all(
            group.logicalSessions.map((logicalSession) =>
              ChatCacheService.getSessionLineage(
                logicalSession.gatewayConfigId,
                logicalSession.agentId,
                logicalSession.sessionKey,
              ),
            ),
          );
          const mergedCount = countUniqueMessages(
            lineageParts.flat().map((snapshot) => snapshot.messages),
          );
          return [group.key, mergedCount] as const;
        }),
      );

      if (cancelled) return;
      setGroupMessageCounts(Object.fromEntries(entries));
    };

    void loadGroupMessageCounts();

    return () => {
      cancelled = true;
    };
  }, [displayGroups]);
  const hasMultipleGateways = useMemo(
    () => new Set(sessions.map((session) => session.gatewayConfigId)).size > 1,
    [sessions],
  );

  // Debounced content search
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);

    if (activeTab !== "history") {
      setContentResults([]);
      setSearching(false);
      return;
    }

    const query = searchText.trim();
    if (!query) {
      setContentResults([]);
      setSearching(false);
      return;
    }

    setSearching(true);
    searchTimerRef.current = setTimeout(async () => {
      const results = await ChatCacheService.search(query);
      setContentResults(results);
      setSearching(false);
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, [activeTab, agentFilter, agents, searchText]);

  useEffect(() => {
    if (!agentFilter) return;
    if (!agents.some((item) => item.key === agentFilter)) {
      setAgentFilter(null);
    }
  }, [agentFilter, agents]);

  const listItems = useMemo((): ListItem[] => {
    const query = searchText.trim().toLowerCase();

    // No search — show all sessions filtered by agent
    if (!query) {
      let result = displayGroups;
      if (agentFilter) {
        result = result.filter(
          (group) => group.key.startsWith(`${agentFilter}::`) || group.agentLabel.trim().toLowerCase() === agentFilter,
        );
      }
      return result.map((group) => ({ type: "session" as const, group }));
    }

    // With search — merge label-matched sessions + content-matched sessions
    let pool = displayGroups;
    if (agentFilter) {
      pool = pool.filter(
        (group) =>
          group.key.startsWith(`${agentFilter}::`) ||
          group.agentLabel.trim().toLowerCase() === agentFilter,
      );
    }

    // Sessions matching by label/agent name
    const labelMatched = new Set<string>();
    for (const group of pool) {
      const meta = group.latestMeta;
      if (
        group.sessionLabel.toLowerCase().includes(query) ||
        group.agentLabel.toLowerCase().includes(query)
      ) {
        labelMatched.add(group.key);
      }
    }

    // Build content match count map
    const groupedContentMatches = buildGroupedSearchMatches(contentResults);
    const contentMatchMap = new Map<
      string,
      { group: ChatHistoryDisplayGroup; matches: CachedMessage[] }
    >();
    for (const result of groupedContentMatches) {
      const group = displayGroups.find((item) =>
        item.logicalSessions.some(
          (logicalSession) =>
            getLogicalSessionGroupKey(logicalSession.latestMeta) === result.groupKey,
        ),
      );
      if (!group) continue;
      const existing = contentMatchMap.get(group.key);
      if (existing) {
        const seenMessageIds = new Set(existing.matches.map((message) => message.id));
        for (const message of result.messages) {
          if (seenMessageIds.has(message.id)) continue;
          seenMessageIds.add(message.id);
          existing.matches.push(message);
        }
      } else {
        contentMatchMap.set(group.key, {
          group,
          matches: [...result.messages],
        });
      }
    }

    const items: ListItem[] = [];
    const seen = new Set<string>();

    // First: sessions that match by label (show as session cards with optional match count)
    for (const group of pool) {
      if (!labelMatched.has(group.key)) continue;
      seen.add(group.key);
      const contentHit = contentMatchMap.get(group.key);
      items.push({
        type: "session",
        group,
        contentMatchCount: contentHit?.matches.length,
      });
    }

    // Then: sessions that match by content only (not already shown from label match)
    for (const { group, matches } of contentMatchMap.values()) {
      if (seen.has(group.key)) continue;
      // Skip if filtered by agent and doesn't match
      if (
        agentFilter &&
        !(
          group.key.startsWith(`${agentFilter}::`) ||
          group.agentLabel.trim().toLowerCase() === agentFilter
        )
      )
        continue;
      seen.add(group.key);

      // Show session card with match count
      items.push({
        type: "session",
        group,
        contentMatchCount: matches.length,
      });

      // Show up to 3 matching message previews inline
      for (const msg of matches.slice(0, 3)) {
        items.push({ type: "match", group, message: msg });
      }
    }

    return items;
  }, [contentResults, agentFilter, displayGroups, searchText]);

  const visibleListItems = useMemo(
    () =>
      isPro ? listItems : listItems.filter((item) => item.type === "session"),
    [isPro, listItems],
  );

  const filteredFavorites = useMemo(() => {
    const query = searchText.trim().toLowerCase();
    if (!query) return favorites;
    return favorites.filter((item) =>
      item.text.toLowerCase().includes(query) ||
      (item.agentName && item.agentName.toLowerCase().includes(query)) ||
      item.sessionKey.toLowerCase().includes(query) ||
      (item.sessionLabel && item.sessionLabel.toLowerCase().includes(query)) ||
      (item.modelLabel && item.modelLabel.toLowerCase().includes(query)) ||
      (item.toolName && item.toolName.toLowerCase().includes(query)) ||
      (item.toolSummary && item.toolSummary.toLowerCase().includes(query)),
    );
  }, [favorites, searchText]);

  const handleDelete = useCallback(
    (group: ChatHistoryDisplayGroup) => {
      const meta = group.latestMeta;
      Alert.alert(
        t("Delete Cache"),
        t('Delete cached messages for "{{label}}"?', {
          label: formatSessionLabel(meta, t),
        }),
        [
          { text: t("common:Cancel"), style: "cancel" },
          {
            text: t("common:Delete"),
            style: "destructive",
            onPress: async () => {
              await Promise.all(
                group.logicalSessions.map((logicalSession) =>
                  ChatCacheService.deleteMessages(
                    logicalSession.gatewayConfigId,
                    logicalSession.agentId,
                    logicalSession.sessionKey,
                  ),
                ),
              );
              setSessions((prev) =>
                prev.filter(
                  (session) =>
                    !group.logicalSessions.some(
                      (logicalSession) =>
                        getChatHistorySessionGroupKey(session) ===
                        logicalSession.key,
                    ),
                ),
              );
            },
          },
        ],
      );
    },
    [t],
  );

  const handleClearAll = useCallback(() => {
    Alert.alert(t("Clear All Cache"), t("Delete all cached chat messages?"), [
      { text: t("common:Cancel"), style: "cancel" },
      {
        text: t("Clear All"),
        style: "destructive",
        onPress: async () => {
          await ChatCacheService.clearAll();
          setSessions([]);
        },
      },
    ]);
  }, [t]);

  const handleClearAllFavorites = useCallback(() => {
    Alert.alert(
      t("Clear All Favorites"),
      t("Delete all favorited messages?"),
      [
        { text: t("common:Cancel"), style: "cancel" },
        {
          text: t("Clear All"),
          style: "destructive",
          onPress: async () => {
            await MessageFavoritesService.clearAll();
            setFavorites([]);
          },
        },
      ],
    );
  }, [t]);

  const handleRemoveFavorite = useCallback((item: FavoritedMessage) => {
    Alert.alert(
      t("Remove favorite"),
      t(
        "If you remove this favorite, it will be deleted permanently and cannot be recovered.",
      ),
      [
        { text: t("common:Cancel"), style: "cancel" },
        {
          text: t("Remove favorite"),
          style: "destructive",
          onPress: async () => {
            await MessageFavoritesService.toggleFavorite({
              gatewayConfigId: item.gatewayConfigId,
              agentId: item.agentId,
              agentName: item.agentName,
              agentEmoji: item.agentEmoji,
              sessionKey: item.sessionKey,
              sessionLabel: item.sessionLabel,
              message: {
                id: item.messageId,
                role: item.role,
                text: item.text,
                timestampMs: item.timestampMs,
                modelLabel: item.modelLabel,
                toolName: item.toolName,
                toolStatus: item.toolStatus,
                toolSummary: item.toolSummary,
                toolArgs: item.toolArgs,
                toolDetail: item.toolDetail,
                toolDurationMs: item.toolDurationMs,
                toolStartedAt: item.toolStartedAt,
                toolFinishedAt: item.toolFinishedAt,
              },
            });
            setFavorites((prev) =>
              prev.filter((favorite) => favorite.favoriteKey !== item.favoriteKey),
            );
          },
        },
      ],
    );
  }, [t]);

  const headerRight = useMemo(
    () =>
      activeTab === "history" ? (
        sessions.length > 0 ? (
          <HeaderActionButton
            icon={Trash2}
            onPress={handleClearAll}
            tone="destructive"
          />
        ) : null
      ) : favorites.length > 0 ? (
        <HeaderActionButton
          icon={Trash2}
          onPress={handleClearAllFavorites}
          tone="destructive"
        />
      ) : null,
    [activeTab, favorites.length, handleClearAll, handleClearAllFavorites, sessions.length],
  );

  useNativeStackModalHeader({
    navigation,
    title: t("Messages"),
    rightContent: headerRight ?? undefined,
    onClose: () => navigation.goBack(),
  });

  const renderItem = useCallback(
    ({ item }: { item: ListItem }) => {
      if (item.type === "match") {
        const msg = item.message;
        const isTool = msg.role === "tool";
        const text = isTool ? msg.toolSummary || msg.toolName || "" : msg.text;
        const initialQuery = searchText.trim() || undefined;
        return (
          <TouchableOpacity
            style={[
              styles.matchRow,
              {
                backgroundColor: colors.surfaceMuted,
                borderColor: colors.border,
              },
            ]}
            activeOpacity={0.7}
            onPress={() =>
              navigation.navigate("ChatHistoryDetail", {
                storageKey: item.group.latestMeta.storageKey,
                initialQuery,
                sessionRefs: item.group.logicalSessions.map((logicalSession) => ({
                  gatewayConfigId: logicalSession.gatewayConfigId,
                  agentId: logicalSession.agentId,
                  sessionKey: logicalSession.sessionKey,
                })),
              })
            }
          >
            <Search size={12} color={colors.textSubtle} strokeWidth={2} />
            <Text style={[styles.matchRole, { color: colors.textMuted }]}>
              {msg.role}
            </Text>
            <Text
              style={[styles.matchText, { color: colors.text }]}
              numberOfLines={2}
            >
              {renderHighlightedText(
                text,
                searchText,
                colors,
                `match_${item.group.latestMeta.storageKey}_${msg.id}`,
              )}
            </Text>
          </TouchableOpacity>
        );
      }

      const { group, contentMatchCount } = item;
      const meta = group.latestMeta;
      const initialQuery = searchText.trim() || undefined;
      return (
        <TouchableOpacity
          style={[
            styles.sessionCard,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
          activeOpacity={0.7}
          onPress={() =>
            navigation.navigate("ChatHistoryDetail", {
              storageKey: meta.storageKey,
              initialQuery,
              sessionRefs: group.logicalSessions.map((logicalSession) => ({
                gatewayConfigId: logicalSession.gatewayConfigId,
                agentId: logicalSession.agentId,
                sessionKey: logicalSession.sessionKey,
              })),
            })
          }
        >
          <View style={styles.sessionRow}>
            <Text style={styles.sessionEmoji}>{getDisplayAgentEmoji(meta.agentEmoji)}</Text>
            <View style={styles.sessionInfo}>
              <Text
                style={[styles.sessionTitle, { color: colors.text }]}
                numberOfLines={1}
              >
                {renderHighlightedText(
                  group.agentLabel,
                  searchText,
                  colors,
                  `agent_${meta.storageKey}`,
                )}
                <Text style={{ color: colors.textSubtle }}> / </Text>
                {renderHighlightedText(
                  group.sessionLabel,
                  searchText,
                  colors,
                  `session_${meta.storageKey}`,
                )}
              </Text>
              <View style={styles.sessionMeta}>
                <MessageCircle
                  size={13}
                  color={colors.textMuted}
                  strokeWidth={2}
                />
                <Text
                  style={[styles.sessionMetaText, { color: colors.textMuted }]}
                >
                  {groupMessageCounts[group.key] ?? meta.messageCount}
                </Text>
                <Text
                  style={[styles.sessionMetaDot, { color: colors.textSubtle }]}
                >
                  ·
                </Text>
                <Text
                  style={[styles.sessionMetaText, { color: colors.textSubtle }]}
                >
                  {meta.lastMessageMs
                    ? formatRelativeTime(meta.lastMessageMs, t)
                    : "—"}
                </Text>
                {group.snapshotCount > 1 && (
                  <>
                    <Text
                      style={[
                        styles.sessionMetaDot,
                        { color: colors.textSubtle },
                      ]}
                    >
                      ·
                    </Text>
                    <Text
                      style={[styles.snapshotBadge, { color: colors.textMuted }]}
                    >
                      {t(
                        group.snapshotCount > 1
                          ? "{{count}} snapshots"
                          : "{{count}} snapshot",
                        { count: group.snapshotCount },
                      )}
                    </Text>
                  </>
                )}
                {hasMultipleGateways && (
                  <>
                    <Text
                      style={[
                        styles.sessionMetaDot,
                        { color: colors.textSubtle },
                      ]}
                    >
                      ·
                    </Text>
                    <Text
                      style={[styles.gatewayBadge, { color: colors.textMuted }]}
                    >
                      {gatewayNames[meta.gatewayConfigId] || t("Gateway")}
                    </Text>
                  </>
                )}
                {contentMatchCount != null && contentMatchCount > 0 && (
                  <>
                    <Text
                      style={[
                        styles.sessionMetaDot,
                        { color: colors.textSubtle },
                      ]}
                    >
                      ·
                    </Text>
                    <Text
                      style={[styles.matchBadge, { color: colors.primary }]}
                    >
                      {t(
                        contentMatchCount > 1
                          ? "{{count}} matches"
                          : "{{count}} match",
                        { count: contentMatchCount },
                      )}
                    </Text>
                  </>
                )}
              </View>
            </View>
            <View style={styles.sessionActions}>
              <IconButton
                icon={<Trash2 size={15} color={colors.error} strokeWidth={2} />}
                onPress={() => handleDelete(group)}
              />
              <ChevronRight
                size={15}
                color={colors.textSubtle}
                strokeWidth={2}
              />
            </View>
          </View>
        </TouchableOpacity>
      );
    },
    [
      colors,
      gatewayNames,
      handleDelete,
      hasMultipleGateways,
      navigation,
      searchText,
      groupMessageCounts,
      t,
    ],
  );

  const renderFavoriteItem = useCallback(
    ({ item }: { item: FavoritedMessage }) => {
      const displayText =
        item.role === "tool"
          ? item.toolSummary || item.toolName || item.text
          : item.text;
      const sessionName =
        item.sessionLabel ||
        formatSessionLabel(
          {
            storageKey: "",
            gatewayConfigId: item.gatewayConfigId,
            agentId: item.agentId,
            agentName: item.agentName,
            agentEmoji: item.agentEmoji,
            sessionKey: item.sessionKey,
            messageCount: 0,
            updatedAt: item.favoritedAt,
          },
          t,
        );

      return (
        <TouchableOpacity
          style={[
            styles.favoriteCard,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
          activeOpacity={0.7}
          onPress={() =>
            navigation.navigate("FavoriteMessageDetail", {
              favoriteKey: item.favoriteKey,
            })
          }
        >
          <TouchableOpacity
            activeOpacity={0.7}
            style={[
              styles.favoriteStarButton,
              {
                backgroundColor: colors.surfaceMuted,
                borderColor: colors.border,
              },
            ]}
            onPress={(event) => {
              event.stopPropagation();
              handleRemoveFavorite(item);
            }}
          >
            <Star
              size={14}
              color={colors.warning}
              fill={colors.warning}
              strokeWidth={2}
            />
          </TouchableOpacity>
          <View style={styles.favoriteHeader}>
            <View style={styles.favoriteTitleWrap}>
              <Text
                style={[styles.favoriteTitle, { color: colors.text }]}
                numberOfLines={1}
              >
                {item.agentName || item.agentId}
              </Text>
            </View>
            <Text
              style={[styles.favoriteMetaText, { color: colors.textSubtle }]}
            >
              {formatAbsoluteDateTime(item.favoritedAt)}
            </Text>
          </View>
          <View style={styles.favoriteMetaRow}>
            <Text style={[styles.favoriteRoleBadge, { color: colors.textMuted }]}>
              {item.role}
            </Text>
            <Text
              style={[styles.favoriteMetaText, { color: colors.textSubtle }]}
              numberOfLines={1}
            >
              {sessionName}
            </Text>
            {gatewayNames[item.gatewayConfigId] ? (
              <Text
                style={[styles.favoriteMetaText, { color: colors.textSubtle }]}
                numberOfLines={1}
              >
                {" · "}
                {gatewayNames[item.gatewayConfigId]}
              </Text>
            ) : null}
          </View>
          <Text
            style={[styles.favoriteBody, { color: colors.text }]}
            numberOfLines={4}
          >
            {renderHighlightedText(
              displayText,
              searchText,
              colors,
              `favorite_${item.favoriteKey}`,
            )}
          </Text>
        </TouchableOpacity>
      );
    },
    [colors, gatewayNames, handleRemoveFavorite, navigation, searchText, t],
  );

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <SegmentedTabs tabs={tabs} active={activeTab} onSwitch={setActiveTab} />

      {activeTab === "history" && agents.length > 1 && (
        <View style={styles.filterRow}>
          <TouchableOpacity
            style={[
              styles.filterChip,
              {
                backgroundColor: !agentFilter
                  ? colors.primary
                  : colors.surfaceMuted,
                borderColor: !agentFilter ? colors.primary : colors.border,
              },
            ]}
            onPress={() => setAgentFilter(null)}
            activeOpacity={0.7}
          >
            <Text
              style={[
                styles.filterChipText,
                { color: !agentFilter ? colors.primaryText : colors.text },
              ]}
            >
              {t("common:All")}
            </Text>
          </TouchableOpacity>
          {agents.map((agent) => (
            <TouchableOpacity
              key={agent.key}
              style={[
                styles.filterChip,
                {
                  backgroundColor:
                    agentFilter === agent.key
                      ? colors.primary
                      : colors.surfaceMuted,
                  borderColor:
                    agentFilter === agent.key ? colors.primary : colors.border,
                },
              ]}
              onPress={() =>
                setAgentFilter(agent.key === agentFilter ? null : agent.key)
              }
              activeOpacity={0.7}
            >
              {agent.emoji && (
                <Text style={styles.filterChipEmoji}>{getDisplayAgentEmoji(agent.emoji)}</Text>
              )}
              <Text
                style={[
                  styles.filterChipText,
                  {
                    color:
                      agentFilter === agent.key
                        ? colors.primaryText
                        : colors.text,
                  },
                ]}
                numberOfLines={1}
              >
                {agent.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      <View style={styles.searchRow}>
        <View style={styles.searchWrap}>
          <SearchInput
            value={searchText}
            onChangeText={setSearchText}
            placeholder={t("Search messages...")}
          />
        </View>
      </View>
      <Text style={[styles.cacheHint, { color: colors.textMuted }]}>
        {activeTab === "history"
          ? t("Only conversations cached on this device appear here.")
          : t("Only favorited messages saved on this device appear here.")}
      </Text>

      {activeTab === "history" && searching && searchText.trim().length > 0 && (
        <Text style={[styles.searchHint, { color: colors.textSubtle }]}>
          {t("Searching messages...")}
        </Text>
      )}

      {activeTab === "history" ? (
        <FlatList
          data={visibleListItems}
          keyExtractor={(item, index) =>
            item.type === "session"
              ? item.group.key
              : `match_${item.group.key}_${item.message.id}_${index}`
          }
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <EmptyState
              icon="💬"
              title={
                loadingHistory
                  ? t("common:Loading...")
                  : sessions.length === 0
                    ? t("No cached messages")
                    : searching
                      ? t("Searching...")
                      : t("No matching results")
              }
              subtitle={t(
                "Only conversations cached on this device appear here.",
              )}
            />
          }
        />
      ) : (
        <FlatList
          data={filteredFavorites}
          keyExtractor={(item) => item.favoriteKey}
          renderItem={renderFavoriteItem}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <EmptyState
              icon="⭐"
              title={
                loadingFavorites
                  ? t("common:Loading...")
                  : favorites.length === 0
                    ? t("No favorited messages")
                    : t("No matching favorites")
              }
              subtitle={t("Only favorited messages saved on this device appear here.")}
            />
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  filterRow: {
    flexDirection: "row",
    paddingHorizontal: Space.lg,
    paddingTop: Space.md,
    paddingBottom: Space.sm,
    gap: Space.sm,
    flexWrap: "wrap",
  },
  filterChip: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Space.md,
    paddingVertical: Space.xs + 2,
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    gap: Space.xs,
  },
  filterChipEmoji: {
    fontSize: FontSize.sm,
  },
  filterChipText: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.medium,
  },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Space.lg,
    paddingTop: Space.md,
    paddingBottom: Space.sm,
    gap: Space.sm,
  },
  searchWrap: {
    flex: 1,
  },
  searchHint: {
    fontSize: FontSize.xs,
    paddingHorizontal: Space.lg,
    paddingBottom: Space.xs,
  },
  cacheHint: {
    fontSize: FontSize.sm,
    paddingHorizontal: Space.lg,
    paddingBottom: Space.sm,
  },
  listContent: {
    ...createListContentStyle({ grow: true, bottom: Space.xxxl }),
  },
  sessionCard: {
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: Space.sm + 2,
    paddingHorizontal: Space.md,
    marginBottom: Space.sm,
  },
  sessionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Space.sm,
  },
  sessionEmoji: {
    fontSize: FontSize.xxl,
  },
  sessionInfo: {
    flex: 1,
  },
  sessionTitle: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.semibold,
  },
  sessionMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    marginTop: 3,
  },
  sessionMetaText: {
    fontSize: FontSize.md,
    fontWeight: FontWeight.medium,
  },
  sessionMetaDot: {
    fontSize: FontSize.md,
  },
  sessionActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  matchBadge: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
  },
  snapshotBadge: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.medium,
  },
  gatewayBadge: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.medium,
  },
  matchRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Space.xs,
    paddingHorizontal: Space.md,
    paddingVertical: Space.sm,
    marginBottom: 2,
    marginLeft: Space.xl,
    borderRadius: Radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
  },
  matchRole: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    textTransform: "capitalize",
    minWidth: 40,
  },
  favoriteCard: {
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Space.md,
    paddingVertical: Space.md,
    marginBottom: Space.sm,
    gap: Space.xs,
    position: "relative",
    paddingRight: Space.xxxl,
  },
  favoriteHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: Space.sm,
  },
  favoriteTitleWrap: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  favoriteTitle: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.semibold,
    flex: 1,
  },
  favoriteStarButton: {
    position: "absolute",
    top: Space.sm,
    right: Space.sm,
    width: 28,
    height: 28,
    borderRadius: Radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1,
  },
  favoriteMetaRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  favoriteRoleBadge: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    textTransform: "capitalize",
    marginRight: Space.sm,
  },
  favoriteMetaText: {
    fontSize: FontSize.sm,
  },
  favoriteBody: {
    fontSize: FontSize.md,
    lineHeight: 19,
  },
  matchText: {
    fontSize: FontSize.sm,
    flex: 1,
    lineHeight: 18,
  },
  highlightInline: {
    borderRadius: Radius.sm,
  },
});
