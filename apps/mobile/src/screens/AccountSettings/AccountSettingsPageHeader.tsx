import React from 'react';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { useAppTheme } from '../../theme';

type AccountSettingsPageHeaderProps = Readonly<{
  title: string;
  onBack: () => void;
  testID: string;
  rightContent?: React.ReactNode;
  /** Connection state; the title yields its slot so the header never grows. */
  status?: React.ReactNode;
}>;

/** The canonical page header on the grouped canvas, with the account page test hooks. */
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

  return (
    <ScreenHeader
      testID={`${testID}-header`}
      backTestID={`${testID}-back`}
      titleTestID={`${testID}-title`}
      statusTestID={`${testID}-header-status`}
      title={title}
      titleNumberOfLines={2}
      topInset={insets.top}
      status={status}
      onBack={onBack}
      backAccessibilityLabel={t('Back')}
      rightContent={rightContent}
      style={{ backgroundColor: theme.colors.canvasGrouped }}
    />
  );
}
