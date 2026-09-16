import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ChevronLeft } from '../../components/ui/DirectionalIcon';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FloatingButton } from '../../components/ui/FloatingButton';
import { useAppTheme } from '../../theme';
import {
  ControlSize,
  FontSize,
  FontWeight,
  LineHeight,
  Space,
} from '../../theme/tokens';

type AccountSettingsPageHeaderProps = Readonly<{
  title: string;
  onBack: () => void;
  testID: string;
  rightContent?: React.ReactNode;
  /** Connection state; the title yields its slot so the header never grows. */
  status?: React.ReactNode;
}>;

export function AccountSettingsPageHeader({
  title,
  onBack,
  testID,
  rightContent,
  status,
}: AccountSettingsPageHeaderProps): React.JSX.Element {
  const { t } = useTranslation('common');
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const safeAreaStyle = useMemo(
    () => ({ paddingTop: insets.top + Space.sm }),
    [insets.top],
  );

  return (
    <View testID={`${testID}-header`} style={[styles.header, safeAreaStyle]}>
      <View style={styles.sideSlot}>
        <FloatingButton
          testID={`${testID}-back`}
          icon={ChevronLeft}
          accessibilityLabel={t('Back')}
          onPress={onBack}
        />
      </View>
      {status ? (
        <View testID={`${testID}-header-status`} style={styles.status}>{status}</View>
      ) : (
        <Text
          testID={`${testID}-title`}
          numberOfLines={2}
          style={[styles.title, { color: theme.colors.ink }]}
        >
          {title}
        </Text>
      )}
      <View style={[styles.sideSlot, styles.rightSlot]}>{rightContent}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: Space.lg,
    paddingBottom: Space.lg,
    flexDirection: 'row',
    alignItems: 'center',
  },
  sideSlot: {
    width: ControlSize.settingsRow,
    alignItems: 'flex-start',
  },
  rightSlot: { alignItems: 'flex-end' },
  status: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    flex: 1,
    textAlign: 'center',
    fontSize: FontSize.title,
    lineHeight: LineHeight.title,
    fontWeight: FontWeight.semibold,
  },
});
