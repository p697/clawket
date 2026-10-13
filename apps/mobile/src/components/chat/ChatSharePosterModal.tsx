import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  I18nManager,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { captureRef } from 'react-native-view-shot';
import * as MediaLibrary from 'expo-media-library/legacy';
import { requestPhotoLibraryWritePermission } from '../../services/photo-library-permissions';
import * as Sharing from 'expo-sharing';
import { EnrichedMarkdownText } from 'react-native-enriched-markdown';
import { Download, Share2, X } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaFrame, useSafeAreaInsets } from 'react-native-safe-area-context';
import { CHAT_MARKDOWN_BREAK_STRATEGY, getChatMarkdownFlavor, openChatMarkdownLink } from './chatMarkdown';
import {
  BorderWidth,
  ControlSize,
  FontSize,
  FontWeight,
  IconSize,
  LineHeight,
  PresentationColor,
  Radius,
  Space,
} from '../../theme/tokens';
import { useAppTheme } from '../../theme';
import { extractDisplayAgentEmoji } from '../../utils/agent-emoji';
import { getAgentInitials } from '../ui/AgentAvatar';
import { isProductFacePlatform, PlatformDisc, type PlatformKind } from '../ui/PlatformMark';
import { resolveAgentAvatarImageSource } from '../../utils/agent-avatar-uri';
import { sanitizeDisplayText } from '../../utils/chat-message';
import { PosterThemePicker } from '../poster/PosterThemePicker';
import { getPosterThemeForAccent } from '../poster/posterThemes';
import { ThemedSwitch } from '../ui/ThemedSwitch';
import { PresentationSafeAreaProvider } from '../ui/PresentationSafeAreaProvider';

// ---- Types ----

type Props = {
  visible: boolean;
  onClose: () => void;
  agentName: string;
  agentEmoji?: string;
  agentAvatarUri?: string;
  /** The Agent's backend: a product Agent signs the poster with its official mark, as in the app. */
  agentPlatform?: PlatformKind | null;
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

// Matches the poster avatar box and the app's face proportion for official marks.
const POSTER_AVATAR_SIZE = 56;
const POSTER_FACE_GLYPH = 0.54;

// ---- Component ----

export function ChatSharePosterModal({
  visible,
  onClose,
  agentName,
  agentEmoji,
  agentAvatarUri,
  agentPlatform,
  shareProductLabel,
  messageText,
  modelLabel,
  timestampMs,
}: Props) {
  const { t, i18n } = useTranslation('chat');
  const { accentId } = useAppTheme();
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en';
  const posterRef = useRef<View>(null);
  const captureReadyRef = useRef(false);
  const exportInFlight = useRef(false);
  const presentationGeneration = useRef(0);
  const captureWaiter = useRef<((ready: boolean) => void) | null>(null);
  const finishCaptureWait = useCallback((ready: boolean) => {
    const resolve = captureWaiter.current;
    captureWaiter.current = null;
    resolve?.(ready);
  }, []);
  useLayoutEffect(() => {
    presentationGeneration.current += 1;
    finishCaptureWait(false);
  }, [visible, agentName, agentEmoji, agentAvatarUri, agentPlatform, shareProductLabel, messageText, modelLabel, timestampMs, finishCaptureWait]);
  useLayoutEffect(() => () => {
    presentationGeneration.current += 1;
    finishCaptureWait(false);
  }, [finishCaptureWait]);
  const [captureReady, setCaptureReady] = useState(false);
  const onCaptureReadyChange = useCallback((ready: boolean) => {
    captureReadyRef.current = ready;
    setCaptureReady(ready);
    if (ready) finishCaptureWait(true);
  }, [finishCaptureWait]);
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

  type ExportRequest = { target: View; generation: number };
  const isCurrentExport = useCallback((request: ExportRequest) => (
    request.generation === presentationGeneration.current && request.target === posterRef.current
  ), []);
  const capture = useCallback(async (request: ExportRequest) => {
    const takeSnapshot = async (useRenderInContext = false) => {
      // One export owns this waiter. Consecutive resizes may supersede a ready callback
      // before its continuation runs; keep waiting within this presentation.
      while (isCurrentExport(request) && !captureReadyRef.current) {
        const ready = await new Promise<boolean>(resolve => { captureWaiter.current = resolve; });
        if (!ready) return null;
      }
      if (!isCurrentExport(request)) return null;
      return captureRef(request.target, {
        format: 'png', quality: 1, ...(useRenderInContext ? { useRenderInContext: true } : {}),
      });
    };
    try {
      return await takeSnapshot();
    } catch (error) {
      if (!isCurrentExport(request)) return null;
      if (Platform.OS !== 'ios') throw error;
      // Preserve the iOS fallback for complex Markdown, but never change capture targets.
      return takeSnapshot(true);
    }
  }, [isCurrentExport]);

  const beginExport = useCallback((): ExportRequest | null => {
    if (exportInFlight.current || !captureReadyRef.current || !posterRef.current) return null;
    exportInFlight.current = true;
    return { target: posterRef.current, generation: presentationGeneration.current };
  }, []);

  const handleSave = useCallback(async () => {
    const request = beginExport();
    if (!request) return;
    setSaving(true);
    try {
      const granted = await requestPhotoLibraryWritePermission();
      if (!isCurrentExport(request)) return;
      if (!granted) { Alert.alert(t('Permission denied')); return; }
      const uri = await capture(request);
      if (!uri || !isCurrentExport(request)) return;
      const fileUri = uri.startsWith('file://') ? uri : 'file://' + uri;
      await MediaLibrary.saveToLibraryAsync(fileUri);
      if (isCurrentExport(request)) Alert.alert(t('Saved to Photos!'));
    } catch (e) {
      if (isCurrentExport(request)) {
        console.warn('[ChatSharePoster] save failed:', e);
        Alert.alert(t('Failed to save'));
      }
    } finally {
      exportInFlight.current = false;
      setSaving(false);
    }
  }, [beginExport, capture, isCurrentExport, t]);

  const handleShare = useCallback(async () => {
    const request = beginExport();
    if (!request) return;
    setSharing(true);
    try {
      const uri = await capture(request);
      if (!uri || !isCurrentExport(request)) return;
      await Sharing.shareAsync(uri, { mimeType: 'image/png' });
    } catch {
      // user cancelled
    } finally {
      exportInFlight.current = false;
      setSharing(false);
    }
  }, [beginExport, capture, isCurrentExport]);

  const agentAvatarSource = resolveAgentAvatarImageSource(agentAvatarUri);
  const displayEmoji = extractDisplayAgentEmoji(agentEmoji);

  const posterContent = (
    <>
      {/* Agent Identity */}
      <View style={s.avatarSection}>
        {isProductFacePlatform(agentPlatform) ? (
          <View testID="chat-share-poster-platform-face" style={[s.avatarFallback, s.avatarFace, { borderColor: theme.accentMuted }]}>
            <PlatformDisc platform={agentPlatform} size={POSTER_AVATAR_SIZE} glyph={POSTER_FACE_GLYPH}
              artworkColors={{ ground: C.bg, ink: C.text }} />
          </View>
        ) : agentAvatarSource ? (
          <Image source={agentAvatarSource} style={[s.avatar, { borderColor: theme.accent }]} />
        ) : (
          <View style={[s.avatarFallback, { backgroundColor: theme.accentSoft, borderColor: theme.accentMuted }]}>
            <Text style={displayEmoji ? s.avatarEmoji : [s.avatarInitials, { color: theme.accent }]}>
              {displayEmoji ?? getAgentInitials(agentName)}
            </Text>
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
          textBreakStrategy={CHAT_MARKDOWN_BREAK_STRATEGY}
          containerStyle={s.contentMarkdown}
        />
      </View>

      {/* Branding */}
      <Text style={s.branding}>{`${brandingLabel} \u{00D7} Clawket`}</Text>
    </>
  );

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <PresentationSafeAreaProvider style={{ backgroundColor: PresentationColor.mediaOverlayStrong }}>
        <PosterPresentation posterRef={posterRef} posterContent={posterContent} onClose={onClose} onCaptureReadyChange={onCaptureReadyChange}>
          {modelLabel ? (
            <View style={s.toggleRow}>
              <Text style={s.toggleLabel}>{t('Show model')}</Text>
              <ThemedSwitch
                testID="chat-share-poster-model"
                disabled={saving || sharing}
                value={showModel}
                onValueChange={setShowModel}
                trackColor={{ false: PresentationColor.mediaControl, true: theme.accent }}
                thumbColor={PresentationColor.onMedia}
                ios_backgroundColor={PresentationColor.mediaControl}
              />
            </View>
          ) : null}
          <PosterThemePicker current={theme} onSelect={setTheme} disabled={saving || sharing} />
          <View style={s.actions}>
            <TouchableOpacity testID="chat-share-poster-save" accessibilityRole="button"
              style={s.actionBtn} onPress={handleSave} activeOpacity={0.7} disabled={saving || sharing || !captureReady}>
              {saving ? <ActivityIndicator size="small" color={C.chromeText} />
                : <Download size={18} color={C.chromeText} strokeWidth={2} />}
              <Text style={s.actionText}>{t('Save')}</Text>
            </TouchableOpacity>
            <TouchableOpacity testID="chat-share-poster-share" accessibilityRole="button"
              style={[s.actionBtn, { backgroundColor: theme.accent }]}
              onPress={handleShare} activeOpacity={0.7} disabled={saving || sharing || !captureReady}>
              {sharing ? <ActivityIndicator size="small" color={C.chromeText} />
                : <Share2 size={18} color={C.chromeText} strokeWidth={2} />}
              <Text style={s.actionText}>{t('Share')}</Text>
            </TouchableOpacity>
          </View>
        </PosterPresentation>
      </PresentationSafeAreaProvider>
    </Modal>
  );
}

function PosterPresentation({ posterRef, posterContent, onClose, onCaptureReadyChange, children }: React.PropsWithChildren<{
  posterRef: React.RefObject<View | null>;
  posterContent: React.ReactNode;
  onClose: () => void;
  onCaptureReadyChange: (ready: boolean) => void;
}>): React.JSX.Element {
  const { t } = useTranslation('common');
  const insets = useSafeAreaInsets();
  const frame = useSafeAreaFrame();
  const posterWidth = Math.min(360, Math.max(0, frame.width - insets.left - insets.right - Space.xl * 2));
  const safeHeight = Math.max(0, frame.height - insets.top - insets.bottom - Space.lg * 2);
  // Preview stays bounded; the containing scroll keeps all controls reachable in short windows.
  const maxPosterPreviewHeight = safeHeight * 0.6;
  const measurementGeneration = useRef(0);
  const expectedWidth = useRef(posterWidth);
  const measureCapture = useCallback(() => {
    const generation = ++measurementGeneration.current;
    onCaptureReadyChange(false);
    posterRef.current?.measure((_x, _y, width, height) => {
      if (generation !== measurementGeneration.current) return;
      onCaptureReadyChange(width > 0 && height > 0 && Math.abs(width - expectedWidth.current) < 0.5);
    });
  }, [onCaptureReadyChange, posterRef]);
  useLayoutEffect(() => {
    expectedWidth.current = posterWidth;
    // Explicit measurement also handles A→B→A when native layout coalesces the middle size.
    measureCapture();
    return () => { measurementGeneration.current += 1; onCaptureReadyChange(false); };
  }, [measureCapture, onCaptureReadyChange, posterWidth]);
  return (
    <View style={s.backdrop}>
      <Pressable testID="chat-share-poster-backdrop" style={StyleSheet.absoluteFill} onPress={onClose} accessible={false} />
      {/* Only this full-height, unscrolled target is exported; chrome and safe padding stay outside. */}
      <View testID="chat-share-poster-capture" ref={posterRef} collapsable={false}
        pointerEvents="none" onLayout={measureCapture}
        accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
        style={[s.poster, s.captureTarget, { width: posterWidth }]}>
        {posterContent}
      </View>
      <View testID="chat-share-poster-safe-area" pointerEvents="box-none" style={[s.safeArea, {
        paddingTop: insets.top + Space.lg,
        paddingBottom: insets.bottom + Space.lg,
        paddingStart: (I18nManager.isRTL ? insets.right : insets.left) + Space.xl,
        paddingEnd: (I18nManager.isRTL ? insets.left : insets.right) + Space.xl,
      }]}>
        <ScrollView testID="chat-share-poster-controls-scroll" style={[s.presentationScroll, { width: posterWidth }]}
          contentContainerStyle={s.container} bounces={false} nestedScrollEnabled keyboardShouldPersistTaps="handled">
          <TouchableOpacity testID="chat-share-poster-close" accessibilityRole="button"
            accessibilityLabel={t('Close')} style={s.closeBtn} onPress={onClose} activeOpacity={0.7}>
            <X size={IconSize.md} color={C.chromeText} strokeWidth={2} />
          </TouchableOpacity>
          <ScrollView testID="chat-share-poster-preview-scroll" style={{ maxHeight: maxPosterPreviewHeight }}
            bounces={false} nestedScrollEnabled keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator>
            <View testID="chat-share-poster-preview" style={[s.poster, { width: posterWidth }]}>
              {posterContent}
            </View>
          </ScrollView>
          {children}
        </ScrollView>
      </View>
    </View>
  );
}

// ---- Styles ----

const s = StyleSheet.create({
  backdrop: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  presentationScroll: {
    maxHeight: '100%',
    flexGrow: 0,
  },
  container: {
    alignItems: 'stretch',
    gap: Space.md,
  },
  // A 30%-white X floated past the poster's corner and was hard to find over photos (device review
  // 2026-09-27): a filled control aligned with the poster's right edge reads as the way out.
  closeBtn: {
    alignSelf: 'flex-end',
    width: ControlSize.floatingButton,
    height: ControlSize.floatingButton,
    borderRadius: Radius.full,
    backgroundColor: PresentationColor.mediaControl,
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
  avatarFace: {
    backgroundColor: C.bg,
    overflow: 'hidden',
  },
  avatarEmoji: {
    fontSize: FontSize.display,
  },
  avatarInitials: {
    fontSize: FontSize.title,
    fontWeight: FontWeight.semibold,
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
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: Space.sm,
  },
  toggleLabel: {
    fontSize: FontSize.caption,
    fontWeight: FontWeight.semibold,
    // 30% white read as a disabled hint over the scrim (iOS review 2026-09-27).
    color: C.chromeText,
  },
  // Actions
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: Space.sm,
    alignItems: 'center',
  },
  actionBtn: {
    minHeight: ControlSize.floatingButton,
    maxWidth: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: PresentationColor.mediaControl,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: Radius.full,
  },
  actionText: {
    flexShrink: 1,
    fontSize: FontSize.secondary,
    fontWeight: FontWeight.semibold,
    color: C.chromeText,
  },
});
