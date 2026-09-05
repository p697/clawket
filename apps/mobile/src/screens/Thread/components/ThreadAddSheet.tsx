import React from 'react';
import { Camera, FileText, Images, Lightbulb, Sparkles } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { isMacCatalyst } from '../../../utils/platform';
import { useAppTheme } from '../../../theme';
import { IconSize } from '../../../theme/tokens';
import { Sheet } from '../../../components/ui/Sheet';
import {
  SettingsDivider,
  SettingsGroup,
  SettingsRow,
} from '../../../components/ui/SettingsGroup';

export type ThreadAddSheetProps = Readonly<{
  visible: boolean;
  attachmentsEnabled: boolean;
  skillsEnabled: boolean;
  onClose: () => void;
  onPickImage: () => void;
  onTakePhoto: () => void;
  onChooseFile?: () => void;
  onOpenSkills?: () => void;
  onOpenPrompts?: () => void;
}>;

export function ThreadAddSheet({
  visible,
  attachmentsEnabled,
  skillsEnabled,
  onClose,
  onPickImage,
  onTakePhoto,
  onChooseFile,
  onOpenSkills,
  onOpenPrompts,
}: ThreadAddSheetProps): React.JSX.Element {
  const { t } = useTranslation(['chat', 'common']);
  const { theme } = useAppTheme();
  const iconColor = theme.colors.inkSecondary;
  const run = (action: () => void) => {
    onClose();
    action();
  };

  const rows: React.ReactNode[] = [];
  const addRow = (key: string, row: React.ReactNode) => {
    if (rows.length > 0) rows.push(<SettingsDivider key={`${key}-divider`} inset="content" />);
    rows.push(row);
  };

  if (attachmentsEnabled) {
    addRow('library', (
      <SettingsRow
        key="library"
        testID="thread-add-photo-library"
        title={t('Photo Library', { ns: 'chat' })}
        leading={<Images size={IconSize.md} color={iconColor} strokeWidth={2} />}
        onPress={() => run(onPickImage)}
      />
    ));
    if (!isMacCatalyst) {
      addRow('camera', (
        <SettingsRow
          key="camera"
          testID="thread-add-camera"
          title={t('Take Photo', { ns: 'chat' })}
          leading={<Camera size={IconSize.md} color={iconColor} strokeWidth={2} />}
          onPress={() => run(onTakePhoto)}
        />
      ));
    }
    if (onChooseFile) {
      addRow('file', (
        <SettingsRow
          key="file"
          testID="thread-add-file"
          title={t('Choose File', { ns: 'chat' })}
          leading={<FileText size={IconSize.md} color={iconColor} strokeWidth={2} />}
          onPress={() => run(onChooseFile)}
        />
      ));
    }
  }

  if (skillsEnabled && onOpenSkills) {
    addRow('skills', (
      <SettingsRow
        key="skills"
        testID="thread-add-skills"
        title={t('Skills', { ns: 'common' })}
        leading={<Sparkles size={IconSize.md} color={iconColor} strokeWidth={2} />}
        onPress={() => run(onOpenSkills)}
      />
    ));
  }

  if (onOpenPrompts) {
    addRow('prompts', (
      <SettingsRow
        key="prompts"
        testID="thread-add-prompts"
        title={t('Prompts', { ns: 'chat' })}
        leading={<Lightbulb size={IconSize.md} color={iconColor} strokeWidth={2} />}
        onPress={() => run(onOpenPrompts)}
      />
    ));
  }

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      closeAccessibilityLabel={t('Close', { ns: 'common' })}
      title={t('Add', { ns: 'common' })}
      maxHeight="75%"
      testID="thread-add-sheet"
    >
      <SettingsGroup>{rows}</SettingsGroup>
    </Sheet>
  );
}
