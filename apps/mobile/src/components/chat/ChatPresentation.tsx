import React, { createContext, useContext, useMemo } from 'react';
import { FontSize } from '../../theme/tokens';
import { useAppTheme } from '../../theme';
import { buildTheme, resolveChatTheme } from '../../theme/theme';
import { resolveAccentScale } from '../../theme/accents';
import { DEFAULT_CHAT_APPEARANCE } from '../../features/chat-appearance/defaults';
import type { ChatMessageIdentityProps } from './ChatMessageIdentity';
import type { AccentColorId, ChatAppearanceSettings } from '../../types';

type ChatPresentation = {
  identity?: ChatMessageIdentityProps;
  appearance: ChatAppearanceSettings;
  fontSize: number;
  /** BCP 47 tag for bubble clock labels; omitted in the editor preview. */
  locale?: string;
  /** A local editor draft; omitted in real conversations. */
  accentId?: AccentColorId;
};

const PresentationContext = createContext<ChatPresentation>({
  appearance: DEFAULT_CHAT_APPEARANCE,
  fontSize: FontSize.body,
});

export const ChatPresentationProvider = PresentationContext.Provider;
export function useChatPresentation() { return useContext(PresentationContext); }

/** Both the editor preview and real messages use the same saved/draft palette. */
export function useConversationTheme() {
  const { theme } = useAppTheme();
  const { accentId } = useChatPresentation();
  return useMemo(() => accentId
    ? buildTheme(theme.mode, theme.scheme, resolveAccentScale(accentId))
    : resolveChatTheme(theme), [accentId, theme]);
}
