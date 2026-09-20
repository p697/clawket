import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type {
  AgentAdapter,
  AgentDescriptor,
  AgentFileSummary,
} from '@clawket/agent-protocol';
import { Banner } from '../../components/ui/Banner';
import { SearchInput } from '../../components/ui/SearchInput';
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
  LineHeight,
  Space,
} from '../../theme/tokens';
import {
  canEditAgentFile,
  filterAgentFiles,
  formatFileSize,
} from './files-model';

export type FilesSectionProps = Readonly<{
  adapter: AgentAdapter;
  agent: AgentDescriptor;
  online: boolean;
  /** Bumped when the list regains focus so a save on the document page is reflected quietly. */
  refreshKey?: number;
  /** Opens the full-page reader/editor; a `missing` file opens straight into its empty editor. */
  onOpenFile: (file: AgentFileSummary) => void;
}>;

export function FilesSection(props: FilesSectionProps): React.JSX.Element {
  return <FilesContent key={`${props.agent.connectionId}:${props.agent.agentId}`} {...props} />;
}

function FilesContent({
  adapter,
  agent,
  online,
  refreshKey = 0,
  onOpenFile,
}: FilesSectionProps): React.JSX.Element {
  const { t } = useTranslation(['common', 'settings']);
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);
  const operations = adapter.management?.agents?.files;
  const [files, setFiles] = useState<ReadonlyArray<AgentFileSummary> | null>(null);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const active = useRef(false);
  const listRequest = useRef(0);
  const current = useRef({ operations });
  current.current = { operations };
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);
  const editable = canEditAgentFile(adapter.capabilities, operations);

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
    // A focus refresh keeps the loaded rows on screen; only the first load shows the skeleton.
    if (refreshKey > 0 && !online) return;
    void load();
  }, [load, online, refreshKey]);

  const visibleFiles = useMemo(
    () => filterAgentFiles(files ?? [], query),
    [files, query],
  );

  if (loading && files === null) return <FilesLoading />;

  return (
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
                onPress={() => onOpenFile(file)}
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
  );
}

function FilesLoading(): React.JSX.Element {
  return (
    <View testID="agent-files-loading" style={stylesStatic.loading}>
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
