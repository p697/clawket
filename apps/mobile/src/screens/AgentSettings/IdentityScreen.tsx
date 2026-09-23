import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { usePreventRemove, type NavigationAction } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import type { AgentAdapter, AgentDescriptor } from '@clawket/agent-protocol';
import type { RootStackParamList } from '../../navigation/root-stack';
import { AgentAvatar } from '../../components/ui/AgentAvatar';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { ConfirmationModal } from '../../components/ui/ConfirmationModal';
import { FormTextInput } from '../../components/ui/FormTextInput';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { Sheet } from '../../components/ui/Sheet';
import { Skeleton } from '../../components/ui/Skeleton';
import { useAppTheme } from '../../theme';
import { ControlSize, FontSize, FontWeight, LineHeight, Space } from '../../theme/tokens';
import type { AgentIdentityProfile } from '../../utils/agent-identity-profile';
import {
  IDENTITY_FILE_NAME,
  buildIdentityAgentPatch,
  buildIdentityFileContent,
  canCreateIdentityAgent,
  canEditIdentityFiles,
  canEditIdentityProfile,
  loadIdentityBundle,
  normalizeIdentityProfile,
  sameIdentityProfile,
  validateAgentCreateName,
  validateIdentityProfile,
  type IdentityBundle,
} from './identity-model';

type ProfileField = 'name' | 'emoji' | 'vibe';
type Busy = 'save' | 'delete' | 'create' | null;

export type IdentityScreenProps = Readonly<{
  adapter: AgentAdapter;
  agent: AgentDescriptor;
  online: boolean;
  isPro: boolean;
  navigation: Pick<NativeStackNavigationProp<RootStackParamList, 'AgentSettingsSection'>, 'goBack' | 'dispatch'>;
  openCreateOnMount?: boolean;
  isFocused?: boolean;
  onCreateActionConsumed?: () => void;
  onOpenPaywall: (reason: string, onContinue?: () => void) => void;
  onChanged?: () => void | Promise<void>;
  onCreated?: (agentId: string) => void | Promise<void>;
  onRemoved?: () => void | Promise<void>;
}>;

/**
 * Agent identity: the name and emoji that live in the backend's Agent record
 * (mirrored into IDENTITY.md by the Gateway) and the vibe that lives only in
 * IDENTITY.md, plus Agent creation and removal. The avatar is shown but not
 * edited here: it is a workspace path or URL that belongs to the desktop.
 * Persona, memory and user documents are files and are edited on the Files page.
 */
export function IdentityScreen({
  adapter,
  agent,
  online,
  isPro,
  navigation,
  openCreateOnMount = false,
  isFocused = true,
  onCreateActionConsumed,
  onOpenPaywall,
  onChanged,
  onCreated,
  onRemoved,
}: IdentityScreenProps): React.JSX.Element {
  const { t } = useTranslation(['common', 'settings', 'config', 'chat']);
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);
  const operations = adapter.management?.agents;
  const fileOperations = operations?.files;
  const profileEditable = canEditIdentityProfile(adapter.capabilities, operations);
  const identityFileEditable = canEditIdentityFiles(adapter.capabilities, fileOperations);
  const agentCreatable = canCreateIdentityAgent(adapter.capabilities, operations);
  const [bundle, setBundle] = useState<IdentityBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [draft, setDraft] = useState<AgentIdentityProfile | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingLeave, setPendingLeave] = useState<NavigationAction | null>(null);
  const [leaving, setLeaving] = useState(false);
  const leaveAction = useRef<NavigationAction | null>(null);
  const afterLeave = useRef<(() => void | Promise<void>) | null>(null);
  const [deleteVisible, setDeleteVisible] = useState(false);
  const [createVisible, setCreateVisible] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createEmoji, setCreateEmoji] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const scope = useMemo(() => ({}), [adapter, agent.agentId]);
  const activeScope = useRef<object | null>(scope);
  activeScope.current = scope;
  useEffect(() => () => { if (activeScope.current === scope) activeScope.current = null; }, [scope]);
  // Roster refreshes rebuild the descriptor object; only a scope change may reload and reset the draft.
  const agentRef = useRef(agent);
  agentRef.current = agent;
  const handledOpenCreateRef = useRef(false);
  const focusedRef = useRef(isFocused);
  focusedRef.current = isFocused;
  const saving = busy !== null;
  const dirty = bundle !== null && draft !== null && !sameIdentityProfile(draft, bundle.profile);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const next = await loadIdentityBundle(operations, agentRef.current);
      if (activeScope.current !== scope) return;
      setBundle(next);
      setDraft({ ...next.profile });
      setLoadError(null);
    } catch (loadFailure: unknown) {
      if (activeScope.current !== scope) return;
      setLoadError(loadFailure ?? new Error());
    } finally {
      if (activeScope.current === scope) setLoading(false);
    }
  }, [operations, scope]);

  useEffect(() => {
    setBundle(null);
    setDraft(null);
    setError(null);
    void load();
  }, [load]);

  // Route removal is blocked while a draft is dirty or a write is in flight;
  // `leaving` re-enables it once the user confirmed or the write settled.
  usePreventRemove((dirty || saving) && !leaving, ({ data: removal }) => {
    if (!saving) setPendingLeave(removal.action);
  });
  useEffect(() => {
    if (!leaving) return;
    const callback = afterLeave.current;
    afterLeave.current = null;
    if (callback) {
      void Promise.resolve().then(callback).finally(() => setLeaving(false));
      return;
    }
    if (leaveAction.current) navigation.dispatch(leaveAction.current);
    else navigation.goBack();
  }, [leaving, navigation]);

  const leaveThen = useCallback((callback: () => void | Promise<void>) => {
    afterLeave.current = callback;
    setLeaving(true);
  }, []);

  const back = useCallback(() => {
    if (saving) return;
    if (dirty) setPendingLeave({ type: 'GO_BACK' });
    else navigation.goBack();
  }, [dirty, navigation, saving]);

  const save = useCallback(async () => {
    if (!bundle || !draft || !profileEditable || !online || saving || !dirty) return;
    const validation = validateIdentityProfile(draft);
    if (!validation.valid) {
      setError(validation.error === 'too-long'
        ? t('Name must be 50 characters or fewer.', { ns: 'settings' })
        : t('Please enter a name.', { ns: 'settings' }));
      return;
    }
    const nextProfile = normalizeIdentityProfile(draft);
    const patch = buildIdentityAgentPatch(bundle.profile, nextProfile);
    const nextIdentityFile = buildIdentityFileContent(nextProfile, bundle.identityFile);
    const identityFileChanged = identityFileEditable
      && nextIdentityFile !== buildIdentityFileContent(bundle.profile, bundle.identityFile);
    setBusy('save');
    setError(null);
    try {
      if (identityFileChanged) {
        const result = await fileOperations?.set?.(IDENTITY_FILE_NAME, nextIdentityFile, agent.agentId);
        if (!result?.ok) throw new Error(t('Gateway rejected save request', { ns: 'settings' }));
      }
      if (Object.keys(patch).length > 0) {
        const result = await operations?.update?.(agent.agentId, patch);
        if (!result?.ok) throw new Error(t('Save failed', { ns: 'settings' }));
      }
      if (activeScope.current !== scope) return;
      setBundle({
        profile: nextProfile,
        identityFile: identityFileChanged ? nextIdentityFile : bundle.identityFile,
      });
      setDraft(nextProfile);
      // The write is already acknowledged; a roster refresh failure is not a failed save.
      void Promise.resolve().then(() => onChanged?.()).catch(() => undefined);
    } catch (saveFailure: unknown) {
      if (activeScope.current !== scope) return;
      setError(errorMessage(saveFailure, t('Save failed', { ns: 'settings' })));
    } finally {
      if (activeScope.current === scope) setBusy(null);
    }
  }, [
    agent.agentId,
    bundle,
    dirty,
    draft,
    fileOperations,
    identityFileEditable,
    onChanged,
    online,
    operations,
    profileEditable,
    saving,
    scope,
    t,
  ]);

  const removeAgent = useCallback(async () => {
    if (agent.isMain || !profileEditable || !operations?.remove || !online || saving) return;
    setDeleteVisible(false);
    setBusy('delete');
    setError(null);
    try {
      const result = await operations.remove(agent.agentId, true);
      if (!result.ok) throw new Error(t('Delete failed', { ns: 'settings' }));
      if (activeScope.current !== scope) return;
      setBusy(null);
      leaveThen(() => onRemoved?.());
    } catch (removeFailure: unknown) {
      if (activeScope.current !== scope) return;
      setBusy(null);
      setError(errorMessage(removeFailure, t('Delete failed', { ns: 'settings' })));
    }
  }, [agent.agentId, agent.isMain, leaveThen, onRemoved, online, operations, profileEditable, saving, scope, t]);

  const showCreateSheet = useCallback(() => {
    if (!focusedRef.current || activeScope.current !== scope) return;
    setCreateName('');
    setCreateEmoji('');
    setCreateError(null);
    setCreateVisible(true);
  }, [scope]);

  const openCreate = useCallback(() => {
    if (!agentCreatable) return;
    if (!isPro) {
      onOpenPaywall('agents', showCreateSheet);
      return;
    }
    showCreateSheet();
  }, [agentCreatable, isPro, onOpenPaywall, showCreateSheet]);

  useEffect(() => {
    if (!openCreateOnMount) {
      handledOpenCreateRef.current = false;
      return;
    }
    if (!isFocused || !agentCreatable || handledOpenCreateRef.current) return;
    handledOpenCreateRef.current = true;
    // Consume the navigation intent before opening: reconnect can remount this child.
    onCreateActionConsumed?.();
    openCreate();
  }, [agentCreatable, isFocused, onCreateActionConsumed, openCreate, openCreateOnMount]);

  useEffect(() => {
    if (!isFocused) setCreateVisible(false);
  }, [isFocused]);

  const createAgent = useCallback(async () => {
    if (!agentCreatable || !operations?.create || !online || saving) return;
    const validation = validateAgentCreateName(createName);
    if (!validation.valid) {
      if (validation.error === 'too-long') {
        setCreateError(t('Name must be 50 characters or fewer.', { ns: 'settings' }));
      } else if (validation.error === 'invalid') {
        setCreateError(t('Agent name must contain at least one ASCII letter or digit.', { ns: 'chat' }));
      } else if (validation.error === 'reserved') {
        setCreateError(t('"main" is reserved and cannot be used as an agent name.', { ns: 'chat' }));
      } else {
        setCreateError(t('Please enter a name for the agent.', { ns: 'chat' }));
      }
      return;
    }
    setBusy('create');
    setCreateError(null);
    try {
      const result = await operations.create({
        name: createName.trim(),
        ...(createEmoji.trim() ? { emoji: createEmoji.trim() } : {}),
      });
      if (!result.ok) throw new Error(t('Failed to create agent', { ns: 'chat' }));
      await onChanged?.();
      if (activeScope.current !== scope) return;
      setCreateVisible(false);
      setBusy(null);
      if (onCreated) leaveThen(() => onCreated(result.agentId));
    } catch (createFailure: unknown) {
      if (activeScope.current !== scope) return;
      setBusy(null);
      setCreateError(errorMessage(createFailure, t('Failed to create agent', { ns: 'chat' })));
    }
  }, [agentCreatable, createEmoji, createName, leaveThen, onChanged, onCreated, online, operations, saving, scope, t]);

  const fields: ReadonlyArray<Readonly<{ key: ProfileField; editable: boolean }>> = [
    { key: 'name', editable: profileEditable },
    { key: 'emoji', editable: profileEditable },
    { key: 'vibe', editable: profileEditable && identityFileEditable },
  ];
  const canRemove = !agent.isMain && profileEditable && Boolean(operations?.remove);

  return (
    <View testID="agent-identity-screen" style={styles.screen}>
      <ScreenHeader
        title={t('Identity', { ns: 'config' })}
        topInset={insets.top}
        onBack={back}
        rightContent={profileEditable && bundle ? (
          <Button
            testID="agent-identity-save"
            label={t('Save', { ns: 'common' })}
            variant="primary"
            loading={busy === 'save'}
            disabled={!dirty || !online || saving}
            onPress={() => { void save(); }}
          />
        ) : undefined}
      />
      <KeyboardAwareScrollView
        testID="agent-identity-scroll"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Space.xl }]}
      >
        {!online ? <Banner message={t('Offline · reconnecting', { ns: 'common' })} /> : null}
        {error ? <Banner testID="agent-identity-error" tone="bad" message={error} /> : null}
        {loading && !bundle ? (
          <IdentityLoading />
        ) : !bundle || !draft ? (
          <Banner
            testID="agent-identity-load-error"
            tone="bad"
            message={errorMessage(loadError, t('Settings could not load', { ns: 'common' }))}
            actionLabel={t('Retry', { ns: 'common' })}
            onAction={() => { void load(); }}
          />
        ) : (
          <>
            <View style={styles.hero}>
              <AgentAvatar
                testID="agent-identity-avatar"
                agentId={agent.agentId}
                name={draft.name || agent.name}
                emoji={draft.emoji}
                avatarUrl={agent.avatarUrl}
                variant="roster"
              />
              {!profileEditable ? (
                <Text style={styles.secondary}>{t('Read only', { ns: 'config' })}</Text>
              ) : null}
            </View>
            {fields.map((field) => (
              <View key={field.key} style={styles.field}>
                <Text style={styles.label}>{translateProfileField(field.key, t)}</Text>
                <FormTextInput
                  testID={`agent-identity-profile-${field.key}`}
                  accessibilityLabel={translateProfileField(field.key, t)}
                  value={draft[field.key]}
                  onChangeText={(value) => setDraft({ ...draft, [field.key]: value })}
                  editable={field.editable && online && !saving}
                  multiline={field.key === 'vibe'}
                  autoCapitalize={field.key === 'name' ? 'words' : field.key === 'vibe' ? 'sentences' : 'none'}
                  autoCorrect={field.key === 'name' || field.key === 'vibe'}
                />
              </View>
            ))}
            {/* No `New Agent` button here (owner decision 2026-09-19): the roster `+` sheet is the
                one creation entry and lands on this page with `openCreateOnMount`. */}
            {canRemove ? (
              <View style={styles.actions}>
                <Button
                  testID="agent-identity-delete"
                  label={t('Delete Agent', { ns: 'settings' })}
                  variant="destructive"
                  disabled={!online || saving}
                  loading={busy === 'delete'}
                  onPress={() => setDeleteVisible(true)}
                />
              </View>
            ) : null}
          </>
        )}
      </KeyboardAwareScrollView>

      <ConfirmationModal
        testID="agent-identity-discard"
        visible={pendingLeave !== null}
        title={t('Discard changes?', { ns: 'settings' })}
        message={t('Unsaved changes will be lost.', { ns: 'settings' })}
        confirmLabel={t('Discard', { ns: 'settings' })}
        cancelLabel={t('Keep editing', { ns: 'settings' })}
        destructive
        onClose={() => setPendingLeave(null)}
        onConfirm={() => {
          leaveAction.current = pendingLeave && pendingLeave.type !== 'GO_BACK' ? pendingLeave : null;
          setPendingLeave(null);
          setLeaving(true);
        }}
      />

      <ConfirmationModal
        testID="agent-identity-delete-confirm"
        visible={deleteVisible}
        title={t('Delete Agent', { ns: 'settings' })}
        message={t('Are you sure you want to delete "{{name}}"? This cannot be undone.', {
          ns: 'settings',
          name: bundle?.profile.name || agent.name,
        })}
        confirmLabel={t('Delete', { ns: 'common' })}
        cancelLabel={t('Cancel', { ns: 'common' })}
        destructive
        onClose={() => setDeleteVisible(false)}
        onConfirm={() => { void removeAgent(); }}
      />

      <Sheet
        testID="agent-identity-create-sheet"
        visible={createVisible && isFocused}
        title={t('Create Agent', { ns: 'chat' })}
        closeAccessibilityLabel={t('Back', { ns: 'common' })}
        dismissOnBackdropPress={!saving}
        snapPoints={['55%', '90%']}
        keyboardBehavior="interactive"
        keyboardBlurBehavior="restore"
        footer={
          <View style={styles.actionRow}>
            <Button
              testID="agent-identity-create-cancel"
              label={t('Cancel', { ns: 'common' })}
              variant="secondary"
              disabled={saving}
              onPress={() => setCreateVisible(false)}
              style={styles.actionButton}
            />
            <Button
              testID="agent-identity-create-action"
              label={t('Create', { ns: 'common' })}
              loading={busy === 'create'}
              disabled={saving}
              onPress={() => { void createAgent(); }}
              style={styles.actionButton}
            />
          </View>
        }
        onClose={() => { if (!saving) setCreateVisible(false); }}
      >
        <BottomSheetScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.sheetContent}>
          {createError ? <Banner testID="agent-identity-create-error" tone="bad" message={createError} /> : null}
          <View style={styles.field}>
            <Text style={styles.label}>{t('Agent name', { ns: 'settings' })}</Text>
            <FormTextInput
              bottomSheet
              testID="agent-identity-create-name"
              value={createName}
              onChangeText={setCreateName}
              editable={!saving}
              autoCapitalize="words"
            />
          </View>
          <View style={styles.field}>
            <Text style={styles.label}>{t('Emoji', { ns: 'settings' })}</Text>
            <FormTextInput
              bottomSheet
              testID="agent-identity-create-emoji"
              value={createEmoji}
              onChangeText={setCreateEmoji}
              editable={!saving}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
        </BottomSheetScrollView>
      </Sheet>
    </View>
  );
}

type Translate = ReturnType<typeof useTranslation>['t'];

function translateProfileField(key: ProfileField, t: Translate): string {
  if (key === 'name') return t('Agent name', { ns: 'settings' });
  if (key === 'emoji') return t('Emoji', { ns: 'settings' });
  return t('Vibe', { ns: 'settings' });
}

function IdentityLoading(): React.JSX.Element {
  return (
    <View testID="agent-identity-loading" style={staticStyles.loading}>
      {[0, 1, 2].map((index) => (
        <View key={index} style={staticStyles.loadingField}>
          <Skeleton style={staticStyles.loadingLabel} />
          <Skeleton style={staticStyles.loadingInput} />
        </View>
      ))}
    </View>
  );
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

const staticStyles = StyleSheet.create({
  loading: { gap: Space.lg, paddingTop: Space.lg },
  loadingField: { gap: Space.sm },
  loadingLabel: { width: '30%', height: LineHeight.caption },
  loadingInput: { height: ControlSize.floatingButton },
});

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.canvas },
    content: {
      paddingHorizontal: Space.lg,
      paddingTop: Space.sm,
      gap: Space.lg,
    },
    hero: { alignItems: 'center', gap: Space.sm, paddingVertical: Space.md },
    field: { gap: Space.sm },
    label: {
      color: colors.inkSecondary,
      fontSize: FontSize.caption,
      lineHeight: LineHeight.caption,
      fontWeight: FontWeight.semibold,
    },
    secondary: {
      color: colors.inkSecondary,
      fontSize: FontSize.secondary,
      lineHeight: LineHeight.secondary,
    },
    actions: { gap: Space.md, paddingTop: Space.md },
    sheetContent: { gap: Space.lg, paddingHorizontal: Space.lg, paddingBottom: Space.xxl },
    actionRow: { flexDirection: 'row', gap: Space.md },
    actionButton: { flex: 1 },
  });
}
