import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Check } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import type {
  AgentAdapter,
  AgentDescriptor,
  ModelSelectionState,
} from '@clawket/agent-protocol';
import { Banner } from '../../components/ui/Banner';
import { SearchInput } from '../../components/ui/SearchInput';
import { SegmentedTabs } from '../../components/ui/SegmentedTabs';
import {
  SettingsDivider,
  SettingsGroup,
  SettingsRow,
} from '../../components/ui/SettingsGroup';
import { Skeleton } from '../../components/ui/Skeleton';
import { useAppTheme } from '../../theme';
import {
  ControlSize,
  FontSize,
  FontWeight,
  IconSize,
  LineHeight,
  Space,
} from '../../theme/tokens';
import {
  buildAgentModelGroups,
  buildModelSelectionWrite,
  formatModelCost,
  type AgentModelRow,
} from './models-model';

type ModelsView = 'models' | 'providers';

export type ModelsSectionProps = Readonly<{
  adapter: AgentAdapter;
  agent: AgentDescriptor;
  online: boolean;
}>;

export function ModelsSection({
  adapter,
  agent,
  online,
}: ModelsSectionProps): React.JSX.Element {
  const { t } = useTranslation(['common', 'settings', 'config']);
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);
  const operations = adapter.management?.models;
  const [selection, setSelection] = useState<ModelSelectionState | null>(null);
  const [view, setView] = useState<ModelsView>('models');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      let next = operations?.getSelection
        ? await operations.getSelection()
        : null;
      if ((!next || next.models.length === 0) && operations?.list) {
        const models = await operations.list();
        next = {
          currentModel: next?.currentModel ?? '',
          currentProvider: next?.currentProvider ?? '',
          currentBaseUrl: next?.currentBaseUrl ?? '',
          models,
          providers: next?.providers,
          note: next?.note,
        };
      }
      setSelection(next);
      setError(null);
    } catch (loadError: unknown) {
      setError(errorMessage(loadError, t('Failed to load models', { ns: 'settings' })));
    } finally {
      setLoading(false);
    }
  }, [operations, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const groups = useMemo(
    () => buildAgentModelGroups(selection, query),
    [query, selection],
  );
  const thinkingLevelCount = adapter.capabilities.thinkingLevels
    ? operations?.listThinkingLevels?.().length ?? 0
    : 0;
  const tabs = useMemo(() => [
    { key: 'models' as const, label: t('Models', { ns: 'common' }) },
    { key: 'providers' as const, label: t('Providers', { ns: 'config' }) },
  ], [t]);

  const selectModel = useCallback(async (row: AgentModelRow) => {
    if (!online || row.current || savingKey || !operations?.setSelection) return;
    setSavingKey(row.key);
    setError(null);
    try {
      const result = await operations.setSelection(buildModelSelectionWrite(
        row,
        adapter.capabilities,
        agent,
      ));
      setSelection((current) => ({
        currentModel: result.currentModel || row.id,
        currentProvider: result.currentProvider || row.provider,
        currentBaseUrl: result.currentBaseUrl || current?.currentBaseUrl || '',
        models: result.models.length ? result.models : current?.models ?? [],
        providers: result.providers ?? current?.providers,
        note: result.note ?? current?.note,
      }));
    } catch (saveError: unknown) {
      setError(errorMessage(saveError, t('Failed to load models', { ns: 'settings' })));
    } finally {
      setSavingKey(null);
    }
  }, [adapter.capabilities, agent, online, operations, savingKey, t]);

  if (loading && !selection) {
    return <ModelsLoading />;
  }

  return (
    <View testID="agent-models-section" style={styles.root}>
      <SegmentedTabs
        testID="agent-models-tabs"
        tabs={tabs}
        active={view}
        onSwitch={setView}
      />
      <SearchInput
        testID="agent-models-search"
        value={query}
        onChangeText={setQuery}
        placeholder={t('Search models...', { ns: 'settings' })}
      />
      {error ? (
        <Banner
          testID="agent-models-error"
          tone="bad"
          message={error}
          actionLabel={t('Retry', { ns: 'common' })}
          onAction={() => { void load(); }}
        />
      ) : null}
      {groups.length === 0 ? (
        <Text testID="agent-models-empty" style={styles.emptyText}>
          {t(query.trim() ? 'No models found' : 'No models available', { ns: 'settings' })}
        </Text>
      ) : view === 'models' ? (
        <View style={styles.groups}>
          {groups.map((group) => (
            <View key={group.provider} style={styles.groupWrap}>
              <Text style={styles.groupTitle}>
                {group.provider || t('Other', { ns: 'settings' })}
              </Text>
              <SettingsGroup>
                {group.rows.map((row, index) => (
                  <React.Fragment key={row.key}>
                    {index ? <SettingsDivider inset="content" /> : null}
                    <SettingsRow
                      testID={`agent-model-row-${row.key}`}
                      title={row.name}
                      value={savingKey === row.key
                        ? t('Loading...', { ns: 'common' })
                        : undefined}
                      trailing={row.current ? (
                        <Check
                          testID={`agent-model-current-${row.key}`}
                          size={IconSize.sm}
                          color={theme.colors.accent}
                          strokeWidth={2}
                        />
                      ) : undefined}
                      disabled={!online || row.current || Boolean(savingKey) || !operations?.setSelection}
                      onPress={() => { void selectModel(row); }}
                    />
                  </React.Fragment>
                ))}
              </SettingsGroup>
            </View>
          ))}
          {thinkingLevelCount > 0 ? (
            <View style={styles.groupWrap}>
              <Text style={styles.groupTitle}>{t('Thinking level', { ns: 'config' })}</Text>
              <SettingsGroup>
                <SettingsRow
                  title={t('Available', { ns: 'config' })}
                  value={String(thinkingLevelCount)}
                />
              </SettingsGroup>
            </View>
          ) : null}
        </View>
      ) : (
        <View style={styles.groups}>
          {groups.map((group) => (
            <View key={group.provider} style={styles.groupWrap}>
              <Text style={styles.groupTitle}>
                {group.provider || t('Other', { ns: 'settings' })}
              </Text>
              <SettingsGroup>
                {group.rows.map((row, index) => (
                  <React.Fragment key={row.key}>
                    {index ? <SettingsDivider inset="content" /> : null}
                    <SettingsRow
                      testID={`agent-model-cost-${row.key}`}
                      title={row.name}
                      value={formatModelCost(row.cost)}
                    />
                  </React.Fragment>
                ))}
              </SettingsGroup>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

function ModelsLoading(): React.JSX.Element {
  return (
    <View testID="agent-models-loading" style={stylesStatic.loading}>
      {[0, 1, 2, 3].map((row) => (
        <View key={row} style={stylesStatic.skeletonRow}>
          <Skeleton style={stylesStatic.skeletonTitle} />
          <Skeleton style={stylesStatic.skeletonValue} />
        </View>
      ))}
    </View>
  );
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  return fallback;
}

const stylesStatic = StyleSheet.create({
  loading: {
    gap: Space.sm,
  },
  skeletonRow: {
    minHeight: ControlSize.settingsRow,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.lg,
  },
  skeletonTitle: {
    flex: 1,
    height: LineHeight.body,
  },
  skeletonValue: {
    width: '20%',
    height: LineHeight.secondary,
  },
});

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    root: {
      gap: Space.lg,
    },
    groups: {
      gap: Space.xl,
    },
    groupWrap: {
      gap: Space.sm,
    },
    groupTitle: {
      paddingHorizontal: Space.xs,
      color: colors.inkSecondary,
      fontSize: FontSize.secondary,
      lineHeight: LineHeight.secondary,
      fontWeight: FontWeight.regular,
    },
    emptyText: {
      paddingVertical: Space.xxl,
      color: colors.inkSecondary,
      fontSize: FontSize.secondary,
      lineHeight: LineHeight.secondary,
      fontWeight: FontWeight.regular,
      textAlign: 'center',
    },
  });
}
