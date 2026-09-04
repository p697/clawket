import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Button, Card, FormTextInput, ModalSheet } from '../ui';
import { useAppTheme } from '../../theme';
import { FontSize, FontWeight, Space } from '../../theme/tokens';

export type AddModelDraft = {
  modelId: string;
  modelName: string;
};

type Props = {
  visible: boolean;
  provider: string;
  draft: AddModelDraft;
  saving: boolean;
  saveDisabled: boolean;
  onChangeField: (field: keyof AddModelDraft, value: string) => void;
  onClose: () => void;
  onSave: () => void;
};

export function AddModelModal({
  visible,
  provider,
  draft,
  saving,
  saveDisabled,
  onChangeField,
  onClose,
  onSave,
}: Props): React.JSX.Element {
  const { t } = useTranslation('console');
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors), [theme]);

  return (
    <ModalSheet visible={visible} onClose={onClose} title={t('Add Model')} maxHeight="78%">
      <ScrollView contentContainerStyle={styles.content}>
        <Card tone="muted">
          <Text style={styles.metaLabel}>{t('Provider')}</Text>
          <Text style={styles.metaValue}>{provider}</Text>
        </Card>

        <View style={styles.fieldWrap}>
          <Text style={styles.fieldLabel}>{t('Model ID')}</Text>
          <FormTextInput
            value={draft.modelId}
            onChangeText={(value) => onChangeField('modelId', value)}
            surface="sunken"
            placeholder={t('Enter a unique model ID')}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!saving}
          />
        </View>

        <View style={styles.fieldWrap}>
          <Text style={styles.fieldLabel}>{t('Model Name')}</Text>
          <FormTextInput
            value={draft.modelName}
            onChangeText={(value) => onChangeField('modelName', value)}
            surface="sunken"
            placeholder={t('Enter a display name')}
            autoCapitalize="words"
            autoCorrect={false}
            editable={!saving}
          />
        </View>

        <Button
          label={saving ? t('common:Saving...') : t('common:Add')}
          onPress={onSave}
          disabled={saveDisabled}
          loading={saving}
          style={styles.saveButton}
        />
      </ScrollView>
    </ModalSheet>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    content: {
      padding: Space.md,
      paddingBottom: Space.xxxl,
      gap: Space.md,
    },
    metaLabel: {
      color: colors.textMuted,
      fontSize: FontSize.sm,
      fontWeight: FontWeight.medium,
    },
    metaValue: {
      color: colors.text,
      fontSize: FontSize.base,
      fontWeight: FontWeight.semibold,
      fontFamily: 'monospace',
    },
    fieldWrap: {
      gap: Space.xs,
    },
    fieldLabel: {
      color: colors.textMuted,
      fontSize: FontSize.md,
      fontWeight: FontWeight.medium,
    },
    saveButton: {
      marginTop: Space.sm,
    },
  });
}
