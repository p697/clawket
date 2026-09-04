import * as Clipboard from 'expo-clipboard';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '../../theme';
import { FontSize, FontWeight, Radius, Space } from '../../theme/tokens';

type Props = {
  logs: string[];
  style?: ViewStyle;
};

export function DebugOverlay({ logs, style }: Props): React.JSX.Element {
  const { t } = useTranslation('chat');
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors), [theme]);
  const [copied, setCopied] = useState(false);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const displayLogs = useMemo(() => [...logs].reverse(), [logs]);

  useEffect(() => {
    return () => {
      if (resetTimerRef.current) {
        clearTimeout(resetTimerRef.current);
      }
    };
  }, []);

  const handleCopy = () => {
    void Clipboard.setStringAsync(displayLogs.join('\n'));
    setCopied(true);
    if (resetTimerRef.current) {
      clearTimeout(resetTimerRef.current);
    }
    resetTimerRef.current = setTimeout(() => {
      setCopied(false);
      resetTimerRef.current = null;
    }, 1500);
  };

  return (
    <View style={[styles.debugOverlay, style]}>
      <View style={styles.header}>
        <View style={styles.headerSpacer} />
        <Pressable onPress={handleCopy} style={({ pressed }) => [styles.copyButton, pressed && styles.copyButtonPressed]}>
          <Text style={styles.copyButtonText}>{copied ? t('Copied') : t('Copy Logs')}</Text>
        </Pressable>
      </View>
      <ScrollView style={styles.debugScroll}>
        {displayLogs.map((line, index) => (
          <Text key={index} style={styles.debugText}>{line}</Text>
        ))}
      </ScrollView>
    </View>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    debugOverlay: {
      position: 'absolute',
      top: 100,
      left: Space.sm,
      right: Space.sm,
      maxHeight: 260,
      backgroundColor: colors.debugOverlay,
      borderRadius: Radius.sm,
      padding: Space.sm,
      zIndex: 999,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: Space.xs,
    },
    headerSpacer: {
      flex: 1,
    },
    copyButton: {
      paddingHorizontal: Space.sm,
      paddingVertical: Space.xs,
      borderRadius: Radius.sm,
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    copyButtonPressed: {
      opacity: 0.84,
    },
    copyButtonText: {
      color: colors.text,
      fontSize: FontSize.sm,
      fontWeight: FontWeight.semibold,
    },
    debugScroll: {
      maxHeight: 244,
    },
    debugText: {
      color: colors.debugText,
      fontSize: FontSize.micro,
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      lineHeight: 14,
    },
  });
}
