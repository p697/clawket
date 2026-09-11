import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Check, CheckCheck, Clock, CircleAlert } from 'lucide-react-native';
import { FontSize, FontWeight, LineHeight, Space } from '../../theme/tokens';
import type { UserMessageStatus } from '../../chat/messageDelivery';
import { useConversationTheme } from './ChatPresentation';

/** Glyph size that sits on the caption baseline without outweighing the time. */
export const MESSAGE_META_ICON_SIZE = 14;
/** Matches the 1.75 chrome stroke so the glyph weighs the same as the caption digits. */
const MESSAGE_META_STROKE_WIDTH = 1.75;

/**
 * Inside the tinted user bubble the meta is the bubble's own hue, softened:
 * accent at this opacity over `accentSoft` lands on a mid tone that belongs to
 * the surface (Telegram's outgoing ticks), never the full accent.
 */
const ACCENT_META_OPACITY = 0.62;

export type MessageMetaProps = Readonly<{
  time: string;
  /** `accent` inside the user's tinted bubble; `neutral` (tertiary ink) elsewhere. */
  tone?: 'accent' | 'neutral';
  status?: UserMessageStatus | null;
  /** Spoken form of the status glyph. */
  statusLabel?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}>;

/**
 * Telegram-style trailing meta: the clock time plus, for the user's own
 * messages, a delivery glyph. A clock while the prompt is in flight, one
 * check when the backend accepted it and two checks once the Agent has picked
 * it up. Time and glyph share one color: the softened accent inside the user's
 * tinted bubble, the tertiary ink elsewhere. Only an uncertain send borrows
 * the semantic warn tone.
 */
export function MessageMeta({ time, tone = 'neutral', status, statusLabel, style, testID }: MessageMetaProps): React.JSX.Element {
  const { colors } = useConversationTheme();
  const metaColor = tone === 'accent' ? colors.accent : colors.inkTertiary;
  const Icon = status === 'delivered' ? CheckCheck : status === 'sent' ? Check : status === 'sending' ? Clock : status === 'uncertain' ? CircleAlert : null;
  const iconColor = status === 'uncertain' ? colors.warn : metaColor;
  return (
    <View testID={testID} style={[styles.row, tone === 'accent' ? styles.accentTone : null, style]} pointerEvents="none">
      {time ? <Text style={[styles.time, { color: metaColor }]} numberOfLines={1}>{time}</Text> : null}
      {Icon ? (
        <View
          testID={testID ? `${testID}-status` : undefined}
          accessibilityLabel={statusLabel}
          accessible={Boolean(statusLabel)}
          style={styles.glyph}
        >
          <Icon size={MESSAGE_META_ICON_SIZE} color={iconColor} strokeWidth={MESSAGE_META_STROKE_WIDTH} />
        </View>
      ) : null}
    </View>
  );
}

/**
 * Invisible tail appended to the last text line so the overlaid meta never
 * covers glyphs; it wraps to a fresh line exactly when the meta would.
 */
export function messageMetaSpacer(time: string, hasStatus: boolean): string {
  // En spaces keep a fixed half-em width in every font: two lead the time, and
  // three cover the 14-point glyph plus its 4-point gap at caption size.
  const lead = '\u2002\u2002';
  const glyphSlot = hasStatus ? '\u2002\u2002\u2002' : '';
  return `${lead}${time}${glyphSlot}`;
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
  },
  accentTone: {
    opacity: ACCENT_META_OPACITY,
  },
  time: {
    fontSize: FontSize.caption,
    lineHeight: LineHeight.caption,
    fontWeight: FontWeight.regular,
    fontVariant: ['tabular-nums'],
  },
  glyph: {
    height: LineHeight.caption,
    justifyContent: 'center',
  },
});
