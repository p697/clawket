import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { MessageSelectionFrames } from '../components/MessageBubble';
import type { UiMessage } from '../types/chat';
import { Space, SpringPreset } from '../theme/tokens';
import { sanitizeDisplayText, sanitizeUserMessageText } from '../utils/chat-message';

type Props = {
  isFavoritedMessage: (message: UiMessage) => boolean;
  listData: UiMessage[];
  onToggleFavorite: (message: UiMessage) => Promise<{ favorited: boolean; favoriteKey: string | null }>;
};

export function useChatMessageSelection({ isFavoritedMessage, listData, onToggleFavorite }: Props) {
  const selectionAnim = useRef(new Animated.Value(0)).current;
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);
  const [selectedFrames, setSelectedFrames] = useState<MessageSelectionFrames | null>(null);
  const [copiedSelected, setCopiedSelected] = useState(false);
  const copyResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selectedMessage = useMemo(
    () => (selectedMessageId ? listData.find((item) => item.id === selectedMessageId) ?? null : null),
    [listData, selectedMessageId],
  );
  const selectedMessageText = useMemo(
    () => {
      if (!selectedMessage?.text) return '';
      const text = selectedMessage.role === 'assistant'
        ? sanitizeDisplayText(selectedMessage.text)
        : selectedMessage.role === 'user'
          ? sanitizeUserMessageText(selectedMessage.text)
          : selectedMessage.text;
      return text.trim();
    },
    [selectedMessage],
  );
  const hasSelectedMessageText = selectedMessageText.length > 0;
  const selectedMessageFavorited = useMemo(
    () => (selectedMessage ? isFavoritedMessage(selectedMessage) : false),
    [isFavoritedMessage, selectedMessage],
  );

  useEffect(() => {
    return () => {
      if (copyResetTimerRef.current) clearTimeout(copyResetTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const shouldShow = !!selectedMessageId && !!selectedFrames && !!selectedMessage;
    Animated.spring(selectionAnim, {
      toValue: shouldShow ? 1 : 0,
      damping: SpringPreset.sheet.damping,
      stiffness: SpringPreset.sheet.stiffness,
      mass: 0.85,
      useNativeDriver: true,
    }).start();
  }, [selectedFrames, selectedMessage, selectedMessageId, selectionAnim]);

  useEffect(() => {
    if (selectedMessageId && !selectedMessage) {
      setSelectedMessageId(null);
      setSelectedFrames(null);
      setCopiedSelected(false);
    }
  }, [selectedMessage, selectedMessageId]);

  const clearSelection = useCallback(() => {
    setSelectedMessageId(null);
    setSelectedFrames(null);
    setCopiedSelected(false);
  }, []);

  const toggleMessageSelection = useCallback((messageId: string) => {
    setCopiedSelected(false);
    setSelectedMessageId((prev) => {
      if (prev === messageId) {
        setSelectedFrames(null);
        return null;
      }
      return messageId;
    });
  }, []);

  const handleSelectMessage = useCallback((messageId: string, frames: MessageSelectionFrames) => {
    setCopiedSelected(false);
    setSelectedMessageId(messageId);
    setSelectedFrames(frames);
  }, []);

  const copySelectedMessage = useCallback(async () => {
    if (!hasSelectedMessageText) return;
    await Clipboard.setStringAsync(selectedMessageText);
    setCopiedSelected(true);
    if (copyResetTimerRef.current) clearTimeout(copyResetTimerRef.current);
    copyResetTimerRef.current = setTimeout(() => setCopiedSelected(false), 1200);
  }, [hasSelectedMessageText, selectedMessageText]);

  const copyButtonSize = Space.xxxl - 2;

  const toggleSelectedMessageFavorite = useCallback(async () => {
    if (!selectedMessage) return { favorited: false, favoriteKey: null };
    return onToggleFavorite(selectedMessage);
  }, [onToggleFavorite, selectedMessage]);

  return {
    clearSelection,
    copiedSelected,
    copyButtonSize,
    copySelectedMessage,
    handleSelectMessage,
    hasSelectedMessageText,
    selectedFrames,
    selectedMessage,
    selectedMessageFavorited,
    selectedMessageId,
    selectedMessageVisible: !!selectedMessageId && !!selectedFrames && !!selectedMessage,
    selectionAnim,
    toggleSelectedMessageFavorite,
    toggleMessageSelection,
  };
}
