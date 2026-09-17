import React, { useEffect, useRef } from 'react';
import { ActivityIndicator, Animated, Modal, Platform, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { FullWindowOverlay } from 'react-native-screens';
import { useAppTheme } from '../../theme';
import { FontSize, FontWeight, Radius, Space, createSurfaceStyle } from '../../theme/tokens';

type Props = {
  visible: boolean;
  message?: string;
};

export function GlobalLoadingOverlay({ visible, message }: Props): React.JSX.Element | null {
  const { t } = useTranslation('common');
  const displayMessage = message ?? t('Switching Gateway...');

  const { theme } = useAppTheme();
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(opacity, {
      toValue: visible ? 1 : 0,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [opacity, visible]);

  if (!visible) return null;

  const content = (
    <Animated.View style={[styles.overlay, { opacity, backgroundColor: theme.colors.scrim }]} pointerEvents="auto">
      <View style={[styles.card, createSurfaceStyle(theme.colors, theme.scheme, 'overlay')]}>
        <ActivityIndicator size="small" color={theme.colors.accent} />
        <Text style={[styles.label, { color: theme.colors.ink }]}>{displayMessage}</Text>
      </View>
    </Animated.View>
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

export const GatewaySwitchOverlay = GlobalLoadingOverlay;

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    paddingHorizontal: Space.xl,
    paddingVertical: Space.lg,
    borderRadius: Radius.card,
  },
  label: {
    fontSize: FontSize.secondary,
    fontWeight: FontWeight.semibold,
  },
});
