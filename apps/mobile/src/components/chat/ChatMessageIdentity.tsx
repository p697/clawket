import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useConversationTheme } from './ChatPresentation';
import { FontSize, FontWeight, LineHeight, Radius, Space } from '../../theme/tokens';
import { AgentAvatar } from '../ui/AgentAvatar';

export type ChatMessageIdentityProps = {
  agentId: string;
  name: string;
  emoji?: string | null;
  avatarUrl?: string | null;
  /** Off by default: the header already carries the Agent's identity. */
  showAvatar?: boolean;
  /** Explicit role in conversations shared with external participants. */
  showRoleLabel?: boolean;
};

/** Optional signature above a reply: avatar/name and an explicit Agent role in participant conversations, never the model. */
export function ChatMessageIdentity({ agentId, name, emoji, avatarUrl, showAvatar = false, showRoleLabel = false }: ChatMessageIdentityProps) {
  const { colors } = useConversationTheme();
  const { t } = useTranslation('common');
  if (!showAvatar) return null;
  return <View style={styles.row}>
    <AgentAvatar agentId={agentId} name={name} emoji={emoji} avatarUrl={avatarUrl} variant="header" />
    <Text numberOfLines={1} style={[styles.name, { color: showRoleLabel ? colors.ink : colors.inkSecondary },
      showRoleLabel && { fontWeight: FontWeight.semibold }]}>{name}</Text>
    {showRoleLabel ? <View testID="chat-agent-role" style={[styles.badge, { backgroundColor: colors.accentSoft }]}>
      <Text style={[styles.badgeText, { color: colors.ink }]}>{t('Agent')}</Text>
    </View> : null}
  </View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, marginBottom: Space.sm },
  badge: { flexShrink: 0, paddingHorizontal: Space.sm, borderRadius: Radius.full },
  badgeText: { fontSize: FontSize.caption, lineHeight: LineHeight.caption, fontWeight: FontWeight.semibold },
  name: { flexShrink: 1, fontSize: FontSize.caption, lineHeight: LineHeight.caption },
});
