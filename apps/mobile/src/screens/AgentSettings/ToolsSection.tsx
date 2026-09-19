import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Check } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import type {
  AgentAdapter,
  AgentDescriptor,
  ToolCatalog,
  ToolPolicy,
} from '@clawket/agent-protocol';
import { Banner } from '../../components/ui/Banner';
import { ConfirmationModal } from '../../components/ui/ConfirmationModal';
import { SearchInput } from '../../components/ui/SearchInput';
import {
  SettingsDivider,
  SettingsGroup,
  SettingsRow,
} from '../../components/ui/SettingsGroup';
import { Skeleton } from '../../components/ui/Skeleton';
import { ThemedSwitch } from '../../components/ui/ThemedSwitch';
import { analyticsEvents } from '../../services/analytics/events';
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
  activeToolProfile,
  computeToolPolicyDiff,
  countCatalogTools,
  countEnabledTools,
  extractAgentToolPolicy,
  filterToolCatalog,
  isExplicitToolAllowList,
  isToolEnabledForPolicy,
  sameToolPolicy,
  selectToolProfile,
  toggleToolInPolicy,
} from './tools-model';

export type ToolsEditorState = Readonly<{
  dirty: boolean;
  saving: boolean;
  editable: boolean;
}>;

export type ToolsSectionProps = Readonly<{
  adapter: AgentAdapter;
  agent: AgentDescriptor;
  online: boolean;
  /** Bumped by the host each time its header Save is pressed; opens the confirmation. */
  saveRequest?: number;
  /** Reports the draft state so the host can drive the header Save and its leave guard. */
  onEditorChange?: (state: ToolsEditorState) => void;
}>;

export function ToolsSection({
  adapter,
  agent,
  online,
  saveRequest = 0,
  onEditorChange,
}: ToolsSectionProps): React.JSX.Element {
  const { t } = useTranslation(['common', 'settings', 'config']);
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);
  const operations = adapter.management?.tools;
  const configOperations = adapter.management?.config;
  const supported = adapter.capabilities.tools && Boolean(operations?.catalog);
  const [catalog, setCatalog] = useState<ToolCatalog | null>(null);
  const [savedPolicy, setSavedPolicy] = useState<ToolPolicy>({ agentId: agent.agentId });
  const [draftPolicy, setDraftPolicy] = useState<ToolPolicy>({ agentId: agent.agentId });
  const [policyLoaded, setPolicyLoaded] = useState(false);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(supported && online);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmVisible, setConfirmVisible] = useState(false);
  const catalogLabels = useMemo<Record<string, string>>(() => ({
    Minimal: t('Minimal tools', { ns: 'settings' }),
    Coding: t('Coding tools', { ns: 'settings' }),
    Messaging: t('Messaging', { ns: 'settings' }),
    Full: t('All tools', { ns: 'settings' }),
    Files: t('Files', { ns: 'common' }),
    Runtime: t('Execution tools', { ns: 'settings' }),
    Web: t('Web tools', { ns: 'settings' }),
    Memory: t('Memory', { ns: 'settings' }),
    Sessions: t('Sessions', { ns: 'common' }),
    UI: t('Interface tools', { ns: 'settings' }),
    Automation: t('Automation tools', { ns: 'settings' }),
    Nodes: t('Nodes', { ns: 'settings' }),
    Agents: t('Agents', { ns: 'common' }),
  }), [t]);

  const load = useCallback(async () => {
    if (!supported || !online || !operations?.catalog) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const nextCatalog = await operations.catalog(agent.agentId);
      setCatalog(nextCatalog);
      if (configOperations?.view) {
        try {
          const config = await configOperations.view();
          const nextPolicy = extractAgentToolPolicy(config.config, agent.agentId);
          setSavedPolicy(nextPolicy);
          setDraftPolicy(nextPolicy);
          setPolicyLoaded(true);
        } catch (configError: unknown) {
          setPolicyLoaded(false);
          setError(errorMessage(configError, t('Unavailable', { ns: 'settings' })));
        }
      } else {
        setSavedPolicy({ agentId: agent.agentId });
        setDraftPolicy({ agentId: agent.agentId });
        setPolicyLoaded(false);
      }
    } catch (loadError: unknown) {
      setCatalog(null);
      setPolicyLoaded(false);
      setError(errorMessage(loadError, t('Settings could not load', { ns: 'common' })));
    } finally {
      setLoading(false);
    }
  }, [agent.agentId, configOperations, online, operations, supported, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const groups = useMemo(
    () => catalog ? filterToolCatalog({ ...catalog, groups: catalog.groups.map(group => ({
      ...group, label: catalogLabels[group.label] ?? group.label,
    })) }, query) : [],
    [catalog, catalogLabels, query],
  );
  const totalTools = catalog ? countCatalogTools(catalog) : 0;
  const enabledTools = catalog ? countEnabledTools(catalog, draftPolicy) : 0;
  const explicitAllow = isExplicitToolAllowList(savedPolicy);
  const editable = online && policyLoaded && !explicitAllow && Boolean(operations?.save);
  const dirty = catalog !== null && !sameToolPolicy(savedPolicy, draftPolicy);
  const diff = catalog
    ? computeToolPolicyDiff(catalog, savedPolicy, draftPolicy)
    : { enabled: 0, disabled: 0, totalChanged: 0 };
  const changeCount = Math.max(diff.totalChanged, dirty ? 1 : 0);
  const activeProfile = catalog ? activeToolProfile(catalog, draftPolicy) : null;

  useEffect(() => {
    onEditorChange?.({ dirty, saving, editable });
  }, [dirty, editable, onEditorChange, saving]);
  // The host keeps the last report; an unmounted draft must not leave its Save or leave guard armed.
  useEffect(() => () => {
    onEditorChange?.({ dirty: false, saving: false, editable: false });
  }, [onEditorChange]);

  // Only a new request opens the confirmation; a later draft change must not reopen a cancelled one.
  useEffect(() => {
    if (saveRequest > 0 && dirty && editable && !saving) setConfirmVisible(true);
  }, [saveRequest]);

  const save = useCallback(async () => {
    if (!editable || !dirty || saving || !operations?.save) return;
    setSaving(true);
    setError(null);
    try {
      await operations.save(draftPolicy);
      analyticsEvents.toolsSaveTapped({
        changed_count: changeCount,
        enabled_count: enabledTools,
        total_count: totalTools,
      });
      setSavedPolicy(draftPolicy);
    } catch (saveError: unknown) {
      setError(errorMessage(saveError, t('Save failed', { ns: 'settings' })));
    } finally {
      setSaving(false);
    }
  }, [
    changeCount,
    dirty,
    draftPolicy,
    editable,
    enabledTools,
    operations,
    saving,
    t,
    totalTools,
  ]);

  if (!supported) {
    return (
      <Banner
        testID="agent-tools-unavailable"
        message={t('No available settings', { ns: 'config' })}
      />
    );
  }
  if (!online) {
    return (
      <Banner
        testID="agent-tools-offline"
        message={t('Offline', { ns: 'common' })}
      />
    );
  }
  if (loading && !catalog) return <ToolsLoading />;

  return (
    <>
      <View testID="agent-tools-section" style={styles.root}>
        <SearchInput
          testID="agent-tools-search"
          value={query}
          onChangeText={setQuery}
          placeholder={t('Search tools...', { ns: 'settings' })}
        />
        {error ? (
          <Banner
            testID="agent-tools-error"
            tone="bad"
            message={error}
            actionLabel={t('Retry', { ns: 'common' })}
            onAction={() => { void load(); }}
          />
        ) : null}
        {catalog && !policyLoaded ? (
          <Banner
            testID="agent-tools-read-only"
            message={t('Unavailable', { ns: 'settings' })}
          />
        ) : explicitAllow ? (
          <Banner
            testID="agent-tools-read-only"
            message={t('This agent uses an explicit allow list. Toggles are read-only.', {
              ns: 'settings',
            })}
          />
        ) : null}

        {catalog && catalog.profiles.length > 0 ? (
          <View style={styles.groupWrap}>
            <Text style={styles.groupTitle}>
              {t('Tool profile', { ns: 'config' })}
            </Text>
            <SettingsGroup testID="agent-tools-profiles">
              {catalog.profiles.map((profile, index) => (
                <React.Fragment key={profile.id}>
                  {index ? <SettingsDivider inset="content" /> : null}
                  <SettingsRow
                    testID={`agent-tools-profile-${profile.id}`}
                    title={catalogLabels[profile.label] ?? profile.label}
                    trailing={activeProfile === profile.id ? (
                      <Check
                        testID={`agent-tools-profile-current-${profile.id}`}
                        size={IconSize.sm}
                        color={theme.colors.accent}
                        strokeWidth={2}
                      />
                    ) : undefined}
                    disabled={!editable || saving}
                    onPress={editable && !saving
                      ? () => setDraftPolicy((current) => selectToolProfile(current, profile.id))
                      : undefined}
                  />
                </React.Fragment>
              ))}
            </SettingsGroup>
          </View>
        ) : null}

        {groups.length === 0 ? (
          <Text testID="agent-tools-empty" style={styles.emptyText}>
            {t('No available settings', { ns: 'config' })}
          </Text>
        ) : (
          <View style={styles.groups}>
            {groups.map((group) => (
              <View key={group.id} style={styles.groupWrap}>
                <Text style={styles.groupTitle}>{group.label}</Text>
                <SettingsGroup testID={`agent-tools-group-${group.id}`}>
                  {group.tools.map((tool, index) => (
                    <React.Fragment key={tool.id}>
                      {index ? <SettingsDivider inset="content" /> : null}
                      <SettingsRow
                        testID={`agent-tools-row-${tool.id}`}
                        title={tool.label}
                        disabled={!editable || saving}
                        trailing={(
                          <ThemedSwitch
                            testID={`agent-tools-toggle-${tool.id}`}
                            accessibilityLabel={tool.label}
                            value={isToolEnabledForPolicy(tool, draftPolicy)}
                            disabled={!editable || saving}
                            onValueChange={(enabled) => {
                              setDraftPolicy((current) => toggleToolInPolicy(
                                tool,
                                enabled,
                                current,
                              ));
                            }}
                          />
                        )}
                      />
                    </React.Fragment>
                  ))}
                </SettingsGroup>
              </View>
            ))}
          </View>
        )}
      </View>

      <ConfirmationModal
        testID="agent-tools-confirm"
        visible={confirmVisible}
        title={t('Apply {{count}} changes?', { ns: 'settings', count: changeCount })}
        message={[
          t('This will restart Gateway. Continue?', { ns: 'common' }),
          t('{{enabled}}/{{total}} tools will be active after saving.', {
            ns: 'settings',
            enabled: enabledTools,
            total: totalTools,
          }),
        ].join('\n')}
        confirmLabel={t('Save', { ns: 'common' })}
        cancelLabel={t('Cancel', { ns: 'common' })}
        onClose={() => setConfirmVisible(false)}
        onConfirm={() => {
          setConfirmVisible(false);
          void save();
        }}
      />
    </>
  );
}

function ToolsLoading(): React.JSX.Element {
  return (
    <View testID="agent-tools-loading" style={stylesStatic.loading}>
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
  loading: { gap: Space.sm },
  skeletonRow: {
    minHeight: ControlSize.settingsRow,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.lg,
  },
  skeletonTitle: { flex: 1, height: LineHeight.body },
  skeletonValue: { width: '20%', height: LineHeight.secondary },
});

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    root: { gap: Space.lg },
    groups: { gap: Space.xl },
    groupWrap: { gap: Space.sm },
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
