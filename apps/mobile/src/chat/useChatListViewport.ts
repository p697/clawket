import { RefObject, useCallback, useEffect, useRef, useState } from 'react';

type ScrollTarget = {
  scrollToOffset?: (params: { offset: number; animated: boolean }) => void;
};

type Props = {
  flatListRef: RefObject<ScrollTarget | null>;
  isSending: boolean;
  listLength: number;
  onSingleMessageAppend?: () => void;
  streamingText: string | null;
};

export function useChatListViewport({
  flatListRef,
  isSending,
  listLength,
  onSingleMessageAppend,
  streamingText,
}: Props) {
  const snapBottomTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const snapBottomRafRef = useRef<number | null>(null);
  const isAtBottomRef = useRef(true);
  const isScrollingRef = useRef(false);
  const [showScrollButton, setShowScrollButton] = useState(false);

  const clearScheduledBottomSnap = useCallback(() => {
    if (snapBottomTimerRef.current) {
      clearTimeout(snapBottomTimerRef.current);
      snapBottomTimerRef.current = null;
    }
    if (snapBottomRafRef.current !== null) {
      cancelAnimationFrame(snapBottomRafRef.current);
      snapBottomRafRef.current = null;
    }
  }, []);

  const scheduleBottomSnap = useCallback((options?: { animated?: boolean; settle?: boolean }) => {
    clearScheduledBottomSnap();

    const animated = options?.animated === true;
    const perform = () => {
      flatListRef.current?.scrollToOffset?.({ offset: 0, animated });
    };

    perform();

    if (options?.settle === false) {
      return;
    }

    snapBottomRafRef.current = requestAnimationFrame(() => {
      perform();
      snapBottomRafRef.current = requestAnimationFrame(() => {
        perform();
        snapBottomRafRef.current = null;
      });
    });

    snapBottomTimerRef.current = setTimeout(() => {
      perform();
      snapBottomTimerRef.current = null;
    }, 96);
  }, [clearScheduledBottomSnap, flatListRef]);

  const onScrollToBottom = useCallback(() => {
    scheduleBottomSnap({ animated: true });
    isAtBottomRef.current = true;
    setShowScrollButton(false);
  }, [scheduleBottomSnap]);

  const onScrollStateChange = useCallback((atBottom: boolean) => {
    isAtBottomRef.current = atBottom;
    setShowScrollButton(!atBottom);
  }, []);

  const onScrollBeginDrag = useCallback(() => {
    isScrollingRef.current = true;
  }, []);

  const onScrollEndDrag = useCallback(() => {
    isScrollingRef.current = false;
  }, []);

  const prevIsSendingRef = useRef(isSending);
  useEffect(() => {
    const wasIdle = !prevIsSendingRef.current;
    prevIsSendingRef.current = isSending;
    if (isSending && wasIdle) {
      isAtBottomRef.current = true;
      setShowScrollButton(false);
      scheduleBottomSnap();
    }
  }, [isSending, scheduleBottomSnap]);

  const prevListLenRef = useRef(listLength);
  useEffect(() => {
    const prevLen = prevListLenRef.current;
    prevListLenRef.current = listLength;
    if (listLength <= prevLen) return;

    const appendedCount = listLength - prevLen;
    const shouldAnimateAppend = appendedCount === 1 && prevLen > 0;
    if (shouldAnimateAppend) {
      onSingleMessageAppend?.();
    }
    if (isAtBottomRef.current) {
      scheduleBottomSnap();
    }
  }, [listLength, onSingleMessageAppend, scheduleBottomSnap]);

  const prevStreamingTextRef = useRef<string | null>(null);
  useEffect(() => {
    const prev = prevStreamingTextRef.current;
    prevStreamingTextRef.current = streamingText;
    if (streamingText !== null && streamingText !== prev && isAtBottomRef.current && !isScrollingRef.current) {
      scheduleBottomSnap({ settle: false });
    }
  }, [scheduleBottomSnap, streamingText]);

  const onListContentSizeChange = useCallback(() => {
    if (!isAtBottomRef.current || isScrollingRef.current) return;
    scheduleBottomSnap();
  }, [scheduleBottomSnap]);

  useEffect(() => {
    return () => {
      clearScheduledBottomSnap();
    };
  }, [clearScheduledBottomSnap]);

  return {
    onListContentSizeChange,
    onScrollBeginDrag,
    onScrollEndDrag,
    onScrollStateChange,
    onScrollToBottom,
    showScrollButton,
  };
}
