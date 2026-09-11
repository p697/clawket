import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useAppTheme } from '../../theme';
import { FontSize, LineHeight, Space } from '../../theme/tokens';
import { AgentAvatar } from '../ui/AgentAvatar';

export type ChatMessageIdentityProps = {
  agentId: string;
  name: string;
  emoji?: string | null;
  avatarUrl?: string | null;
  /** Off by default: the header already carries the Agent's identity. */
  showAvatar?: boolean;
};

/** Optional signature above a reply: avatar and name only, never the model. */
export function ChatMessageIdentity({ agentId, name, emoji, avatarUrl, showAvatar = false }: ChatMessageIdentityProps) {
  const { theme: { colors } } = useAppTheme();
  if (!showAvatar) return null;
  return <View style={styles.row}>
    <AgentAvatar agentId={agentId} name={name} emoji={emoji} avatarUrl={avatarUrl} variant="header" />
    <Text numberOfLines={1} style={[styles.name, { color: colors.inkSecondary }]}>{name}</Text>
  </View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, marginBottom: Space.sm },
  name: { flexShrink: 1, fontSize: FontSize.caption, lineHeight: LineHeight.caption },
});
