import React, { useCallback, useMemo, useState } from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Check, Copy } from 'lucide-react-native';
import { useAppTheme } from '../../theme';
import { FontSize, Radius, Space } from '../../theme/tokens';

export function CopyableCommand({
  command,
  multiline = false,
}: {
  command: string;
  multiline?: boolean;
}): React.JSX.Element {
  const [copied, setCopied] = useState(false);
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors), [theme]);

  const handleCopy = useCallback(async () => {
    await Clipboard.setStringAsync(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [command]);

  return (
    <TouchableOpacity
      style={[styles.container, multiline && styles.containerMultiline]}
      onPress={handleCopy}
      activeOpacity={0.7}
    >
      <Text style={[styles.text, multiline && styles.textMultiline]} numberOfLines={multiline ? undefined : 1}>
        {command}
      </Text>
      {copied
        ? <Check size={14} color={theme.colors.good} strokeWidth={2.5} style={styles.icon} />
        : <Copy size={14} color={theme.colors.inkTertiary} strokeWidth={2} style={styles.icon} />
      }
    </TouchableOpacity>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    container: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surfaceFloating,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.line,
      borderRadius: Radius.card,
      paddingLeft: Space.md,
      paddingRight: Space.sm,
      paddingVertical: Space.sm,
      marginTop: 6,
      marginBottom: 2,
    },
    containerMultiline: {
      alignItems: 'flex-start',
    },
    text: {
      flex: 1,
      fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
      fontSize: FontSize.caption,
      color: colors.inkSecondary,
    },
    textMultiline: {
      lineHeight: 20,
      paddingTop: 1,
    },
    icon: {
      marginLeft: Space.sm,
      marginTop: 2,
    },
  });
}
