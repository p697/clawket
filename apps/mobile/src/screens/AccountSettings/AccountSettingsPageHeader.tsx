import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ChevronLeft } from 'lucide-react-native';
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
}>;

export function AccountSettingsPageHeader({
  title,
  onBack,
  testID,
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
      <Text
        numberOfLines={1}
        style={[styles.title, { color: theme.colors.ink }]}
      >
        {title}
      </Text>
      <View style={styles.sideSlot} />
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: Space.lg,
    paddingBottom: Space.md,
    flexDirection: 'row',
    alignItems: 'center',
  },
  sideSlot: {
    width: ControlSize.settingsRow,
    alignItems: 'flex-start',
  },
  title: {
    flex: 1,
    textAlign: 'center',
    fontSize: FontSize.title,
    lineHeight: LineHeight.title,
    fontWeight: FontWeight.semibold,
  },
});
