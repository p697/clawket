import { act, renderHook } from '@testing-library/react-native';
import * as Clipboard from 'expo-clipboard';
import { useChatMessageSelection } from './useChatMessageSelection';
import { UiMessage } from '../types/chat';
import { Motion } from '../theme/tokens';

jest.mock('expo-clipboard', () => ({
  setStringAsync: jest.fn(() => Promise.resolve()),
}));

jest.mock('react-native', () => ({
  StyleSheet: {
    hairlineWidth: 1,
  },
  Easing: {
    cubic: 'cubic',
    out: (value: string) => `out(${value})`,
  },
  Animated: {
    Value: class {
      value: number;

      constructor(value: number) {
        this.value = value;
      }

      interpolate() {
        return 0;
      }
    },
    timing: jest.fn(() => ({
      start: jest.fn(),
    })),
  },
}));

function createMessage({
  id,
  role,
  ...rest
}: Partial<UiMessage> & Pick<UiMessage, 'id' | 'role'>): UiMessage {
  return {
    id,
    role,
    text: '',
    streaming: false,
    ...rest,
  };
}

const frames = {
  rowFrame: { x: 8, y: 20, width: 300, height: 80 },
  bubbleFrame: { x: 20, y: 30, width: 220, height: 50 },
};

describe('useChatMessageSelection', () => {
  let consoleErrorSpy: jest.SpyInstance;
  const isFavoritedMessage = jest.fn() as jest.MockedFunction<(message: UiMessage) => boolean>;
  const onToggleFavorite = jest.fn(() => Promise.resolve({ favorited: true, favoriteKey: 'favorite-key' }));

  beforeEach(() => {
    jest.useFakeTimers();
    isFavoritedMessage.mockReset();
    isFavoritedMessage.mockReturnValue(false);
    onToggleFavorite.mockClear();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation((message?: unknown) => {
      if (typeof message === 'string' && message.includes('react-test-renderer is deprecated')) {
        return;
      }
    });
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    consoleErrorSpy.mockRestore();
    jest.clearAllMocks();
  });

  it('shows selection overlay when message and frames are both set', () => {
    const { Animated } = require('react-native');
    const m1 = createMessage({ id: 'm1', role: 'assistant', text: 'hello' });
    const { result } = renderHook(() =>
      useChatMessageSelection({
        isFavoritedMessage,
        listData: [m1],
        onToggleFavorite,
      }),
    );

    expect(result.current.selectedMessageVisible).toBe(false);

    act(() => {
      result.current.handleSelectMessage('m1', frames);
    });

    expect(result.current.selectedMessageVisible).toBe(true);
    expect(result.current.selectedMessage?.id).toBe('m1');
    expect(Animated.timing).toHaveBeenLastCalledWith(
      result.current.selectionAnim,
      {
        toValue: 1,
        duration: Motion.duration.normal,
        easing: 'out(cubic)',
        useNativeDriver: true,
      },
    );
  });

  it('copies trimmed message text and resets copied state after delay', async () => {
    const m1 = createMessage({ id: 'm1', role: 'assistant', text: '  hello world  ' });
    const { result } = renderHook(() =>
      useChatMessageSelection({
        isFavoritedMessage,
        listData: [m1],
        onToggleFavorite,
      }),
    );

    act(() => {
      result.current.handleSelectMessage('m1', frames);
    });

    await act(async () => {
      await result.current.copySelectedMessage();
    });

    expect(Clipboard.setStringAsync).toHaveBeenCalledWith('hello world');
    expect(result.current.copiedSelected).toBe(true);

    act(() => {
      jest.advanceTimersByTime(1200);
    });
    expect(result.current.copiedSelected).toBe(false);
  });

  it('clears selection when selected message disappears from list', () => {
    const m1 = createMessage({ id: 'm1', role: 'assistant', text: 'hello' });
    const { result, rerender } = renderHook(
      ({ listData }: { listData: UiMessage[] }) =>
        useChatMessageSelection({
          isFavoritedMessage,
          listData,
          onToggleFavorite,
        }),
      {
        initialProps: { listData: [m1] },
      },
    );

    act(() => {
      result.current.handleSelectMessage('m1', frames);
    });
    expect(result.current.selectedMessageVisible).toBe(true);

    rerender({ listData: [] });
    expect(result.current.selectedMessageVisible).toBe(false);
    expect(result.current.selectedMessage).toBe(null);
  });

  it('reflects and toggles favorite state for the selected message', async () => {
    const m1 = createMessage({ id: 'm1', role: 'assistant', text: 'hello' });
    isFavoritedMessage.mockImplementation((message: UiMessage) => message.id === 'm1');
    const { result } = renderHook(() =>
      useChatMessageSelection({
        isFavoritedMessage,
        listData: [m1],
        onToggleFavorite,
      }),
    );

    act(() => {
      result.current.handleSelectMessage('m1', frames);
    });

    expect(result.current.selectedMessageFavorited).toBe(true);

    await act(async () => {
      await result.current.toggleSelectedMessageFavorite();
    });

    expect(onToggleFavorite).toHaveBeenCalledWith(m1);
  });
});
