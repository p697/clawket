import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import { SlashCommand } from '../../data/slash-commands';
import { useAppTheme } from '../../theme';
import {
  FontSize,
  FontWeight,
  Radius,
  Shadow,
  Space,
  TimingPreset,
  createThemedShadowStyle,
} from '../../theme/tokens';

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
  const { t } = useTranslation('chat');
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors, theme.scheme), [theme]);
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
        duration: 120,
        useNativeDriver: true,
      }).start();
      return;
    }

    Animated.timing(anim, {
      toValue: 0,
      duration: 80,
      useNativeDriver: true,
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
        renderItem={({ item, index }) => {
          const { highlight, rest } = splitCommandLabel(item.command, typedPrefix);
          return (
            <Pressable
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onSelect(item); }}
              style={({ pressed }) => [
                styles.row,
                index < suggestions.length - 1 && styles.rowDivider,
                pressed && styles.rowPressed,
              ]}
            >
              <View style={styles.rowTop}>
                <Text style={styles.command} numberOfLines={1} ellipsizeMode="tail">
                  {highlight ? <Text style={styles.commandHighlight}>{highlight}</Text> : null}
                  <Text style={styles.command}>{rest}</Text>
                </Text>
              </View>
              <Text style={styles.description} numberOfLines={1} ellipsizeMode="tail">{t(item.description)}</Text>
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
      borderRadius: Radius.md,
      backgroundColor: colors.surfaceElevated,
      ...createThemedShadowStyle(colors, scheme, Shadow.sm),
    },
    popupInner: {
      borderRadius: Radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.surfaceElevated,
      overflow: 'hidden',
      paddingTop: Space.xs,
      paddingBottom: Space.xs,
    },
    row: {
      minHeight: 46,
      paddingHorizontal: Space.lg - 2,
      paddingVertical: Space.sm,
      justifyContent: 'center',
      backgroundColor: colors.surfaceElevated,
    },
    rowPressed: {
      backgroundColor: colors.surfaceMuted,
    },
    rowDivider: {
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    rowTop: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    command: {
      color: colors.text,
      fontSize: FontSize.bodySm,
      fontWeight: FontWeight.bold,
      flexShrink: 1,
    },
    commandHighlight: {
      color: colors.primary,
      fontSize: FontSize.bodySm,
      fontWeight: FontWeight.bold,
    },
    description: {
      color: colors.textMuted,
      fontSize: FontSize.sm,
      marginTop: 2,
    },
  });
}
