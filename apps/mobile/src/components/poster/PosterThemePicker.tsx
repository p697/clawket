import React, { useCallback, useState } from 'react';
import { Animated, StyleSheet, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { BorderWidth, ControlSize, PresentationColor, Radius, Space } from '../../theme/tokens';
import { POSTER_THEMES, PosterTheme } from './posterThemes';

type Props = {
  disabled?: boolean;
  current: PosterTheme;
  onSelect: (theme: PosterTheme) => void;
};

/**
 * A small circular button showing the current theme accent color.
 * The palette stays in normal flow so every color remains reachable when the
 * presentation narrows or becomes short. The caller supplies a full-width row.
 */
export function PosterThemePicker({ current, onSelect, disabled = false }: Props) {
  const { t } = useTranslation('config');
  const labels: Record<PosterTheme['id'], string> = {
    iceBlue: t('Ice Blue'), jadeGreen: t('Jade Green'), oceanTeal: t('Ocean Teal'),
    sunsetOrange: t('Sunset Orange'), rosePink: t('Rose Pink'), royalPurple: t('Royal Purple'),
  };
  const [expanded, setExpanded] = useState(false);
  const [anim] = useState(() => new Animated.Value(0));

  const toggle = useCallback(() => {
    const next = !expanded;
    setExpanded(next);
    Animated.spring(anim, {
      toValue: next ? 1 : 0,
      damping: 18,
      stiffness: 260,
      useNativeDriver: true,
    }).start();
  }, [expanded, anim]);

  const handleSelect = useCallback((theme: PosterTheme) => {
    onSelect(theme);
    setExpanded(false);
    Animated.spring(anim, {
      toValue: 0,
      damping: 18,
      stiffness: 260,
      useNativeDriver: true,
    }).start();
  }, [onSelect, anim]);

  const paletteStyle = {
    opacity: anim,
    transform: [
      { translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [-6, 0] }) },
      { scale: anim.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }) },
    ],
  };

  return (
    <View testID="poster-theme-picker" style={s.root}>
      <TouchableOpacity testID="poster-theme-trigger" accessibilityRole="button" accessibilityLabel={t('Color')}
        accessibilityState={{ expanded, disabled }} disabled={disabled} style={s.trigger} onPress={toggle} activeOpacity={0.7}>
        <View style={[s.triggerDot, { backgroundColor: current.swatch }]} />
      </TouchableOpacity>
      {expanded && (
        <Animated.View testID="poster-theme-palette" style={[s.palette, paletteStyle]}>
          {POSTER_THEMES.map((theme) => {
            const isActive = theme.id === current.id;
            return (
              <TouchableOpacity
                key={theme.id}
                testID={`poster-theme-${theme.id}`}
                accessibilityRole="button"
                accessibilityLabel={labels[theme.id]}
                accessibilityState={{ selected: isActive, disabled }}
                disabled={disabled}
                activeOpacity={0.7}
                onPress={() => handleSelect(theme)}
                style={s.dotTouch}
              >
                <View style={[
                  s.dot,
                  { backgroundColor: theme.swatch },
                  isActive && s.dotActive,
                ]} />
              </TouchableOpacity>
            );
          })}
        </Animated.View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root: {
    width: '100%',
    alignItems: 'center',
  },
  trigger: {
    width: ControlSize.floatingButton,
    height: ControlSize.floatingButton,
    borderRadius: Radius.full,
    backgroundColor: PresentationColor.mediaControl,
    justifyContent: 'center',
    alignItems: 'center',
  },
  triggerDot: {
    width: 18,
    height: 18,
    borderRadius: Radius.full,
  },
  palette: {
    maxWidth: '100%',
    marginTop: Space.sm,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: PresentationColor.mediaControlSoft,
    borderRadius: Radius.full,
    paddingHorizontal: 6,
    paddingVertical: 4,
    gap: 2,
  },
  dotTouch: {
    width: ControlSize.floatingButton,
    height: ControlSize.floatingButton,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    width: 20,
    height: 20,
    borderRadius: Radius.full,
  },
  dotActive: {
    borderWidth: BorderWidth.strong,
    borderColor: PresentationColor.onMedia,
  },
});
