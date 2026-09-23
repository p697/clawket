import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { ControlSize, Radius, Space } from '../../theme/tokens';
import { Skeleton } from './Skeleton';

const TITLE_WIDTHS = ['52%', '38%', '60%', '44%', '56%'] as const;
const DETAIL_WIDTHS = ['86%', '72%', '80%', '64%', '76%'] as const;

type ListSkeletonProps = Readonly<{
  testID?: string;
  accessibilityLabel?: string;
  rows?: number;
  detail?: boolean;
  icon?: boolean;
  trailing?: 'value' | 'switch' | 'none';
  style?: StyleProp<ViewStyle>;
}>;

/** Compact content-shaped placeholders, with no extra gap between rows. */
export function ListSkeleton({
  testID,
  accessibilityLabel,
  rows = 5,
  detail = false,
  icon = false,
  trailing = 'value',
  style,
}: ListSkeletonProps): React.JSX.Element {
  return (
    <View testID={testID} style={style} pointerEvents="none" accessible={Boolean(accessibilityLabel)} accessibilityRole="progressbar" accessibilityLabel={accessibilityLabel}>
      {Array.from({ length: rows }, (_, index) => (
        <View key={index} style={[styles.row, detail && styles.detailRow]}>
          {icon ? <Skeleton style={styles.icon} /> : null}
          <View style={styles.copy}>
            <Skeleton style={[styles.title, { width: TITLE_WIDTHS[index % TITLE_WIDTHS.length] }]} />
            {detail ? <Skeleton style={[styles.detail, { width: DETAIL_WIDTHS[index % DETAIL_WIDTHS.length] }]} /> : null}
          </View>
          {trailing !== 'none' ? <Skeleton style={trailing === 'switch' ? styles.toggle : styles.value} /> : null}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { minHeight: ControlSize.settingsRow, flexDirection: 'row', alignItems: 'center', gap: Space.md },
  detailRow: { minHeight: ControlSize.settingsRowComfortable },
  copy: { flex: 1, gap: Space.sm },
  title: { minHeight: 0, height: Space.lg, borderRadius: Radius.avatarHeader },
  detail: { minHeight: 0, height: Space.md, borderRadius: Radius.avatarHeader },
  value: { minHeight: 0, width: Space.xxl, height: Space.md, borderRadius: Radius.avatarHeader },
  toggle: { width: ControlSize.floatingButton, height: Space.xl, borderRadius: Radius.full },
  icon: { width: Space.xxl, height: Space.xxl, borderRadius: Radius.avatarSheet },
});
