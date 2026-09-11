import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { SlashCommand } from '../../data/slash-commands';
import { useSlashCommandDescriptions } from './slashCommandCopy';
import { useAppTheme } from '../../theme';
import {
  ControlSize,
  FontSize,
  FontWeight,
  LineHeight,
  Motion,
  Radius,
  Shadow,
  Space,
  createThemedShadowStyle,
} from '../../theme/tokens';

export const SLASH_SUGGESTION_TIMING_CONFIG = {
  duration: Motion.duration.fast,
  easing: Easing.out(Easing.cubic),
  useNativeDriver: true,
} as const;

type Props = {
  visible: boolean;
  inputValue: string;
  suggestions: SlashCommand[];
  maxHeight?: number;
  onSelect: (command: SlashCommand) => void;
};

function getTypedPrefix(inputValue: string): string {
  if (!inputValue.startsWith('/')) return '';
  const token = inputValue.slice(1).split(/\s/, 1)[0] ?? '';
  return `/${token}`;
}

function splitCommandLabel(command: string, typedPrefix: string): { highlight: string; rest: string } {
  const normalizedPrefix = typedPrefix.toLowerCase();
  if (!normalizedPrefix || !command.toLowerCase().startsWith(normalizedPrefix)) {
    return { highlight: '', rest: command };
  }
  return {
    highlight: command.slice(0, typedPrefix.length),
    rest: command.slice(typedPrefix.length),
  };
}

export function SlashSuggestions({ visible, inputValue, suggestions, maxHeight, onSelect }: Props): React.JSX.Element | null {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors, theme.scheme), [theme]);
  const describe = useSlashCommandDescriptions();
  const anim = useRef(new Animated.Value(0)).current;
  const show = visible && suggestions.length > 0;
  const [rendered, setRendered] = useState(show);

  // Reset anim to 0 immediately when mounting so the full animation is visible
  if (show && !rendered) {
    anim.setValue(0);
  }

  useEffect(() => {
    if (show) {
      setRendered(true);
      Animated.timing(anim, {
        toValue: 1,
        ...SLASH_SUGGESTION_TIMING_CONFIG,
      }).start();
      return;
    }

    Animated.timing(anim, {
      toValue: 0,
      ...SLASH_SUGGESTION_TIMING_CONFIG,
    }).start(({ finished }) => {
      if (finished) {
        setRendered(false);
      }
    });
  }, [anim, show]);

  const typedPrefix = useMemo(() => getTypedPrefix(inputValue), [inputValue]);

  if (!rendered) {
    return null;
  }

  return (
    <Animated.View
      style={[
        styles.popup,
        {
          opacity: anim,
          transform: [
            {
              translateY: anim.interpolate({
                inputRange: [0, 1],
                outputRange: [8, 0],
              }),
            },
          ],
        },
        maxHeight ? { maxHeight } : undefined,
      ]}
    >
      <View style={styles.popupInner}>
      <FlatList
        data={suggestions}
        keyExtractor={(item) => item.key}
        bounces={false}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={suggestions.length > 4}
        renderItem={({ item }) => {
          const { highlight, rest } = splitCommandLabel(item.command, typedPrefix);
          return (
            <Pressable
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onSelect(item); }}
              style={({ pressed }) => [
                styles.row,
                pressed && styles.rowPressed,
              ]}
            >
              <View style={styles.rowTop}>
                <Text style={styles.command} numberOfLines={1} ellipsizeMode="tail">
                  {highlight ? <Text style={styles.commandHighlight}>{highlight}</Text> : null}
                  <Text style={styles.command}>{rest}</Text>
                </Text>
              </View>
              <Text style={styles.description} numberOfLines={1} ellipsizeMode="tail">
                {describe(item)}
              </Text>
            </Pressable>
          );
        }}
      />
      </View>
    </Animated.View>
  );
}

function createStyles(
  colors: ReturnType<typeof useAppTheme>['theme']['colors'],
  scheme: ReturnType<typeof useAppTheme>['theme']['scheme'],
) {
  return StyleSheet.create({
    popup: {
      borderRadius: Radius.card,
      backgroundColor: colors.surfaceFloating,
      ...createThemedShadowStyle(colors, scheme, Shadow.sm),
    },
    // Borderless floating list: rows separate by spacing and pressed color only.
    popupInner: {
      borderRadius: Radius.card,
      backgroundColor: colors.surfaceFloating,
      overflow: 'hidden',
      paddingVertical: Space.xs,
    },
    row: {
      minHeight: ControlSize.floatingButton,
      paddingHorizontal: Space.lg,
      paddingVertical: Space.sm,
      justifyContent: 'center',
      gap: Space.xs,
    },
    rowPressed: {
      backgroundColor: colors.surface,
    },
    rowTop: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    command: {
      color: colors.ink,
      fontSize: FontSize.secondary,
      lineHeight: LineHeight.secondary,
      fontWeight: FontWeight.semibold,
      flexShrink: 1,
    },
    commandHighlight: {
      color: colors.accent,
      fontSize: FontSize.secondary,
      lineHeight: LineHeight.secondary,
      fontWeight: FontWeight.semibold,
    },
    description: {
      color: colors.inkSecondary,
      fontSize: FontSize.caption,
      lineHeight: LineHeight.caption,
    },
  });
}
