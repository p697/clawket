import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '../../theme';
import {
  ControlSize,
  FontSize,
  LineHeight,
  Radius,
  Space,
} from '../../theme/tokens';
import { Button } from './Button';
import { CompositionSafeBottomSheetTextInput } from './CompositionSafeBottomSheetTextInput';
import { Sheet } from './Sheet';

export type RenameSheetProps = Readonly<{
  visible: boolean;
  /** Current name; the draft resets to it each time the sheet opens. */
  value: string;
  title?: string;
  onClose: () => void;
  /** Resolves when the new name is stored; a rejection keeps the sheet open with the draft. */
  onSubmit: (name: string) => Promise<unknown> | unknown;
  testID: string;
}>;

/**
 * One rename recipe for roster sessions and connections: a single input in a
 * bottom sheet with Cancel / Save. Saving is disabled for an empty or unchanged
 * name and a failed save keeps the draft so the user can retry.
 */
export function RenameSheet({
  visible,
  value,
  title,
  onClose,
  onSubmit,
  testID,
}: RenameSheetProps): React.JSX.Element {
  const { t } = useTranslation('common');
  const { theme } = useAppTheme();
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible) setDraft(value);
  }, [value, visible]);

  const trimmed = draft.trim();
  const submittable = trimmed.length > 0 && trimmed !== value.trim() && !saving;
  const submit = useCallback(async () => {
    if (!submittable) return;
    setSaving(true);
    try {
      await onSubmit(trimmed);
      onClose();
    } catch {
      // Keep the editor open so the user can retry without losing the name.
    } finally {
      setSaving(false);
    }
  }, [onClose, onSubmit, submittable, trimmed]);

  return (
    <Sheet
      testID={`${testID}-sheet`}
      visible={visible}
      onClose={() => { if (!saving) onClose(); }}
      closeAccessibilityLabel={t('Close')}
      title={title ?? t('Rename')}
      dismissOnBackdropPress={!saving}
      maxHeight="55%"
    >
      <View style={styles.content}>
        <View style={[styles.field, { backgroundColor: theme.colors.surfaceFloating }]}>
          <CompositionSafeBottomSheetTextInput
            testID={`${testID}-input`}
            style={[styles.input, { color: theme.colors.ink }]}
            value={draft}
            onChangeText={setDraft}
            editable={!saving}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={() => { void submit(); }}
          />
        </View>
        <View style={styles.actions}>
          <Button
            testID={`${testID}-cancel`}
            label={t('Cancel')}
            variant="secondary"
            disabled={saving}
            onPress={onClose}
            style={styles.action}
          />
          <Button
            testID={`${testID}-save`}
            label={t('Save')}
            loading={saving}
            disabled={!submittable}
            onPress={() => { void submit(); }}
            style={styles.action}
          />
        </View>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: Space.lg,
    paddingBottom: Space.lg,
    gap: Space.lg,
  },
  field: {
    minHeight: ControlSize.floatingButton,
    justifyContent: 'center',
    borderRadius: Radius.settingsGroup,
    overflow: 'hidden',
  },
  input: {
    minHeight: ControlSize.floatingButton,
    paddingHorizontal: Space.md,
    paddingVertical: 0,
    fontSize: FontSize.secondary,
    lineHeight: LineHeight.secondary,
  },
  actions: {
    flexDirection: 'row',
    gap: Space.sm,
  },
  action: {
    flex: 1,
  },
});
