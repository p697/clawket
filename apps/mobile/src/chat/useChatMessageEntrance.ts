import { useEffect, useMemo, useRef } from 'react';
import { Animated } from 'react-native';
import { UiMessage } from '../types/chat';

type Props = {
  listData: UiMessage[];
};

export function useChatMessageEntrance({ listData }: Props) {
  const listFadeAnim = useRef(new Animated.Value(listData.length > 0 ? 1 : 0)).current;
  const listFadeTriggeredRef = useRef(listData.length > 0);

  useEffect(() => {
    if (!listFadeTriggeredRef.current && listData.length > 0) {
      listFadeTriggeredRef.current = true;
      Animated.timing(listFadeAnim, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }).start();
    }
  }, [listData.length, listFadeAnim]);

  const knownTailIdRef = useRef<string | null>(null);
  const readyForNewAnimRef = useRef(false);
  const wasStreamingRef = useRef(false);

  const newMessageIds = useMemo(() => {
    const ids = new Set<string>();
    if (!readyForNewAnimRef.current) return ids;

    const tailId = knownTailIdRef.current;
    if (!tailId) return ids;

    const tailIdx = listData.findIndex((message) => message.id === tailId);
    if (tailIdx < 0) return ids;

    for (let i = 0; i < tailIdx; i++) {
      const message = listData[i];
      if (wasStreamingRef.current && message.role === 'assistant' && !message.streaming) continue;
      ids.add(message.id);
    }

    return ids;
  }, [listData]);

  useEffect(() => {
    if (listData.length === 0) return;

    if (!readyForNewAnimRef.current && listFadeTriggeredRef.current) {
      readyForNewAnimRef.current = true;
    }

    wasStreamingRef.current = listData.some((message) => message.streaming);
    const newest = listData.find((message) => !message.streaming);
    if (newest) {
      knownTailIdRef.current = newest.id;
    }
  }, [listData]);

  return {
    listFadeAnim,
    newMessageIds,
  };
}
