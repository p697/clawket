import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Check } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '../../theme';
import { builtInAccents } from '../../theme/accents';
import { ControlSize, IconSize, Radius, Space } from '../../theme/tokens';
import type { AccentColorId } from '../../types';

const COLORS: ReadonlyArray<[AccentColorId, string]> = [
  ['iceBlue', 'Ice Blue'], ['jadeGreen', 'Jade Green'], ['oceanTeal', 'Ocean Teal'],
  ['sunsetOrange', 'Sunset Orange'], ['rosePink', 'Rose Pink'], ['royalPurple', 'Royal Purple'],
];

export function ChatColorPicker({ value, onChange }: { value: AccentColorId; onChange: (value: AccentColorId) => void }) {
  const { theme } = useAppTheme();
  const { t } = useTranslation('config');
  return <View style={styles.colors}>
    {COLORS.map(([id, label]) => <Pressable key={id} testID={`chat-theme-color-${id}`}
      accessibilityRole="radio" accessibilityLabel={t(label)} accessibilityState={{ selected: value === id }}
      onPress={() => onChange(id)} style={({ pressed }) => [styles.target, pressed && styles.pressed]}>
      <View style={[styles.swatch, { backgroundColor: builtInAccents[id][theme.scheme].accent500 }]}>
        {value === id ? <Check size={IconSize.sm} color={theme.colors.canvas} strokeWidth={2} /> : null}
      </View>
    </Pressable>)}
  </View>;
}

const styles = StyleSheet.create({
  colors: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: Space.xs },
  target: { width: ControlSize.floatingButton, height: ControlSize.floatingButton, alignItems: 'center', justifyContent: 'center' },
  swatch: { width: ControlSize.pill, height: ControlSize.pill, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.72 },
});
