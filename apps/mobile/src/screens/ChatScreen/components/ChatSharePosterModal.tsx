import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { captureRef } from 'react-native-view-shot';
import * as MediaLibrary from 'expo-media-library';
import * as Sharing from 'expo-sharing';
import { EnrichedMarkdownText } from 'react-native-enriched-markdown';
import { Download, Share2, X } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getChatMarkdownFlavor, openChatMarkdownLink } from '../../../components/chat/chatMarkdown';
import { FontSize, FontWeight, Radius, Space } from '../../../theme/tokens';
import { useAppTheme } from '../../../theme';
import { getDisplayAgentEmoji } from '../../../utils/agent-emoji';
import { sanitizeDisplayText } from '../../../utils/chat-message';
import { PosterThemePicker } from '../../../components/poster/PosterThemePicker';
import { getPosterThemeForAccent } from '../../../components/poster/posterThemes';

// ---- Types ----

type Props = {
  visible: boolean;
  onClose: () => void;
  agentName: string;
  agentEmoji?: string;
  agentAvatarUri?: string;
  messageText: string;
  modelLabel?: string;
  timestampMs?: number;
};

// ---- Poster Colors ----

const C = {
  /** Poster background */
  bg: '#FFFFFF',
  /** Primary text */
  text: '#1C1C1E',
  /** Secondary text (timestamp, branding) */
  textSecondary: '#8E8E93',
  /** Body text */
  textBody: '#3A3A3C',
  /** Content card background */
  cardBg: '#F5F5F7',
  /** Modal chrome text (buttons outside poster) */
  chromeText: '#FFFFFF',
  chromeTextSecondary: 'rgba(255,255,255,0.5)',
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
      fontSize: 14,
      color: C.textBody,
      lineHeight: 22,
      marginTop: 0,
      marginBottom: 6,
    },
    h1: {
      fontSize: FontSize.xl,
      fontWeight: FontWeight.bold,
      color: C.text,
      marginBottom: Space.sm,
    },
    h2: {
      fontSize: FontSize.lg,
      fontWeight: FontWeight.bold,
      color: C.text,
      marginBottom: Space.sm,
    },
    h3: {
      fontSize: FontSize.base,
      fontWeight: FontWeight.semibold,
      color: C.text,
      marginBottom: Space.xs,
    },
    list: {
      fontSize: 14,
      color: C.textBody,
      lineHeight: 22,
      marginBottom: 6,
      markerColor: theme.accent,
      bulletColor: theme.accent,
      marginLeft: Space.md,
    },
    blockquote: {
      fontSize: 14,
      color: C.textBody,
      lineHeight: 22,
      backgroundColor: '#EEF2F7',
      borderColor: '#D9DEE7',
      borderWidth: 3,
      gapWidth: Space.sm,
      marginBottom: Space.sm,
    },
    strong: {
      color: C.text,
    },
    code: {
      fontSize: FontSize.md,
      color: theme.accent,
      backgroundColor: 'transparent',
      borderColor: 'transparent',
    },
    codeBlock: {
      fontSize: FontSize.md,
      color: C.textBody,
      lineHeight: 20,
      backgroundColor: '#FFFFFF',
      borderColor: '#D9DEE7',
      borderRadius: Radius.sm,
      borderWidth: 1,
      padding: Space.md,
      marginBottom: Space.sm,
    },
    link: {
      color: theme.accent,
      underline: true,
    },
    table: {
      fontSize: FontSize.md,
      color: C.textBody,
      borderColor: '#D9DEE7',
      borderWidth: 1,
      borderRadius: Radius.sm,
      headerBackgroundColor: '#EEF2F7',
      headerTextColor: C.text,
      rowEvenBackgroundColor: '#FFFFFF',
      rowOddBackgroundColor: '#F8F9FB',
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
  const formattedTime = timestampMs
    ? new Date(timestampMs).toLocaleString(locale, {
        month: 'short', day: 'numeric', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      })
    : null;

  const capture = useCallback(async () => {
    if (!posterRef.current) return null;
    return captureRef(posterRef, { format: 'png', quality: 1 });
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

  const hasAvatar = !!agentAvatarUri;

  const posterContent = (
    <>
      {/* Agent Identity */}
      <View style={s.avatarSection}>
        {hasAvatar ? (
          <Image source={{ uri: agentAvatarUri }} style={[s.avatar, { borderColor: theme.accent }]} />
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
      <Text style={s.branding}>{'\u{1F43E} OpenClaw \u{00D7} Clawket \u{1F43E}'}</Text>
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
              <Switch
                value={showModel}
                onValueChange={setShowModel}
                trackColor={{ false: 'rgba(255,255,255,0.15)', true: theme.accent }}
                thumbColor="#FFFFFF"
                ios_backgroundColor="rgba(255,255,255,0.15)"
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
    backgroundColor: 'rgba(0,0,0,0.6)',
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
    borderRadius: 20,
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
    borderRadius: 28,
    borderWidth: 2,
  },
  avatarFallback: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 1.5,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarEmoji: {
    fontSize: 28,
  },
  agentMeta: {
    flex: 1,
    alignItems: 'flex-start',
    marginLeft: 12,
    paddingTop: 2,
  },
  agentName: {
    fontSize: 17,
    fontWeight: FontWeight.semibold,
    color: C.text,
    marginBottom: 4,
  },
  timestamp: {
    fontSize: 11,
    fontWeight: FontWeight.regular,
    color: C.textSecondary,
    marginBottom: 8,
  },
  modelBadge: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: Radius.lg,
    borderWidth: 1,
    marginTop: 2,
  },
  modelText: {
    fontSize: 11,
    fontWeight: FontWeight.medium,
    letterSpacing: 0.2,
  },
  // Content
  contentCard: {
    width: '100%',
    backgroundColor: C.cardBg,
    borderRadius: Radius.md,
    paddingVertical: 16,
    paddingHorizontal: 16,
    marginBottom: 20,
  },
  contentMarkdown: {
    width: '100%',
  },
  // Branding
  branding: {
    fontSize: 11,
    fontWeight: FontWeight.medium,
    color: C.textSecondary,
    letterSpacing: 0.3,
  },
  // Toggle
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
  },
  toggleLabel: {
    fontSize: 13,
    fontWeight: FontWeight.medium,
    color: 'rgba(255,255,255,0.7)',
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
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: Radius.md,
  },
  actionText: {
    fontSize: 14,
    fontWeight: FontWeight.semibold,
    color: C.chromeText,
  },
});
