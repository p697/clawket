import { Linking } from 'react-native';
import { FontSize, FontWeight, Radius, Space } from '../../theme/tokens';
import type { useAppTheme } from '../../theme';

type ThemeColors = ReturnType<typeof useAppTheme>['theme']['colors'];

export function createChatMarkdownStyle(
  colors: ThemeColors,
  fontSize: number = FontSize.base,
) {
  const lineHeight = Math.round(fontSize * 1.47);
  return {
    paragraph: {
      fontSize,
      color: colors.text,
      lineHeight,
      marginTop: 0,
      marginBottom: 6,
    },
    h1: {
      fontSize: fontSize + 5,
      fontWeight: FontWeight.bold,
      color: colors.text,
      marginBottom: 6,
    },
    h2: {
      fontSize: fontSize + 3,
      fontWeight: FontWeight.bold,
      color: colors.text,
      marginBottom: 6,
    },
    h3: {
      fontSize: fontSize + 1,
      fontWeight: FontWeight.semibold,
      color: colors.text,
      marginBottom: Space.xs,
    },
    list: {
      fontSize,
      color: colors.text,
      lineHeight,
      marginBottom: 6,
    },
    blockquote: {
      fontSize,
      color: colors.textMuted,
      lineHeight,
      backgroundColor: colors.surfaceMuted,
      borderColor: colors.borderStrong,
      borderWidth: 3,
      marginBottom: 6,
    },
    code: {
      color: colors.primary,
      backgroundColor: 'transparent',
      borderColor: 'transparent',
    },
    codeBlock: {
      fontSize: FontSize.md,
      color: colors.text,
      lineHeight: 20,
      backgroundColor: colors.surfaceElevated,
      borderColor: colors.border,
      borderRadius: Radius.sm,
      padding: Space.md,
      marginBottom: 6,
    },
    link: {
      color: colors.primary,
      underline: true,
    },
    table: {
      fontSize: FontSize.md,
      borderColor: colors.borderStrong,
      borderRadius: 6,
      headerBackgroundColor: colors.surfaceMuted,
    },
  };
}

export function getChatMarkdownFlavor(): 'github' | undefined {
  return 'github';
}

export function openChatMarkdownLink({ url }: { url: string }): void {
  Linking.openURL(url);
}
