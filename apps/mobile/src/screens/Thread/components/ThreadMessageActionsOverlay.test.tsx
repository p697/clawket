import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import type { UiMessage } from '../../../types/chat';
import { ControlSize, Motion, Radius, Space } from '../../../theme/tokens';
import { triggerSelectionHaptic } from '../../../services/haptics';
import {
  ThreadMessageActionsOverlay,
  type ThreadMessageActionsOverlayProps,
  type ThreadMessageSelection,
} from './ThreadMessageActionsOverlay';

let mockReducedMotion = false;
const mockScrollTo = jest.fn();

jest.mock('react-native', () => {
  const ReactRuntime = require('react');
  const host = (name: string) => ReactRuntime.forwardRef(
    ({ children, style, ...props }: Record<string, unknown>, ref: unknown) => ReactRuntime.createElement(
      name,
      { ...props, ref, style: typeof style === 'function' ? style({ pressed: false }) : style },
      children,
    ),
  );
  const ScrollView = ReactRuntime.forwardRef(
    ({ children, ...props }: Record<string, unknown>, ref: unknown) => {
      ReactRuntime.useImperativeHandle(ref, () => ({ scrollTo: mockScrollTo }));
      return ReactRuntime.createElement('ScrollView', props, children);
    },
  );
  return {
    Modal: ({ children, visible, ...props }: Record<string, unknown>) => (
      visible ? ReactRuntime.createElement('Modal', props, children) : null
    ),
    Pressable: host('Pressable'),
    ScrollView,
    StyleSheet: {
      absoluteFill: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
      absoluteFillObject: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
      create: <T,>(styles: T) => styles,
      flatten: (style: unknown) => flattenStyle(style),
      hairlineWidth: 1,
    },
    Text: host('Text'),
    View: host('View'),
    useWindowDimensions: () => ({ width: 393, height: 852, scale: 3, fontScale: 1 }),
  };
});

jest.mock('react-native-reanimated', () => {
  const ReactRuntime = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: { View },
    Easing: { cubic: 'cubic', out: (value: unknown) => ({ kind: 'out', value }) },
    runOnJS: (callback: (...args: unknown[]) => unknown) => callback,
    // Shared values change inside effects; re-render once so the rendered
    // style reflects them, the way the UI thread would on the next frame.
    useAnimatedStyle: (factory: () => unknown) => {
      const [, force] = ReactRuntime.useReducer((count: number) => count + 1, 0);
      const value = factory();
      ReactRuntime.useEffect(() => {
        if (JSON.stringify(factory()) !== JSON.stringify(value)) force();
      });
      return value;
    },
    useReducedMotion: () => mockReducedMotion,
    useSharedValue: (value: unknown) => ReactRuntime.useRef({ value }).current,
    withTiming: (value: unknown, _config: unknown, callback?: (finished: boolean) => void) => {
      callback?.(true);
      return value;
    },
  };
});

jest.mock('lucide-react-native', () => {
  const ReactRuntime = require('react');
  return new Proxy({}, {
    get: (_target, property) => (props: Record<string, unknown>) => (
      ReactRuntime.createElement(String(property), props)
    ),
  });
});

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('../../../theme', () => ({
  useAppTheme: () => ({
    theme: require('../../../theme/theme').buildTheme(
      'light',
      'light',
      require('../../../theme/accents').builtInAccents.iceBlue,
    ),
  }),
}));

jest.mock('../../../services/haptics', () => ({
  triggerLightImpact: jest.fn(),
  triggerSelectionHaptic: jest.fn(),
}));

function flattenStyle(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (!Array.isArray(value)) return value as Record<string, unknown>;
  return Object.assign({}, ...value.map(flattenStyle));
}

const message: UiMessage = { id: 'reply-1', role: 'assistant', text: 'Lifted reply' };
const anchor = { x: 0, y: 300, width: 393, height: 160 };
const MENU_SIZE = { width: 248, height: 58 };
const TOP_BOUND = 59 + Space.sm;

function createSelection(overrides: Partial<ThreadMessageSelection> = {}): ThreadMessageSelection {
  return {
    messageId: message.id,
    role: 'assistant',
    anchor,
    remeasure: jest.fn((callback) => callback(anchor)),
    ...overrides,
  };
}

function createProps(overrides: Partial<ThreadMessageActionsOverlayProps> = {}): ThreadMessageActionsOverlayProps {
  return {
    selection: createSelection(),
    message,
    favorited: false,
    topInset: 59,
    bottomInset: 34,
    contentInset: Space.lg,
    renderMessage: jest.fn((target: UiMessage, width: number) => (
      React.createElement('Clone', { testID: 'clone-content', width }, target.text)
    )),
    onCopy: jest.fn(),
    onToggleFavorite: jest.fn(),
    onShare: jest.fn(),
    onClosed: jest.fn(),
    ...overrides,
  };
}

function layoutOverlay(view: ReturnType<typeof render>, contentHeight = 120) {
  act(() => {
    fireEvent(view.getByTestId('thread-message-actions-menu'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, ...MENU_SIZE } },
    });
  });
  act(() => {
    fireEvent(view.getByTestId('clone-content').parent!, 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 393, height: contentHeight } },
    });
  });
}

beforeEach(() => {
  mockReducedMotion = false;
  mockScrollTo.mockClear();
  jest.useRealTimers();
});

describe('ThreadMessageActionsOverlay', () => {
  it('stays hidden without a selection and offers copy, favorite, and share once lifted', () => {
    const props = createProps({ selection: null });
    const view = render(<ThreadMessageActionsOverlay {...props} />);
    expect(view.queryByTestId('thread-message-actions')).toBeNull();

    view.rerender(<ThreadMessageActionsOverlay {...props} selection={createSelection()} />);
    expect(view.getByTestId('thread-message-actions').props.accessibilityViewIsModal).toBe(true);
    expect(view.getByText('Copy')).toBeTruthy();
    expect(view.getByText('Favorite')).toBeTruthy();
    expect(view.getByText('Share')).toBeTruthy();
    expect(props.renderMessage).toHaveBeenCalledWith(message, 393);
    // The menu waits for its measurements before it can receive touches.
    expect(view.getByTestId('thread-message-actions-menu').props.pointerEvents).toBe('none');
  });

  it('lands the clone on the original message and drops the menu below the bubble', () => {
    const view = render(<ThreadMessageActionsOverlay {...createProps()} />);
    layoutOverlay(view, 120);
    const clone = flattenStyle(view.getByTestId('thread-message-actions-message').props.style);
    // Bottom-aligned to the row so the shorter clone (no identity chrome) lands on the bubble.
    expect(clone).toMatchObject({ top: 300 + 160 - 120, left: 0, height: 120, width: 393, opacity: 1 });
    const menu = view.getByTestId('thread-message-actions-menu');
    expect(menu.props.pointerEvents).toBe('auto');
    const menuStyle = flattenStyle(menu.props.style);
    expect(menuStyle).toMatchObject({ top: 340 + 120 + Space.md, left: Space.lg, opacity: 1 });
    expect(menuStyle.transform).toEqual([{ translateY: 0 }, { scale: 1 }]);
    expect(mockScrollTo).not.toHaveBeenCalled();
    expect(view.getByTestId('thread-message-actions-message').props.pointerEvents).toBe('none');
  });

  it('grows a streaming clone downward and moves the menu with it', () => {
    const props = createProps();
    const view = render(<ThreadMessageActionsOverlay {...props} />);
    layoutOverlay(view, 120);
    const before = flattenStyle(view.getByTestId('thread-message-actions-message').props.style);
    expect(before).toMatchObject({ top: 340, height: 120 });
    act(() => {
      fireEvent(view.getByTestId('clone-content').parent!, 'layout', {
        nativeEvent: { layout: { x: 0, y: 0, width: 393, height: 180 } },
      });
    });
    const after = flattenStyle(view.getByTestId('thread-message-actions-message').props.style);
    expect(after).toMatchObject({ top: 340, height: 180 });
    expect(flattenStyle(view.getByTestId('thread-message-actions-menu').props.style).top).toBe(340 + 180 + Space.md);
  });

  it('keeps a tall message stationary by scrolling its clone and lets the clone scroll', () => {
    const tall = { x: 0, y: -300, width: 393, height: 800 };
    const view = render(<ThreadMessageActionsOverlay {...createProps({ selection: createSelection({ anchor: tall }) })} />);
    layoutOverlay(view, 800);
    const clone = view.getByTestId('thread-message-actions-message');
    expect(flattenStyle(clone.props.style).top).toBe(TOP_BOUND);
    expect(mockScrollTo).toHaveBeenCalledWith({ y: expect.any(Number), animated: false });
    expect(mockScrollTo.mock.calls[0][0].y).toBeGreaterThan(0);
    expect(clone.props.pointerEvents).toBe('auto');
    expect(view.UNSAFE_getByType(require('react-native').ScrollView).props.scrollEnabled).toBe(true);
  });

  it('lays the three actions out as equal cells in one capsule', () => {
    const view = render(<ThreadMessageActionsOverlay {...createProps()} />);
    layoutOverlay(view);
    const menu = view.getByTestId('thread-message-actions-menu');
    const menuStyle = flattenStyle(menu.props.style);
    expect(menuStyle).toMatchObject({ flexDirection: 'row', borderRadius: Radius.full, padding: Space.xs });
    expect(menuStyle.width).toBeUndefined();
    const cells = ['thread-message-copy', 'thread-message-favorite', 'thread-message-share']
      .map((id) => flattenStyle(view.getByTestId(id).props.style));
    for (const cell of cells) {
      expect(cell).toMatchObject({ width: 80, minHeight: ControlSize.floatingButton, borderRadius: Radius.full });
    }
    expect(view.getByTestId('thread-message-copy').props.accessibilityRole).toBe('button');
    expect(view.getByText('Copy').props.numberOfLines).toBe(1);
  });

  it('confirms copy inline, then closes on its own after the hold', () => {
    jest.useFakeTimers();
    const props = createProps();
    const view = render(<ThreadMessageActionsOverlay {...props} />);
    layoutOverlay(view);
    fireEvent.press(view.getByTestId('thread-message-copy'));
    expect(props.onCopy).toHaveBeenCalledWith(message);
    expect(triggerSelectionHaptic).toHaveBeenCalled();
    expect(view.getByText('Copied')).toBeTruthy();
    expect(view.getByTestId('thread-message-favorite').props.disabled).toBe(true);
    expect(view.getByTestId('thread-message-share').props.disabled).toBe(true);
    // A second tap during the confirmation does nothing.
    fireEvent.press(view.getByTestId('thread-message-copy'));
    expect(props.onCopy).toHaveBeenCalledTimes(1);
    expect(props.onClosed).not.toHaveBeenCalled();
    act(() => { jest.advanceTimersByTime(Motion.duration.slow * 2); });
    expect(props.selection?.remeasure).toHaveBeenCalled();
    expect(props.onClosed).toHaveBeenCalledTimes(1);
  });

  it('toggles favorite with a confirmation label in both directions', () => {
    jest.useFakeTimers();
    const props = createProps();
    const view = render(<ThreadMessageActionsOverlay {...props} />);
    layoutOverlay(view);
    expect(view.getByTestId('thread-message-favorite').props.accessibilityState).toMatchObject({ selected: false });
    fireEvent.press(view.getByTestId('thread-message-favorite'));
    expect(props.onToggleFavorite).toHaveBeenCalledWith(message);
    expect(view.getByText('Favorited')).toBeTruthy();
    act(() => { jest.advanceTimersByTime(Motion.duration.slow * 2); });
    expect(props.onClosed).toHaveBeenCalledTimes(1);

    const favorited = createProps({ favorited: true, selection: createSelection({ messageId: 'reply-2' }), message: { ...message, id: 'reply-2' } });
    const second = render(<ThreadMessageActionsOverlay {...favorited} />);
    layoutOverlay(second);
    // The star carries the state; the visible label stays "Favorite" while
    // assistive technology hears the actual toggle direction.
    const favoriteCell = second.getByTestId('thread-message-favorite');
    expect(second.getByText('Favorite')).toBeTruthy();
    expect(favoriteCell.props.accessibilityLabel).toBe('Unfavorite');
    expect(favoriteCell.props.accessibilityState).toMatchObject({ selected: true });
    expect(second.UNSAFE_getByType('Star' as never).props.fill).toBeTruthy();
    fireEvent.press(favoriteCell);
    expect(second.getByText('Removed')).toBeTruthy();
  });

  it('corrects an optimistic favorite confirmation from the recorded outcome', async () => {
    jest.useFakeTimers();
    const recorded = createProps({
      onToggleFavorite: jest.fn(async () => ({ favorited: false, favoriteKey: 'key-1' })),
    });
    const recordedView = render(<ThreadMessageActionsOverlay {...recorded} />);
    layoutOverlay(recordedView);
    fireEvent.press(recordedView.getByTestId('thread-message-favorite'));
    expect(recordedView.getByText('Favorited')).toBeTruthy();
    await act(async () => { await Promise.resolve(); });
    expect(recordedView.getByText('Removed')).toBeTruthy();
    expect(recorded.onClosed).not.toHaveBeenCalled();

    const unscoped = createProps({
      selection: createSelection({ messageId: 'reply-3' }),
      message: { ...message, id: 'reply-3' },
      onToggleFavorite: jest.fn(async () => ({ favorited: false, favoriteKey: null })),
    });
    const unscopedView = render(<ThreadMessageActionsOverlay {...unscoped} />);
    layoutOverlay(unscopedView);
    fireEvent.press(unscopedView.getByTestId('thread-message-favorite'));
    await act(async () => { await Promise.resolve(); });
    // Nothing was recorded, so the overlay closes without claiming a favorite.
    expect(unscoped.onClosed).toHaveBeenCalledTimes(1);
    expect(unscopedView.queryByText('Favorited')).toBeNull();

    const failing = createProps({
      selection: createSelection({ messageId: 'reply-4' }),
      message: { ...message, id: 'reply-4' },
      onToggleFavorite: jest.fn(async () => { throw new Error('storage'); }),
    });
    const failingView = render(<ThreadMessageActionsOverlay {...failing} />);
    layoutOverlay(failingView);
    fireEvent.press(failingView.getByTestId('thread-message-favorite'));
    await act(async () => { await Promise.resolve(); });
    expect(failing.onClosed).toHaveBeenCalledTimes(1);
  });

  it('hands share off only after the overlay has closed', () => {
    jest.useFakeTimers();
    const props = createProps();
    const view = render(<ThreadMessageActionsOverlay {...props} />);
    layoutOverlay(view);
    fireEvent.press(view.getByTestId('thread-message-share'));
    expect(props.onClosed).toHaveBeenCalledTimes(1);
    expect(props.onShare).not.toHaveBeenCalled();
    act(() => { jest.advanceTimersByTime(Motion.duration.fast); });
    expect(props.onShare).toHaveBeenCalledWith(message);
    const onClosed = props.onClosed as jest.Mock;
    const onShare = props.onShare as jest.Mock;
    expect(onClosed.mock.invocationCallOrder[0]).toBeLessThan(onShare.mock.invocationCallOrder[0]);
  });

  it('returns the clone to the freshly measured row when the scrim is tapped', () => {
    const moved = { x: 0, y: 420, width: 393, height: 160 };
    const remeasure = jest.fn((callback) => callback(moved));
    const props = createProps({ selection: createSelection({ remeasure }) });
    const view = render(<ThreadMessageActionsOverlay {...props} />);
    layoutOverlay(view, 120);
    fireEvent.press(view.getByTestId('thread-message-actions-scrim'));
    expect(remeasure).toHaveBeenCalledTimes(1);
    // Event handlers drive shared values without a React render; refresh the mocked styles.
    view.rerender(<ThreadMessageActionsOverlay {...props} />);
    const clone = flattenStyle(view.getByTestId('thread-message-actions-message').props.style);
    expect(clone).toMatchObject({ top: 420 + 160 - 120, height: 120, opacity: 1 });
    expect(flattenStyle(view.getByTestId('thread-message-actions-menu').props.style).opacity).toBe(0);
    expect(props.onClosed).toHaveBeenCalledTimes(1);
    // Repeated close requests are ignored while closing.
    fireEvent.press(view.getByTestId('thread-message-actions-scrim'));
    expect(remeasure).toHaveBeenCalledTimes(1);
  });

  it('fades out in place when the row is gone, off screen, or the clone was scroll-compensated', () => {
    const gone = createProps({ selection: createSelection({ remeasure: jest.fn((callback) => callback(null)) }) });
    const goneView = render(<ThreadMessageActionsOverlay {...gone} />);
    layoutOverlay(goneView, 120);
    fireEvent.press(goneView.getByTestId('thread-message-actions-scrim'));
    goneView.rerender(<ThreadMessageActionsOverlay {...gone} />);
    expect(flattenStyle(goneView.getByTestId('thread-message-actions-message').props.style).opacity).toBe(0);
    expect(gone.onClosed).toHaveBeenCalledTimes(1);

    const offscreen = createProps({ selection: createSelection({ remeasure: jest.fn((callback) => callback({ x: 0, y: 900, width: 393, height: 160 })) }) });
    const offscreenView = render(<ThreadMessageActionsOverlay {...offscreen} />);
    layoutOverlay(offscreenView, 120);
    fireEvent.press(offscreenView.getByTestId('thread-message-actions-scrim'));
    offscreenView.rerender(<ThreadMessageActionsOverlay {...offscreen} />);
    expect(flattenStyle(offscreenView.getByTestId('thread-message-actions-message').props.style).opacity).toBe(0);

    const tall = createProps({ selection: createSelection({ anchor: { x: 0, y: -300, width: 393, height: 800 } }) });
    const tallView = render(<ThreadMessageActionsOverlay {...tall} />);
    layoutOverlay(tallView, 800);
    fireEvent.press(tallView.getByTestId('thread-message-actions-scrim'));
    tallView.rerender(<ThreadMessageActionsOverlay {...tall} />);
    expect(flattenStyle(tallView.getByTestId('thread-message-actions-message').props.style).opacity).toBe(0);
    expect(tall.onClosed).toHaveBeenCalledTimes(1);
  });

  it('still closes when a re-measurement never calls back', () => {
    jest.useFakeTimers();
    const props = createProps({ selection: createSelection({ remeasure: jest.fn() }) });
    const view = render(<ThreadMessageActionsOverlay {...props} />);
    layoutOverlay(view);
    fireEvent.press(view.getByTestId('thread-message-actions-scrim'));
    expect(props.onClosed).not.toHaveBeenCalled();
    act(() => { jest.advanceTimersByTime(Motion.duration.fast); });
    expect(props.onClosed).toHaveBeenCalledTimes(1);
  });

  it('disables copy and share for a message without text and closes when the message disappears', () => {
    const imageOnly: UiMessage = { id: 'image-1', role: 'user', imageUris: ['file://a.jpg'], text: '' };
    const props = createProps({ message: imageOnly, selection: createSelection({ messageId: imageOnly.id, role: 'user' }) });
    const view = render(<ThreadMessageActionsOverlay {...props} />);
    layoutOverlay(view);
    expect(view.getByTestId('thread-message-copy').props.disabled).toBe(true);
    expect(view.getByTestId('thread-message-share').props.disabled).toBe(true);
    expect(view.getByTestId('thread-message-favorite').props.disabled).toBe(false);
    fireEvent.press(view.getByTestId('thread-message-copy'));
    expect(props.onCopy).not.toHaveBeenCalled();

    view.rerender(<ThreadMessageActionsOverlay {...props} message={null} />);
    expect(props.onClosed).toHaveBeenCalledTimes(1);
    expect(view.queryByTestId('thread-message-actions')).toBeNull();
  });

  it('removes positional motion from the menu under reduced motion', () => {
    mockReducedMotion = true;
    const view = render(<ThreadMessageActionsOverlay {...createProps()} />);
    layoutOverlay(view);
    const menuStyle = flattenStyle(view.getByTestId('thread-message-actions-menu').props.style);
    expect(menuStyle.transform).toEqual([]);
    expect(menuStyle.opacity).toBe(1);
  });
});

describe('ThreadMessageActionsOverlay queued messages', () => {
  const queued: UiMessage = { id: 'usr_9_q1', role: 'user', text: 'Later please', delivery: 'queued' };

  function createQueuedProps(overrides: Partial<ThreadMessageActionsOverlayProps> = {}) {
    return createProps({
      message: queued,
      selection: createSelection({ messageId: queued.id, role: 'user' }),
      queuedActions: {
        canSendNow: false,
        editable: true,
        onSendNow: jest.fn(),
        onEdit: jest.fn(),
        onRemove: jest.fn(),
      },
      ...overrides,
    });
  }

  it('offers edit, remove, and copy for a queued message and hides favorite and share', () => {
    const view = render(<ThreadMessageActionsOverlay {...createQueuedProps()} />);
    expect(view.getByText('Edit')).toBeTruthy();
    expect(view.getByText('Remove')).toBeTruthy();
    expect(view.getByText('Copy')).toBeTruthy();
    expect(view.queryByText('Send now')).toBeNull();
    expect(view.queryByText('Favorite')).toBeNull();
    expect(view.queryByText('Share')).toBeNull();
  });

  it('adds Send now while the queue is paused and hands each action off after closing', () => {
    jest.useFakeTimers();
    const props = createQueuedProps();
    const actions = props.queuedActions!;
    const view = render(<ThreadMessageActionsOverlay {...props} queuedActions={{ ...actions, canSendNow: true }} />);
    layoutOverlay(view);
    expect(view.getByText('Send now')).toBeTruthy();

    fireEvent.press(view.getByTestId('thread-message-send-now'));
    expect(triggerSelectionHaptic).toHaveBeenCalled();
    expect(props.onClosed).toHaveBeenCalledTimes(1);
    expect(actions.onSendNow).not.toHaveBeenCalled();
    act(() => { jest.advanceTimersByTime(Motion.duration.fast); });
    expect(actions.onSendNow).toHaveBeenCalledWith(queued);

    const edit = render(<ThreadMessageActionsOverlay {...createQueuedProps({ queuedActions: actions })} />);
    layoutOverlay(edit);
    fireEvent.press(edit.getByTestId('thread-message-edit'));
    act(() => { jest.advanceTimersByTime(Motion.duration.fast); });
    expect(actions.onEdit).toHaveBeenCalledWith(queued);

    const remove = render(<ThreadMessageActionsOverlay {...createQueuedProps({ queuedActions: actions })} />);
    layoutOverlay(remove);
    fireEvent.press(remove.getByTestId('thread-message-remove'));
    act(() => { jest.advanceTimersByTime(Motion.duration.fast); });
    expect(actions.onRemove).toHaveBeenCalledWith(queued);
  });

  it('locks edit and remove while the queued message is already being delivered', () => {
    const props = createQueuedProps();
    const actions = { ...props.queuedActions!, editable: false, canSendNow: false };
    const view = render(<ThreadMessageActionsOverlay {...props}
      message={{ ...queued, delivery: 'sending' }} queuedActions={actions} />);
    layoutOverlay(view);
    expect(view.getByTestId('thread-message-edit').props.accessibilityState).toEqual({ disabled: true });
    expect(view.getByTestId('thread-message-remove').props.accessibilityState).toEqual({ disabled: true });
    fireEvent.press(view.getByTestId('thread-message-edit'));
    fireEvent.press(view.getByTestId('thread-message-remove'));
    expect(actions.onEdit).not.toHaveBeenCalled();
    expect(actions.onRemove).not.toHaveBeenCalled();
    expect(view.getByTestId('thread-message-copy').props.accessibilityState).toEqual({ disabled: false });
  });
});
