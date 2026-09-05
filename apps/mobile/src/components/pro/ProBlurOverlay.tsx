import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { Lock } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '../../theme';
import { FontSize, FontWeight, Radius, Space } from '../../theme/tokens';

type Props = {
  onUpgrade: () => void;
  description?: string;
};

export function ProBlurOverlay({ onUpgrade, description }: Props): React.JSX.Element {
  const { t } = useTranslation('settings');
  const { theme, resolvedScheme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors), [theme]);

  return (
    <BlurView
      intensity={resolvedScheme === 'dark' ? 10 : 12}
      tint={resolvedScheme === 'dark' ? 'dark' : 'light'}
      style={styles.root}
    >
      <View style={styles.content}>
        <Lock size={28} color={theme.colors.accent} strokeWidth={2} />
        {description ? (
          <Text style={styles.description}>{description}</Text>
        ) : null}
        <Pressable
          onPress={onUpgrade}
          style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
        >
          <Text style={styles.buttonText}>{t('Upgrade to View')}</Text>
        </Pressable>
      </View>
    </BlurView>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    root: {
      ...StyleSheet.absoluteFillObject,
      alignItems: 'center',
      justifyContent: 'center',
    },
    content: {
      alignItems: 'center',
      gap: Space.md,
      paddingHorizontal: Space.xl,
      maxWidth: '55%',
    },
    description: {
      fontSize: FontSize.secondary,
      fontWeight: FontWeight.semibold,
      color: colors.ink,
      textAlign: 'center',
      lineHeight: 22,
    },
    button: {
      marginTop: Space.sm,
      paddingVertical: 11,
      paddingHorizontal: Space.xl + Space.lg,
      borderRadius: Radius.full,
      backgroundColor: colors.accent,
    },
    buttonPressed: {
      opacity: 0.88,
    },
    buttonText: {
      fontSize: FontSize.secondary,
      fontWeight: FontWeight.semibold,
      color: colors.onAccent,
    },
  });
}
