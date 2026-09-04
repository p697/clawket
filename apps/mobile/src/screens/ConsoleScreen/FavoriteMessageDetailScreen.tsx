import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, View } from "react-native";
import { Bot, MessageCircle, Star, Trash2, User, Wrench } from "lucide-react-native";
import { EnrichedMarkdownText } from "react-native-enriched-markdown";
import { RouteProp, useNavigation, useRoute } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useTranslation } from "react-i18next";
import {
  EmptyState,
  HeaderActionButton,
  LoadingState,
  createCardContentStyle,
} from "../../components/ui";
import { createChatMarkdownStyle, getChatMarkdownFlavor, openChatMarkdownLink } from "../../components/chat/chatMarkdown";
import { useNativeStackModalHeader } from "../../hooks/useNativeStackModalHeader";
import {
  FavoritedMessage,
  MessageFavoritesService,
} from "../../services/message-favorites";
import { useAppTheme } from "../../theme";
import { FontSize, FontWeight, Radius, Space } from "../../theme/tokens";
import type { ConsoleStackParamList } from "./ConsoleTab";

type Navigation = NativeStackNavigationProp<
  ConsoleStackParamList,
  "FavoriteMessageDetail"
>;
type Route = RouteProp<ConsoleStackParamList, "FavoriteMessageDetail">;

const CHAT_MARKDOWN_FLAVOR = getChatMarkdownFlavor();

function formatDateTime(ts?: number): string {
  if (!ts) return "—";
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(ts));
}

function RoleIcon({
  role,
  colors,
}: {
  role: FavoritedMessage["role"];
  colors: ReturnType<typeof useAppTheme>["theme"]["colors"];
}) {
  switch (role) {
    case "user":
      return <User size={14} color={colors.primary} strokeWidth={2} />;
    case "assistant":
      return <Bot size={14} color={colors.success} strokeWidth={2} />;
    case "tool":
      return <Wrench size={14} color={colors.warning} strokeWidth={2} />;
    default:
      return (
        <MessageCircle size={14} color={colors.textSubtle} strokeWidth={2} />
      );
  }
}

function resolveDisplayMarkdown(message: FavoritedMessage): string {
  if (message.role === "tool") {
    return message.toolDetail || message.toolSummary || message.text || "";
  }
  return message.text || "";
}

export function FavoriteMessageDetailScreen(): React.JSX.Element {
  const { theme } = useAppTheme();
  const { t } = useTranslation("console");
  const colors = theme.colors;
  const navigation = useNavigation<Navigation>();
  const route = useRoute<Route>();
  const { favoriteKey } = route.params;
  const [favorite, setFavorite] = useState<FavoritedMessage | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    MessageFavoritesService.getFavoriteByKey(favoriteKey)
      .then((item) => {
        if (active) setFavorite(item);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [favoriteKey]);

  const markdownStyle = useMemo(
    () => createChatMarkdownStyle(colors),
    [colors],
  );

  const handleRemoveFavorite = useCallback(() => {
    if (!favorite) return;
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
              gatewayConfigId: favorite.gatewayConfigId,
              agentId: favorite.agentId,
              agentName: favorite.agentName,
              agentEmoji: favorite.agentEmoji,
              sessionKey: favorite.sessionKey,
              sessionLabel: favorite.sessionLabel,
              message: {
                id: favorite.messageId,
                role: favorite.role,
                text: favorite.text,
                timestampMs: favorite.timestampMs,
                modelLabel: favorite.modelLabel,
                toolName: favorite.toolName,
                toolStatus: favorite.toolStatus,
                toolSummary: favorite.toolSummary,
                toolArgs: favorite.toolArgs,
                toolDetail: favorite.toolDetail,
                toolDurationMs: favorite.toolDurationMs,
                toolStartedAt: favorite.toolStartedAt,
                toolFinishedAt: favorite.toolFinishedAt,
              },
            });
            navigation.goBack();
          },
        },
      ],
    );
  }, [favorite, navigation, t]);

  useNativeStackModalHeader({
    navigation,
    title: favorite?.agentName || t("Messages"),
    rightContent: favorite ? (
      <HeaderActionButton
        icon={Trash2}
        onPress={handleRemoveFavorite}
        tone="destructive"
      />
    ) : undefined,
    onClose: () => navigation.goBack(),
  });

  if (loading) {
    return <LoadingState message={t("common:Loading...")} />;
  }

  if (!favorite) {
    return (
      <View style={[styles.root, { backgroundColor: colors.background }]}>
        <EmptyState icon="⭐" title={t("No messages")} />
      </View>
    );
  }

  const markdown = resolveDisplayMarkdown(favorite);

  return (
    <ScrollView
      style={[styles.root, { backgroundColor: colors.background }]}
      contentContainerStyle={createCardContentStyle()}
    >
      <View
        style={[
          styles.card,
          { backgroundColor: colors.surface, borderColor: colors.border },
        ]}
      >
        <View style={styles.headerRow}>
          <View style={styles.titleRow}>
            <RoleIcon role={favorite.role} colors={colors} />
            <Text style={[styles.roleText, { color: colors.textMuted }]}>
              {favorite.role}
            </Text>
            <Star
              size={13}
              color={colors.warning}
              fill={colors.warning}
              strokeWidth={2}
            />
          </View>
          {favorite.modelLabel ? (
            <Text style={[styles.modelText, { color: colors.textSubtle }]}>
              {favorite.modelLabel}
            </Text>
          ) : null}
        </View>

        <View style={styles.metaList}>
          <Text style={[styles.metaText, { color: colors.textSubtle }]}>
            {favorite.agentName || favorite.agentId}
          </Text>
          <Text style={[styles.metaText, { color: colors.textSubtle }]}>
            {favorite.sessionLabel || favorite.sessionKey}
          </Text>
          <Text style={[styles.metaText, { color: colors.textSubtle }]}>
            {t("Original time")}: {formatDateTime(favorite.timestampMs)}
          </Text>
          <Text style={[styles.metaText, { color: colors.textSubtle }]}>
            {t("Favorited at")}: {formatDateTime(favorite.favoritedAt)}
          </Text>
        </View>

        <View
          style={[
            styles.markdownWrap,
            {
              backgroundColor: colors.surfaceMuted,
              borderColor: colors.border,
            },
          ]}
        >
          <EnrichedMarkdownText
            flavor={CHAT_MARKDOWN_FLAVOR}
            markdown={markdown}
            markdownStyle={markdownStyle}
            onLinkPress={openChatMarkdownLink}
            selectable
          />
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  card: {
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Space.md,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Space.sm,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Space.xs,
    flex: 1,
  },
  roleText: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    textTransform: "capitalize",
  },
  modelText: {
    fontSize: FontSize.xs,
  },
  metaList: {
    marginTop: Space.md,
    gap: Space.xs,
  },
  metaText: {
    fontSize: FontSize.sm,
  },
  markdownWrap: {
    marginTop: Space.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.sm,
    padding: Space.md,
  },
});
