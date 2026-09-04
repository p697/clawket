import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Bot, Sparkles } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Card } from '../ui';
import { useAppTheme } from '../../theme';
import { FontSize, FontWeight, Radius, Shadow, Space } from '../../theme/tokens';
import type { ChatAppearanceSettings } from '../../types/chat-appearance';
import {
  resolveChatBubbleAppearance,
  resolveChatMetaAppearance,
} from '../../features/chat-appearance/resolver';
import { ChatBackgroundLayer } from './ChatBackgroundLayer';

type Props = {
  appearance: ChatAppearanceSettings;
  backgroundImageUri?: string | null;
  chatFontSize: number;
  showAgentAvatar: boolean;
  showModelUsage: boolean;
};

export function ChatAppearancePreviewCard({
  appearance,
  backgroundImageUri,
  chatFontSize,
  showAgentAvatar,
  showModelUsage,
}: Props): React.JSX.Element {
  const { t } = useTranslation(['config', 'chat']);
  const { theme } = useAppTheme();
  const wallpaperActive = appearance.background.enabled && !!(backgroundImageUri ?? appearance.background.imagePath);
  const resolved = useMemo(
    () => resolveChatBubbleAppearance(theme, appearance),
    [appearance, theme],
  );
  const resolvedMeta = useMemo(() => resolveChatMetaAppearance(theme), [theme]);
  const styles = useMemo(
    () => createStyles(theme.colors, chatFontSize),
    [chatFontSize, theme.colors],
  );

  const userBubbleStyle = useMemo(
    () => [
      styles.messageBubble,
      styles.userBubble,
      resolved.userBubble.shadow ? Shadow.sm : null,
      {
        backgroundColor: resolved.userBubble.backgroundColor,
        borderColor: resolved.userBubble.borderColor,
        borderWidth: resolved.userBubble.borderWidth,
      },
    ],
    [resolved.userBubble, styles.messageBubble, styles.userBubble],
  );
  const assistantBubbleStyle = useMemo(
    () => [
      styles.messageBubble,
      styles.assistantBubble,
      resolved.assistantBubble.shadow ? Shadow.sm : null,
      {
        backgroundColor: resolved.assistantBubble.backgroundColor,
        borderColor: resolved.assistantBubble.borderColor,
        borderWidth: resolved.assistantBubble.borderWidth,
      },
    ],
    [resolved.assistantBubble, styles.assistantBubble, styles.messageBubble],
  );

  return (
    <Card style={styles.previewCard}>
      <ChatBackgroundLayer appearance={appearance} imageUri={backgroundImageUri} borderRadius={Radius.md} />

      <View style={styles.previewChrome}>
        <View style={styles.previewHeader}>
          <View style={styles.previewHeaderDots}>
            <View style={[styles.headerDot, { backgroundColor: theme.colors.textSubtle }]} />
            <View style={[styles.headerDot, { backgroundColor: theme.colors.textSubtle }]} />
            <View style={[styles.headerDot, { backgroundColor: theme.colors.textSubtle }]} />
          </View>
          <Text style={styles.previewHeaderTitle}>{t('Chat Preview')}</Text>
          <View style={styles.previewHeaderBadge}>
            <Sparkles size={12} color={theme.colors.primary} strokeWidth={2} />
          </View>
        </View>

        <View style={styles.messages}>
          <View style={styles.assistantRow}>
            {showAgentAvatar ? (
                <View style={styles.avatarSlot}>
                  <View style={[styles.avatar, { backgroundColor: theme.colors.primarySoft }]}>
                    <Bot size={16} color={theme.colors.primary} strokeWidth={2} />
                  </View>
                </View>
            ) : null}

            <View style={styles.assistantColumn}>
              {showAgentAvatar ? (
                <View
                  style={[
                    styles.assistantMetaRow,
                    wallpaperActive && styles.assistantMetaRowWallpaper,
                    wallpaperActive && resolvedMeta.shadow ? Shadow.sm : null,
                    wallpaperActive
                      ? {
                        backgroundColor: resolvedMeta.backgroundColor,
                        borderColor: resolvedMeta.borderColor,
                      }
                      : null,
                  ]}
                >
                  <Text style={[styles.agentName, wallpaperActive && styles.agentNameWallpaper]}>
                    {t('chat:Assistant')}
                  </Text>
                  {showModelUsage ? (
                    <Text style={[styles.agentMeta, wallpaperActive && styles.agentMetaWallpaper]}>
                      {t('GPT-5.4')}
                    </Text>
                  ) : null}
                </View>
              ) : showModelUsage ? (
                <Text style={[styles.agentMetaInline, wallpaperActive && styles.agentMetaInlineWallpaper]}>
                  {t('GPT-5.4 · 09:41')}
                </Text>
              ) : null}

              <View style={assistantBubbleStyle}>
                <Text style={styles.assistantText}>
                  {t('This wallpaper still keeps the chat readable.')}
                </Text>
              </View>
            </View>
          </View>

          <View style={styles.userRow}>
            <View style={userBubbleStyle}>
              <Text style={styles.userText}>{t('Looks good. Keep it clean and easy to read.')}</Text>
            </View>
          </View>
        </View>

        <View style={styles.composerWrap}>
          <View style={styles.composer}>
            <Text style={styles.composerPlaceholder}>{t('chat:Message...')}</Text>
          </View>
        </View>
      </View>
    </Card>
  );
}

function createStyles(
  colors: ReturnType<typeof useAppTheme>['theme']['colors'],
  fontSize: number,
) {
  return StyleSheet.create({
    previewCard: {
      minHeight: 250,
      padding: 0,
      overflow: 'hidden',
      backgroundColor: colors.background,
    },
    previewChrome: {
      flex: 1,
      padding: Space.md,
    },
    previewHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: Space.md,
    },
    previewHeaderDots: {
      flexDirection: 'row',
      gap: Space.xs,
      minWidth: 44,
    },
    headerDot: {
      width: 6,
      height: 6,
      borderRadius: Radius.full,
      opacity: 0.65,
    },
    previewHeaderTitle: {
      color: colors.text,
      fontSize: FontSize.sm,
      fontWeight: FontWeight.semibold,
    },
    previewHeaderBadge: {
      width: 44,
      alignItems: 'flex-end',
    },
    messages: {
      flex: 1,
      justifyContent: 'center',
      gap: Space.md,
    },
    assistantRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
    },
    avatarSlot: {
      width: 40,
      marginRight: Space.sm,
    },
    avatar: {
      width: 36,
      height: 36,
      borderRadius: Radius.full,
      alignItems: 'center',
      justifyContent: 'center',
    },
    assistantColumn: {
      flex: 1,
      alignItems: 'flex-start',
    },
    assistantMetaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: Space.xs,
    },
    assistantMetaRowWallpaper: {
      alignSelf: 'flex-start',
      paddingHorizontal: Space.sm,
      paddingVertical: 5,
      borderRadius: Radius.full,
      borderWidth: StyleSheet.hairlineWidth,
    },
    agentName: {
      color: colors.textMuted,
      fontSize: FontSize.sm,
      marginLeft: Space.xs,
    },
    agentNameWallpaper: {
      color: colors.text,
      marginLeft: 0,
    },
    agentMeta: {
      color: colors.textSubtle,
      fontSize: FontSize.xs,
      marginLeft: Space.sm,
      opacity: 0.7,
    },
    agentMetaWallpaper: {
      color: colors.textMuted,
      opacity: 1,
    },
    agentMetaInline: {
      color: colors.textSubtle,
      fontSize: FontSize.micro,
      marginBottom: Space.xs,
      opacity: 0.85,
    },
    agentMetaInlineWallpaper: {
      color: colors.textMuted,
      opacity: 1,
    },
    messageBubble: {
      maxWidth: '88%',
      borderRadius: Radius.md + 2,
      paddingHorizontal: Space.md,
      paddingVertical: Space.md - 2,
    },
    assistantBubble: {
      alignSelf: 'flex-start',
    },
    userBubble: {
      alignSelf: 'flex-end',
    },
    assistantText: {
      color: colors.text,
      fontSize,
      lineHeight: Math.round(fontSize * 1.45),
    },
    userText: {
      color: colors.text,
      fontSize,
      lineHeight: Math.round(fontSize * 1.45),
    },
    userRow: {
      alignItems: 'flex-end',
    },
    composerWrap: {
      marginTop: Space.md,
    },
    composer: {
      borderRadius: Radius.lg,
      paddingHorizontal: Space.md,
      paddingVertical: Space.sm + 2,
      backgroundColor: colors.inputBackground,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    composerPlaceholder: {
      color: colors.textSubtle,
      fontSize: FontSize.base,
    },
  });
}
