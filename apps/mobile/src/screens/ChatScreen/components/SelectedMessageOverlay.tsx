import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Animated, Modal, Pressable, ScrollView, StyleSheet, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { Check, Copy, Share2, Star } from 'lucide-react-native';
import type { UiMessage } from '../../../types/chat';
import { useAppTheme } from '../../../theme';
import { Radius, Shadow, createThemedShadowStyle } from '../../../theme/tokens';
import { ChatSharePosterModal } from './ChatSharePosterModal';
import { getSelectedMessageOverlayLayout } from './selectedMessageOverlayLayout';
import type { MessageSelectionFrames } from '../../../components/MessageBubble';

type Props = {
  copiedSelected: boolean;
  copyButtonSize: number;
  currentAgentEmoji?: string;
  currentAgentName: string;
  shareProductLabel?: string;
  effectiveAvatarUri?: string;
  hasSelectedMessageText: boolean;
  insetsTop: number;
  modalBottomInset: number;
  onCopySelectedMessage: () => Promise<void>;
  onToggleSelectedMessageFavorite: () => Promise<{ favorited: boolean; favoriteKey: string | null }>;
  renderSelectedMessage: () => React.ReactNode;
  clearSelection: () => void;
  selectedFrames: MessageSelectionFrames | null;
  selectedMessage: UiMessage | null;
  selectedMessageFavorited: boolean;
  selectedMessageVisible: boolean;
  selectionAnim: Animated.Value;
};

export function SelectedMessageOverlay({
  copiedSelected,
  copyButtonSize,
  currentAgentEmoji,
  currentAgentName,
  shareProductLabel,
  effectiveAvatarUri,
  hasSelectedMessageText,
  insetsTop,
  modalBottomInset,
  onCopySelectedMessage,
  onToggleSelectedMessageFavorite,
  renderSelectedMessage,
  clearSelection,
  selectedFrames,
  selectedMessage,
  selectedMessageFavorited,
  selectedMessageVisible,
  selectionAnim,
}: Props): React.JSX.Element {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors, theme.scheme), [theme]);
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const [sharePosterVisible, setSharePosterVisible] = useState(false);
  const sharePosterDataRef = useRef<{ text: string; modelLabel?: string; timestampMs?: number } | null>(null);

  const handleSharePress = useCallback(() => {
    if (!selectedMessage) return;
    sharePosterDataRef.current = {
      text: selectedMessage.text ?? '',
      modelLabel: selectedMessage.modelLabel,
      timestampMs: selectedMessage.timestampMs,
    };
    clearSelection();
    setTimeout(() => {
      setSharePosterVisible(true);
    }, 350);
  }, [clearSelection, selectedMessage]);

  const selectionLayout = useMemo(
    () => getSelectedMessageOverlayLayout({
      copyButtonSize,
      frames: selectedFrames,
      insetsTop,
      modalBottomInset,
      screenHeight,
      screenWidth,
    }),
    [copyButtonSize, insetsTop, modalBottomInset, screenHeight, screenWidth, selectedFrames],
  );
  const shouldRenderSelectedMessageOverlay = !!selectionLayout && !!selectedMessage;

  const animatedCloneStyle = useMemo(
    () => ({
      opacity: selectionAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 1] }),
      transform: [
        { translateY: selectionAnim.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) },
        { scale: selectionAnim.interpolate({ inputRange: [0, 1], outputRange: [0.985, 1] }) },
      ],
    }),
    [selectionAnim],
  );
  const animatedCopyStyle = useMemo(
    () => ({
      opacity: selectionAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 1] }),
      transform: [
        { translateY: selectionAnim.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) },
        { scale: selectionAnim.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) },
      ],
    }),
    [selectionAnim],
  );

  return (
    <>
      <Modal
        transparent
        animationType="fade"
        visible={selectedMessageVisible}
        statusBarTranslucent
        onRequestClose={clearSelection}
      >
        <View style={styles.selectionModalRoot}>
          <Pressable style={styles.selectionModalMask} onPress={clearSelection} />
          {shouldRenderSelectedMessageOverlay ? (
            <>
              <Animated.View
                style={[
                  styles.selectedCloneWrap,
                  selectionLayout.scrollEnabled && styles.selectedCloneWrapScrollable,
                  animatedCloneStyle,
                  {
                    top: selectionLayout.containerTop,
                    left: selectionLayout.containerLeft,
                    width: selectionLayout.containerWidth,
                    height: selectionLayout.containerHeight,
                  },
                ]}
              >
                <ScrollView
                  bounces={selectionLayout.scrollEnabled}
                  contentContainerStyle={styles.selectedCloneScrollContent}
                  scrollEnabled={selectionLayout.scrollEnabled}
                  showsVerticalScrollIndicator={selectionLayout.scrollEnabled}
                >
                  {renderSelectedMessage()}
                </ScrollView>
              </Animated.View>
              <Animated.View
                style={[
                  styles.floatingActionWrap,
                  animatedCopyStyle,
                  {
                    top: selectionLayout.favoriteButtonTop,
                    left: selectionLayout.favoriteButtonLeft,
                    width: copyButtonSize,
                    height: copyButtonSize,
                  },
                ]}
              >
                <TouchableOpacity
                  activeOpacity={0.78}
                  style={styles.floatingActionBtn}
                  onPress={() => {
                    void onToggleSelectedMessageFavorite();
                  }}
                >
                  <Star
                    size={18}
                    color={selectedMessageFavorited ? theme.colors.warning : theme.colors.primary}
                    fill={selectedMessageFavorited ? theme.colors.warning : 'transparent'}
                    strokeWidth={2.2}
                  />
                </TouchableOpacity>
              </Animated.View>
              <Animated.View
                style={[
                  styles.floatingActionWrap,
                  animatedCopyStyle,
                  {
                    top: selectionLayout.copyButtonTop,
                    left: selectionLayout.copyButtonLeft,
                    width: copyButtonSize,
                    height: copyButtonSize,
                  },
                ]}
              >
                <TouchableOpacity
                  activeOpacity={0.78}
                  style={[
                    styles.floatingActionBtn,
                    copiedSelected && styles.floatingActionBtnCopied,
                    !hasSelectedMessageText && styles.selectionActionBtnDisabled,
                  ]}
                  onPress={() => {
                    void onCopySelectedMessage();
                  }}
                  disabled={!hasSelectedMessageText}
                >
                  {copiedSelected ? (
                    <Check size={20} color={theme.colors.success} strokeWidth={2.4} />
                  ) : (
                    <Copy size={18} color={theme.colors.primary} strokeWidth={2.3} />
                  )}
                </TouchableOpacity>
              </Animated.View>
              <Animated.View
                style={[
                  styles.floatingActionWrap,
                  animatedCopyStyle,
                  {
                    top: selectionLayout.shareButtonTop,
                    left: selectionLayout.shareButtonLeft,
                    width: copyButtonSize,
                    height: copyButtonSize,
                  },
                ]}
              >
                <TouchableOpacity
                  activeOpacity={0.78}
                  style={[
                    styles.floatingActionBtn,
                    !hasSelectedMessageText && styles.selectionActionBtnDisabled,
                  ]}
                  onPress={handleSharePress}
                  disabled={!hasSelectedMessageText}
                >
                  <Share2 size={18} color={theme.colors.primary} strokeWidth={2.3} />
                </TouchableOpacity>
              </Animated.View>
            </>
          ) : null}
        </View>
      </Modal>

      <ChatSharePosterModal
        visible={sharePosterVisible}
        onClose={() => {
          setSharePosterVisible(false);
          sharePosterDataRef.current = null;
        }}
        agentName={currentAgentName}
        agentEmoji={currentAgentEmoji}
        agentAvatarUri={effectiveAvatarUri}
        shareProductLabel={shareProductLabel}
        messageText={sharePosterDataRef.current?.text ?? ''}
        modelLabel={sharePosterDataRef.current?.modelLabel}
        timestampMs={sharePosterDataRef.current?.timestampMs}
      />
    </>
  );
}

function createStyles(
  colors: ReturnType<typeof useAppTheme>['theme']['colors'],
  scheme: ReturnType<typeof useAppTheme>['theme']['scheme'],
) {
  return StyleSheet.create({
    floatingActionBtn: {
      flex: 1,
      borderRadius: Radius.full,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surfaceElevated,
      ...createThemedShadowStyle(colors, scheme, Shadow.lg),
    },
    floatingActionBtnCopied: {
      backgroundColor: colors.surface,
    },
    floatingActionWrap: {
      position: 'absolute',
    },
    selectedCloneWrap: {
      position: 'absolute',
    },
    selectedCloneWrapScrollable: {
      overflow: 'hidden',
    },
    selectedCloneScrollContent: {
      flexGrow: 1,
    },
    selectionActionBtnDisabled: {
      opacity: 0.5,
    },
    selectionModalMask: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: colors.overlay,
    },
    selectionModalRoot: {
      flex: 1,
    },
  });
}
