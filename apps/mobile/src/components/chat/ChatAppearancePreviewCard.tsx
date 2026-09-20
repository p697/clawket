import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '../../theme';
import { ControlSize, FontSize, LineHeight, Radius, Space } from '../../theme/tokens';
import type { AccentColorId, ChatAppearanceSettings } from '../../types';
import { Bubble } from '../ui/Bubble';
import { ChatPresentationProvider } from './ChatPresentation';
import { ChatMessageIdentity } from './ChatMessageIdentity';
import { ChatBackgroundLayer } from './ChatBackgroundLayer';
import { createChatGlassStyle, isChatWallpaperActive } from '../../features/chat-appearance/resolver';

export type ChatAppearancePreviewAgent = Readonly<{
  agentId: string;
  name: string;
  emoji?: string | null;
  avatarUrl?: string | null;
}>;

type Props = {
  accentId?: AccentColorId;
  /** The person's own Agent, so the signature previews the avatar they will actually see. */
  agent?: ChatAppearancePreviewAgent | null;
  appearance: ChatAppearanceSettings;
  backgroundImageUri?: string | null;
  chatFontSize: number;
  showAgentAvatar: boolean;
};

/** Uses the same surfaces, type, identity, and wallpaper as the real thread. */
export function ChatAppearancePreviewCard({ accentId, agent, appearance, backgroundImageUri, chatFontSize, showAgentAvatar }: Props) {
  const { t } = useTranslation(['config', 'chat']);
  const { theme } = useAppTheme();
  const { colors } = theme;
  const presentation = useMemo(() => ({ appearance, fontSize: chatFontSize, accentId }), [accentId, appearance, chatFontSize]);
  // The preview composer wears the same glass the real one does over a wallpaper.
  const composerChrome = useMemo(() => (
    isChatWallpaperActive(appearance, backgroundImageUri) ? createChatGlassStyle(theme) : { backgroundColor: colors.surface }
  ), [appearance, backgroundImageUri, colors.surface, theme]);
  return <ChatPresentationProvider value={presentation}>
    <View style={[styles.preview, { backgroundColor: colors.canvas }]}>
      <ChatBackgroundLayer appearance={appearance} imageUri={backgroundImageUri} />
      <View>
        <ChatMessageIdentity
          agentId={agent?.agentId ?? 'preview'}
          name={agent?.name ?? t('chat:Assistant')}
          emoji={agent?.emoji}
          avatarUrl={agent?.avatarUrl}
          showAvatar={showAgentAvatar}
        />
        <Bubble role="assistant">{t('Clear words. Calm surfaces. Familiar controls.')}</Bubble>
      </View>
      <Bubble role="user">{t('Looks good. Keep it clean and easy to read.')}</Bubble>
      <View testID="chat-appearance-preview-composer" style={[styles.composer, composerChrome]}>
        <Text style={[styles.placeholder, { color: colors.inkTertiary }]}>{t('chat:Message...')}</Text>
      </View>
    </View>
  </ChatPresentationProvider>;
}

const styles = StyleSheet.create({
  preview: { padding: Space.lg, gap: Space.lg, borderRadius: Radius.card, overflow: 'hidden' },
  composer: { minHeight: ControlSize.floatingButton, paddingHorizontal: Space.lg, justifyContent: 'center', borderRadius: Radius.bubble },
  placeholder: { fontSize: FontSize.secondary, lineHeight: LineHeight.secondary },
});
