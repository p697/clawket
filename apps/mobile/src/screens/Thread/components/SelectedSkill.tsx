import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { Sparkles, X } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '../../../theme';
import { FontSize, Space, Radius } from '../../../theme/tokens';

export function SelectedSkill({ name, onRemove }: Readonly<{ name: string; onRemove: () => void }>) {
  const { theme } = useAppTheme();
  const { t } = useTranslation('common');
  return <Pressable testID="composer-selected-skill" accessibilityRole="button" accessibilityLabel={`${name}, ${t('Remove')}`}
    onPress={onRemove} style={[styles.chip, { backgroundColor: theme.colors.surface }]}>
    <Sparkles size={16} color={theme.colors.inkSecondary} />
    <Text numberOfLines={1} style={[styles.label, { color: theme.colors.ink }]}>{name}</Text>
    <X size={14} color={theme.colors.inkSecondary} />
  </Pressable>;
}
const styles = StyleSheet.create({
  chip: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: Space.sm, minHeight: 44, paddingHorizontal: Space.md, borderRadius: Radius.full, maxWidth: '100%' },
  label: { fontSize: FontSize.secondary, flexShrink: 1 },
});
