import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useTranslation } from 'react-i18next';
import type { ModelCost, ModelDeletionPreview } from '@clawket/agent-protocol';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { FormTextInput } from '../../components/ui/FormTextInput';
import {
  SettingsDivider,
  SettingsGroup,
  SettingsRow,
} from '../../components/ui/SettingsGroup';
import { Sheet } from '../../components/ui/Sheet';
import { useAppTheme } from '../../theme';
import { FontSize, FontWeight, LineHeight, Space } from '../../theme/tokens';
import {
  formatContextWindow,
  formatCostNumber,
  type AgentModelGroup,
  type AgentModelRow,
  type ModelsMode,
} from './models-model';

export type ModelDetailSheetProps = Readonly<{
  visible: boolean;
  row: AgentModelRow | null;
  group: AgentModelGroup | null;
  mode: ModelsMode;
  online: boolean;
  dirty: boolean;
  busy: boolean;
  deletion: ModelDeletionPreview | null;
  error: string | null;
  canDelete: boolean;
  canEditCost: boolean;
  onClose: () => void;
  onSetDefault: (row: AgentModelRow) => void;
  onToggleFallback: (row: AgentModelRow) => void;
  onSaveCost: (row: AgentModelRow, cost: ModelCost) => void;
  onDelete: (row: AgentModelRow) => void;
}>;

type CostField = keyof ModelCost;
const COST_FIELDS: ReadonlyArray<CostField> = ['input', 'output', 'cacheRead', 'cacheWrite'];

type Translate = (key: string, options: { ns: string }) => string;

function blockLabel(reason: string, t: Translate): string {
  if (reason === 'model_not_configured') return t('Not in Gateway config', { ns: 'settings' });
  if (reason.startsWith('defaults_')) return t('Agent defaults', { ns: 'settings' });
  if (reason.startsWith('agent_')) return t('An Agent', { ns: 'settings' });
  if (reason === 'channel_model_override') return t('A channel', { ns: 'settings' });
  return t('A hook', { ns: 'settings' });
}

export function describeDeletionBlocks(preview: ModelDeletionPreview | null, t: Translate): string[] {
  if (!preview || preview.canDelete) return [];
  return [...new Set(preview.blocks.map((block) => blockLabel(block.reason, t)))];
}

function costDraftFrom(row: AgentModelRow | null): Record<CostField, string> {
  const cost = row?.model.cost;
  return {
    input: cost ? String(cost.input) : '',
    output: cost ? String(cost.output) : '',
    cacheRead: cost ? String(cost.cacheRead) : '',
    cacheWrite: cost ? String(cost.cacheWrite) : '',
  };
}

export function parseCostDraft(draft: Record<CostField, string>): ModelCost | null {
  const cost = {} as ModelCost;
  for (const field of COST_FIELDS) {
    const value = Number(draft[field].trim() || '0');
    if (!Number.isFinite(value) || value < 0) return null;
    cost[field] = value;
  }
  return cost;
}

/** Everything about one catalog model plus the actions the backend allows on it. */
export function ModelDetailSheet({
  visible,
  row,
  group,
  mode,
  online,
  dirty,
  busy,
  deletion,
  error,
  canDelete,
  canEditCost,
  onClose,
  onSetDefault,
  onToggleFallback,
  onSaveCost,
  onDelete,
}: ModelDetailSheetProps): React.JSX.Element {
  const { t } = useTranslation(['common', 'settings', 'config', 'chat']);
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);
  const [copied, setCopied] = useState(false);
  const [editingCost, setEditingCost] = useState(false);
  const [costDraft, setCostDraft] = useState(costDraftFrom(row));
  const [costError, setCostError] = useState<string | null>(null);

  useEffect(() => {
    setCopied(false);
    setEditingCost(false);
    setCostDraft(costDraftFrom(row));
    setCostError(null);
  }, [row?.key, visible]);

  const manage = mode === 'manage';
  const blocks = describeDeletionBlocks(deletion, t);
  const contextWindow = formatContextWindow(row?.model.contextWindow);
  const capabilities = [
    row?.model.reasoning ? t('Reasoning', { ns: 'chat' }) : null,
    row?.model.input?.includes('image') ? t('Image', { ns: 'settings' }) : null,
  ].filter(Boolean).join(' · ');
  const cost = row?.model.cost;
  const writeLocked = !online || busy;
  const immediateLocked = writeLocked || dirty;
  const immediateHint = dirty ? t('Save changes first', { ns: 'settings' }) : undefined;

  const copyReference = () => {
    if (!row) return;
    void Clipboard.setStringAsync(row.reference).then(() => setCopied(true)).catch(() => setCopied(false));
  };

  const saveCost = () => {
    if (!row) return;
    const parsed = parseCostDraft(costDraft);
    if (!parsed) {
      setCostError(t('Enter valid non-negative numbers.', { ns: 'settings' }));
      return;
    }
    setCostError(null);
    onSaveCost(row, parsed);
  };

  return (
    <Sheet
      testID="agent-model-detail"
      visible={visible}
      title={row?.name ?? ''}
      closeAccessibilityLabel={t('Close', { ns: 'common' })}
      dismissOnBackdropPress={!busy}
      onClose={() => { if (!busy) onClose(); }}
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore"
    >
      {row ? (
        <View style={styles.content}>
          {error ? <Banner testID="agent-model-detail-error" tone="bad" message={error} /> : null}
          <SettingsGroup>
            <SettingsRow title={t('Model ID', { ns: 'settings' })} value={row.id} />
            <SettingsDivider inset="content" />
            <SettingsRow title={t('Provider', { ns: 'settings' })} value={row.provider || t('Other', { ns: 'settings' })} />
            {contextWindow ? (
              <>
                <SettingsDivider inset="content" />
                <SettingsRow title={t('Context window', { ns: 'settings' })} value={contextWindow} />
              </>
            ) : null}
            {capabilities ? (
              <>
                <SettingsDivider inset="content" />
                <SettingsRow title={t('Capabilities', { ns: 'settings' })} value={capabilities} />
              </>
            ) : null}
            {cost ? (
              <>
                <SettingsDivider inset="content" />
                <SettingsRow
                  title={t('Cost per 1M tokens', { ns: 'settings' })}
                  value={`$${formatCostNumber(cost.input)} / $${formatCostNumber(cost.output)}`}
                />
              </>
            ) : null}
          </SettingsGroup>

          {editingCost ? (
            <View style={styles.costEditor}>
              <Text style={styles.sectionTitle}>{t('Cost per 1M tokens', { ns: 'settings' })}</Text>
              {costError ? <Banner testID="agent-model-cost-error" tone="bad" message={costError} /> : null}
              {COST_FIELDS.map((field) => (
                <View key={field} style={styles.field}>
                  <Text style={styles.label}>{translateCostField(field, t)}</Text>
                  <FormTextInput
                    testID={`agent-model-cost-${field}`}
                    accessibilityLabel={translateCostField(field, t)}
                    value={costDraft[field]}
                    onChangeText={(value) => setCostDraft((current) => ({ ...current, [field]: value }))}
                    keyboardType="decimal-pad"
                    editable={!busy}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                </View>
              ))}
              <View style={styles.actionRow}>
                <Button
                  testID="agent-model-cost-cancel"
                  label={t('Cancel', { ns: 'common' })}
                  variant="secondary"
                  disabled={busy}
                  onPress={() => setEditingCost(false)}
                  style={styles.actionButton}
                />
                <Button
                  testID="agent-model-cost-save"
                  label={t('Save', { ns: 'common' })}
                  loading={busy}
                  disabled={immediateLocked}
                  onPress={saveCost}
                  style={styles.actionButton}
                />
              </View>
            </View>
          ) : (
            <SettingsGroup>
              <SettingsRow
                testID="agent-model-set-default"
                title={manage
                  ? t('Set as default model', { ns: 'settings' })
                  : t('Set as current model', { ns: 'settings' })}
                value={row.current ? t('Current', { ns: 'config' }) : busy && !manage ? t('Loading...', { ns: 'common' }) : undefined}
                disabled={row.current || (manage ? !online : writeLocked)}
                onPress={() => onSetDefault(row)}
              />
              {manage ? (
                <>
                  <SettingsDivider inset="content" />
                  <SettingsRow
                    testID="agent-model-toggle-fallback"
                    title={row.fallbackIndex >= 0
                      ? t('Remove from fallbacks', { ns: 'settings' })
                      : t('Add to fallbacks', { ns: 'settings' })}
                    disabled={row.current || !online}
                    onPress={() => onToggleFallback(row)}
                  />
                </>
              ) : null}
              <SettingsDivider inset="content" />
              <SettingsRow
                testID="agent-model-copy"
                title={t('Copy model reference', { ns: 'settings' })}
                value={copied ? t('Copied', { ns: 'config' }) : row.reference}
                onPress={copyReference}
              />
              {manage && canEditCost ? (
                <>
                  <SettingsDivider inset="content" />
                  <SettingsRow
                    testID="agent-model-edit-cost"
                    title={t('Edit cost', { ns: 'settings' })}
                    value={group?.explicit ? immediateHint : t('Read only', { ns: 'config' })}
                    disabled={!group?.explicit || immediateLocked}
                    onPress={() => setEditingCost(true)}
                  />
                </>
              ) : null}
              {manage && canDelete ? (
                <>
                  <SettingsDivider inset="content" />
                  <SettingsRow
                    testID="agent-model-delete"
                    title={t('Delete model', { ns: 'settings' })}
                    value={blocks.length > 0
                      ? t('Still used by {{targets}}', { ns: 'settings', targets: blocks.join(', ') })
                      : immediateHint}
                    destructive
                    disabled={immediateLocked || deletion === null || !deletion.canDelete}
                    onPress={() => onDelete(row)}
                  />
                </>
              ) : null}
            </SettingsGroup>
          )}
        </View>
      ) : null}
    </Sheet>
  );
}

function translateCostField(field: CostField, t: (key: string, options: { ns: string }) => string): string {
  if (field === 'input') return t('Input', { ns: 'settings' });
  if (field === 'output') return t('Output', { ns: 'settings' });
  if (field === 'cacheRead') return t('Cache read', { ns: 'settings' });
  return t('Cache write', { ns: 'settings' });
}

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    content: { gap: Space.lg, padding: Space.lg, paddingBottom: Space.xxl },
    costEditor: { gap: Space.md },
    field: { gap: Space.sm },
    sectionTitle: {
      color: colors.inkSecondary,
      fontSize: FontSize.secondary,
      lineHeight: LineHeight.secondary,
      fontWeight: FontWeight.regular,
    },
    label: {
      color: colors.inkSecondary,
      fontSize: FontSize.secondary,
      lineHeight: LineHeight.secondary,
      fontWeight: FontWeight.regular,
    },
    actionRow: { flexDirection: 'row', gap: Space.md },
    actionButton: { flex: 1 },
  });
}
