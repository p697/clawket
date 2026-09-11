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
import { useTranslation } from 'react-i18next';
import { SlashCommand } from '../../data/slash-commands';
import { useAppTheme } from '../../theme';
import {
  FontSize,
  FontWeight,
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
  const { t } = useTranslation('chat');
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors, theme.scheme), [theme]);
  const translatedDescriptions = useMemo<Record<string, string>>(() => ({
    'Show session status': t('Show session status'),
    'Browse and switch models': t('Browse and switch models'),
    'Compact session context': t('Compact session context'),
    'Set thinking level (off/low/medium/high)': t('Set thinking level (off/low/medium/high)'),
    'Toggle fast mode': t('Toggle fast mode'),
    'Start a new session': t('Start a new session'),
    'Reset current session': t('Reset current session'),
    'Stop current generation': t('Stop current generation'),
    'Toggle reasoning mode': t('Toggle reasoning mode'),
    'Toggle elevated permissions': t('Toggle elevated permissions'),
    'Show token usage stats': t('Show token usage stats'),
    'Show context window usage': t('Show context window usage'),
    'Show current session info': t('Show current session info'),
    'List available agents': t('List available agents'),
    'List all commands': t('List all commands'),
    'Kill running subagents': t('Kill running subagents'),
    'Send instruction to a subagent': t('Send instruction to a subagent'),
    'Send message to another session': t('Send message to another session'),
    'Text-to-speech': t('Text-to-speech'),
    'Show or change queue mode': t('Show or change queue mode'),
    'Show available commands': t('Show available commands'),
    'Switch to a specific model': t('Switch to a specific model'),
    'Toggle verbose mode': t('Toggle verbose mode'),
    'Restart the gateway': t('Restart the gateway'),
  }), [t]);
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
              <Text style={styles.description} numberOfLines={1} ellipsizeMode="tail">
                {translatedDescriptions[item.description] ?? item.description}
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
    popupInner: {
      borderRadius: Radius.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.line,
      backgroundColor: colors.surfaceFloating,
      overflow: 'hidden',
      paddingTop: Space.xs,
      paddingBottom: Space.xs,
    },
    row: {
      minHeight: 46,
      paddingHorizontal: Space.lg - 2,
      paddingVertical: Space.sm,
      justifyContent: 'center',
      backgroundColor: colors.surfaceFloating,
    },
    rowPressed: {
      backgroundColor: colors.surface,
    },
    rowDivider: {
      borderBottomWidth: 1,
      borderBottomColor: colors.line,
    },
    rowTop: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    command: {
      color: colors.ink,
      fontSize: FontSize.secondary,
      fontWeight: FontWeight.semibold,
      flexShrink: 1,
    },
    commandHighlight: {
      color: colors.accent,
      fontSize: FontSize.secondary,
      fontWeight: FontWeight.semibold,
    },
    description: {
      color: colors.inkSecondary,
      fontSize: FontSize.caption,
      marginTop: 2,
    },
  });
}
