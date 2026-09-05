import React from 'react';
import * as Haptics from 'expo-haptics';
import { StyleProp, View, ViewStyle } from 'react-native';
import { MenuAction, MenuView } from '@react-native-menu/menu';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '../../theme';
import { isMacCatalyst } from '../../utils/platform';

type AttachmentAction = 'photo-library' | 'take-photo' | 'choose-file';

type Props = {
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
  onPickImage: () => void | Promise<void>;
  onTakePhoto: () => void | Promise<void>;
  onChooseFile?: () => void | Promise<void>;
};

export function AttachmentMenu({
  disabled = false,
  style,
  children,
  onPickImage,
  onTakePhoto,
  onChooseFile,
}: Props): React.JSX.Element {
  const { t } = useTranslation('chat');
  const { theme } = useAppTheme();

  const actions = React.useMemo<MenuAction[]>(() => {
    const items: MenuAction[] = [{ id: 'photo-library', title: t('Photo Library') }];
    if (onChooseFile) {
      items.unshift({ id: 'choose-file', title: t('Choose File') });
    }
    if (!isMacCatalyst) {
      items.splice(1, 0, { id: 'take-photo', title: t('Take Photo') });
    }
    return items;
  }, [onChooseFile, t]);

  const handleAction = React.useCallback(({ nativeEvent }: { nativeEvent: { event: string } }) => {
    const action = nativeEvent.event as AttachmentAction;
    Haptics.selectionAsync();

    if (action === 'photo-library') {
      void onPickImage();
      return;
    }
    if (action === 'take-photo') {
      void onTakePhoto();
      return;
    }
    if (action === 'choose-file' && onChooseFile) {
      void onChooseFile();
    }
  }, [onChooseFile, onPickImage, onTakePhoto]);

  if (disabled) {
    return <View style={style}>{children}</View>;
  }

  return (
    <MenuView
      actions={actions}
      shouldOpenOnLongPress={false}
      title={t('Add Attachment')}
      themeVariant={theme.scheme}
      style={style}
      onPressAction={handleAction}
    >
      {children}
    </MenuView>
  );
}
