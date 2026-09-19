import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { usePreventRemove, type NavigationAction } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { EnrichedMarkdownText } from 'react-native-enriched-markdown';
import type { RootStackParamList } from '../../navigation/root-stack';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { CompositionSafeTextInput } from '../../components/ui/CompositionSafeTextInput';
import { ConfirmationModal } from '../../components/ui/ConfirmationModal';
import { ConnectionStatusPill } from '../../components/ui/ConnectionStatusPill';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { Skeleton } from '../../components/ui/Skeleton';
import { createChatMarkdownStyle, getChatMarkdownFlavor, openChatMarkdownLink } from '../../components/chat/chatMarkdown';
import { useAppTheme } from '../../theme';
import { FontSize, LineHeight, Space } from '../../theme/tokens';
import { formatCronDate } from './cron-schedule';
import { formatFileSize } from './files-model';
import type { DocumentContent, DocumentSource } from './document-model';

type Leave = NavigationAction | 'cancel' | null;

export type DocumentScreenProps = Readonly<{
  title: string;
  subtitle?: string;
  /** `null` when the backend no longer exposes the read (e.g. support vanished on reconnect). */
  source: DocumentSource | null;
  online: boolean;
  /** The runtime's foreground grace window is open: show quiet reconnecting instead of offline. */
  reconnecting?: boolean;
  isPro: boolean;
  navigation: Pick<NativeStackNavigationProp<RootStackParamList, 'AgentSettingsSection'>, 'goBack' | 'dispatch'>;
  onOpenPaywall: (reason: string, onContinue?: () => void) => void;
  onSaved?: () => void;
  onOpenLinkedFile?: (filePath: string) => void;
}>;

/**
 * Full-page reader and editor for one long document (an Agent workspace file
 * or a skill's SKILL.md). Reading renders Markdown across the whole page; Edit
 * swaps the header to Cancel / Save and the body to a natively scrolling source
 * input that shrinks above the keyboard, so long files stay readable and the
 * caret stays visible without a nested scroll.
 */
export function DocumentScreen(props: DocumentScreenProps): React.JSX.Element {
  return <DocumentPage key={props.source?.key ?? 'unsupported'} {...props} />;
}

function DocumentPage({
  title,
  subtitle,
  source,
  online,
  reconnecting = false,
  isPro,
  navigation,
  onOpenPaywall,
  onSaved,
  onOpenLinkedFile,
}: DocumentScreenProps): React.JSX.Element {
  const { t, i18n } = useTranslation(['common', 'settings', 'config']);
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);
  const markdownStyle = useMemo(() => createChatMarkdownStyle(theme.colors, FontSize.body), [theme.colors]);
  const [content, setContent] = useState<DocumentContent | null>(null);
  const [loading, setLoading] = useState(source !== null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingLeave, setPendingLeave] = useState<Leave>(null);
  const [leaving, setLeaving] = useState(false);
  const leaveAction = useRef<NavigationAction | null>(null);
  const active = useRef(true);
  const writeLock = useRef(false);
  // The page is keyed by `source.key`; a host re-render may hand over a fresh
  // source object for the same document, which must not reload or drop the draft.
  const sourceRef = useRef(source);
  sourceRef.current = source;
  const current = useRef({ draft, editing, online, content });
  current.current = { draft, editing, online, content };
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);
  const editable = Boolean(content?.editable && source?.save);
  // A listed-but-absent file has nothing to read: the page opens as its editor.
  const creating = editing && content?.missing === true;
  const dirty = editing && content !== null && draft !== content.content;

  const load = useCallback(async () => {
    const document = sourceRef.current;
    if (!document) return;
    setLoading(true);
    try {
      const next = await document.load();
      if (!active.current) return;
      setContent(next);
      setLoadError(null);
      if (next.missing && next.editable && document.save) {
        setDraft('');
        setEditing(true);
        document.onActivity?.('edit');
      }
    } catch (failure: unknown) {
      if (!active.current) return;
      setLoadError(failure ?? new Error());
    } finally {
      if (active.current) setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // A dirty draft blocks route removal until the user confirms; `leaving` releases it.
  usePreventRemove(dirty && !leaving, ({ data: removal }) => {
    if (!writeLock.current) setPendingLeave(removal.action);
  });
  useEffect(() => {
    if (!leaving) return;
    if (leaveAction.current) navigation.dispatch(leaveAction.current);
    else navigation.goBack();
  }, [leaving, navigation]);

  const startEditing = useCallback(() => {
    if (!content || !editable) return;
    setError(null);
    setDraft(content.content);
    setEditing(true);
    sourceRef.current?.onActivity?.('edit');
  }, [content, editable]);

  const exitEditing = useCallback(() => {
    setError(null);
    setEditing(false);
    if (content?.missing) {
      // Nothing was created, so there is no reading state to return to.
      leaveAction.current = null;
      setLeaving(true);
    }
  }, [content?.missing]);

  const cancel = useCallback(() => {
    if (writeLock.current) return;
    if (dirty) setPendingLeave('cancel');
    else exitEditing();
  }, [dirty, exitEditing]);

  const commit = useCallback(async () => {
    const document = sourceRef.current;
    const valid = () => active.current && current.current.editing && current.current.draft === draft
      && current.current.content === content;
    if (!document?.save || !content || !valid() || writeLock.current || !current.current.online || !dirty) return;
    writeLock.current = true;
    setSaving(true);
    setError(null);
    try {
      const result = await document.save(draft);
      if (!valid()) return;
      if (!result.ok) throw new Error(t('Save failed', { ns: 'settings' }));
      document.onActivity?.('saved');
      setContent({
        ...content,
        content: draft,
        missing: false,
        size: utf8Length(draft),
        updatedAtMs: Date.now(),
      });
      setEditing(false);
      onSaved?.();
    } catch (failure: unknown) {
      if (!active.current) return;
      document.onActivity?.('failed');
      setError(errorMessage(failure, t('Save failed', { ns: 'settings' })));
    } finally {
      writeLock.current = false;
      if (active.current) setSaving(false);
    }
  }, [content, dirty, draft, onSaved, t]);

  const save = useCallback(() => {
    if (!isPro) {
      onOpenPaywall('coreFileEditing', () => { void commit(); });
      return;
    }
    void commit();
  }, [commit, isPro, onOpenPaywall]);

  const status = !online && reconnecting
    ? <ConnectionStatusPill placement="inline" status="reconnecting" message={t('Reconnecting…', { ns: 'common' })} />
    : !online
      ? <ConnectionStatusPill testID="document-offline" placement="inline" status="offline" message={t('Offline · reconnecting', { ns: 'common' })} />
      : undefined;
  const resolvedSubtitle = subtitle ?? content?.subtitle;
  const meta = content && !content.missing && (content.size !== undefined || content.updatedAtMs !== undefined)
    ? [formatFileSize(content.size), content.updatedAtMs === undefined ? undefined : formatCronDate(content.updatedAtMs, i18n?.resolvedLanguage)]
      .filter(Boolean).join(' · ')
    : '';

  return (
    <View testID="document-screen" style={styles.screen}>
      <ScreenHeader
        title={title}
        {...(resolvedSubtitle ? { subtitle: resolvedSubtitle } : {})}
        topInset={insets.top}
        status={status}
        onBack={navigation.goBack}
        leftContent={editing ? (
          <Button
            testID="document-cancel"
            label={t('Cancel', { ns: 'common' })}
            variant="ghost"
            disabled={saving}
            onPress={cancel}
          />
        ) : undefined}
        rightContent={editing ? (
          <Button
            testID="document-save"
            label={t('Save', { ns: 'common' })}
            variant="ghost"
            loading={saving}
            disabled={!dirty || !online || saving}
            onPress={save}
          />
        ) : editable && !loading ? (
          <Button
            testID="document-edit"
            label={t('Edit', { ns: 'common' })}
            variant="ghost"
            disabled={!online}
            onPress={startEditing}
          />
        ) : undefined}
      />

      {editing && content ? (
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.body}>
          {error ? <View style={styles.notice}><Banner testID="document-error" tone="bad" message={error} /></View> : null}
          <CompositionSafeTextInput
            testID="document-input"
            accessibilityLabel={title}
            value={draft}
            onChangeText={setDraft}
            multiline
            scrollEnabled
            autoFocus={creating}
            editable={!saving}
            autoCorrect={false}
            autoCapitalize="none"
            spellCheck={false}
            textAlignVertical="top"
            style={[styles.input, { paddingBottom: insets.bottom + Space.xl }]}
          />
        </KeyboardAvoidingView>
      ) : (
        <ScrollView
          testID="document-scroll"
          style={styles.body}
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Space.xxl }]}
          keyboardShouldPersistTaps="handled"
        >
          {error ? <Banner testID="document-error" tone="bad" message={error} /> : null}
          {!source ? (
            <Banner testID="document-unsupported" message={t('Not supported by this backend', { ns: 'config' })} />
          ) : loading && !content ? (
            <DocumentSkeleton />
          ) : !content ? (
            <Banner
              testID="document-load-error"
              tone="bad"
              message={errorMessage(loadError, t('Failed to load file', { ns: 'settings' }))}
              actionLabel={t('Retry', { ns: 'common' })}
              onAction={() => { void load(); }}
            />
          ) : (
            <>
              {!editable ? <Text style={styles.secondary}>{t('Read only', { ns: 'config' })}</Text> : null}
              {content.binary ? null : content.content.trim() ? (
                <View testID="document-content">
                  {content.plainText ? <Text selectable style={styles.sourceCode}>{content.content}</Text> : <EnrichedMarkdownText
                    markdown={content.content}
                    markdownStyle={markdownStyle}
                    flavor={getChatMarkdownFlavor()}
                    selectable
                    onLinkPress={openChatMarkdownLink}
                  />}
                </View>
              ) : (
                <Text testID="document-empty" style={styles.secondary}>{t('Empty file', { ns: 'settings' })}</Text>
              )}
              {onOpenLinkedFile ? content.linkedFiles?.map(filePath => (
                <Button key={filePath} testID={`document-linked-${filePath}`} label={filePath}
                  variant="ghost" disabled={!online} onPress={() => onOpenLinkedFile(filePath)} />
              )) : null}
              {meta ? <Text testID="document-meta" style={styles.meta}>{meta}</Text> : null}
            </>
          )}
        </ScrollView>
      )}

      <ConfirmationModal
        testID="document-discard"
        visible={pendingLeave !== null}
        title={t('Discard changes?', { ns: 'settings' })}
        message={t('Unsaved changes will be lost.', { ns: 'settings' })}
        confirmLabel={t('Discard', { ns: 'settings' })}
        cancelLabel={t('Keep editing', { ns: 'settings' })}
        destructive
        onClose={() => setPendingLeave(null)}
        onConfirm={() => {
          const leave = pendingLeave;
          setPendingLeave(null);
          if (leave === 'cancel' || leave === null) {
            exitEditing();
            return;
          }
          leaveAction.current = leave.type === 'GO_BACK' ? null : leave;
          setLeaving(true);
        }}
      />
    </View>
  );
}

function DocumentSkeleton(): React.JSX.Element {
  return (
    <View testID="document-loading" style={staticStyles.skeleton}>
      {SKELETON_LINES.map((width, index) => (
        <Skeleton key={index} style={[staticStyles.skeletonLine, { width }]} />
      ))}
    </View>
  );
}

const SKELETON_LINES: ReadonlyArray<`${number}%`> = ['52%', '92%', '84%', '96%', '70%', '88%', '40%'];

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).length;
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  return fallback;
}

const staticStyles = StyleSheet.create({
  skeleton: { gap: Space.md, paddingTop: Space.xs },
  skeletonLine: { height: LineHeight.body - Space.sm },
});

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.canvas },
    body: { flex: 1 },
    content: {
      paddingHorizontal: Space.lg,
      paddingTop: Space.sm,
      gap: Space.md,
    },
    notice: { paddingHorizontal: Space.lg, paddingBottom: Space.sm },
    sourceCode: {
      fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
      color: colors.ink,
      fontSize: FontSize.body,
      lineHeight: LineHeight.body,
    },
    input: {
      flex: 1,
      paddingHorizontal: Space.lg,
      paddingTop: Space.sm,
      color: colors.ink,
      fontSize: FontSize.body,
      lineHeight: LineHeight.body,
    },
    secondary: {
      color: colors.inkSecondary,
      fontSize: FontSize.secondary,
      lineHeight: LineHeight.secondary,
    },
    meta: {
      paddingTop: Space.md,
      color: colors.inkTertiary,
      fontSize: FontSize.caption,
      lineHeight: LineHeight.caption,
    },
  });
}
