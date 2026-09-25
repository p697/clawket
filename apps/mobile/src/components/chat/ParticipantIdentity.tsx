import React, { useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import type { MessageAttribution } from '@clawket/agent-protocol';
import { useTranslation } from 'react-i18next';
import { messageChannelName, messageParticipantKey, messageSenderLabel, publicAvatarUrl } from '../../chat/messageAttribution';
import { builtInAccents } from '../../theme/accents';
import { useConversationTheme } from './ChatPresentation';
import { ControlSize, FontSize, FontWeight, LineHeight, Radius, Space } from '../../theme/tokens';

// Fixed ordering makes a person's color stable across refreshes and display-name changes.
const PARTICIPANT_ACCENTS = ['iceBlue', 'jadeGreen', 'oceanTeal', 'sunsetOrange', 'rosePink', 'royalPurple'] as const;
export function participantAvatarColors(attribution: MessageAttribution, scheme: 'light' | 'dark') {
  let hash = 2166136261;
  for (const char of messageParticipantKey(attribution)) {
    hash = Math.imul(hash ^ char.codePointAt(0)!, 16777619);
  }
  const scale = builtInAccents[PARTICIPANT_ACCENTS[(hash >>> 0) % PARTICIPANT_ACCENTS.length]][scheme];
  return { backgroundColor: scale.accent100, color: scale.accent700 };
}

/** A participant is not an Agent. Failed/missing photos always retain a legible initial. */
export function ParticipantIdentity({ attribution, testID }: {
  attribution: MessageAttribution;
  testID?: string;
}): React.JSX.Element {
  const theme = useConversationTheme();
  const { t } = useTranslation('chat');
  const [failedUrl, setFailedUrl] = useState<string>();
  const channel = messageChannelName(attribution.channel);
  const sender = attribution.sender;
  const known = !!(sender?.name || sender?.username || sender?.id);
  const name = known ? messageSenderLabel(attribution) : t('{{channel}} member', { channel });
  const url = publicAvatarUrl(sender?.avatarUrl);
  const palette = participantAvatarColors(attribution, theme.scheme);
  return <View testID={testID} style={styles.row}>
    <View accessible={false} style={[styles.avatar, { backgroundColor: palette.backgroundColor }]}>
      <Text style={[styles.initial, { color: palette.color }]}>{Array.from(name)[0]?.toUpperCase() || '?'}</Text>
      {url && failedUrl !== url ? <Image key={url} source={{ uri: url }} style={styles.image}
        onError={() => setFailedUrl(url)} /> : null}
    </View>
    <Text selectable numberOfLines={2} accessibilityLabel={[name, channel, sender?.id].filter(Boolean).join(' · ')}
      style={[styles.name, { color: theme.colors.ink }]}>
      {name}{known ? <Text style={{ color: theme.colors.inkTertiary }}>{` · ${channel}`}</Text> : null}
    </Text>
  </View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, marginBottom: Space.sm },
  avatar: { width: ControlSize.pill - Space.md, height: ControlSize.pill - Space.md,
    borderRadius: Radius.full, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  image: { ...StyleSheet.absoluteFill, width: '100%', height: '100%' },
  initial: { fontSize: FontSize.caption, lineHeight: LineHeight.caption, fontWeight: FontWeight.semibold },
  name: { flexShrink: 1, fontSize: FontSize.caption, lineHeight: LineHeight.caption, fontWeight: FontWeight.semibold },
});
