import React, { useMemo } from 'react';
import {
  StyleProp,
  StyleSheet,
  Text,
  TextStyle,
  View,
  ViewStyle,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useChatPresentation, useChatSurfaces, useConversationTheme } from '../chat/ChatPresentation';
import { parseColor } from '../../theme/color';
import {
  FontSize,
  FontWeight,
  LineHeight,
  Radius,
  Space,
  Shadow,
  createThemedShadowStyle,
} from '../../theme/tokens';

export type BubbleRole = 'assistant' | 'user';

export type BubbleProps = {
  role: BubbleRole;
  children: React.ReactNode;
  selectable?: boolean;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  testID?: string;
  /** The row above is a bubble from the same speaker: the hanging-side top corner joins it. */
  joinsOlder?: boolean;
  /**
   * Something from the same speaker follows directly (the next bubble, or this
   * message's own photos): the hanging-side bottom corner joins it and the
   * tail waits for the last bubble of the group.
   */
  joinsNewer?: boolean;
};

/** Tail geometry in points, Telegram style: it grows from the bubble's bottom edge on the speaker's side. */
export const BUBBLE_TAIL_WIDTH = 6;
export const BUBBLE_TAIL_HEIGHT = 14;
// Each path's straight edge is the bubble edge; an opaque bubble lets the tail
// tuck one point under it so no hairline seam can show at fractional layouts.
const INCOMING_TAIL = 'M7 5V14H1C3.5 12.5 5.5 9.5 6 5Z';
const INCOMING_TAIL_FLUSH = 'M6 5V14H1C3.5 12.5 5.5 9.5 6 5Z';
const OUTGOING_TAIL = 'M0 5V14H6C3.5 12.5 1.5 9.5 1 5Z';
const OUTGOING_TAIL_FLUSH = 'M0 5V14H5C2.5 12.5 0.5 9.5 0 5Z';

/**
 * Message typography for anything rendered inside a bubble: the saved text
 * size with the body leading, in the color drawn on that speaker's bubble
 * (ink on the Agent's, white on the user's solid accent).
 */
export function useBubbleTypography(role: BubbleRole = 'assistant'): TextStyle {
  const surfaces = useChatSurfaces();
  const { fontSize } = useChatPresentation();
  const color = role === 'user' ? surfaces.outgoing.textColor : surfaces.incoming.textColor;
  return useMemo(() => ({
    color,
    fontSize,
    lineHeight: fontSize === FontSize.body ? LineHeight.body : Math.round(fontSize * 1.45),
    fontWeight: FontWeight.regular,
  }), [color, fontSize]);
}

/**
 * The corners of one bubble. The side the speaker hangs from (left for the
 * Agent, right for the user) tightens where the bubble meets its neighbours
 * from the same speaker and squares off under a tail; the far side stays round.
 */
export function resolveBubbleCorners(role: BubbleRole, joinsOlder: boolean, joinsNewer: boolean, tail: boolean): ViewStyle {
  const top = joinsOlder ? Radius.bubbleJoined : Radius.bubble;
  const bottom = tail ? Radius.bubbleTail : joinsNewer ? Radius.bubbleJoined : Radius.bubble;
  return role === 'user'
    ? { borderTopRightRadius: top, borderBottomRightRadius: bottom }
    : { borderTopLeftRadius: top, borderBottomLeftRadius: bottom };
}

/**
 * Canonical 3.0 message surface (A+ chat design, owner decision 2026-09-30):
 * the user's words on the solid accent, the Agent's on white (the saved
 * material decides how translucent), grouped Telegram style with joined
 * corners and a tail on the last bubble of each group. Rich content can be
 * passed as children while plain strings receive the shared message
 * typography automatically. Replies may run nearly edge to edge because they
 * carry paragraphs; the user's own messages stay narrower so the two voices
 * read apart.
 */
export function Bubble({
  role,
  children,
  selectable = true,
  style,
  textStyle,
  testID,
  joinsOlder = false,
  joinsNewer = false,
}: BubbleProps): React.JSX.Element {
  const theme = useConversationTheme();
  const surfaces = useChatSurfaces();
  const typography = useBubbleTypography(role);
  const surface = role === 'user' ? surfaces.outgoing : surfaces.incoming;
  const tail = surface.tail && !joinsNewer;
  const corners = useMemo(() => resolveBubbleCorners(role, joinsOlder, joinsNewer, tail), [joinsNewer, joinsOlder, role, tail]);
  const opaque = (parseColor(surface.backgroundColor)?.a ?? 1) >= 1;
  const tailPath = role === 'user'
    ? opaque ? OUTGOING_TAIL : OUTGOING_TAIL_FLUSH
    : opaque ? INCOMING_TAIL : INCOMING_TAIL_FLUSH;
  const tailWidth = BUBBLE_TAIL_WIDTH + (opaque ? 1 : 0);

  return (
    <View
      testID={testID}
      style={[
        styles.bubble,
        role === 'user' ? styles.user : styles.assistant,
        surface.shadow ? createThemedShadowStyle(theme.colors, theme.scheme, Shadow.sm) : null,
        { backgroundColor: surface.backgroundColor, borderColor: surface.borderColor, borderWidth: surface.borderWidth },
        corners,
        style,
      ]}
    >
      {typeof children === 'string' || typeof children === 'number' ? (
        <Text selectable={selectable} style={[typography, textStyle]}>
          {children}
        </Text>
      ) : children}
      {tail ? (
        <Svg
          testID={testID ? `${testID}-tail` : undefined}
          pointerEvents="none"
          width={tailWidth}
          height={BUBBLE_TAIL_HEIGHT}
          viewBox={`0 0 ${tailWidth} ${BUBBLE_TAIL_HEIGHT}`}
          style={role === 'user' ? [styles.tail, styles.tailOutgoing] : [styles.tail, styles.tailIncoming]}
        >
          <Path d={tailPath} fill={surface.backgroundColor} />
        </Svg>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bubble: {
    borderRadius: Radius.bubble,
    paddingHorizontal: Space.md,
    paddingVertical: Space.sm,
  },
  assistant: {
    alignSelf: 'flex-start',
    maxWidth: '92%',
  },
  user: {
    alignSelf: 'flex-end',
    maxWidth: '82%',
  },
  tail: {
    position: 'absolute',
    bottom: 0,
  },
  tailIncoming: {
    left: -BUBBLE_TAIL_WIDTH,
  },
  tailOutgoing: {
    right: -BUBBLE_TAIL_WIDTH,
  },
});
