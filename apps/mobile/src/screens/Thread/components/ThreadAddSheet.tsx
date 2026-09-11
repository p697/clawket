import React, { useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Camera, FileText, Images, Lightbulb, Sparkles, type LucideIcon } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { isMacCatalyst } from '../../../utils/platform';
import { useAppTheme } from '../../../theme';
import { FontSize, FontWeight, IconSize, LineHeight, Radius, Space } from '../../../theme/tokens';
import { Sheet } from '../../../components/ui/Sheet';
import { SettingsRow } from '../../../components/ui/SettingsGroup';

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
  visible, attachmentsEnabled, skillsEnabled, onClose, onPickImage,
  onTakePhoto, onChooseFile, onOpenSkills, onOpenPrompts,
}: ThreadAddSheetProps): React.JSX.Element {
  const { t } = useTranslation(['chat', 'common']);
  const { theme } = useAppTheme();
  const pendingAction = useRef<(() => void) | null>(null);
  const run = (action: () => void) => {
    if (pendingAction.current) return;
    pendingAction.current = action;
    onClose();
  };
  const afterClose = () => {
    const action = pendingAction.current;
    pendingAction.current = null;
    action?.();
  };
  const attachments: { key: string; title: string; icon: LucideIcon; action: () => void }[] = [];
  if (attachmentsEnabled) {
    attachments.push({ key: 'photo-library', title: t('Photo Library'), icon: Images, action: onPickImage });
    if (!isMacCatalyst) attachments.push({ key: 'camera', title: t('Take Photo'), icon: Camera, action: onTakePhoto });
    if (onChooseFile) attachments.push({ key: 'file', title: t('Choose File'), icon: FileText, action: onChooseFile });
  }
  return (
    <Sheet visible={visible} onClose={onClose} onAfterClose={afterClose}
      closeAccessibilityLabel={t('Close', { ns: 'common' })}
      title={t('Add', { ns: 'common' })} maxHeight="75%" testID="thread-add-sheet">
      <View style={styles.content}>
        {attachments.length > 0 ? <View style={styles.attachments}>
          {attachments.map(({ key, title, icon: Icon, action }) => (
            <Pressable key={key} testID={`thread-add-${key}`} accessibilityRole="button"
              accessibilityLabel={title} onPress={() => run(action)}
              style={({ pressed }) => [styles.tile, { backgroundColor: pressed ? theme.colors.surfaceFloating : theme.colors.surface }]}>
              <Icon size={IconSize.lg} color={theme.colors.ink} strokeWidth={1.75} />
              <Text style={[styles.label, { color: theme.colors.ink }]}>{title}</Text>
            </Pressable>
          ))}
        </View> : null}
        <View>
          {skillsEnabled && onOpenSkills ? <SettingsRow testID="thread-add-skills"
            title={t('Skills', { ns: 'common' })}
            leading={<Sparkles size={IconSize.md} color={theme.colors.inkSecondary} strokeWidth={1.75} />}
            onPress={() => run(onOpenSkills)} /> : null}
          {onOpenPrompts ? <SettingsRow testID="thread-add-prompts" title={t('Prompts')}
            leading={<Lightbulb size={IconSize.md} color={theme.colors.inkSecondary} strokeWidth={1.75} />}
            onPress={() => run(onOpenPrompts)} /> : null}
        </View>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: Space.xl, paddingTop: Space.md, gap: Space.md },
  attachments: { flexDirection: 'row', gap: Space.sm },
  tile: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: Space.xl,
    paddingHorizontal: Space.sm, gap: Space.md, borderRadius: Radius.card },
  label: { fontSize: FontSize.caption, lineHeight: LineHeight.caption, fontWeight: FontWeight.semibold, textAlign: 'center' },
});
