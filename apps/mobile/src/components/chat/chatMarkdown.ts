import { Linking, Platform } from 'react-native';
import { BorderWidth, FontSize, FontWeight, Radius, Space } from '../../theme/tokens';
import type { useAppTheme } from '../../theme';

type ThemeColors = ReturnType<typeof useAppTheme>['theme']['colors'];

export function createChatMarkdownStyle(
  colors: ThemeColors,
  fontSize: number = FontSize.secondary,
) {
  const lineHeight = Math.round(fontSize * 1.47);
  return {
    paragraph: {
      fontSize,
      color: colors.ink,
      lineHeight,
      marginTop: 0,
      marginBottom: 6,
    },
    h1: {
      fontSize: fontSize + 5,
      fontWeight: FontWeight.semibold,
      color: colors.ink,
      marginBottom: 6,
    },
    h2: {
      fontSize: fontSize + 3,
      fontWeight: FontWeight.semibold,
      color: colors.ink,
      marginBottom: 6,
    },
    h3: {
      fontSize: fontSize + 1,
      fontWeight: FontWeight.semibold,
      color: colors.ink,
      marginBottom: Space.xs,
    },
    list: {
      fontSize,
      color: colors.ink,
      lineHeight,
      marginBottom: 6,
    },
    blockquote: {
      fontSize,
      color: colors.inkSecondary,
      lineHeight,
      backgroundColor: colors.surface,
      borderColor: colors.line,
      borderWidth: BorderWidth.strong,
      marginBottom: 6,
    },
    code: {
      color: colors.accent,
      backgroundColor: 'transparent',
      borderColor: 'transparent',
    },
    codeBlock: {
      fontSize: FontSize.caption,
      color: colors.ink,
      lineHeight: 20,
      backgroundColor: colors.surfaceFloating,
      borderColor: colors.line,
      borderRadius: Radius.card,
      padding: Space.md,
      marginBottom: 6,
    },
    link: {
      color: colors.accent,
      underline: true,
    },
    table: {
      fontSize: FontSize.caption,
      borderColor: colors.line,
      borderRadius: Radius.card,
      headerBackgroundColor: colors.surface,
    },
  };
}

export function getChatMarkdownFlavor(): 'github' | undefined {
  return Platform.OS === 'ios' ? 'github' : undefined;
}

export function openChatMarkdownLink({ url }: { url: string }): void {
  Linking.openURL(url);
}
