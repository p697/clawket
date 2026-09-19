import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { useTranslation } from 'react-i18next';
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
import type { AgentModelGroup } from './models-model';

export type ModelProviderSheetProps = Readonly<{
  visible: boolean;
  adding?: boolean;
  groups?: ReadonlyArray<AgentModelGroup>;
  onSelectProvider?: (provider: string) => void;
  group: AgentModelGroup | null;
  online: boolean;
  dirty: boolean;
  busy: boolean;
  error: string | null;
  canAdd: boolean;
  onClose: () => void;
  onAdd: (group: AgentModelGroup, modelId: string, modelName: string) => void;
  onOpenConfig?: () => void;
}>;

export function formatProviderTitle(slug: string, fallback: string): string {
  const trimmed = slug.trim();
  if (!trimmed) return fallback;
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

/** Where a provider's models come from, plus the add-model form for `manage` backends. */
export function ModelProviderSheet({
  visible,
  adding = false,
  groups = [],
  onSelectProvider,
  group,
  online,
  dirty,
  busy,
  error,
  canAdd,
  onClose,
  onAdd,
  onOpenConfig,
}: ModelProviderSheetProps): React.JSX.Element {
  const { t } = useTranslation(['common', 'settings', 'config']);
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);
  const [choosingProvider, setChoosingProvider] = useState(true);
  const [modelId, setModelId] = useState('');
  const [modelName, setModelName] = useState('');
  const [validation, setValidation] = useState<string | null>(null);

  useEffect(() => { if (visible) setChoosingProvider(true); }, [visible]);

  useEffect(() => {
    setModelId('');
    setModelName('');
    setValidation(null);
  }, [group?.provider, visible]);

  const submit = () => {
    if (!group) return;
    const id = modelId.trim();
    if (!id) {
      setValidation(t('Enter a model ID.', { ns: 'settings' }));
      return;
    }
    setValidation(null);
    onAdd(group, id, modelName.trim() || id);
  };

  const addLocked = !online || busy || dirty;

  return (
    <Sheet
      testID="agent-model-provider"
      visible={visible}
      title={adding ? t('Add model', { ns: 'settings' }) : group ? formatProviderTitle(group.provider, t('Other', { ns: 'settings' })) : ''}
      snapPoints={['82%', '92%']}
      closeAccessibilityLabel={t('Close', { ns: 'common' })}
      dismissOnBackdropPress={!busy}
      onClose={() => { if (!busy) onClose(); }}
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore"
    >
      <BottomSheetScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        {adding ? <View style={styles.form}>
          <Text style={styles.label}>{t('Provider', { ns: 'settings' })}</Text>
          <SettingsGroup chrome="plain">
            {!choosingProvider && group ? <SettingsRow
              title={formatProviderTitle(group.provider, t('Other', { ns: 'settings' }))}
              showChevron
              onPress={() => setChoosingProvider(true)}
            /> : groups.map((provider) => <SettingsRow
              key={provider.provider}
              testID={`agent-model-add-provider-${provider.provider}`}
              title={formatProviderTitle(provider.provider, t('Other', { ns: 'settings' }))}
              selected={provider.provider === group?.provider}
              value={provider.provider === group?.provider ? t('Current', { ns: 'config' }) : undefined}
              disabled={busy}
              onPress={() => { onSelectProvider?.(provider.provider); setChoosingProvider(false); }}
            />)}
          </SettingsGroup>
        </View> : null}
      {group ? (
        <View style={styles.form}>
          {error ? <Banner testID="agent-model-provider-error" tone="bad" message={error} /> : null}
          {!adding ? <SettingsGroup chrome="plain">
            <SettingsRow
              title={t('Models', { ns: 'settings' })}
              value={String(group.rows.length)}
            />
            {group.baseUrl ? (
              <>
                <SettingsDivider inset="none" />
                <SettingsRow title={t('Base URL', { ns: 'settings' })} value={group.baseUrl} />
              </>
            ) : null}
            {group.api ? (
              <>
                <SettingsDivider inset="none" />
                <SettingsRow title={t('API', { ns: 'settings' })} value={group.api} />
              </>
            ) : null}
            {onOpenConfig ? (
              <>
                <SettingsDivider inset="none" />
                <SettingsRow
                  testID="agent-model-provider-config"
                  title={t('Keys and endpoints', { ns: 'settings' })}
                  value={t('OpenClaw config', { ns: 'settings' })}
                  showChevron
                  onPress={onOpenConfig}
                />
              </>
            ) : null}
          </SettingsGroup> : null}

          {canAdd ? (
            <View style={styles.form}>
              <Text style={styles.sectionTitle}>{t('Add model', { ns: 'settings' })}</Text>
              {validation ? <Banner testID="agent-model-provider-validation" tone="bad" message={validation} /> : null}
              <View style={styles.field}>
                <Text style={styles.label}>{t('Model ID', { ns: 'settings' })}</Text>
                <FormTextInput
                  testID="agent-model-add-id"
                  accessibilityLabel={t('Model ID', { ns: 'settings' })}
                  value={modelId}
                  onChangeText={setModelId}
                  editable={!busy}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>
              <View style={styles.field}>
                <Text style={styles.label}>{t('Model name', { ns: 'settings' })}</Text>
                <FormTextInput
                  testID="agent-model-add-name"
                  accessibilityLabel={t('Model name', { ns: 'settings' })}
                  value={modelName}
                  onChangeText={setModelName}
                  editable={!busy}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>
              <Button
                testID="agent-model-add-submit"
                label={dirty ? t('Save changes first', { ns: 'settings' }) : t('Add model', { ns: 'settings' })}
                loading={busy}
                disabled={addLocked}
                onPress={submit}
              />
            </View>
          ) : null}
        </View>
      ) : null}
      </BottomSheetScrollView>
    </Sheet>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    content: { gap: Space.lg, paddingHorizontal: Space.xl, paddingBottom: Space.xxl },
    form: { gap: Space.md },
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
  });
}
