import React from 'react';
import { Copy, Share2, Star } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import type { UiMessage } from '../../../types/chat';
import { useAppTheme } from '../../../theme';
import { IconSize } from '../../../theme/tokens';
import { Sheet } from '../../../components/ui/Sheet';
import {
  SettingsDivider,
  SettingsGroup,
  SettingsRow,
} from '../../../components/ui/SettingsGroup';

export type ThreadMessageActionsSheetProps = Readonly<{
  visible: boolean;
  message: UiMessage | null;
  favorited: boolean;
  onClose: () => void;
  onCopy: (message: UiMessage) => void;
  onToggleFavorite: (message: UiMessage) => void;
  onShare: (message: UiMessage) => void;
}>;

export function ThreadMessageActionsSheet({
  visible,
  message,
  favorited,
  onClose,
  onCopy,
  onToggleFavorite,
  onShare,
}: ThreadMessageActionsSheetProps): React.JSX.Element {
  const { t } = useTranslation(['chat', 'common']);
  const { theme } = useAppTheme();
  const iconColor = theme.colors.inkSecondary;
  const handle = (action: (target: UiMessage) => void) => {
    if (!message) return;
    action(message);
    onClose();
  };

  return (
    <Sheet
      visible={visible && Boolean(message)}
      onClose={onClose}
      closeAccessibilityLabel={t('Close', { ns: 'common' })}
      title={t('Message', { ns: 'chat' })}
      maxHeight="55%"
      testID="thread-message-actions"
    >
      <SettingsGroup>
        <SettingsRow
          testID="thread-message-copy"
          title={t('Copy', { ns: 'common' })}
          leading={<Copy size={IconSize.md} color={iconColor} strokeWidth={2} />}
          onPress={() => handle(onCopy)}
        />
        <SettingsDivider inset="content" />
        <SettingsRow
          testID="thread-message-favorite"
          title={t('Favorite', { ns: 'common' })}
          leading={(
            <Star
              size={IconSize.md}
              color={favorited ? theme.colors.accent : iconColor}
              fill={favorited ? theme.colors.accent : 'transparent'}
              strokeWidth={2}
            />
          )}
          onPress={() => handle(onToggleFavorite)}
        />
        <SettingsDivider inset="content" />
        <SettingsRow
          testID="thread-message-share"
          title={t('Share', { ns: 'chat' })}
          leading={<Share2 size={IconSize.md} color={iconColor} strokeWidth={2} />}
          onPress={() => handle(onShare)}
        />
      </SettingsGroup>
    </Sheet>
  );
}
