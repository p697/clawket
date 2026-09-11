import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { ArrowUp, Check, Copy, Pencil, Share2, Star, StarOff, Trash2 } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import type { UiMessage } from '../../../types/chat';
import { useAppTheme } from '../../../theme';
import {
  ControlSize,
  FontSize,
  FontWeight,
  IconSize,
  LineHeight,
  Motion,
  Radius,
  Space,
  createSurfaceStyle,
} from '../../../theme/tokens';
import { triggerSelectionHaptic } from '../../../services/haptics';
import {
  canReturnToAnchor,
  computeMessageActionsLayout,
  getMessageCloneAnchor,
  isUsableAnchor,
  type MessageAnchorFrame,
} from './messageActionsLayout';

// Long-press message actions overlay.
//
// The list row stays where it is, dimmed under the scrim. A clone of the
// message block is rendered on top with identical geometry so it appears to
// lift out of the timeline; it then slides just far enough for the action
// bar to fit below it. The bar is a capsule of three equal icon-over-label
// cells (Copy, Favorite, Share) anchored to the bubble edge; Favorite is a
// toggle whose star shows the current state. Closing re-measures the live row
// so the clone lands back on the real message even if the list moved
// (keyboard dismissal, streaming growth) while the bar was open.

/** Re-measures the still-mounted list row; yields null when it is gone or reused. */
export type MessageAnchorRemeasure = (
  callback: (frame: MessageAnchorFrame | null) => void,
) => void;

export type ThreadMessageSelection = Readonly<{
  messageId: string;
  role: 'assistant' | 'user';
  anchor: MessageAnchorFrame | null;
  remeasure: MessageAnchorRemeasure | null;
}>;

export type MessageFavoriteToggleResult = Readonly<{
  favorited: boolean;
  /** Null when the toggle could not be recorded (no connection/session scope). */
  favoriteKey: string | null;
}>;

/** Replaces the standard rows while the selected message is still queued locally. */
export type ThreadQueuedMessageOverlayActions = Readonly<{
  canSendNow: boolean;
  /** False while the queued message is already being delivered. */
  editable: boolean;
  onSendNow: (message: UiMessage) => void;
  onEdit: (message: UiMessage) => void;
  onRemove: (message: UiMessage) => void;
}>;

export type ThreadMessageActionsOverlayProps = Readonly<{
  selection: ThreadMessageSelection | null;
  /** Live message for the selection, so a streaming reply keeps updating in the clone. */
  message: UiMessage | null;
  favorited: boolean;
  topInset: number;
  bottomInset: number;
  /** Horizontal padding of the timeline row; aligns the menu with the bubble edge. */
  contentInset: number;
  renderMessage: (message: UiMessage, width: number) => React.ReactNode;
  onCopy: (message: UiMessage) => void;
  /** May resolve with the recorded outcome so the confirmation row stays truthful. */
  onToggleFavorite: (message: UiMessage) => void | Promise<MessageFavoriteToggleResult | void>;
  onShare: (message: UiMessage) => void;
  queuedActions?: ThreadQueuedMessageOverlayActions;
  /** Fires once the close animation has finished; the owner clears the selection. */
  onClosed: () => void;
  testID?: string;
}>;

type Confirmation = 'copied' | 'favorited' | 'unfavorited';

type MenuCell = Readonly<{
  key: string;
  testID: string;
  label: string;
  accessibilityLabel: string;
  /** Semantic label tint: confirmation or destructive. */
  tone?: 'good' | 'bad';
  icon: React.ReactNode;
  onPress: () => void;
  disabled: boolean;
  /** Only toggles expose a selected state. */
  selected?: boolean;
}>;

// Equal cells keep the capsule the same size in every locale and while a
// cell shows its confirmation, so the anchored edge never shifts.
const MENU_CELL_WIDTH = 80;
const MENU_ENTER_OFFSET = Space.sm;
const MENU_ENTER_SCALE = Motion.pressedScale;
const EASE_OUT = Easing.out(Easing.cubic);
// Long enough to read the confirmation row before the menu closes on its own.
const CONFIRMATION_HOLD_MS = Motion.duration.slow * 2;
// A modal presented by an action must not race the dismissing overlay modal.
const AFTER_CLOSE_HANDOFF_MS = Motion.duration.fast;

export function ThreadMessageActionsOverlay({
  selection,
  message,
  favorited,
  topInset,
  bottomInset,
  contentInset,
  renderMessage,
  onCopy,
  onToggleFavorite,
  onShare,
  queuedActions,
  onClosed,
  testID = 'thread-message-actions',
}: ThreadMessageActionsOverlayProps): React.JSX.Element {
  const closeRef = useRef<((after?: () => void) => void) | null>(null);
  const active = Boolean(selection && message);

  useEffect(() => {
    // The selected message left the timeline (session switch, reconciliation).
    if (selection && !message) onClosed();
  }, [message, onClosed, selection]);

  const handleRequestClose = useCallback(() => {
    if (closeRef.current) closeRef.current();
    else onClosed();
  }, [onClosed]);

  return (
    <Modal
      transparent
      animationType="none"
      visible={active}
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={handleRequestClose}
    >
      {selection && message ? (
        <ThreadMessageActionsContent
          key={selection.messageId}
          closeRef={closeRef}
          selection={selection}
          message={message}
          favorited={favorited}
          topInset={topInset}
          bottomInset={bottomInset}
          contentInset={contentInset}
          renderMessage={renderMessage}
          onCopy={onCopy}
          onToggleFavorite={onToggleFavorite}
          onShare={onShare}
          queuedActions={queuedActions}
          onClosed={onClosed}
          testID={testID}
        />
      ) : null}
    </Modal>
  );
}

type ContentProps = Readonly<{
  closeRef: React.RefObject<((after?: () => void) => void) | null>;
  selection: ThreadMessageSelection;
  message: UiMessage;
  favorited: boolean;
  topInset: number;
  bottomInset: number;
  contentInset: number;
  renderMessage: (message: UiMessage, width: number) => React.ReactNode;
  onCopy: (message: UiMessage) => void;
  onToggleFavorite: ThreadMessageActionsOverlayProps['onToggleFavorite'];
  onShare: (message: UiMessage) => void;
  queuedActions?: ThreadQueuedMessageOverlayActions;
  onClosed: () => void;
  testID: string;
}>;

function ThreadMessageActionsContent({
  closeRef,
  selection,
  message,
  favorited,
  topInset,
  bottomInset,
  contentInset,
  renderMessage,
  onCopy,
  onToggleFavorite,
  onShare,
  queuedActions,
  onClosed,
  testID,
}: ContentProps): React.JSX.Element {
  const { theme } = useAppTheme();
  const { t } = useTranslation(['chat', 'common']);
  const reduceMotion = useReducedMotion();
  const styles = useMemo(
    () => createStyles(theme.colors, theme.scheme),
    [theme.colors, theme.scheme],
  );
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const [contentHeight, setContentHeight] = useState<number | null>(null);
  const [menuSize, setMenuSize] = useState<{ width: number; height: number } | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);

  const anchor = isUsableAnchor(selection.anchor) ? selection.anchor : null;
  const initialWidth = anchor ? Math.min(anchor.width, screenWidth) : screenWidth;

  const scrimOpacity = useSharedValue(0);
  // The clone container starts with the row's exact frame and bottom-aligns
  // its content, so the message block covers the original from the very
  // first frame without waiting for a measurement.
  const cloneOpacity = useSharedValue(1);
  const cloneTop = useSharedValue(anchor?.y ?? 0);
  const cloneLeft = useSharedValue(anchor?.x ?? 0);
  const cloneHeight = useSharedValue(anchor?.height ?? 0);
  const menuProgress = useSharedValue(0);
  const menuTop = useSharedValue(0);
  const menuLeft = useSharedValue(0);

  const openedRef = useRef(false);
  // Natural top of the clone once opened. Later growth (a streaming reply)
  // must extend the clone downward like the row does, not shift it upward.
  const openedTopRef = useRef<number | null>(null);
  const closingRef = useRef(false);
  const settledRef = useRef(false);
  const appliedScrollOffsetRef = useRef(0);
  const contentHeightRef = useRef<number | null>(null);
  contentHeightRef.current = contentHeight;
  const pendingAfterRef = useRef<(() => void) | undefined>(undefined);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const onClosedRef = useRef(onClosed);
  onClosedRef.current = onClosed;

  const hasText = Boolean(message.text?.trim());

  useEffect(() => {
    scrimOpacity.value = withTiming(1, { duration: Motion.duration.normal, easing: EASE_OUT });
    return () => {
      if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
      if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    };
    // Mount-only entrance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const layout = useMemo(() => computeMessageActionsLayout({
    anchor: anchor && openedTopRef.current !== null && contentHeight !== null
      ? { ...anchor, y: openedTopRef.current, height: contentHeight }
      : anchor,
    role: selection.role,
    contentHeight,
    menuWidth: menuSize?.width ?? null,
    menuHeight: menuSize?.height ?? null,
    contentInset,
    topInset,
    bottomInset,
    screenWidth,
    screenHeight,
  }), [anchor, bottomInset, contentHeight, contentInset, menuSize, screenHeight, screenWidth, selection.role, topInset]);

  const move = useCallback((target: number) => (
    reduceMotion
      ? target
      : withTiming(target, { duration: Motion.duration.normal, easing: EASE_OUT })
  ), [reduceMotion]);

  useEffect(() => {
    if (!layout || closingRef.current) return;
    if (!openedRef.current) {
      openedRef.current = true;
      const cloneAnchor = getMessageCloneAnchor(anchor, contentHeight)
        ?? { top: layout.messageTop, height: layout.messageHeight };
      openedTopRef.current = cloneAnchor.top;
      appliedScrollOffsetRef.current = layout.scrollOffset;
      cloneLeft.value = layout.messageLeft;
      if (layout.scrollOffset > 0) {
        // The pressed content stays optically still: the container jumps to
        // its clamped top while the inner scroll offset compensates.
        scrollRef.current?.scrollTo({ y: layout.scrollOffset, animated: false });
        cloneTop.value = layout.messageTop;
      } else {
        cloneTop.value = cloneAnchor.top;
        cloneTop.value = move(layout.messageTop);
      }
      cloneHeight.value = cloneAnchor.height;
      cloneHeight.value = move(layout.messageHeight);
      menuTop.value = layout.menuTop;
      menuLeft.value = layout.menuLeft;
      menuProgress.value = withTiming(1, { duration: Motion.duration.normal, easing: EASE_OUT });
      return;
    }
    // Streaming growth or a rotation re-derives the layout from fresh sizes.
    cloneTop.value = move(layout.messageTop);
    cloneLeft.value = move(layout.messageLeft);
    cloneHeight.value = move(layout.messageHeight);
    menuTop.value = move(layout.menuTop);
    menuLeft.value = move(layout.menuLeft);
  }, [anchor, cloneHeight, cloneLeft, cloneTop, contentHeight, layout, menuLeft, menuProgress, menuTop, move]);

  const finishClose = useCallback(() => {
    const after = pendingAfterRef.current;
    pendingAfterRef.current = undefined;
    onClosedRef.current();
    if (after) setTimeout(after, AFTER_CLOSE_HANDOFF_MS);
  }, []);

  const requestClose = useCallback((after?: () => void) => {
    if (closingRef.current) return;
    closingRef.current = true;
    pendingAfterRef.current = after;
    if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
    menuProgress.value = withTiming(0, { duration: Motion.duration.fast, easing: EASE_OUT });

    const settle = (frame: MessageAnchorFrame | null) => {
      if (settledRef.current) return;
      settledRef.current = true;
      if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
      const returnAnchor = !reduceMotion
        && appliedScrollOffsetRef.current === 0
        && canReturnToAnchor(frame, screenHeight)
        ? getMessageCloneAnchor(frame, contentHeightRef.current)
        : null;
      if (returnAnchor && frame) {
        cloneTop.value = withTiming(returnAnchor.top, { duration: Motion.duration.normal, easing: EASE_OUT });
        cloneLeft.value = withTiming(frame.x, { duration: Motion.duration.normal, easing: EASE_OUT });
        cloneHeight.value = withTiming(returnAnchor.height, { duration: Motion.duration.normal, easing: EASE_OUT });
      } else {
        // Nothing to land on: fade out in place instead of sliding to a stale frame.
        cloneOpacity.value = withTiming(0, { duration: Motion.duration.normal, easing: EASE_OUT });
      }
      scrimOpacity.value = withTiming(
        0,
        { duration: Motion.duration.normal, easing: EASE_OUT },
        () => {
          runOnJS(finishClose)();
        },
      );
    };

    const remeasure = selection.remeasure;
    if (!remeasure) {
      settle(null);
      return;
    }
    // Never wait on a measurement that cannot call back (detached node).
    settleTimerRef.current = setTimeout(() => settle(null), Motion.duration.fast);
    remeasure(settle);
  }, [cloneHeight, cloneLeft, cloneOpacity, cloneTop, finishClose, menuProgress, reduceMotion, screenHeight, scrimOpacity, selection.remeasure]);

  useEffect(() => {
    closeRef.current = requestClose;
    return () => {
      if (closeRef.current === requestClose) closeRef.current = null;
    };
  }, [closeRef, requestClose]);

  const holdThenClose = useCallback(() => {
    if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
    holdTimerRef.current = setTimeout(() => requestClose(), CONFIRMATION_HOLD_MS);
  }, [requestClose]);

  const handleCopy = useCallback(() => {
    if (!hasText || confirmation) return;
    onCopy(message);
    triggerSelectionHaptic();
    setConfirmation('copied');
    holdThenClose();
  }, [confirmation, hasText, holdThenClose, message, onCopy]);

  const handleToggleFavorite = useCallback(() => {
    if (confirmation) return;
    triggerSelectionHaptic();
    // Optimistic so the row answers immediately; a recorded outcome corrects it.
    setConfirmation(favorited ? 'unfavorited' : 'favorited');
    holdThenClose();
    const outcome = onToggleFavorite(message);
    if (!outcome || typeof outcome.then !== 'function') return;
    outcome.then((result) => {
      if (closingRef.current) return;
      if (!result) return;
      if (!result.favoriteKey) {
        // Nothing was recorded; do not claim a favorite that does not exist.
        setConfirmation(null);
        requestClose();
        return;
      }
      setConfirmation(result.favorited ? 'favorited' : 'unfavorited');
    }, () => {
      if (closingRef.current) return;
      setConfirmation(null);
      requestClose();
    });
  }, [confirmation, favorited, holdThenClose, message, onToggleFavorite, requestClose]);

  const handleShare = useCallback(() => {
    if (!hasText || confirmation) return;
    requestClose(() => onShare(message));
  }, [confirmation, hasText, message, onShare, requestClose]);

  // Queue actions change the timeline immediately; the row leaves with the menu.
  const handleQueuedSendNow = useCallback(() => {
    if (!queuedActions?.canSendNow || confirmation) return;
    triggerSelectionHaptic();
    requestClose(() => queuedActions.onSendNow(message));
  }, [confirmation, message, queuedActions, requestClose]);
  const handleQueuedEdit = useCallback(() => {
    if (!queuedActions?.editable || confirmation) return;
    requestClose(() => queuedActions.onEdit(message));
  }, [confirmation, message, queuedActions, requestClose]);
  const handleQueuedRemove = useCallback(() => {
    if (!queuedActions?.editable || confirmation) return;
    triggerSelectionHaptic();
    requestClose(() => queuedActions.onRemove(message));
  }, [confirmation, message, queuedActions, requestClose]);

  const cells = useMemo((): MenuCell[] => {
    const iconColor = theme.colors.ink;
    const confirmColor = theme.colors.good;
    const copied = confirmation === 'copied';
    const favoriteConfirmed = confirmation === 'favorited' || confirmation === 'unfavorited';
    const favoriteLabel = favorited
      ? t('Unfavorite', { ns: 'common' })
      : t('Favorite', { ns: 'common' });
    const copyCell: MenuCell = {
      key: 'copy',
      testID: 'thread-message-copy',
      label: copied ? t('Copied', { ns: 'chat' }) : t('Copy', { ns: 'common' }),
      accessibilityLabel: copied ? t('Copied', { ns: 'chat' }) : t('Copy', { ns: 'common' }),
      tone: copied ? 'good' : undefined,
      icon: copied
        ? <Check size={IconSize.md} color={confirmColor} strokeWidth={2} />
        : <Copy size={IconSize.md} color={iconColor} strokeWidth={2} />,
      onPress: handleCopy,
      disabled: !hasText || (Boolean(confirmation) && !copied),
    };
    if (queuedActions) {
      // A locally queued message can still be changed; favorite/share wait
      // until it has actually been delivered.
      const locked = !queuedActions.editable || Boolean(confirmation);
      return [
        ...(queuedActions.canSendNow ? [{
          key: 'send-now',
          testID: 'thread-message-send-now',
          label: t('Send now', { ns: 'chat' }),
          accessibilityLabel: t('Send now', { ns: 'chat' }),
          icon: <ArrowUp size={IconSize.md} color={iconColor} strokeWidth={2} />,
          onPress: handleQueuedSendNow,
          disabled: Boolean(confirmation),
        } satisfies MenuCell] : []),
        {
          key: 'edit',
          testID: 'thread-message-edit',
          label: t('Edit', { ns: 'common' }),
          accessibilityLabel: t('Edit', { ns: 'common' }),
          icon: <Pencil size={IconSize.md} color={iconColor} strokeWidth={2} />,
          onPress: handleQueuedEdit,
          disabled: locked,
        },
        {
          key: 'remove',
          testID: 'thread-message-remove',
          label: t('Remove', { ns: 'common' }),
          accessibilityLabel: t('Remove', { ns: 'common' }),
          tone: 'bad',
          icon: <Trash2 size={IconSize.md} color={theme.colors.bad} strokeWidth={2} />,
          onPress: handleQueuedRemove,
          disabled: locked,
        },
        copyCell,
      ];
    }
    return [
      copyCell,
      {
        key: 'favorite',
        testID: 'thread-message-favorite',
        // The star carries the state, so the visible label stays short.
        label: confirmation === 'favorited'
          ? t('Favorited', { ns: 'chat' })
          : confirmation === 'unfavorited'
            ? t('Removed', { ns: 'chat' })
            : t('Favorite', { ns: 'common' }),
        accessibilityLabel: confirmation === 'favorited'
          ? t('Favorited', { ns: 'chat' })
          : confirmation === 'unfavorited'
            ? t('Removed', { ns: 'chat' })
            : favoriteLabel,
        tone: favoriteConfirmed ? 'good' : undefined,
        icon: confirmation === 'favorited'
          ? <Star size={IconSize.md} color={confirmColor} fill={confirmColor} strokeWidth={2} />
          : confirmation === 'unfavorited'
            ? <StarOff size={IconSize.md} color={confirmColor} strokeWidth={2} />
            : favorited
              ? <Star size={IconSize.md} color={theme.colors.accent} fill={theme.colors.accent} strokeWidth={2} />
              : <Star size={IconSize.md} color={iconColor} strokeWidth={2} />,
        onPress: handleToggleFavorite,
        disabled: Boolean(confirmation) && !favoriteConfirmed,
        selected: favorited,
      },
      {
        key: 'share',
        testID: 'thread-message-share',
        label: t('Share', { ns: 'chat' }),
        accessibilityLabel: t('Share', { ns: 'chat' }),
        icon: <Share2 size={IconSize.md} color={iconColor} strokeWidth={2} />,
        onPress: handleShare,
        disabled: !hasText || Boolean(confirmation),
      },
    ];
  }, [confirmation, favorited, handleCopy, handleQueuedEdit, handleQueuedRemove, handleQueuedSendNow, handleShare, handleToggleFavorite, hasText, queuedActions, t, theme.colors.accent, theme.colors.bad, theme.colors.good, theme.colors.ink]);

  const scrimStyle = useAnimatedStyle(() => ({ opacity: scrimOpacity.value }));
  const cloneStyle = useAnimatedStyle(() => ({
    top: cloneTop.value,
    left: cloneLeft.value,
    height: cloneHeight.value,
    opacity: cloneOpacity.value,
  }));
  const menuStyle = useAnimatedStyle(() => ({
    top: menuTop.value,
    left: menuLeft.value,
    opacity: menuProgress.value,
    transform: reduceMotion
      ? []
      : [
        { translateY: (1 - menuProgress.value) * MENU_ENTER_OFFSET },
        { scale: MENU_ENTER_SCALE + (1 - MENU_ENTER_SCALE) * menuProgress.value },
      ],
  }));

  const cloneWidth = layout?.messageWidth ?? initialWidth;
  const scrollEnabled = layout?.scrollEnabled ?? false;

  return (
    <View style={styles.root} testID={testID} accessibilityViewIsModal>
      <Animated.View style={[styles.scrim, scrimStyle]}>
        <Pressable
          testID={`${testID}-scrim`}
          accessibilityRole="button"
          accessibilityLabel={t('Close', { ns: 'common' })}
          onPress={() => requestClose()}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>
      <Animated.View
        testID={`${testID}-message`}
        pointerEvents={scrollEnabled ? 'auto' : 'none'}
        style={[styles.clone, { width: cloneWidth }, cloneStyle]}
      >
        <ScrollView
          ref={scrollRef}
          style={styles.cloneScroll}
          contentContainerStyle={styles.cloneContent}
          bounces={scrollEnabled}
          scrollEnabled={scrollEnabled}
          showsVerticalScrollIndicator={scrollEnabled}
        >
          <View
            onLayout={(event) => {
              const { height } = event.nativeEvent.layout;
              if (Number.isFinite(height) && height > 0) setContentHeight(height);
            }}
          >
            {renderMessage(message, cloneWidth)}
          </View>
        </ScrollView>
      </Animated.View>
      <Animated.View
        testID={`${testID}-menu`}
        pointerEvents={layout ? 'auto' : 'none'}
        style={[styles.menu, menuStyle]}
        onLayout={(event) => {
          const { width, height } = event.nativeEvent.layout;
          if (width > 0 && height > 0) {
            setMenuSize((previous) => (
              previous && previous.width === width && previous.height === height
                ? previous
                : { width, height }
            ));
          }
        }}
      >
        {cells.map((cell) => (
          <Pressable
            key={cell.key}
            testID={cell.testID}
            accessibilityRole="button"
            accessibilityLabel={cell.accessibilityLabel}
            accessibilityState={cell.selected === undefined
              ? { disabled: cell.disabled }
              : { disabled: cell.disabled, selected: cell.selected }}
            disabled={cell.disabled}
            onPress={cell.onPress}
            style={({ pressed }) => [
              styles.menuCell,
              pressed && !cell.disabled ? styles.menuCellPressed : null,
              cell.disabled ? styles.menuCellDisabled : null,
            ]}
          >
            {cell.icon}
            <Text
              numberOfLines={1}
              style={[
                styles.menuLabel,
                cell.tone === 'good' ? styles.menuLabelGood : null,
                cell.tone === 'bad' ? styles.menuLabelBad : null,
              ]}
            >
              {cell.label}
            </Text>
          </Pressable>
        ))}
      </Animated.View>
    </View>
  );
}

function createStyles(
  colors: ReturnType<typeof useAppTheme>['theme']['colors'],
  scheme: ReturnType<typeof useAppTheme>['theme']['scheme'],
) {
  return StyleSheet.create({
    root: {
      flex: 1,
    },
    scrim: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: colors.scrim,
    },
    clone: {
      position: 'absolute',
      overflow: 'hidden',
    },
    cloneScroll: {
      flex: 1,
    },
    cloneContent: {
      flexGrow: 1,
      justifyContent: 'flex-end',
    },
    // Capsule action bar; cells keep their own rounded press highlight.
    menu: {
      position: 'absolute',
      flexDirection: 'row',
      padding: Space.xs,
      borderRadius: Radius.full,
      ...createSurfaceStyle(colors, scheme, 'overlay'),
    },
    menuCell: {
      width: MENU_CELL_WIDTH,
      minHeight: ControlSize.floatingButton,
      alignItems: 'center',
      justifyContent: 'center',
      gap: Space.xs,
      paddingVertical: Space.xs,
      paddingHorizontal: Space.xs,
      borderRadius: Radius.full,
    },
    menuCellPressed: {
      backgroundColor: colors.surface,
    },
    menuCellDisabled: {
      opacity: 0.45,
    },
    menuLabel: {
      maxWidth: '100%',
      color: colors.inkSecondary,
      fontSize: FontSize.caption,
      lineHeight: LineHeight.caption,
      fontWeight: FontWeight.regular,
    },
    menuLabelGood: {
      color: colors.good,
    },
    menuLabelBad: {
      color: colors.bad,
    },
  });
}
