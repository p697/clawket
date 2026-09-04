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
import {
  FontSize,
  FontWeight,
  LineHeight,
  Radius,
  Space,
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
 * Canonical 3.0 message surface. Rich content can be passed as children while
 * plain strings receive the shared message typography automatically.
 */
export function Bubble({
  role,
  children,
  selectable = true,
  style,
  textStyle,
  testID,
}: BubbleProps): React.JSX.Element {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);

  return (
    <View
      testID={testID}
      style={[
        styles.bubble,
        role === 'user' ? styles.user : styles.assistant,
        style,
      ]}
    >
      {typeof children === 'string' || typeof children === 'number' ? (
        <Text selectable={selectable} style={[styles.text, textStyle]}>
          {children}
        </Text>
      ) : children}
    </View>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    bubble: {
      maxWidth: '82%',
      borderRadius: Radius.bubble,
      paddingHorizontal: Space.lg,
      paddingVertical: Space.md,
    },
    assistant: {
      alignSelf: 'flex-start',
      backgroundColor: colors.surface,
    },
    user: {
      alignSelf: 'flex-end',
      backgroundColor: colors.accentSoft,
    },
    text: {
      color: colors.ink,
      fontSize: FontSize.body,
      lineHeight: LineHeight.body,
      fontWeight: FontWeight.regular,
    },
  });
}
