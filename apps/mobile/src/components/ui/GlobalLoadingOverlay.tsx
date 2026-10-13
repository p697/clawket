import React, { useEffect, useRef, useState } from 'react';
import { Animated, I18nManager, Modal, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { CompanionSceneKey } from '../../brand/companion-scenes';
import { PresentationSafeAreaProvider } from './PresentationSafeAreaProvider';
import { FullWindowOverlay } from 'react-native-screens';
import { useAppTheme } from '../../theme';
import { FontSize, FontWeight, Radius, Space, createSurfaceStyle } from '../../theme/tokens';
import { CompanionScene } from './companion/CompanionScene';
import { drawLoadingScene } from './LoadingState';

type Props = {
  visible: boolean;
  message?: string;
};

export function GlobalLoadingOverlay({ visible, message }: Props): React.JSX.Element | null {
  const { t } = useTranslation('common');
  const displayMessage = message ?? t('Connecting');

  const opacity = useRef(new Animated.Value(0)).current;
  // Each appearance draws a fresh compact scene.
  const [scene, setScene] = useState(() => drawLoadingScene('compact'));
  useEffect(() => {
    if (visible) setScene(drawLoadingScene('compact'));
  }, [visible]);

  useEffect(() => {
    Animated.timing(opacity, {
      toValue: visible ? 1 : 0,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [opacity, visible]);

  if (!visible) return null;

  const content = (
    <PresentationSafeAreaProvider testID="global-loading-presentation">
      <LoadingPresentation opacity={opacity} scene={scene} message={displayMessage} />
    </PresentationSafeAreaProvider>
  );

  if (Platform.OS === 'ios') {
    return <FullWindowOverlay>{content}</FullWindowOverlay>;
  }

  return (
    <Modal transparent statusBarTranslucent animationType="none" visible>
      {content}
    </Modal>
  );
}

function LoadingPresentation({ opacity, scene, message }: {
  opacity: Animated.Value;
  scene: CompanionSceneKey;
  message: string;
}): React.JSX.Element {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  return (
    <Animated.View testID="global-loading-scrim" style={[styles.overlay, { opacity, backgroundColor: theme.colors.scrim }]} pointerEvents="auto">
      <View testID="global-loading-safe-area" style={[styles.safeArea, {
        paddingTop: insets.top + Space.lg,
        paddingBottom: insets.bottom + Space.lg,
        paddingStart: (I18nManager.isRTL ? insets.right : insets.left) + Space.lg,
        paddingEnd: (I18nManager.isRTL ? insets.left : insets.right) + Space.lg,
      }]}>
        <ScrollView testID="global-loading-card" style={[styles.card, createSurfaceStyle(theme.colors, theme.scheme, 'overlay')]}
          contentContainerStyle={styles.cardContent} bounces={false} accessible
          accessibilityRole="progressbar" accessibilityLabel={message} accessibilityState={{ busy: true }}>
          <CompanionScene scene={scene} phase="wait" compact />
          <Text style={[styles.label, { color: theme.colors.ink }]}>{message}</Text>
        </ScrollView>
      </View>
    </Animated.View>
  );
}

export const GatewaySwitchOverlay = GlobalLoadingOverlay;

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
  },
  safeArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    maxWidth: '100%',
    maxHeight: '100%',
    flexGrow: 0,
    borderRadius: Radius.card,
  },
  cardContent: {
    alignItems: 'center',
    gap: Space.md,
    paddingHorizontal: Space.xl,
    paddingVertical: Space.xl,
  },
  label: {
    fontSize: FontSize.secondary,
    fontWeight: FontWeight.semibold,
  },
});
