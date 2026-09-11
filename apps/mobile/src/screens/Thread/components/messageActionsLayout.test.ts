import { Space } from '../../../theme/tokens';
import {
  canReturnToAnchor,
  computeMessageActionsLayout,
  getMessageCloneAnchor,
  isUsableAnchor,
  MESSAGE_ACTIONS_MENU_GAP,
  type MessageActionsLayoutInput,
} from './messageActionsLayout';

const SCREEN = { screenWidth: 393, screenHeight: 852 };
const INSETS = { topInset: 59, bottomInset: 34 };
const MENU = { menuWidth: 240, menuHeight: 134 };
const TOP_BOUND = INSETS.topInset + Space.sm;
const BOTTOM_BOUND = SCREEN.screenHeight - INSETS.bottomInset - Space.sm;

function input(overrides: Partial<MessageActionsLayoutInput> = {}): MessageActionsLayoutInput {
  return {
    anchor: { x: 0, y: 300, width: 393, height: 120 },
    role: 'assistant',
    contentHeight: 120,
    contentInset: Space.lg,
    ...SCREEN,
    ...INSETS,
    ...MENU,
    ...overrides,
  };
}

describe('messageActionsLayout', () => {
  it('keeps a message that already fits exactly where it was and drops the menu below it', () => {
    const layout = computeMessageActionsLayout(input());
    expect(layout).toMatchObject({
      messageTop: 300,
      messageLeft: 0,
      messageWidth: 393,
      messageHeight: 120,
      scrollOffset: 0,
      scrollEnabled: false,
      menuTop: 300 + 120 + MESSAGE_ACTIONS_MENU_GAP,
    });
  });

  it('aligns the menu with the bubble edge for each role and clamps it inside the side margins', () => {
    const assistant = computeMessageActionsLayout(input({ role: 'assistant' }));
    expect(assistant?.menuLeft).toBe(Space.lg);
    const user = computeMessageActionsLayout(input({ role: 'user' }));
    expect(user?.menuLeft).toBe(393 - Space.lg - MENU.menuWidth);
    const narrow = computeMessageActionsLayout(input({ role: 'user', screenWidth: 250, anchor: { x: 0, y: 300, width: 250, height: 120 } }));
    expect(narrow?.menuLeft).toBe(Space.lg);
  });

  it('bottom-aligns the shorter clone so the message block lands on the original', () => {
    const anchor = { x: 0, y: 300, width: 393, height: 160 };
    expect(getMessageCloneAnchor(anchor, 120)).toEqual({ top: 340, height: 120 });
    const layout = computeMessageActionsLayout(input({ anchor, contentHeight: 120 }));
    expect(layout?.messageTop).toBe(340);
  });

  it('lifts a message near the bottom just far enough for the menu to fit', () => {
    const layout = computeMessageActionsLayout(input({ anchor: { x: 0, y: 700, width: 393, height: 120 } }));
    const expectedTop = BOTTOM_BOUND - MENU.menuHeight - MESSAGE_ACTIONS_MENU_GAP - 120;
    expect(layout?.messageTop).toBe(expectedTop);
    expect(layout?.menuTop).toBe(expectedTop + 120 + MESSAGE_ACTIONS_MENU_GAP);
    expect(layout?.menuTop! + MENU.menuHeight).toBeLessThanOrEqual(BOTTOM_BOUND);
    expect(layout?.scrollOffset).toBe(0);
  });

  it('caps a very tall message, enables scrolling, and keeps the pressed content stationary', () => {
    const layout = computeMessageActionsLayout(input({
      anchor: { x: 0, y: -300, width: 393, height: 800 },
      contentHeight: 800,
    }));
    const available = BOTTOM_BOUND - TOP_BOUND - MENU.menuHeight - MESSAGE_ACTIONS_MENU_GAP;
    expect(layout).toMatchObject({
      messageTop: TOP_BOUND,
      messageHeight: available,
      scrollEnabled: true,
    });
    expect(layout?.scrollOffset).toBe(800 - available);
    expect(layout?.scrollOffset).toBeLessThanOrEqual(TOP_BOUND + 300);
  });

  it('pulls a message that starts above the viewport down without scrolling when it fits', () => {
    const layout = computeMessageActionsLayout(input({ anchor: { x: 0, y: -50, width: 393, height: 200 }, contentHeight: 200 }));
    expect(layout).toMatchObject({ messageTop: TOP_BOUND, scrollOffset: 0, scrollEnabled: false });
  });

  it('falls back to a centered menu and full-width clone when the row could not be measured', () => {
    const layout = computeMessageActionsLayout(input({ anchor: null }));
    expect(layout).toMatchObject({
      messageTop: TOP_BOUND,
      messageLeft: 0,
      messageWidth: 393,
      menuLeft: (393 - MENU.menuWidth) / 2,
    });
    expect(computeMessageActionsLayout(input({ anchor: { x: 0, y: 10, width: 0, height: 0 } }))?.menuLeft)
      .toBe((393 - MENU.menuWidth) / 2);
  });

  it('waits for real measurements before producing a layout', () => {
    expect(computeMessageActionsLayout(input({ contentHeight: null }))).toBeNull();
    expect(computeMessageActionsLayout(input({ menuWidth: null }))).toBeNull();
    expect(computeMessageActionsLayout(input({ menuHeight: 0 }))).toBeNull();
    expect(computeMessageActionsLayout(input({ screenHeight: Number.NaN }))).toBeNull();
    expect(computeMessageActionsLayout(input({ contentHeight: Number.POSITIVE_INFINITY }))).toBeNull();
  });

  it('rejects malformed anchors and only returns to frames that still intersect the viewport', () => {
    expect(isUsableAnchor(null)).toBe(false);
    expect(isUsableAnchor({ x: Number.NaN, y: 0, width: 10, height: 10 })).toBe(false);
    expect(isUsableAnchor({ x: 0, y: 0, width: 10, height: 0 })).toBe(false);
    expect(isUsableAnchor({ x: 0, y: 0, width: 10, height: 10 })).toBe(true);
    expect(canReturnToAnchor({ x: 0, y: 900, width: 10, height: 10 }, 852)).toBe(false);
    expect(canReturnToAnchor({ x: 0, y: -20, width: 10, height: 10 }, 852)).toBe(false);
    expect(canReturnToAnchor({ x: 0, y: -5, width: 10, height: 10 }, 852)).toBe(true);
    expect(canReturnToAnchor({ x: 0, y: 100, width: 10, height: 10 }, 0)).toBe(false);
    expect(getMessageCloneAnchor(null, 100)).toBeNull();
    expect(getMessageCloneAnchor({ x: 0, y: 0, width: 10, height: 10 }, 0)).toBeNull();
  });
});
