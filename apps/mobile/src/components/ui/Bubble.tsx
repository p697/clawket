import React, { useMemo } from 'react';
import {
  StyleProp,
  StyleSheet,
  Text,
  TextStyle,
  View,
  ViewStyle,
} from 'react-native';
import { useAppTheme } from '../../theme';
import { useChatPresentation, useConversationTheme } from '../chat/ChatPresentation';
import { resolveChatBubbleAppearance } from '../../features/chat-appearance/resolver';
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
};

/**
 * Message typography for anything rendered inside a bubble: the saved text
 * size with the body leading, in the conversation ink.
 */
export function useBubbleTypography(): TextStyle {
  const theme = useConversationTheme();
  const { fontSize } = useChatPresentation();
  return useMemo(() => ({
    color: theme.colors.ink,
    fontSize,
    lineHeight: fontSize === FontSize.body ? LineHeight.body : Math.round(fontSize * 1.45),
    fontWeight: FontWeight.regular,
  }), [fontSize, theme.colors.ink]);
}

/**
 * Canonical 3.0 message surface. Rich content can be passed as children while
 * plain strings receive the shared message typography automatically. Replies
 * may run nearly edge to edge because they carry paragraphs; the user's own
 * messages stay narrower so the two voices read apart.
 */
export function Bubble({
  role,
  children,
  selectable = true,
  style,
  textStyle,
  testID,
}: BubbleProps): React.JSX.Element {
  const theme = useConversationTheme();
  const { appearance } = useChatPresentation();
  const typography = useBubbleTypography();
  const resolved = useMemo(() => resolveChatBubbleAppearance(theme, appearance), [theme, appearance]);
  const surface = role === 'user' ? resolved.userBubble : resolved.assistantBubble;
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);

  return (
    <View
      testID={testID}
      style={[
        styles.bubble,
        role === 'user' ? styles.user : styles.assistant,
        surface.shadow ? createThemedShadowStyle(theme.colors, theme.scheme, Shadow.sm) : null,
        { backgroundColor: surface.backgroundColor, borderColor: surface.borderColor, borderWidth: surface.borderWidth },
        style,
      ]}
    >
      {typeof children === 'string' || typeof children === 'number' ? (
        <Text selectable={selectable} style={[typography, textStyle]}>
          {children}
        </Text>
      ) : children}
    </View>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    bubble: {
      borderRadius: Radius.bubble,
      paddingHorizontal: Space.lg,
      paddingVertical: Space.md,
    },
    assistant: {
      alignSelf: 'flex-start',
      maxWidth: '92%',
      backgroundColor: colors.surface,
    },
    user: {
      alignSelf: 'flex-end',
      maxWidth: '82%',
      backgroundColor: colors.accentSoft,
    },
  });
}
