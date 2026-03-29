import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { Animated, Image, Platform, Pressable, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { EnrichedMarkdownText } from 'react-native-enriched-markdown';
import remend from 'remend';
import { useTranslation } from 'react-i18next';
import { Star } from 'lucide-react-native';
import { ChatRole } from '../types';
import { ImageMeta, MessageUsage } from '../types/chat';
import { computeImageLayout } from '../utils/image-layout';
import { useImageDimensions } from '../hooks/useImageDimensions';
import { useAppContext } from '../contexts/AppContext';
import {
  resolveChatBubbleAppearance,
  resolveChatMetaAppearance,
} from '../features/chat-appearance/resolver';
import { useAppTheme } from '../theme';
import { FontSize, FontWeight, Radius, Shadow, Space } from '../theme/tokens';
import { sanitizeDisplayText, sanitizeUserMessageText } from '../utils/chat-message';
import { AGENT_AVATAR_SIZE, AGENT_AVATAR_SLOT_WIDTH } from './chat/messageLayout';
import { createChatMarkdownStyle, getChatMarkdownFlavor, openChatMarkdownLink } from './chat/chatMarkdown';

export type BubbleFrame = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type MessageSelectionFrames = {
  rowFrame: BubbleFrame;
  bubbleFrame: BubbleFrame;
};

type Props = {
  messageId: string;
  role: ChatRole;
  text: string;
  timestampMs?: number;
  streaming?: boolean;
  imageUris?: string[];
  imageMetas?: ImageMeta[];
  onImagePress?: (uris: string[], index: number) => void;
  avatarUri?: string;
  onAvatarPress?: () => void;
  displayName?: string;
  isFavorited?: boolean;
  modelLabel?: string;
  usage?: MessageUsage;
  showModelUsage?: boolean;
  isSelected?: boolean;
  showSelectionHighlight?: boolean;
  hideWhenSelected?: boolean;
  onToggleSelection?: (messageId: string) => void;
  onSelectMessage?: (messageId: string, frames: MessageSelectionFrames) => void;
  overlayMode?: boolean;
  reserveAvatarSlot?: boolean;
  chatFontSize?: number;
};

const BUBBLE_PADDING_HORIZONTAL = Space.md;
const BUBBLE_PADDING_VERTICAL = Space.md - 2;
const STREAMING_REMEND_OPTIONS = {
  bold: true,
  italic: true,
  boldItalic: true,
  strikethrough: true,
  links: true,
  linkMode: 'text-only' as const,
  images: true,
  inlineCode: true,
  katex: false,
  setextHeadings: true,
};

type AssistantMarkdownProps = {
  markdown: string;
  markdownStyle: ReturnType<typeof createChatMarkdownStyle>;
  selectable: boolean;
  streamingAnimation: boolean;
};

function StreamingFadeMask({
  streaming,
  children,
}: {
  streaming: boolean;
  children: React.ReactNode;
}): React.JSX.Element {
  const opacity = useRef(new Animated.Value(streaming ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(opacity, {
      toValue: streaming ? 1 : 0,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [streaming, opacity]);

  // When not streaming (and animation has settled) skip MaskedView entirely
  // to avoid any performance overhead on static messages.
  if (!streaming) {
    return <View>{children}</View>;
  }

  return (
    <Animated.View style={{ opacity }}>
      {children}
    </Animated.View>
  );
}

const CHAT_MARKDOWN_FLAVOR = getChatMarkdownFlavor();

const AssistantMarkdown = React.memo(function AssistantMarkdown({
  markdown,
  markdownStyle,
  selectable,
  streamingAnimation,
}: AssistantMarkdownProps): React.JSX.Element {
  return (
    <EnrichedMarkdownText
      flavor={CHAT_MARKDOWN_FLAVOR}
      markdown={markdown}
      markdownStyle={markdownStyle}
      onLinkPress={openChatMarkdownLink}
      selectable={selectable}
      streamingAnimation={streamingAnimation}
    />
  );
}, (prev, next) => (
  prev.markdown === next.markdown
  && prev.markdownStyle === next.markdownStyle
  && prev.selectable === next.selectable
  && prev.streamingAnimation === next.streamingAnimation
));

function ImageGrid({
  uris,
  metas,
  maxWidth,
  onPress,
}: {
  uris: string[];
  metas?: ImageMeta[];
  maxWidth: number;
  onPress?: (index: number) => void;
}): React.JSX.Element {
  const resolvedMetas = useImageDimensions(uris, metas);
  const layoutMetas = resolvedMetas ?? uris.map(() => ({ uri: '', width: 0, height: 0 }));
  const layout = computeImageLayout(layoutMetas, maxWidth);

  if (layout.kind === 'single') {
    return (
      <TouchableOpacity activeOpacity={0.9} onPress={() => onPress?.(0)}>
        <Image
          source={{ uri: uris[0] }}
          style={{ width: layout.width, height: layout.height, borderRadius: Radius.sm + 2 }}
          resizeMode="cover"
        />
      </TouchableOpacity>
    );
  }

  return (
    <View style={{ width: layout.totalWidth, height: layout.totalHeight }}>
      {layout.rects.map((rect, index) => (
        <TouchableOpacity
          key={index}
          activeOpacity={0.9}
          onPress={() => onPress?.(index)}
          style={{ position: 'absolute', left: rect.x, top: rect.y }}
        >
          <Image
            source={{ uri: uris[index] }}
            style={{ width: rect.width, height: rect.height, borderRadius: Radius.sm }}
            resizeMode="cover"
          />
        </TouchableOpacity>
      ))}
    </View>
  );
}

function formatTokens(n?: number): string {
  if (n === undefined || n === null) return '0';
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}K`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
}

function stripReplyTagPrefix(input: string): string {
  return input.replace(/^\s*\[\[\s*reply_to[^\]]*\]\]\s*/i, '');
}

function Avatar({ uri }: { uri?: string }): React.JSX.Element | null {
  const normalizedUri = uri?.trim();
  if (!normalizedUri) return null;
  return <Image source={{ uri: normalizedUri }} style={avatarStyles.img} />;
}

const avatarStyles = StyleSheet.create({
  img: { width: AGENT_AVATAR_SIZE, height: AGENT_AVATAR_SIZE, borderRadius: Radius.sm },
  placeholder: {
    width: AGENT_AVATAR_SIZE,
    height: AGENT_AVATAR_SIZE,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholderText: { fontSize: FontSize.md + 1, fontWeight: FontWeight.semibold },
});

function MessageBubbleComponent({
  messageId,
  role,
  text,
  timestampMs,
  streaming = false,
  imageUris,
  imageMetas,
  onImagePress,
  avatarUri,
  onAvatarPress,
  displayName,
  isFavorited = false,
  modelLabel,
  usage,
  showModelUsage = true,
  isSelected = false,
  showSelectionHighlight = true,
  hideWhenSelected = false,
  onToggleSelection,
  onSelectMessage,
  overlayMode = false,
  reserveAvatarSlot = true,
  chatFontSize,
}: Props): React.JSX.Element {
  const { t } = useTranslation('chat');
  const { theme } = useAppTheme();
  const { chatAppearance } = useAppContext();
  const effectiveFontSize = chatFontSize ?? FontSize.base;
  const styles = useMemo(() => createStyles(theme.colors, effectiveFontSize), [theme, effectiveFontSize]);
  const markdownStyle = useMemo(() => createChatMarkdownStyle(theme.colors, effectiveFontSize), [theme, effectiveFontSize]);
  const resolvedBubbleAppearance = useMemo(
    () => resolveChatBubbleAppearance(theme, chatAppearance),
    [chatAppearance, theme],
  );
  const resolvedMetaAppearance = useMemo(() => resolveChatMetaAppearance(theme), [theme]);
  const wallpaperActive = chatAppearance.background.enabled && !!chatAppearance.background.imagePath;
  const { width: screenWidth } = useWindowDimensions();

  const avatarSpace = reserveAvatarSlot ? AGENT_AVATAR_SLOT_WIDTH : 0;
  const rowHorizontalPadding = Space.sm;
  const maxBubbleWidth = screenWidth - rowHorizontalPadding - avatarSpace;
  const imageGridWidth = maxBubbleWidth - 24;

  const isUser = role === 'user';
  const isSystem = role === 'system';
  const cleanText = useMemo(() => {
    const withoutReplyTag = stripReplyTagPrefix(text);
    if (role === 'assistant') return sanitizeDisplayText(withoutReplyTag);
    if (role === 'user') return sanitizeUserMessageText(withoutReplyTag);
    return withoutReplyTag;
  }, [role, text]);
  const hasImages = imageUris && imageUris.length > 0;
  const hasText = !!(
    cleanText &&
    (!hasImages ||
      (cleanText !== `📷 ${imageUris?.length} image${(imageUris?.length ?? 0) > 1 ? 's' : ''}` &&
        cleanText !== '📷 Image'))
  );

  const rowRef = useRef<View>(null);
  const bubbleRef = useRef<View>(null);
  const timestampLabel = useMemo(() => {
    if (!timestampMs || streaming || isSystem) return null;
    return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(new Date(timestampMs));
  }, [timestampMs, streaming, isSystem]);
  const isLoadingOnly = streaming && cleanText.trim().length === 0;
  const displayText = useMemo(() => {
    if (!streaming) return cleanText;
    // Keep markdown stable while tokens stream in by terminating incomplete syntax.
    // Do not append a fake cursor here: the native markdown view animates only
    // truly appended tail content, so a synthetic trailing glyph would absorb
    // the fade and hide the actual token-level effect.
    return remend(cleanText, STREAMING_REMEND_OPTIONS);
  }, [cleanText, streaming]);
  const shouldReserveWidth = isLoadingOnly;
  const canSelectTextNatively = isSelected && overlayMode;
  const shouldShowSelectedStyle = isSelected && showSelectionHighlight;
  const shouldHideSourceMessage = isSelected && hideWhenSelected && !overlayMode;
  const bubblePressDisabled = overlayMode;
  const useAndroidStackedUserTimestamp = Platform.OS === 'android';
  const handleLongPress = useCallback(() => {
    if (!onSelectMessage) return;
    bubbleRef.current?.measureInWindow((bubbleX, bubbleY, bubbleWidth, bubbleHeight) => {
      const bubbleFrame = { x: bubbleX, y: bubbleY, width: bubbleWidth, height: bubbleHeight };
      rowRef.current?.measureInWindow((rowX, rowY, rowWidth, rowHeight) => {
        onSelectMessage(messageId, {
          rowFrame: { x: rowX, y: rowY, width: rowWidth, height: rowHeight },
          bubbleFrame,
        });
      });
    });
  }, [messageId, onSelectMessage]);
  const handlePress = useCallback(() => {
    if (isSelected) onToggleSelection?.(messageId);
  }, [isSelected, messageId, onToggleSelection]);

  // When avatar is hidden, build a meta line like WebView: "modelLabel · timestamp"
  const assistantMetaLabel = useMemo(() => {
    if (reserveAvatarSlot || streaming || isUser || isSystem) return null;
    const parts: string[] = [];
    if (showModelUsage && modelLabel) parts.push(modelLabel);
    if (timestampLabel) parts.push(timestampLabel);
    return parts.length > 0 ? parts.join(' · ') : null;
  }, [reserveAvatarSlot, streaming, isUser, isSystem, showModelUsage, modelLabel, timestampLabel]);

  if (isUser) {
    return (
      <View ref={rowRef} style={[styles.row, overlayMode && styles.rowOverlay, shouldHideSourceMessage && styles.rowHiddenSource, styles.rowUser, reserveAvatarSlot && { paddingLeft: AGENT_AVATAR_SLOT_WIDTH }]}>
        <Pressable
          ref={bubbleRef}
          onLongPress={bubblePressDisabled ? undefined : handleLongPress}
          onPress={bubblePressDisabled ? undefined : handlePress}
          delayLongPress={220}
          disabled={bubblePressDisabled}
          style={[
            styles.bubble,
            styles.bubbleUser,
            resolvedBubbleAppearance.userBubble.shadow ? styles.bubbleShadow : null,
            {
              backgroundColor: resolvedBubbleAppearance.userBubble.backgroundColor,
              borderColor: resolvedBubbleAppearance.userBubble.borderColor,
              borderWidth: resolvedBubbleAppearance.userBubble.borderWidth,
            },
            shouldShowSelectedStyle && styles.bubbleSelected,
          ]}
        >
          {hasImages && (
            <View style={{ overflow: 'hidden', borderRadius: 10, marginHorizontal: -2 }}>
              <ImageGrid uris={imageUris} metas={imageMetas} maxWidth={imageGridWidth - 4} onPress={(index) => onImagePress?.(imageUris, index)} />
            </View>
          )}
          {hasImages && hasText && <View style={{ height: 6 }} />}
          {hasText && (
            <>
              {useAndroidStackedUserTimestamp ? (
                <Text selectable={canSelectTextNatively} style={[styles.text, styles.textUser]}>{cleanText}</Text>
              ) : (
                <>
                  <Text selectable={canSelectTextNatively} style={[styles.text, styles.textUser]}>
                    {cleanText}
                    {!!timestampLabel && (
                      <Text style={styles.timestampSpacer}>{`  ${timestampLabel} `}</Text>
                    )}
                  </Text>
                  {!!timestampLabel && <Text style={[styles.timestampOverlay, styles.timestampUser]}>{timestampLabel}</Text>}
                </>
              )}
            </>
          )}
          {!!timestampLabel && (useAndroidStackedUserTimestamp || !hasText) && (
            <Text style={[styles.timestampBelow, styles.timestampUser]}>{timestampLabel}</Text>
          )}
        </Pressable>
      </View>
    );
  }

  if (isSystem) {
    return (
      <View ref={rowRef} style={[styles.row, overlayMode && styles.rowOverlay, shouldHideSourceMessage && styles.rowHiddenSource]}>
        <Pressable
          ref={bubbleRef}
          onLongPress={bubblePressDisabled ? undefined : handleLongPress}
          onPress={bubblePressDisabled ? undefined : handlePress}
          delayLongPress={220}
          disabled={bubblePressDisabled}
          style={[styles.bubble, styles.bubbleSystem, shouldShowSelectedStyle && styles.bubbleSelected]}
        >
          <Text selectable={canSelectTextNatively} style={[styles.text, styles.textSystem]}>{cleanText}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View ref={rowRef} style={[styles.row, overlayMode && styles.rowOverlay, shouldHideSourceMessage && styles.rowHiddenSource, styles.rowAssistant]}>
      {reserveAvatarSlot ? (
        <Pressable style={styles.avatarSlot} onPress={onAvatarPress} hitSlop={4}>
          {avatarUri?.trim()
            ? <Avatar uri={avatarUri} />
            : (
              <View style={[avatarStyles.placeholder, { backgroundColor: theme.colors.primary }]}>
                <Text style={[avatarStyles.placeholderText, { color: theme.colors.iconOnColor }]}>{(displayName || 'A').charAt(0).toUpperCase()}</Text>
              </View>
            )}
        </Pressable>
      ) : null}
      <View style={[styles.assistantContent, !reserveAvatarSlot && styles.assistantContentExpanded]}>
        {reserveAvatarSlot ? (
          <View
            style={[
              styles.assistantNameRow,
              wallpaperActive && styles.assistantNameRowWallpaper,
              wallpaperActive && resolvedMetaAppearance.shadow ? styles.assistantNameRowShadow : null,
              wallpaperActive
                ? {
                  backgroundColor: resolvedMetaAppearance.backgroundColor,
                  borderColor: resolvedMetaAppearance.borderColor,
                }
                : null,
            ]}
          >
            <Text
              style={[
                styles.assistantName,
                overlayMode && styles.assistantNameOverlay,
                wallpaperActive && !overlayMode && styles.assistantNameWallpaper,
              ]}
              numberOfLines={1}
            >
              {displayName || t('Assistant')}
            </Text>
            {isFavorited ? (
              <View style={styles.favoriteBadge}>
                <Star size={12} color={theme.colors.warning} fill={theme.colors.warning} strokeWidth={2.1} />
              </View>
            ) : null}
            {showModelUsage && !!modelLabel && (
              <Text style={[styles.modelLabel, wallpaperActive && styles.modelLabelWallpaper]} numberOfLines={1}>
                {modelLabel}
              </Text>
            )}
            {showModelUsage && !!usage?.totalTokens && (
              <Text style={styles.usageBadge} numberOfLines={1}>{formatTokens(usage.totalTokens)} tok</Text>
            )}
          </View>
        ) : null}
        <Pressable
          ref={bubbleRef}
          onLongPress={bubblePressDisabled ? undefined : handleLongPress}
          onPress={bubblePressDisabled ? undefined : handlePress}
          delayLongPress={220}
          disabled={bubblePressDisabled}
          style={[
            styles.bubble,
            styles.bubbleAssistant,
            resolvedBubbleAppearance.assistantBubble.shadow ? styles.bubbleShadow : null,
            {
              backgroundColor: resolvedBubbleAppearance.assistantBubble.backgroundColor,
              borderColor: resolvedBubbleAppearance.assistantBubble.borderColor,
              borderWidth: resolvedBubbleAppearance.assistantBubble.borderWidth,
            },
            { maxWidth: maxBubbleWidth },
            shouldReserveWidth && styles.bubbleAssistantReservedWidth,
            shouldShowSelectedStyle && styles.bubbleSelected,
          ]}
        >
          <StreamingFadeMask streaming={streaming}>
            {hasImages && (
              <View style={{ overflow: 'hidden', borderRadius: Radius.sm + 2, marginHorizontal: -2 }}>
                <ImageGrid uris={imageUris} metas={imageMetas} maxWidth={imageGridWidth - 4} onPress={(index) => onImagePress?.(imageUris, index)} />
              </View>
            )}
            {hasImages && hasText && <View style={{ height: 6 }} />}
            {isLoadingOnly ? (
              <Text selectable={canSelectTextNatively} style={styles.loadingText}>{t('Thinking…')}</Text>
            ) : hasText ? (
              <AssistantMarkdown
                markdown={displayText}
                markdownStyle={markdownStyle}
                selectable={canSelectTextNatively}
                streamingAnimation={streaming}
              />
            ) : null}

            {assistantMetaLabel && !isLoadingOnly ? (
              <Text style={[styles.timestampBelow, styles.timestampAssistant]}>{assistantMetaLabel}</Text>
            ) : !!timestampLabel && !isLoadingOnly && !assistantMetaLabel ? (
              <Text style={[styles.timestampBelow, styles.timestampAssistant]}>{timestampLabel}</Text>
            ) : null}
          </StreamingFadeMask>
        </Pressable>
      </View>
    </View>
  );
}

function areStringArraysEqual(a?: string[], b?: string[]): boolean {
  if (a === b) return true;
  if (!a || !b) return !a && !b;
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index++) {
    if (a[index] !== b[index]) return false;
  }
  return true;
}

function arePropsEqual(prev: Props, next: Props): boolean {
  return (
    prev.messageId === next.messageId &&
    prev.role === next.role &&
    prev.text === next.text &&
    prev.timestampMs === next.timestampMs &&
    prev.streaming === next.streaming &&
    prev.avatarUri === next.avatarUri &&
    prev.displayName === next.displayName &&
    prev.isFavorited === next.isFavorited &&
    prev.modelLabel === next.modelLabel &&
    prev.usage === next.usage &&
    prev.showModelUsage === next.showModelUsage &&
    prev.isSelected === next.isSelected &&
    prev.showSelectionHighlight === next.showSelectionHighlight &&
    prev.hideWhenSelected === next.hideWhenSelected &&
    prev.overlayMode === next.overlayMode &&
    prev.reserveAvatarSlot === next.reserveAvatarSlot &&
    prev.chatFontSize === next.chatFontSize &&
    areStringArraysEqual(prev.imageUris, next.imageUris) &&
    prev.imageMetas === next.imageMetas
  );
}

export const MessageBubble = React.memo(MessageBubbleComponent, arePropsEqual);

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors'], fontSize: number = FontSize.base) {
  return StyleSheet.create({
    row: {
      marginVertical: 6,
      width: '100%',
      flexDirection: 'row',
      paddingHorizontal: Space.xs,
    },
    rowOverlay: {
      marginVertical: 0,
    },
    rowHiddenSource: {
      opacity: 0,
    },
    rowUser: {
      justifyContent: 'flex-end',
    },
    rowAssistant: {
      justifyContent: 'flex-start',
      alignItems: 'flex-start',
    },
    avatarSlot: {
      width: AGENT_AVATAR_SLOT_WIDTH,
      alignSelf: 'flex-start',
      alignItems: 'flex-start',
    },
    assistantContent: {
      flexShrink: 1,
    },
    assistantContentExpanded: {
      flex: 1,
    },
    assistantNameRow: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      marginBottom: Space.xs,
    },
    assistantNameRowWallpaper: {
      alignSelf: 'flex-start',
      paddingHorizontal: Space.sm,
      paddingVertical: 4,
      borderRadius: Radius.full,
      borderWidth: 1,
    },
    assistantNameRowShadow: {
      ...Shadow.sm,
    },
    assistantName: {
      fontSize: FontSize.sm,
      color: colors.textMuted,
      marginLeft: Space.xs,
    },
    assistantNameWallpaper: {
      color: colors.text,
      marginLeft: 0,
    },
    favoriteBadge: {
      marginLeft: Space.xs,
      justifyContent: 'center',
      alignItems: 'center',
    },
    modelLabel: {
      fontSize: FontSize.xs,
      color: colors.textSubtle,
      marginLeft: Space.sm,
      opacity: 0.7,
    },
    modelLabelWallpaper: {
      color: colors.textMuted,
      opacity: 1,
    },
    usageBadge: {
      fontSize: FontSize.xs,
      color: colors.textSubtle,
      marginLeft: 'auto' as const,
      fontFamily: 'monospace',
      opacity: 0.7,
    },
    assistantNameOverlay: {
      color: colors.primaryText,
      fontWeight: FontWeight.bold,
    },
    bubble: {
      borderRadius: Radius.md + 2,
      paddingHorizontal: BUBBLE_PADDING_HORIZONTAL,
      paddingVertical: BUBBLE_PADDING_VERTICAL,
      borderWidth: 0,
    },
    bubbleShadow: {
      ...Shadow.sm,
    },
    bubbleUser: {
      backgroundColor: colors.bubbleUser,
      position: 'relative',
    },
    bubbleAssistant: {
      backgroundColor: colors.bubbleAssistant,
      alignSelf: 'flex-start' as const,
    },
    bubbleAssistantReservedWidth: {
      minWidth: 240,
    },
    bubbleSystem: {
      backgroundColor: colors.bubbleSystem,
      alignSelf: 'center',
      maxWidth: '90%',
    },
    bubbleSelected: {
      borderWidth: 2,
      borderColor: colors.primary,
    },
    text: {
      fontSize,
      lineHeight: Math.round(fontSize * 1.47),
    },
    textUser: {
      color: colors.text,
    },
    textSystem: {
      color: colors.bubbleSystemText,
      fontSize: FontSize.md,
    },
    textAssistant: {
      color: colors.text,
    },
    loadingText: {
      color: colors.textMuted,
      fontSize: FontSize.md + 1,
      fontStyle: 'italic',
    },
    timestampSpacer: {
      color: 'transparent',
      fontSize: FontSize.xs - 1,
    },
    timestampOverlay: {
      position: 'absolute',
      right: BUBBLE_PADDING_HORIZONTAL,
      bottom: BUBBLE_PADDING_VERTICAL,
      fontSize: FontSize.xs - 1,
      lineHeight: 12,
    },
    timestampInline: {
      fontSize: FontSize.xs - 1,
      lineHeight: 12,
    },
    timestampBelow: {
      fontSize: FontSize.xs - 1,
      alignSelf: 'flex-end',
      marginTop: Space.xs,
    },
    timestampUser: {
      color: colors.textMuted,
      opacity: 0.72,
    },
    timestampAssistant: {
      color: colors.textSubtle,
      opacity: 0.85,
    },
  });
}
