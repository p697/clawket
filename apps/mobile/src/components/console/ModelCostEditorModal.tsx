import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button, Card, FormTextInput, ModalSheet } from '../ui';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '../../theme';
import { ControlSize, FontSize, FontWeight, LineHeight, Space } from '../../theme/tokens';
import type { ModelCostValue } from '../../utils/model-cost-config';

export type ModelCostDraft = {
  input: string;
  output: string;
  cacheRead: string;
  cacheWrite: string;
};

type Props = {
  visible: boolean;
  title: string;
  provider: string;
  modelId: string;
  editable: boolean;
  draft: ModelCostDraft;
  saving: boolean;
  saveDisabled: boolean;
  initialCost: ModelCostValue;
  deleteVisible: boolean;
  deleteDisabled: boolean;
  deleting: boolean;
  deleteBlockedReasons: string[];
  onChangeField: (field: keyof ModelCostDraft, value: string) => void;
  onClose: () => void;
  onSave: () => void;
  onDelete: () => void;
};

type CostField = {
  key: keyof ModelCostDraft;
  label: string;
};

export function ModelCostEditorModal({
  visible,
  title,
  provider,
  modelId,
  editable,
  draft,
  saving,
  saveDisabled,
  initialCost,
  deleteVisible,
  deleteDisabled,
  deleting,
  deleteBlockedReasons,
  onChangeField,
  onClose,
  onSave,
  onDelete,
}: Props): React.JSX.Element {
  const { t } = useTranslation('console');
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors), [theme]);

  const fields = useMemo<CostField[]>(() => [
    { key: 'input', label: t('Input Cost') },
    { key: 'output', label: t('Output Cost') },
    { key: 'cacheRead', label: t('Cache Read Cost') },
    { key: 'cacheWrite', label: t('Cache Write Cost') },
  ], [t]);

  return (
    <ModalSheet visible={visible} onClose={onClose} title={title} maxHeight="82%">
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.infoText}>
          <Text style={styles.infoLabel}>{t('Provider')}:  </Text>
          <Text style={styles.infoValue}>{provider}</Text>
        </Text>
        <Text style={styles.infoText} selectable>
          <Text style={styles.infoLabel}>{t('Model ID')}:  </Text>
          <Text style={styles.infoValue}>{modelId}</Text>
        </Text>

        <View style={styles.divider} />

        <Text style={styles.costHint}>{t('USD per 1M tokens')}</Text>

        {fields.map((field) => (
          <View key={field.key} style={styles.fieldRow}>
            <Text style={styles.fieldLabel}>{field.label}</Text>
            <FormTextInput
              value={draft[field.key]}
              onChangeText={(value) => onChangeField(field.key, value)}
              containerStyle={[styles.inputField, !editable && styles.inputDisabled]}
              inputStyle={styles.inputText}
              minHeight={ControlSize.compact}
              surface="sunken"
              placeholder={String(initialCost[field.key])}
              keyboardType="decimal-pad"
              autoCapitalize="none"
              autoCorrect={false}
              editable={editable && !saving}
            />
          </View>
        ))}

        <Button
          label={saving ? t('common:Saving...') : t('common:Save')}
          onPress={onSave}
          disabled={saveDisabled}
          loading={saving}
          style={styles.saveButton}
        />

        {deleteVisible ? (
          <View style={styles.deleteSection}>
            {deleteBlockedReasons.length > 0 ? (
              <Card style={styles.blockCard}>
                <Text style={styles.blockText}>{t('This model cannot be deleted yet.')}</Text>
                {deleteBlockedReasons.map((reason) => (
                  <Text key={reason} style={styles.blockReasonText}>- {reason}</Text>
                ))}
              </Card>
            ) : null}

            <Button
              label={deleting ? t('Deleting model...') : t('Delete Model')}
              variant="destructive"
              onPress={onDelete}
              disabled={deleteDisabled}
              loading={deleting}
            />
          </View>
        ) : null}
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
    infoText: {
      fontSize: FontSize.md,
      lineHeight: LineHeight.md,
    },
    infoLabel: {
      color: colors.textMuted,
      fontWeight: FontWeight.medium,
    },
    infoValue: {
      color: colors.text,
      fontWeight: FontWeight.medium,
    },
    divider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.border,
    },
    costHint: {
      color: colors.textSubtle,
      fontSize: FontSize.sm,
    },
    blockCard: {
      borderColor: colors.error,
    },
    blockText: {
      color: colors.error,
      fontSize: FontSize.sm,
      lineHeight: LineHeight.sm,
    },
    blockReasonText: {
      color: colors.error,
      fontSize: FontSize.sm,
      lineHeight: LineHeight.sm,
      marginTop: Space.xs,
    },
    fieldRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: Space.md,
    },
    fieldLabel: {
      color: colors.textMuted,
      fontSize: FontSize.md,
      fontWeight: FontWeight.medium,
      flexShrink: 0,
    },
    inputField: {
      width: 100,
    },
    inputText: {
      fontSize: FontSize.md,
      fontWeight: FontWeight.medium,
      textAlign: 'right',
      paddingHorizontal: Space.sm,
    },
    inputDisabled: {
      opacity: 0.6,
    },
    saveButton: {
      marginTop: Space.sm,
    },
    deleteSection: {
      gap: Space.sm,
    },
  });
}
