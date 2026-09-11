import { Space } from '../../../theme/tokens';

// Layout engine for the long-press message actions overlay.
//
// The lifted message is a clone of the in-list row rendered with identical
// geometry. The list row frame is only the animation anchor: the clone's own
// measured height decides where it settles, how tall it may be, and whether
// it scrolls internally. Deriving `scrollEnabled` from the real clone height
// makes "content clipped but not scrollable" impossible by construction.

export type MessageAnchorFrame = Readonly<{
  x: number;
  y: number;
  width: number;
  height: number;
}>;

export type MessageActionsLayout = Readonly<{
  messageTop: number;
  messageLeft: number;
  messageWidth: number;
  messageHeight: number;
  /** Inner scroll offset that keeps a clipped clone optically stationary. */
  scrollOffset: number;
  scrollEnabled: boolean;
  menuTop: number;
  menuLeft: number;
}>;

export type MessageActionsLayoutInput = Readonly<{
  anchor: MessageAnchorFrame | null;
  role: 'assistant' | 'user';
  /** Real height of the rendered clone content, from onLayout. */
  contentHeight: number | null;
  /** Measured menu card size, from onLayout. */
  menuWidth: number | null;
  menuHeight: number | null;
  /** Horizontal padding of the list row, used to align the menu with the bubble edge. */
  contentInset: number;
  topInset: number;
  bottomInset: number;
  screenWidth: number;
  screenHeight: number;
}>;

export const MESSAGE_ACTIONS_MENU_GAP = Space.md;
const EDGE_MARGIN = Space.sm;
const MENU_SIDE_MARGIN = Space.lg;
const MIN_MESSAGE_HEIGHT = 40;

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

function isPositiveFinite(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

export function isUsableAnchor(anchor: MessageAnchorFrame | null | undefined): anchor is MessageAnchorFrame {
  return Boolean(anchor)
    && Number.isFinite(anchor!.x)
    && Number.isFinite(anchor!.y)
    && isPositiveFinite(anchor!.width)
    && isPositiveFinite(anchor!.height);
}

/**
 * The clone drops the identity chrome above the message block, so it renders
 * shorter than the row by exactly that chrome. Bottom-aligning the clone to
 * the row frame lands the cloned message block exactly on the original.
 */
export function getMessageCloneAnchor(
  anchor: MessageAnchorFrame | null,
  contentHeight: number | null,
): { top: number; height: number } | null {
  if (!isUsableAnchor(anchor) || !isPositiveFinite(contentHeight)) return null;
  return {
    top: anchor.y + anchor.height - contentHeight,
    height: contentHeight,
  };
}

export function computeMessageActionsLayout({
  anchor,
  role,
  contentHeight,
  menuWidth,
  menuHeight,
  contentInset,
  topInset,
  bottomInset,
  screenWidth,
  screenHeight,
}: MessageActionsLayoutInput): MessageActionsLayout | null {
  if (!isPositiveFinite(screenWidth) || !isPositiveFinite(screenHeight)) return null;
  if (!isPositiveFinite(menuWidth) || !isPositiveFinite(menuHeight)) return null;
  if (!isPositiveFinite(contentHeight)) return null;

  const usableAnchor = isUsableAnchor(anchor) ? anchor : null;
  const topBound = Math.max(topInset, 0) + EDGE_MARGIN;
  const bottomBound = screenHeight - Math.max(bottomInset, 0) - EDGE_MARGIN;
  const availableForMessage = bottomBound - topBound - menuHeight - MESSAGE_ACTIONS_MENU_GAP;

  const messageWidth = usableAnchor ? Math.min(usableAnchor.width, screenWidth) : screenWidth;
  const messageHeight = Math.max(
    Math.min(contentHeight, availableForMessage),
    Math.min(contentHeight, MIN_MESSAGE_HEIGHT),
  );
  const scrollEnabled = contentHeight > messageHeight + 0.5;

  const cloneAnchor = getMessageCloneAnchor(usableAnchor, contentHeight);
  const naturalTop = cloneAnchor ? cloneAnchor.top : topBound;
  const messageLeft = usableAnchor ? clamp(usableAnchor.x, 0, screenWidth - messageWidth) : 0;
  const messageTop = clamp(
    naturalTop,
    topBound,
    bottomBound - menuHeight - MESSAGE_ACTIONS_MENU_GAP - messageHeight,
  );
  // A message that starts above the viewport is pulled down to the top bound.
  // Scrolling the clone by the same distance keeps the pressed content where
  // the finger was instead of jumping to the start of the message.
  const scrollOffset = clamp(messageTop - naturalTop, 0, Math.max(0, contentHeight - messageHeight));
  const menuTop = messageTop + messageHeight + MESSAGE_ACTIONS_MENU_GAP;

  const contentLeft = messageLeft + contentInset;
  const contentRight = messageLeft + messageWidth - contentInset;
  const preferredMenuLeft = usableAnchor
    ? role === 'user'
      ? contentRight - menuWidth
      : contentLeft
    : (screenWidth - menuWidth) / 2;
  const menuLeft = clamp(
    preferredMenuLeft,
    MENU_SIDE_MARGIN,
    screenWidth - menuWidth - MENU_SIDE_MARGIN,
  );

  return {
    messageTop,
    messageLeft,
    messageWidth,
    messageHeight,
    scrollOffset,
    scrollEnabled,
    menuTop,
    menuLeft,
  };
}

/** True when a fresh row frame still intersects the viewport, so the clone can return to it. */
export function canReturnToAnchor(
  anchor: MessageAnchorFrame | null,
  screenHeight: number,
): anchor is MessageAnchorFrame {
  if (!isUsableAnchor(anchor) || !isPositiveFinite(screenHeight)) return false;
  return anchor.y + anchor.height > 0 && anchor.y < screenHeight;
}
