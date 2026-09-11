import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type {
  AgentAdapter,
  AgentDescriptor,
} from '@clawket/agent-protocol';
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
import { Skeleton } from '../../components/ui/Skeleton';
import { useAppTheme } from '../../theme';
import {
  ControlSize,
  FontSize,
  FontWeight,
  LineHeight,
  Space,
} from '../../theme/tokens';
import type { AgentIdentityProfile } from '../../utils/agent-identity-profile';
import type { AgentUserProfile } from '../../utils/agent-user-profile';
import {
  buildIdentityAgentPatch,
  buildIdentityFileContent,
  buildUserFileContent,
  canCreateIdentityAgent,
  canEditIdentityFiles,
  canEditIdentityProfile,
  loadIdentityBundle,
  validateAgentCreateName,
  validateIdentityProfile,
  type IdentityBundle,
} from './identity-model';

type IdentitySheet = 'profile' | 'user' | 'persona' | 'memory';

export type IdentitySectionProps = Readonly<{
  adapter: AgentAdapter;
  agent: AgentDescriptor;
  online: boolean;
  isPro: boolean;
  openCreateOnMount?: boolean;
  onOpenPaywall: (reason: string, onContinue?: () => void) => void;
  onChanged?: () => void | Promise<void>;
  onCreated?: (agentId: string) => void | Promise<void>;
  onRemoved?: () => void | Promise<void>;
}>;

const USER_FIELDS: ReadonlyArray<Readonly<{
  key: keyof AgentUserProfile;
  multiline?: boolean;
}>> = [
  { key: 'name' },
  { key: 'whatToCallThem' },
  { key: 'pronouns' },
  { key: 'timezone' },
  { key: 'notes', multiline: true },
  { key: 'context', multiline: true },
];

export function IdentitySection({
  adapter,
  agent,
  online,
  isPro,
  openCreateOnMount = false,
  onOpenPaywall,
  onChanged,
  onCreated,
  onRemoved,
}: IdentitySectionProps): React.JSX.Element {
  const { t } = useTranslation(['common', 'settings', 'config', 'chat']);
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);
  const operations = adapter.management?.agents;
  const fileOperations = operations?.files;
  const profileEditable = canEditIdentityProfile(adapter.capabilities, operations);
  const filesEditable = canEditIdentityFiles(adapter.capabilities, fileOperations);
  const agentCreatable = canCreateIdentityAgent(adapter.capabilities, operations);
  const [bundle, setBundle] = useState<IdentityBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<IdentitySheet | null>(null);
  const [profileDraft, setProfileDraft] = useState<AgentIdentityProfile | null>(null);
  const [userDraft, setUserDraft] = useState<AgentUserProfile | null>(null);
  const [fileDraft, setFileDraft] = useState('');
  const [editingFile, setEditingFile] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [discardVisible, setDiscardVisible] = useState(false);
  const [deleteVisible, setDeleteVisible] = useState(false);
  const [createVisible, setCreateVisible] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createEmoji, setCreateEmoji] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const handledOpenCreateRef = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const next = await loadIdentityBundle(operations, agent);
      setBundle(next);
      setLoadError(null);
    } catch (error: unknown) {
      setLoadError(errorMessage(error, t('Settings could not load', { ns: 'common' })));
    } finally {
      setLoading(false);
    }
  }, [agent, operations, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const openSheet = useCallback((nextSheet: IdentitySheet) => {
    if (!bundle) return;
    setSheetError(null);
    setEditingFile(false);
    setProfileDraft({ ...bundle.profile });
    setUserDraft({ ...bundle.user });
    if (nextSheet === 'persona') setFileDraft(bundle.contents['SOUL.md']);
    if (nextSheet === 'memory') setFileDraft(bundle.contents['MEMORY.md']);
    setSheet(nextSheet);
  }, [bundle]);

  const profileChanged = sheet === 'profile'
    && bundle !== null
    && profileDraft !== null
    && !sameProfile(profileDraft, bundle.profile);
  const userChanged = sheet === 'user'
    && bundle !== null
    && userDraft !== null
    && !sameUser(userDraft, bundle.user);
  const rawFileChanged = bundle !== null
    && (sheet === 'persona' || sheet === 'memory')
    && fileDraft !== bundle.contents[sheet === 'persona' ? 'SOUL.md' : 'MEMORY.md'];
  const hasUnsavedChanges = profileChanged || (editingFile && (userChanged || rawFileChanged));

  const closeSheet = useCallback(() => {
    if (saving) return;
    if (hasUnsavedChanges) {
      setDiscardVisible(true);
      return;
    }
    setSheet(null);
    setEditingFile(false);
    setSheetError(null);
  }, [hasUnsavedChanges, saving]);

  const discardChanges = useCallback(() => {
    setDiscardVisible(false);
    setSheet(null);
    setEditingFile(false);
    setSheetError(null);
  }, []);

  const saveProfile = useCallback(async () => {
    if (!bundle || !profileDraft || !profileEditable || !online || saving) return;
    const validation = validateIdentityProfile(profileDraft);
    if (!validation.valid) {
      setSheetError(validation.error === 'too-long'
        ? t('Name must be 50 characters or fewer.', { ns: 'settings' })
        : t('Please enter a name.', { ns: 'settings' }));
      return;
    }
    const nextProfile: AgentIdentityProfile = {
      ...profileDraft,
      name: profileDraft.name.trim(),
      emoji: profileDraft.emoji.trim(),
      vibe: profileDraft.vibe.trim(),
      avatar: profileDraft.avatar.trim(),
    };
    const patch = buildIdentityAgentPatch(bundle.profile, nextProfile);
    const profileFileChanged = buildIdentityFileContent(bundle.profile)
      !== buildIdentityFileContent(nextProfile);
    setSaving(true);
    setSheetError(null);
    try {
      if (profileFileChanged && filesEditable) {
        const result = await fileOperations?.set?.(
          'IDENTITY.md',
          buildIdentityFileContent(nextProfile),
          agent.agentId,
        );
        if (!result?.ok) throw new Error(t('Gateway rejected save request', { ns: 'settings' }));
      }
      if (Object.keys(patch).length > 0) {
        const result = await operations?.update?.(agent.agentId, patch);
        if (!result?.ok) throw new Error(t('Save failed', { ns: 'settings' }));
      }
      setBundle((current) => current ? {
        ...current,
        profile: nextProfile,
        contents: {
          ...current.contents,
          'IDENTITY.md': profileFileChanged && filesEditable
            ? buildIdentityFileContent(nextProfile)
            : current.contents['IDENTITY.md'],
        },
      } : current);
      setProfileDraft(nextProfile);
      await onChanged?.();
      setSheet(null);
    } catch (error: unknown) {
      setSheetError(errorMessage(error, t('Save failed', { ns: 'settings' })));
    } finally {
      setSaving(false);
    }
  }, [
    agent.agentId,
    bundle,
    fileOperations,
    filesEditable,
    onChanged,
    online,
    operations,
    profileDraft,
    profileEditable,
    saving,
    t,
  ]);

  const startFileEdit = useCallback(() => {
    if (!filesEditable) return;
    setEditingFile(true);
  }, [filesEditable]);

  const commitFileSave = useCallback(async () => {
    if (!bundle || !sheet || !filesEditable || !online || saving) return;
    const name = sheet === 'user'
      ? 'USER.md'
      : sheet === 'persona'
        ? 'SOUL.md'
        : sheet === 'memory'
          ? 'MEMORY.md'
          : null;
    if (!name) return;
    const content = name === 'USER.md' && userDraft
      ? buildUserFileContent(bundle.contents['USER.md'], userDraft)
      : fileDraft;
    setSaving(true);
    setSheetError(null);
    try {
      const result = await fileOperations?.set?.(name, content, agent.agentId);
      if (!result?.ok) throw new Error(t('Gateway rejected save request', { ns: 'settings' }));
      setBundle((current) => current ? {
        ...current,
        ...(name === 'USER.md' && userDraft ? { user: userDraft } : {}),
        contents: { ...current.contents, [name]: content },
      } : current);
      setEditingFile(false);
      await onChanged?.();
      setSheet(null);
    } catch (error: unknown) {
      setSheetError(errorMessage(error, t('Save failed', { ns: 'settings' })));
    } finally {
      setSaving(false);
    }
  }, [
    agent.agentId,
    bundle,
    fileDraft,
    fileOperations,
    filesEditable,
    onChanged,
    online,
    saving,
    sheet,
    t,
    userDraft,
  ]);

  const saveFile = useCallback(() => {
    if (!isPro) {
      onOpenPaywall('coreFileEditing', () => { void commitFileSave(); });
      return;
    }
    void commitFileSave();
  }, [commitFileSave, isPro, onOpenPaywall]);

  const removeAgent = useCallback(async () => {
    if (agent.isMain || !profileEditable || !operations?.remove || !online || saving) return;
    setSaving(true);
    setSheetError(null);
    try {
      const result = await operations.remove(agent.agentId, true);
      if (!result.ok) throw new Error(t('Delete failed', { ns: 'settings' }));
      setDeleteVisible(false);
      await onRemoved?.();
    } catch (error: unknown) {
      setSheetError(errorMessage(error, t('Delete failed', { ns: 'settings' })));
    } finally {
      setSaving(false);
    }
  }, [agent.agentId, agent.isMain, onRemoved, online, operations, profileEditable, saving, t]);

  const showCreateSheet = useCallback(() => {
    setCreateName('');
    setCreateEmoji('');
    setCreateError(null);
    setCreateVisible(true);
  }, []);

  const openCreate = useCallback(() => {
    if (!agentCreatable) return;
    if (!isPro) {
      onOpenPaywall('agents', showCreateSheet);
      return;
    }
    showCreateSheet();
  }, [agentCreatable, isPro, onOpenPaywall, showCreateSheet]);

  useEffect(() => {
    if (!openCreateOnMount || handledOpenCreateRef.current) return;
    handledOpenCreateRef.current = true;
    openCreate();
  }, [openCreate, openCreateOnMount]);

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
    setSaving(true);
    setCreateError(null);
    try {
      const result = await operations.create({
        name: createName.trim(),
        ...(createEmoji.trim() ? { emoji: createEmoji.trim() } : {}),
      });
      if (!result.ok) throw new Error(t('Failed to create agent', { ns: 'chat' }));
      await onChanged?.();
      setCreateVisible(false);
      await onCreated?.(result.agentId);
    } catch (error: unknown) {
      setCreateError(errorMessage(error, t('Failed to create agent', { ns: 'chat' })));
    } finally {
      setSaving(false);
    }
  }, [agentCreatable, createEmoji, createName, onChanged, onCreated, online, operations, saving, t]);

  if (loading && bundle === null) return <IdentityLoading />;

  if (!bundle) {
    return (
      <View testID="agent-identity-section" style={styles.root}>
        <Banner
          testID="agent-identity-error"
          tone="bad"
          message={loadError || t('Settings could not load', { ns: 'common' })}
          actionLabel={t('Retry', { ns: 'common' })}
          onAction={() => { void load(); }}
        />
      </View>
    );
  }

  return (
    <>
      <View testID="agent-identity-section" style={styles.root}>
        {loadError ? (
          <Banner
            testID="agent-identity-error"
            tone="bad"
            message={loadError}
            actionLabel={t('Retry', { ns: 'common' })}
            onAction={() => { void load(); }}
          />
        ) : null}
        <SettingsGroup testID="agent-identity-settings">
          <SettingsRow
            testID="agent-identity-profile"
            title={t('Profile', { ns: 'settings' })}
            value={[bundle.profile.emoji, bundle.profile.name].filter(Boolean).join(' ') || agent.name}
            showChevron
            onPress={() => openSheet('profile')}
          />
          <SettingsDivider inset="content" />
          <SettingsRow
            testID="agent-identity-user"
            title={t('My Info', { ns: 'settings' })}
            value={bundle.user.whatToCallThem || bundle.user.name || t('Not set', { ns: 'settings' })}
            disabled={!fileOperations?.get}
            showChevron={Boolean(fileOperations?.get)}
            onPress={fileOperations?.get ? () => openSheet('user') : undefined}
          />
          <SettingsDivider inset="content" />
          <SettingsRow
            testID="agent-identity-persona"
            title={t('Persona', { ns: 'settings' })}
            value={bundle.contents['SOUL.md'] ? 'SOUL.md' : t('Not set', { ns: 'settings' })}
            disabled={!fileOperations?.get}
            showChevron={Boolean(fileOperations?.get)}
            onPress={fileOperations?.get ? () => openSheet('persona') : undefined}
          />
          <SettingsDivider inset="content" />
          <SettingsRow
            testID="agent-identity-memory"
            title={t('Memory', { ns: 'settings' })}
            value={bundle.contents['MEMORY.md'] ? 'MEMORY.md' : t('Not set', { ns: 'settings' })}
            disabled={!fileOperations?.get}
            showChevron={Boolean(fileOperations?.get)}
            onPress={fileOperations?.get ? () => openSheet('memory') : undefined}
          />
        </SettingsGroup>
        {!agent.isMain && profileEditable && operations?.remove ? (
          <Button
            testID="agent-identity-delete"
            label={t('Delete Agent', { ns: 'settings' })}
            variant="destructive"
            disabled={!online || saving}
            onPress={() => {
              setSheetError(null);
              setDeleteVisible(true);
            }}
          />
        ) : null}
        {agentCreatable ? (
          <Button
            testID="agent-identity-create"
            label={t('New Agent', { ns: 'chat' })}
            variant="secondary"
            disabled={!online || saving}
            onPress={openCreate}
          />
        ) : null}
      </View>

      <Sheet
        testID="agent-identity-detail"
        visible={sheet !== null && !discardVisible}
        title={sheetTitle(sheet, t)}
        closeAccessibilityLabel={t('Back', { ns: 'common' })}
        dismissOnBackdropPress={!saving}
        onClose={closeSheet}
      >
        <ScrollView contentContainerStyle={styles.sheetContent} keyboardShouldPersistTaps="handled">
          {sheetError ? <Banner testID="agent-identity-sheet-error" tone="bad" message={sheetError} /> : null}
          {sheet === 'profile' && profileDraft ? (
            <ProfileEditor
              profile={profileDraft}
              canEditProfile={profileEditable && online && !saving}
              canEditIdentityFile={profileEditable && filesEditable && online && !saving}
              onChange={setProfileDraft}
              styles={styles}
              t={t}
            />
          ) : null}
          {sheet === 'user' && userDraft ? (
            <UserEditor
              profile={userDraft}
              editable={editingFile && !saving}
              onChange={setUserDraft}
              styles={styles}
              t={t}
            />
          ) : null}
          {(sheet === 'persona' || sheet === 'memory') ? (
            editingFile ? (
              <FormTextInput
                testID="agent-identity-file-input"
                value={fileDraft}
                onChangeText={setFileDraft}
                multiline
                editable={!saving}
                minHeight={ControlSize.settingsRow * 6}
              />
            ) : (
              <Text testID="agent-identity-file-content" selectable style={styles.fileText}>
                {fileDraft || t('Not set', { ns: 'settings' })}
              </Text>
            )
          ) : null}
          {sheet === 'profile' ? (
            profileEditable ? (
              <View style={styles.actionRow}>
                <Button
                  testID="agent-identity-profile-cancel"
                  label={t('Cancel', { ns: 'common' })}
                  variant="secondary"
                  disabled={saving}
                  onPress={closeSheet}
                  style={styles.actionButton}
                />
                <Button
                  testID="agent-identity-profile-save"
                  label={t('Save', { ns: 'common' })}
                  loading={saving}
                  disabled={!profileChanged || !online}
                  onPress={() => { void saveProfile(); }}
                  style={styles.actionButton}
                />
              </View>
            ) : <Text style={styles.readOnlyText}>{t('Read only', { ns: 'config' })}</Text>
          ) : sheet ? (
            editingFile ? (
              <View style={styles.actionRow}>
                <Button
                  testID="agent-identity-file-cancel"
                  label={t('Cancel', { ns: 'common' })}
                  variant="secondary"
                  disabled={saving}
                  onPress={() => {
                    setEditingFile(false);
                    if (bundle && sheet === 'user') setUserDraft({ ...bundle.user });
                    if (bundle && sheet === 'persona') setFileDraft(bundle.contents['SOUL.md']);
                    if (bundle && sheet === 'memory') setFileDraft(bundle.contents['MEMORY.md']);
                  }}
                  style={styles.actionButton}
                />
                <Button
                  testID="agent-identity-file-save"
                  label={t('Save', { ns: 'common' })}
                  loading={saving}
                  disabled={!online || !(userChanged || rawFileChanged)}
                  onPress={saveFile}
                  style={styles.actionButton}
                />
              </View>
            ) : filesEditable ? (
              <Button
                testID="agent-identity-file-edit"
                label={t('Edit', { ns: 'common' })}
                disabled={!online}
                onPress={startFileEdit}
              />
            ) : <Text style={styles.readOnlyText}>{t('Read only', { ns: 'config' })}</Text>
          ) : null}
        </ScrollView>
      </Sheet>

      <Sheet
        testID="agent-identity-discard"
        visible={discardVisible}
        title={t('Discard changes?', { ns: 'settings' })}
        closeAccessibilityLabel={t('Back', { ns: 'common' })}
        dismissOnBackdropPress={!saving}
        onClose={() => setDiscardVisible(false)}
      >
        <View style={styles.confirmContent}>
          <Text style={styles.confirmText}>{t('You have unsaved changes.', { ns: 'settings' })}</Text>
          <View style={styles.actionRow}>
            <Button
              testID="agent-identity-keep-editing"
              label={t('Keep Editing', { ns: 'settings' })}
              variant="secondary"
              onPress={() => setDiscardVisible(false)}
              style={styles.actionButton}
            />
            <Button
              testID="agent-identity-discard-action"
              label={t('Discard', { ns: 'settings' })}
              variant="destructive"
              onPress={discardChanges}
              style={styles.actionButton}
            />
          </View>
        </View>
      </Sheet>

      <Sheet
        testID="agent-identity-create-sheet"
        visible={createVisible}
        title={t('Create Agent', { ns: 'chat' })}
        closeAccessibilityLabel={t('Back', { ns: 'common' })}
        dismissOnBackdropPress={!saving}
        onClose={() => setCreateVisible(false)}
      >
        <View style={styles.confirmContent}>
          {createError ? <Banner testID="agent-identity-create-error" tone="bad" message={createError} /> : null}
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>{t('Agent name', { ns: 'settings' })}</Text>
            <FormTextInput
              testID="agent-identity-create-name"
              value={createName}
              onChangeText={setCreateName}
              editable={!saving}
              autoCapitalize="words"
            />
          </View>
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>{t('Emoji', { ns: 'settings' })}</Text>
            <FormTextInput
              testID="agent-identity-create-emoji"
              value={createEmoji}
              onChangeText={setCreateEmoji}
              editable={!saving}
              autoCapitalize="none"
            />
          </View>
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
              loading={saving}
              onPress={() => { void createAgent(); }}
              style={styles.actionButton}
            />
          </View>
        </View>
      </Sheet>

      <Sheet
        testID="agent-identity-delete-confirm"
        visible={deleteVisible}
        title={t('Delete Agent', { ns: 'settings' })}
        closeAccessibilityLabel={t('Back', { ns: 'common' })}
        dismissOnBackdropPress={!saving}
        onClose={() => setDeleteVisible(false)}
      >
        <View style={styles.confirmContent}>
          {sheetError ? <Banner testID="agent-identity-delete-error" tone="bad" message={sheetError} /> : null}
          <Text style={styles.confirmText}>
            {t('Are you sure you want to delete "{{name}}"? This cannot be undone.', {
              ns: 'settings',
              name: bundle.profile.name || agent.name,
            })}
          </Text>
          <View style={styles.actionRow}>
            <Button
              testID="agent-identity-delete-cancel"
              label={t('Cancel', { ns: 'common' })}
              variant="secondary"
              disabled={saving}
              onPress={() => setDeleteVisible(false)}
              style={styles.actionButton}
            />
            <Button
              testID="agent-identity-delete-action"
              label={t('Delete', { ns: 'common' })}
              variant="destructive"
              loading={saving}
              onPress={() => { void removeAgent(); }}
              style={styles.actionButton}
            />
          </View>
        </View>
      </Sheet>
    </>
  );
}

type IdentityStyles = ReturnType<typeof createStyles>;
type Translate = ReturnType<typeof useTranslation>['t'];

function translateProfileField(
  key: 'name' | 'emoji' | 'vibe' | 'avatar',
  t: Translate,
): string {
  if (key === 'name') return t('Agent name', { ns: 'settings' });
  if (key === 'emoji') return t('Emoji', { ns: 'settings' });
  if (key === 'vibe') return t('Vibe', { ns: 'settings' });
  return t('Avatar', { ns: 'settings' });
}

function translateUserField(key: keyof AgentUserProfile, t: Translate): string {
  if (key === 'name') return t('My name', { ns: 'settings' });
  if (key === 'whatToCallThem') {
    return t('What should the agent call me?', { ns: 'settings' });
  }
  if (key === 'pronouns') return t('Pronouns', { ns: 'settings' });
  if (key === 'timezone') return t('Timezone', { ns: 'settings' });
  if (key === 'notes') {
    return t('What should your agent know about you?', { ns: 'settings' });
  }
  return t('What have you been up to recently?', { ns: 'settings' });
}

function ProfileEditor({
  profile,
  canEditProfile,
  canEditIdentityFile,
  onChange,
  styles,
  t,
}: Readonly<{
  profile: AgentIdentityProfile;
  canEditProfile: boolean;
  canEditIdentityFile: boolean;
  onChange: (profile: AgentIdentityProfile) => void;
  styles: IdentityStyles;
  t: Translate;
}>): React.JSX.Element {
  const fields: ReadonlyArray<Readonly<{
    key: 'name' | 'emoji' | 'vibe' | 'avatar';
    editable: boolean;
  }>> = [
    { key: 'name', editable: canEditProfile },
    { key: 'emoji', editable: canEditIdentityFile },
    { key: 'vibe', editable: canEditIdentityFile },
    { key: 'avatar', editable: canEditProfile },
  ];
  return (
    <>
      {fields.map((field) => (
        <View key={field.key} style={styles.field}>
          <Text style={styles.fieldLabel}>{translateProfileField(field.key, t)}</Text>
          <FormTextInput
            testID={`agent-identity-profile-${field.key}`}
            value={profile[field.key]}
            onChangeText={(value) => onChange({ ...profile, [field.key]: value })}
            editable={field.editable}
            autoCapitalize={field.key === 'name' ? 'words' : 'none'}
          />
        </View>
      ))}
    </>
  );
}

function UserEditor({
  profile,
  editable,
  onChange,
  styles,
  t,
}: Readonly<{
  profile: AgentUserProfile;
  editable: boolean;
  onChange: (profile: AgentUserProfile) => void;
  styles: IdentityStyles;
  t: Translate;
}>): React.JSX.Element {
  return (
    <>
      {USER_FIELDS.map((field) => (
        <View key={field.key} style={styles.field}>
          <Text style={styles.fieldLabel}>{translateUserField(field.key, t)}</Text>
          <FormTextInput
            testID={`agent-identity-user-${field.key}`}
            value={profile[field.key]}
            onChangeText={(value) => onChange({ ...profile, [field.key]: value })}
            editable={editable}
            multiline={field.multiline}
            minHeight={field.multiline ? ControlSize.settingsRow * 2 : undefined}
          />
        </View>
      ))}
    </>
  );
}

function IdentityLoading(): React.JSX.Element {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);
  return (
    <SettingsGroup testID="agent-identity-loading">
      {[0, 1, 2, 3].map((index) => (
        <React.Fragment key={index}>
          {index ? <SettingsDivider inset="content" /> : null}
          <View style={styles.loadingRow}>
            <Skeleton style={styles.loadingTitle} />
            <Skeleton style={styles.loadingValue} />
          </View>
        </React.Fragment>
      ))}
    </SettingsGroup>
  );
}

function sheetTitle(sheet: IdentitySheet | null, t: Translate): string | undefined {
  if (sheet === 'profile') return t('Profile', { ns: 'settings' });
  if (sheet === 'user') return t('My Info', { ns: 'settings' });
  if (sheet === 'persona') return t('Persona', { ns: 'settings' });
  if (sheet === 'memory') return t('Memory', { ns: 'settings' });
  return undefined;
}

function sameProfile(left: AgentIdentityProfile, right: AgentIdentityProfile): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameUser(left: AgentUserProfile, right: AgentUserProfile): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function createStyles(
  colors: ReturnType<typeof useAppTheme>['theme']['colors'],
) {
  return StyleSheet.create({
    root: { gap: Space.lg },
    sheetContent: {
      gap: Space.lg,
      paddingHorizontal: Space.lg,
      paddingTop: Space.sm,
      paddingBottom: Space.xxl,
    },
    field: { gap: Space.sm },
    fieldLabel: {
      color: colors.inkSecondary,
      fontSize: FontSize.caption,
      lineHeight: LineHeight.caption,
      fontWeight: FontWeight.semibold,
    },
    fileText: {
      minHeight: ControlSize.settingsRow * 4,
      color: colors.ink,
      fontSize: FontSize.secondary,
      lineHeight: LineHeight.secondary,
    },
    readOnlyText: {
      color: colors.inkSecondary,
      fontSize: FontSize.secondary,
      lineHeight: LineHeight.secondary,
      textAlign: 'center',
    },
    actionRow: { flexDirection: 'row', gap: Space.md },
    actionButton: { flex: 1 },
    confirmContent: { gap: Space.lg, padding: Space.lg, paddingBottom: Space.xxl },
    confirmText: {
      color: colors.inkSecondary,
      fontSize: FontSize.secondary,
      lineHeight: LineHeight.secondary,
    },
    loadingRow: {
      minHeight: ControlSize.settingsRow,
      paddingHorizontal: Space.lg,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: Space.md,
    },
    loadingTitle: { width: '35%', height: Space.md },
    loadingValue: { width: '24%', height: Space.md },
  });
}
