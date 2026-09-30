import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Check, CheckCheck, Clock, CircleAlert, Pause } from 'lucide-react-native';
import { FontSize, FontWeight, LineHeight, Space } from '../../theme/tokens';
import type { UserMessageStatus } from '../../chat/messageDelivery';
import { useChatSurfaces, useConversationTheme } from './ChatPresentation';

/** Glyph size that sits on the meta baseline without outweighing the time. */
export const MESSAGE_META_ICON_SIZE = 14;
/** Matches the 1.75 chrome stroke so the glyph weighs the same as the meta digits. */
const MESSAGE_META_STROKE_WIDTH = 1.75;

export type MessageMetaProps = Readonly<{
  time: string;
  /** `accent` on the user's solid bubble; `neutral` on the Agent's bubble and elsewhere. */
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
 * it up. Time and glyph share one color: the bubble's own white, softened, on
 * the user's solid accent; a quiet secondary ink on the Agent's bubble. An
 * uncertain send keeps the bubble's meta color on the accent (the warn hue
 * would vanish on it) and borrows the semantic warn tone everywhere else.
 */
export function MessageMeta({ time, tone = 'neutral', status, statusLabel, style, testID }: MessageMetaProps): React.JSX.Element {
  const { colors } = useConversationTheme();
  const surfaces = useChatSurfaces();
  const metaColor = tone === 'accent' ? surfaces.outgoing.metaColor : surfaces.incoming.metaColor;
  const Icon = status === 'delivered' ? CheckCheck : status === 'sent' ? Check
    : status === 'sending' || status === 'queued' ? Clock : status === 'held' ? Pause
      : status === 'uncertain' ? CircleAlert : null;
  const iconColor = status === 'uncertain' && tone !== 'accent' ? colors.warn : metaColor;
  return (
    <View testID={testID} style={[styles.row, style]} pointerEvents="none">
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
  // Reserve one indivisible run. Breakable/trailing en spaces let iOS trim
  // the status slot, leaving the overlaid check marks on top of the body.
  // Figure spaces use the same tabular-digit width as the visible clock.
  // Android selectable text can inherit the parent's ink for transparent spans.
  // Reserve glyph widths with spaces so a second clock can never be painted.
  const clockSpace = [...time].map((character) => character === ':' ? '\u2008' : '\u2007').join('');
  const reservation = `\u2007${clockSpace}${hasStatus ? '\u2007\u2007\u2007' : ''}`;
  return ` ${[...reservation].join('\u2060')}`;
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
  },
  time: {
    fontSize: FontSize.meta,
    lineHeight: LineHeight.meta,
    fontWeight: FontWeight.regular,
    fontVariant: ['tabular-nums'],
  },
  glyph: {
    width: MESSAGE_META_ICON_SIZE,
    height: LineHeight.meta,
    justifyContent: 'center',
  },
});
