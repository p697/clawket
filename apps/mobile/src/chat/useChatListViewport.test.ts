import { act, renderHook } from '@testing-library/react-native';
import { createRef } from 'react';
import { useChatListViewport } from './useChatListViewport';

describe('useChatListViewport', () => {
  const originalRaf = global.requestAnimationFrame;
  const originalCancelRaf = global.cancelAnimationFrame;
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation((message?: unknown) => {
      if (typeof message === 'string' && message.includes('react-test-renderer is deprecated')) {
        return;
      }
    });
    jest.useFakeTimers();
    global.requestAnimationFrame = ((cb: FrameRequestCallback) =>
      setTimeout(() => cb(0), 0) as unknown as number);
    global.cancelAnimationFrame = ((id: number) =>
      clearTimeout(id as unknown as ReturnType<typeof setTimeout>));
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    global.requestAnimationFrame = originalRaf;
    global.cancelAnimationFrame = originalCancelRaf;
    consoleErrorSpy.mockRestore();
  });

  it('toggles scroll button visibility based on list position', () => {
    const flatListRef = createRef<{ scrollToOffset: jest.Mock } | null>();
    flatListRef.current = { scrollToOffset: jest.fn() };
    const { result } = renderHook(() =>
      useChatListViewport({
        flatListRef,
        isSending: false,
        listLength: 1,
        streamingText: null,
      }),
    );

    act(() => {
      result.current.onScrollStateChange(false);
    });
    expect(result.current.showScrollButton).toBe(true);

    act(() => {
      result.current.onScrollStateChange(true);
    });
    expect(result.current.showScrollButton).toBe(false);
  });

  it('auto snaps to bottom when sending starts from idle', () => {
    const scrollToOffset = jest.fn();
    const flatListRef = createRef<{ scrollToOffset: jest.Mock } | null>();
    flatListRef.current = { scrollToOffset };
    const { result, rerender } = renderHook(
      ({ isSending }: { isSending: boolean }) =>
        useChatListViewport({
          flatListRef,
          isSending,
          listLength: 1,
          streamingText: null,
        }),
      {
        initialProps: { isSending: false },
      },
    );

    act(() => {
      result.current.onScrollStateChange(false);
    });
    expect(result.current.showScrollButton).toBe(true);

    rerender({ isSending: true });

    expect(scrollToOffset).toHaveBeenCalledWith({ offset: 0, animated: false });
    expect(result.current.showScrollButton).toBe(false);
  });

  it('fires single-append callback only when one message is appended', () => {
    const scrollToOffset = jest.fn();
    const onSingleMessageAppend = jest.fn();
    const flatListRef = createRef<{ scrollToOffset: jest.Mock } | null>();
    flatListRef.current = { scrollToOffset };
    const { rerender } = renderHook(
      ({ listLength }: { listLength: number }) =>
        useChatListViewport({
          flatListRef,
          isSending: false,
          listLength,
          onSingleMessageAppend,
          streamingText: null,
        }),
      {
        initialProps: { listLength: 2 },
      },
    );

    rerender({ listLength: 3 });
    expect(onSingleMessageAppend).toHaveBeenCalledTimes(1);

    rerender({ listLength: 5 });
    expect(onSingleMessageAppend).toHaveBeenCalledTimes(1);
    expect(scrollToOffset).toHaveBeenCalled();
  });
});
