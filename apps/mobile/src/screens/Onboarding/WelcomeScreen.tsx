import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, useReducedMotion } from 'react-native-reanimated';
import { ArrowRight, Settings, X } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '../../theme';
import { FontSize, FontWeight, IconSize, LineHeight, Motion, Space } from '../../theme/tokens';
import { Companion } from '../../components/ui/Companion';
import { Button } from '../../components/ui/Button';
import { FloatingButton } from '../../components/ui/FloatingButton';

type Props = {
  onConnect: () => void;
  onClose?: () => void;
  onSettings?: () => void;
};

/** A quiet introduction; setup instructions belong to the next step. */
export function WelcomeScreen({ onConnect, onClose, onSettings }: Props): React.JSX.Element {
  const { t } = useTranslation('config');
  const { theme: { colors } } = useAppTheme();
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  return (
    <View testID="welcome-screen" style={[styles.screen, { backgroundColor: colors.canvas, paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View style={styles.wordmark}>
          <Companion size={IconSize.lg} />
          <Text style={[styles.brand, { color: colors.ink }]}>{t('Clawket')}</Text>
        </View>
        {onSettings && !onClose ? <FloatingButton icon={Settings} appearance="plain" onPress={onSettings} accessibilityLabel={t('Settings')} /> : null}
        {onClose ? <FloatingButton icon={X} appearance="plain" onPress={onClose} accessibilityLabel={t('Close', { ns: 'common' })} /> : null}
      </View>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, Space.lg) + Space.xl }]} showsVerticalScrollIndicator={false}>
        <View style={styles.introduction}>
          <Animated.View
            accessible={false}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            entering={reducedMotion ? undefined : FadeIn.duration(Motion.duration.slow)}
            style={styles.artwork}
          >
            <Companion size={132} pose="curious" />
          </Animated.View>
          <Animated.View entering={reducedMotion ? undefined : FadeInDown.duration(Motion.duration.slow)} style={styles.copy}>
            <Text accessibilityRole="header" style={[styles.title, { color: colors.ink }]}>{t('Your agents.\nAlways close.')}</Text>
          </Animated.View>
        </View>
        <View style={styles.actions}>
          <Button testID="welcome-connect" size="lg" label={t('Connect an agent')} icon={ArrowRight} onPress={onConnect} />
          <Text style={[styles.supported, { color: colors.inkSecondary }]}>{t('OpenClaw or Hermes on your computer')}</Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { minHeight: 60, paddingHorizontal: Space.xl, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  wordmark: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  brand: { fontSize: FontSize.body, lineHeight: LineHeight.body, fontWeight: FontWeight.semibold },
  content: { flexGrow: 1, paddingHorizontal: Space.xl, gap: Space.xxl },
  introduction: { flex: 1, justifyContent: 'center', paddingVertical: Space.xl, gap: Space.xl },
  artwork: { height: 220, alignItems: 'center', justifyContent: 'center' },
  copy: { alignItems: 'center' },
  title: { fontSize: FontSize.display, lineHeight: LineHeight.display, fontWeight: FontWeight.semibold, textAlign: 'center' },
  actions: { gap: Space.md, paddingBottom: Space.lg },
  supported: { fontSize: FontSize.secondary, lineHeight: LineHeight.secondary, fontWeight: FontWeight.regular, textAlign: 'center' },
});
