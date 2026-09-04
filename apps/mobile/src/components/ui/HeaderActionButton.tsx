import React, { useMemo } from 'react';
import type { LucideIcon } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { ActionButton } from './ActionButton';
import { useAppTheme } from '../../theme';

type Tone = 'default' | 'accent' | 'destructive';

type Props = {
  icon: LucideIcon;
  onPress: () => void;
  disabled?: boolean;
  tone?: Tone;
  size?: number;
  strokeWidth?: number;
  buttonSize?: number;
  accessibilityLabel?: string;
};

function resolveIconColor(tone: Tone, colors: ReturnType<typeof useAppTheme>['theme']['colors']): string {
  if (tone === 'accent') return colors.primary;
  if (tone === 'destructive') return colors.error;
  return colors.textMuted;
}

export function HeaderActionButton({
  icon: Icon,
  onPress,
  disabled = false,
  tone = 'default',
  size = 18,
  strokeWidth = 2,
  buttonSize = 44,
  accessibilityLabel,
}: Props): React.JSX.Element {
  const { theme } = useAppTheme();
  const { t } = useTranslation('common');
  const color = useMemo(
    () => resolveIconColor(tone, theme.colors),
    [theme.colors, tone],
  );

  return (
    <ActionButton
      icon={Icon}
      onPress={onPress}
      disabled={disabled}
      appearance="surface"
      size={buttonSize <= 36 ? 'sm' : 'md'}
      iconSize={size}
      iconColor={color}
      strokeWidth={strokeWidth}
      accessibilityLabel={accessibilityLabel ?? t('Header action')}
    />
  );
}
