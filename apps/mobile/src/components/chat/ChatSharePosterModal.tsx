import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { captureRef } from 'react-native-view-shot';
import * as MediaLibrary from 'expo-media-library/legacy';
import * as Sharing from 'expo-sharing';
import { EnrichedMarkdownText } from 'react-native-enriched-markdown';
import { Download, Share2, X } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getChatMarkdownFlavor, openChatMarkdownLink } from './chatMarkdown';
import {
  BorderWidth,
  FontSize,
  FontWeight,
  LineHeight,
  PresentationColor,
  Radius,
  Space,
} from '../../theme/tokens';
import { useAppTheme } from '../../theme';
import { getDisplayAgentEmoji } from '../../utils/agent-emoji';
import { resolveAgentAvatarImageSource } from '../../utils/agent-avatar-uri';
import { sanitizeDisplayText } from '../../utils/chat-message';
import { PosterThemePicker } from '../poster/PosterThemePicker';
import { getPosterThemeForAccent } from '../poster/posterThemes';
import { ThemedSwitch } from '../ui/ThemedSwitch';

// ---- Types ----

type Props = {
  visible: boolean;
  onClose: () => void;
  agentName: string;
  agentEmoji?: string;
  agentAvatarUri?: string;
  shareProductLabel?: string;
  messageText: string;
  modelLabel?: string;
  timestampMs?: number;
};

// ---- Poster Colors ----

const C = {
  /** Poster background */
  bg: PresentationColor.onMedia,
  /** Primary text */
  text: PresentationColor.cameraBackground,
  /** Secondary text (timestamp, branding) */
  textSecondary: PresentationColor.skillAvatarFallback,
  /** Body text */
  textBody: PresentationColor.cameraBackground,
  /** Content card background */
  cardBg: PresentationColor.mediaTintSoft,
  /** Modal chrome text (buttons outside poster) */
  chromeText: PresentationColor.onMedia,
  chromeTextSecondary: PresentationColor.onMediaBorder,
};

const CHAT_MARKDOWN_FLAVOR = getChatMarkdownFlavor();

// Close button + toggle + actions + margins
const CHROME_HEIGHT = 36 + 44 + 52 + 48;

// ---- Component ----

export function ChatSharePosterModal({
  visible,
  onClose,
  agentName,
  agentEmoji,
  agentAvatarUri,
  shareProductLabel,
  messageText,
  modelLabel,
  timestampMs,
}: Props) {
  const { t, i18n } = useTranslation('chat');
  const { accentId } = useAppTheme();
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en';
  const insets = useSafeAreaInsets();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const posterWidth = Math.min(screenWidth - 48, 360);
  const topPadding = insets.top + 16;
  const maxPosterPreviewHeight = screenHeight - CHROME_HEIGHT - topPadding;
  const posterRef = useRef<View>(null);
  const [saving, setSaving] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [theme, setTheme] = useState(() => getPosterThemeForAccent(accentId));
  const [showModel, setShowModel] = useState(true);
  const markdownStyle = useMemo(() => ({
    paragraph: {
      fontSize: FontSize.secondary,
      color: C.textBody,
      lineHeight: LineHeight.body,
      marginTop: 0,
      marginBottom: 6,
    },
    h1: {
      fontSize: FontSize.body,
      fontWeight: FontWeight.semibold,
      color: C.text,
      marginBottom: Space.sm,
    },
    h2: {
      fontSize: FontSize.body,
      fontWeight: FontWeight.semibold,
      color: C.text,
      marginBottom: Space.sm,
    },
    h3: {
      fontSize: FontSize.secondary,
      fontWeight: FontWeight.semibold,
      color: C.text,
      marginBottom: Space.xs,
    },
    list: {
      fontSize: FontSize.secondary,
      color: C.textBody,
      lineHeight: LineHeight.body,
      marginBottom: 6,
      markerColor: theme.accent,
      bulletColor: theme.accent,
      marginLeft: Space.md,
    },
    blockquote: {
      fontSize: FontSize.secondary,
      color: C.textBody,
      lineHeight: LineHeight.body,
      backgroundColor: theme.accentSoft,
      borderColor: theme.accentMuted,
      borderWidth: BorderWidth.emphasis,
      gapWidth: Space.sm,
      marginBottom: Space.sm,
    },
    strong: {
      color: C.text,
    },
    code: {
      fontSize: FontSize.caption,
      color: theme.accent,
      backgroundColor: 'transparent',
      borderColor: 'transparent',
    },
    codeBlock: {
      fontSize: FontSize.caption,
      color: C.textBody,
      lineHeight: LineHeight.secondary,
      backgroundColor: C.bg,
      borderColor: theme.accentMuted,
      borderRadius: Radius.card,
      borderWidth: BorderWidth.hairline,
      padding: Space.md,
      marginBottom: Space.sm,
    },
    link: {
      color: theme.accent,
      underline: true,
    },
    table: {
      fontSize: FontSize.caption,
      color: C.textBody,
      borderColor: theme.accentMuted,
      borderWidth: BorderWidth.hairline,
      borderRadius: Radius.card,
      headerBackgroundColor: theme.accentSoft,
      headerTextColor: C.text,
      rowEvenBackgroundColor: C.bg,
      rowOddBackgroundColor: C.cardBg,
      cellPaddingHorizontal: Space.sm,
      cellPaddingVertical: Space.xs,
    },
  }), [theme]);

  // Reset to user's current accent when modal opens
  useEffect(() => {
    if (visible) {
      setSaving(false);
      setSharing(false);
      setTheme(getPosterThemeForAccent(accentId));
      setShowModel(true);
    }
  }, [visible, accentId]);

  const displayText = sanitizeDisplayText(messageText).trim();
  const brandingLabel = shareProductLabel?.trim() || 'OpenClaw';
  const formattedTime = timestampMs
    ? new Date(timestampMs).toLocaleString(locale, {
        month: 'short', day: 'numeric', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      })
    : null;

  const capture = useCallback(async () => {
    if (!posterRef.current) return null;
    try {
      return await captureRef(posterRef, { format: 'png', quality: 1 });
    } catch (error) {
      if (Platform.OS !== 'ios') {
        throw error;
      }

      // `drawViewHierarchyInRect` can fail for complex markdown trees on iOS,
      // especially when the renderer introduces nested scroll containers (for example tables).
      return captureRef(posterRef, {
        format: 'png',
        quality: 1,
        useRenderInContext: true,
      });
    }
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const { status } = await MediaLibrary.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(t('Permission denied'));
        return;
      }
      const uri = await capture();
      if (!uri) return;
      const fileUri = uri.startsWith('file://') ? uri : 'file://' + uri;
      await MediaLibrary.saveToLibraryAsync(fileUri);
      Alert.alert(t('Saved to Photos!'));
    } catch (e) {
      console.warn('[ChatSharePoster] save failed:', e);
      Alert.alert(t('Failed to save'));
    } finally {
      setSaving(false);
    }
  }, [capture, t]);

  const handleShare = useCallback(async () => {
    setSharing(true);
    try {
      const uri = await capture();
      if (!uri) return;
      await Sharing.shareAsync(uri, { mimeType: 'image/png' });
    } catch {
      // user cancelled
    } finally {
      setSharing(false);
    }
  }, [capture]);

  const agentAvatarSource = resolveAgentAvatarImageSource(agentAvatarUri);

  const posterContent = (
    <>
      {/* Agent Identity */}
      <View style={s.avatarSection}>
        {agentAvatarSource ? (
          <Image source={agentAvatarSource} style={[s.avatar, { borderColor: theme.accent }]} />
        ) : (
          <View style={[s.avatarFallback, { backgroundColor: theme.accentSoft, borderColor: theme.accentMuted }]}>
            <Text style={s.avatarEmoji}>{getDisplayAgentEmoji(agentEmoji)}</Text>
          </View>
        )}
        <View style={s.agentMeta}>
          <Text style={s.agentName}>{agentName}</Text>
          {formattedTime ? <Text style={s.timestamp}>{formattedTime}</Text> : null}
          {showModel && modelLabel ? (
            <View style={[s.modelBadge, { backgroundColor: theme.accentSoft, borderColor: theme.accentMuted }]}>
              <Text style={[s.modelText, { color: theme.accent }]}>{modelLabel}</Text>
            </View>
          ) : null}
        </View>
      </View>

      {/* Message Content */}
      <View style={s.contentCard}>
        <EnrichedMarkdownText
          markdown={displayText}
          markdownStyle={markdownStyle}
          onLinkPress={openChatMarkdownLink}
          allowTrailingMargin={false}
          flavor={CHAT_MARKDOWN_FLAVOR}
          containerStyle={s.contentMarkdown}
        />
      </View>

      {/* Branding */}
      <Text style={s.branding}>{`${brandingLabel} \u{00D7} Clawket`}</Text>
    </>
  );

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={[s.backdrop, { paddingTop: topPadding }]}>
        {/* Backdrop dismiss layer */}
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />

        {/* Off-screen full-height poster for capture */}
        <View ref={posterRef} collapsable={false} style={[s.poster, s.captureTarget, { width: posterWidth }]}>
          {posterContent}
        </View>

        <View style={[s.container, { width: posterWidth + 40 }]} pointerEvents="box-none">
          <TouchableOpacity style={s.closeBtn} onPress={onClose} activeOpacity={0.7}>
            <X size={20} color={C.chromeTextSecondary} strokeWidth={2} />
          </TouchableOpacity>

          <ScrollView
            style={{ maxHeight: maxPosterPreviewHeight }}
            bounces={false}
            showsVerticalScrollIndicator
          >
            <View style={[s.poster, { width: posterWidth }]}>
              {posterContent}
            </View>
          </ScrollView>

          {/* Model toggle */}
          {modelLabel ? (
            <View style={s.toggleRow}>
              <Text style={s.toggleLabel}>{t('Show model')}</Text>
              <ThemedSwitch
                value={showModel}
                onValueChange={setShowModel}
                trackColor={{ false: PresentationColor.mediaControl, true: theme.accent }}
                thumbColor={PresentationColor.onMedia}
                ios_backgroundColor={PresentationColor.mediaControl}
              />
            </View>
          ) : null}

          {/* Actions */}
          <View style={s.actions}>
            <PosterThemePicker current={theme} onSelect={setTheme} />
            <TouchableOpacity style={s.actionBtn} onPress={handleSave} activeOpacity={0.7} disabled={saving}>
              {saving ? (
                <ActivityIndicator size="small" color={C.chromeText} />
              ) : (
                <Download size={18} color={C.chromeText} strokeWidth={2} />
              )}
              <Text style={s.actionText}>{t('Save')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.actionBtn, { backgroundColor: theme.accent }]}
              onPress={handleShare}
              activeOpacity={0.7}
              disabled={sharing}
            >
              {sharing ? (
                <ActivityIndicator size="small" color={C.chromeText} />
              ) : (
                <Share2 size={18} color={C.chromeText} strokeWidth={2} />
              )}
              <Text style={s.actionText}>{t('Share')}</Text>
            </TouchableOpacity>
          </View>

        </View>
      </View>
    </Modal>
  );
}

// ---- Styles ----

const s = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: PresentationColor.mediaOverlayStrong,
    justifyContent: 'center',
    alignItems: 'center',
  },
  container: {
    alignItems: 'center',
  },
  closeBtn: {
    position: 'absolute',
    top: -36,
    right: 0,
    width: 32,
    height: 32,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  captureTarget: {
    position: 'absolute',
    left: -9999,
  },
  poster: {
    backgroundColor: C.bg,
    borderRadius: Radius.bubble,
    paddingHorizontal: 24,
    paddingTop: 44,
    paddingBottom: 24,
  },
  // Avatar section
  avatarSection: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 20,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: Radius.full,
    borderWidth: BorderWidth.strong,
  },
  avatarFallback: {
    width: 56,
    height: 56,
    borderRadius: Radius.full,
    borderWidth: BorderWidth.hairline,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarEmoji: {
    fontSize: FontSize.display,
  },
  agentMeta: {
    flex: 1,
    alignItems: 'flex-start',
    marginLeft: 12,
    paddingTop: 2,
  },
  agentName: {
    fontSize: FontSize.body,
    fontWeight: FontWeight.semibold,
    color: C.text,
    marginBottom: 4,
  },
  timestamp: {
    fontSize: FontSize.caption,
    fontWeight: FontWeight.regular,
    color: C.textSecondary,
    marginBottom: 8,
  },
  modelBadge: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: Radius.full,
    borderWidth: BorderWidth.hairline,
    marginTop: 2,
  },
  modelText: {
    fontSize: FontSize.caption,
    fontWeight: FontWeight.semibold,
    letterSpacing: 0.2,
  },
  // Content
  contentCard: {
    width: '100%',
    backgroundColor: C.cardBg,
    borderRadius: Radius.card,
    paddingVertical: 16,
    paddingHorizontal: 16,
    marginBottom: 20,
  },
  contentMarkdown: {
    width: '100%',
  },
  // Branding
  branding: {
    fontSize: FontSize.caption,
    fontWeight: FontWeight.semibold,
    color: C.textSecondary,
    letterSpacing: 0.3,
    textAlign: 'center',
  },
  // Toggle
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
  },
  toggleLabel: {
    fontSize: FontSize.caption,
    fontWeight: FontWeight.semibold,
    color: PresentationColor.onMediaBorder,
  },
  // Actions
  actions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
    alignItems: 'center',
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: PresentationColor.mediaControl,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: Radius.full,
  },
  actionText: {
    fontSize: FontSize.secondary,
    fontWeight: FontWeight.semibold,
    color: C.chromeText,
  },
});
