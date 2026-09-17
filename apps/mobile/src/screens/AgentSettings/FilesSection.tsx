import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type {
  AgentAdapter,
  AgentDescriptor,
  AgentFile,
  AgentFileSummary,
} from '@clawket/agent-protocol';
import { analyticsAgentDocument, analyticsEvents } from '../../services/analytics/events';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { FormTextInput } from '../../components/ui/FormTextInput';
import { SearchInput } from '../../components/ui/SearchInput';
import {
  SettingsDivider,
  SettingsGroup,
  SettingsRow,
} from '../../components/ui/SettingsGroup';
import { Sheet } from '../../components/ui/Sheet';
import { Skeleton } from '../../components/ui/Skeleton';
import { useAppTheme } from '../../theme';
import {
  ControlSize,
  FontSize,
  FontWeight,
  LineHeight,
  Space,
} from '../../theme/tokens';
import {
  canEditAgentFile,
  canSaveAgentFile,
  filterAgentFiles,
  formatFileSize,
} from './files-model';

export type FilesSectionProps = Readonly<{
  adapter: AgentAdapter;
  agent: AgentDescriptor;
  online: boolean;
  isPro: boolean;
  onOpenPaywall: (reason: string, onContinue?: () => void) => void;
}>;

export function FilesSection(props: FilesSectionProps): React.JSX.Element {
  return <FilesContent key={`${props.agent.connectionId}:${props.agent.agentId}`} {...props} />;
}

function FilesContent({
  adapter,
  agent,
  online,
  isPro,
  onOpenPaywall,
}: FilesSectionProps): React.JSX.Element {
  const { t } = useTranslation(['common', 'settings']);
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);
  const operations = adapter.management?.agents?.files;
  const [files, setFiles] = useState<ReadonlyArray<AgentFileSummary> | null>(null);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState<AgentFileSummary | null>(null);
  const [detail, setDetail] = useState<AgentFile | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [original, setOriginal] = useState('');
  const [saving, setSaving] = useState(false);
  const [discardVisible, setDiscardVisible] = useState(false);
  const active = useRef(false);
  const writeLock = useRef(false);
  const listRequest = useRef(0);
  const detailRequest = useRef(0);
  const current = useRef({ adapter, operations, online, selection, draft, editing });
  current.current = { adapter, operations, online, selection, draft, editing };
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);
  const changed = draft !== original;
  const editable = canEditAgentFile(adapter.capabilities, operations);
  const backend = adapter.connection.backendKind;
  const startEditing = useCallback(() => {
    setEditing(true);
    if (selection) {
      analyticsEvents.agentFileActivity({ action: 'edit', backend, document: analyticsAgentDocument(selection.name) });
    }
  }, [backend, selection]);

  const load = useCallback(async () => {
    const request = ++listRequest.current;
    const valid = () => active.current && current.current.operations === operations && request === listRequest.current;
    if (!operations?.list) {
      setFiles([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const result = await operations.list(agent.agentId);
      if (!valid()) return;
      setFiles(result);
      setError(null);
    } catch (loadError: unknown) {
      if (!valid()) return;
      setError(errorMessage(loadError, t('Failed to load files', { ns: 'settings' })));
      setFiles((current) => current ?? []);
    } finally {
      if (valid()) setLoading(false);
    }
  }, [agent.agentId, operations, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const openFile = useCallback(async (file: AgentFileSummary) => {
    if (writeLock.current) return;
    const request = ++detailRequest.current;
    const valid = () => active.current && current.current.operations === operations && request === detailRequest.current;
    if (file.missing) {
      // A listed-but-absent core file is created in place; the backend owns the list.
      if (!editable) return;
      setSelection(file);
      setDetail({ ...file, content: '' });
      setDetailError(null);
      setDetailLoading(false);
      setDraft('');
      setOriginal('');
      setEditing(true);
      analyticsEvents.agentFileActivity({ action: 'edit', backend, document: analyticsAgentDocument(file.name) });
      return;
    }
    if (!operations?.get) return;
    setSelection(file);
    setDetail(null);
    setDetailError(null);
    setDetailLoading(true);
    setEditing(false);
    try {
      const result = await operations.get(file.name, agent.agentId);
      if (!valid()) return;
      setDetail(result);
      const content = result.content ?? '';
      setDraft(content);
      setOriginal(content);
    } catch (loadError: unknown) {
      if (!valid()) return;
      setDetailError(errorMessage(loadError, t('Failed to load file', { ns: 'settings' })));
    } finally {
      if (valid()) setDetailLoading(false);
    }
  }, [agent.agentId, backend, editable, operations, t]);

  const closeDetail = useCallback(() => {
    if (writeLock.current) return;
    if (editing && changed) {
      setDiscardVisible(true);
      return;
    }
    detailRequest.current += 1;
    setSelection(null);
    setDetail(null);
    setEditing(false);
    setDetailError(null);
  }, [changed, editing]);

  const commitSave = useCallback(async () => {
    const valid = () => active.current && current.current.adapter === adapter
      && current.current.operations === operations && current.current.selection === selection
      && current.current.draft === draft && current.current.editing;
    if (!valid() || !selection || writeLock.current || !canSaveAgentFile({
      capabilities: adapter.capabilities,
      operations,
      online: current.current.online,
      changed,
    })) return;
    writeLock.current = true;
    setSaving(true);
    setDetailError(null);
    try {
      const result = await operations?.set?.(selection.name, draft, agent.agentId);
      if (!valid()) return;
      if (!result?.ok) throw new Error(t('Gateway rejected save request', { ns: 'settings' }));
      analyticsEvents.agentFileActivity({ action: 'saved', backend, document: analyticsAgentDocument(selection.name) });
      setOriginal(draft);
      setEditing(false);
      setDetail((current) => current ? { ...current, missing: false, content: draft } : current);
      await load();
    } catch (saveError: unknown) {
      if (!valid()) return;
      analyticsEvents.agentFileActivity({ action: 'failed', backend, document: analyticsAgentDocument(selection.name) });
      setDetailError(errorMessage(saveError, t('Save failed', { ns: 'settings' })));
    } finally {
      writeLock.current = false;
      if (active.current) setSaving(false);
    }
  }, [adapter, agent.agentId, backend, changed, draft, load, operations, selection, t]);

  const save = useCallback(() => {
    if (!isPro) {
      onOpenPaywall('coreFileEditing', () => { void commitSave(); });
      return;
    }
    void commitSave();
  }, [commitSave, isPro, onOpenPaywall]);

  const visibleFiles = useMemo(
    () => filterAgentFiles(files ?? [], query),
    [files, query],
  );

  if (loading && files === null) return <FilesLoading />;

  return (
    <>
      <View testID="agent-files-section" style={styles.root}>
        <SearchInput
          testID="agent-files-search"
          value={query}
          onChangeText={setQuery}
          placeholder={t('Search files...', { ns: 'settings' })}
        />
        {error ? (
          <Banner
            testID="agent-files-error"
            tone="bad"
            message={error}
            actionLabel={t('Retry', { ns: 'common' })}
            onAction={() => { void load(); }}
          />
        ) : null}
        {visibleFiles.length ? (
          <SettingsGroup testID="agent-files-list">
            {visibleFiles.map((file, index) => (
              <React.Fragment key={file.name}>
                {index ? <SettingsDivider inset="content" /> : null}
                <SettingsRow
                  testID={`agent-file-${file.name}`}
                  title={file.name}
                  value={file.missing
                    ? editable ? t('Create', { ns: 'common' }) : t('Missing', { ns: 'settings' })
                    : formatFileSize(file.size)}
                  disabled={file.missing ? !editable : !operations?.get}
                  showChevron={file.missing ? editable : Boolean(operations?.get)}
                  onPress={() => { void openFile(file); }}
                />
              </React.Fragment>
            ))}
          </SettingsGroup>
        ) : (
          <Text testID="agent-files-empty" style={styles.emptyText}>
            {t(query.trim() ? 'No files found' : 'No agent files', { ns: 'settings' })}
          </Text>
        )}
      </View>

      <Sheet
        testID="agent-file-detail"
        visible={selection !== null && !discardVisible}
        title={selection?.name}
        closeAccessibilityLabel={t('Back', { ns: 'common' })}
        dismissOnBackdropPress={!saving}
        onClose={closeDetail}
      >
        <View style={styles.sheetContent}>
          {detailLoading ? <FilesLoading compact /> : null}
          {detailError ? (
            <Banner
              testID="agent-file-detail-error"
              tone="bad"
              message={detailError}
              actionLabel={!detail ? t('Retry', { ns: 'common' }) : undefined}
              onAction={!detail ? () => {
                if (selection) void openFile(selection);
              } : undefined}
            />
          ) : null}
          {detail && !detailLoading ? (
            <>
              {editing ? (
                <FormTextInput
                  testID="agent-file-editor-input"
                  value={draft}
                  onChangeText={setDraft}
                  multiline
                  editable={!saving}
                  minHeight={ControlSize.settingsRow * 6}
                />
              ) : (
                <ScrollView style={styles.filePreview}>
                  <Text testID="agent-file-content" selectable style={styles.fileText}>
                    {original || t('Empty file', { ns: 'settings' })}
                  </Text>
                </ScrollView>
              )}
              {editing ? (
                <View style={styles.actionRow}>
                  <Button
                    testID="agent-file-cancel-edit"
                    label={t('Cancel', { ns: 'common' })}
                    variant="secondary"
                    disabled={saving}
                    onPress={() => {
                      setDraft(original);
                      setEditing(false);
                      if (detail.missing) {
                        setSelection(null);
                        setDetail(null);
                      }
                    }}
                    style={styles.actionButton}
                  />
                  <Button
                    testID="agent-file-save"
                    label={t('Save', { ns: 'common' })}
                    disabled={!canSaveAgentFile({
                      capabilities: adapter.capabilities,
                      operations,
                      online,
                      changed,
                    })}
                    loading={saving}
                    onPress={save}
                    style={styles.actionButton}
                  />
                </View>
              ) : editable ? (
                <Button
                  testID="agent-file-edit"
                  label={t('Edit', { ns: 'common' })}
                  variant="secondary"
                  disabled={!online}
                  onPress={startEditing}
                />
              ) : null}
            </>
          ) : null}
        </View>
      </Sheet>

      <Sheet
        testID="agent-file-discard-confirm"
        visible={discardVisible}
        title={t('Discard changes?', { ns: 'settings' })}
        closeAccessibilityLabel={t('Cancel', { ns: 'common' })}
        onClose={() => setDiscardVisible(false)}
      >
        <View style={styles.confirmContent}>
          <Text style={styles.detailText}>{t('You have unsaved changes.', { ns: 'settings' })}</Text>
          <View style={styles.actionRow}>
            <Button
              label={t('Keep Editing', { ns: 'settings' })}
              variant="secondary"
              onPress={() => setDiscardVisible(false)}
              style={styles.actionButton}
            />
            <Button
              testID="agent-file-discard-action"
              label={t('Discard', { ns: 'settings' })}
              variant="destructive"
              onPress={() => {
                setDiscardVisible(false);
                setSelection(null);
                setDetail(null);
                setEditing(false);
                setDraft(original);
              }}
              style={styles.actionButton}
            />
          </View>
        </View>
      </Sheet>
    </>
  );
}

function FilesLoading({ compact = false }: Readonly<{ compact?: boolean }>): React.JSX.Element {
  const rows = compact ? [0, 1] : [0, 1, 2, 3];
  return (
    <View testID="agent-files-loading" style={stylesStatic.loading}>
      {rows.map((row) => (
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
    emptyText: {
      paddingVertical: Space.xxl,
      color: colors.inkSecondary,
      fontSize: FontSize.secondary,
      lineHeight: LineHeight.secondary,
      fontWeight: FontWeight.regular,
      textAlign: 'center',
    },
    sheetContent: {
      paddingHorizontal: Space.xl,
      paddingBottom: Space.xxl,
      gap: Space.xl,
    },
    filePreview: {
      maxHeight: ControlSize.settingsRow * 7,
    },
    fileText: {
      color: colors.ink,
      fontSize: FontSize.body,
      lineHeight: LineHeight.body,
      fontWeight: FontWeight.regular,
    },
    actionRow: {
      flexDirection: 'row',
      gap: Space.md,
    },
    actionButton: { flex: 1 },
    confirmContent: {
      paddingHorizontal: Space.xl,
      paddingBottom: Space.xxl,
      gap: Space.xl,
    },
    detailText: {
      color: colors.inkSecondary,
      fontSize: FontSize.secondary,
      lineHeight: LineHeight.secondary,
      fontWeight: FontWeight.regular,
      textAlign: 'center',
    },
  });
}
