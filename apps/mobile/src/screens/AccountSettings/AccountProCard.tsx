import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Companion } from '../../components/ui/Companion';
import { ChevronRight } from '../../components/ui/DirectionalIcon';
import { SettingsGroup, SettingsRow } from '../../components/ui/SettingsGroup';
import { useAppTheme } from '../../theme';
import { ControlSize, FontSize, FontWeight, IconSize, LineHeight, Radius, Space } from '../../theme/tokens';

/** A quiet brand signature shared by the settings entrance and membership page. */
export function AccountProCard({ title, status, onPress, testID }: {
  title: string;
  status: string;
  onPress: () => void;
  testID: string;
}): React.JSX.Element {
  const { theme: { colors } } = useAppTheme();
  return (
    <SettingsGroup density="comfortable">
      <SettingsRow testID={testID} onPress={onPress} accessibilityLabel={`${title}, ${status}`} style={styles.row}>
        <View style={[styles.mark, { backgroundColor: colors.ink }]}>
          <Companion size={ControlSize.pill} tone="inverse" pose="idle" testID={`${testID}-companion`} />
        </View>
        <View style={styles.copy}>
          <Text style={[styles.title, { color: colors.ink }]}>{title}</Text>
          <Text style={[styles.status, { color: colors.inkSecondary }]}>{status}</Text>
        </View>
        <ChevronRight size={IconSize.sm} strokeWidth={1.75} color={colors.inkTertiary} />
      </SettingsRow>
    </SettingsGroup>
  );
}

const styles = StyleSheet.create({
  row: { padding: Space.lg, gap: Space.lg, minHeight: ControlSize.rosterRow },
  mark: { width: 56, height: 56, borderRadius: Radius.card, alignItems: 'center', justifyContent: 'center' },
  copy: { flex: 1, gap: Space.xs },
  title: { fontSize: FontSize.title, lineHeight: LineHeight.title, fontWeight: FontWeight.semibold },
  status: { fontSize: FontSize.secondary, lineHeight: LineHeight.secondary, fontWeight: FontWeight.regular },
});
