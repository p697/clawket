import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { RouteProp, useNavigation, usePreventRemove, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { LoadingState, ScreenHeader } from '../../components/ui';
import { useAppContext } from '../../contexts/AppContext';
import { useProPaywall } from '../../contexts/ProPaywallContext';
import { useAppTheme } from '../../theme';
import { FontSize, FontWeight, Radius, Space } from '../../theme/tokens';
import type { SkillContentDetail } from '../../types';
import type { ConsoleStackParamList } from './ConsoleTab';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type SkillContentNavigation = NativeStackNavigationProp<ConsoleStackParamList, 'SkillContent'>;
type SkillContentRoute = RouteProp<ConsoleStackParamList, 'SkillContent'>;

function flattenLinkedFiles(
  linkedFiles: SkillContentDetail['linkedFiles'],
): Array<{ path: string; kind: string }> {
  if (!linkedFiles) return [];
  const orderedKinds: Array<keyof NonNullable<SkillContentDetail['linkedFiles']>> = [
    'references',
    'templates',
    'assets',
    'scripts',
    'other',
  ];
  const next: Array<{ path: string; kind: string }> = [];
  for (const kind of orderedKinds) {
    const items = linkedFiles[kind];
    if (!Array.isArray(items)) continue;
    for (const path of items) {
      next.push({ path, kind });
    }
  }
  return next;
}

export function SkillContentScreen(): React.JSX.Element {
  const { gateway, currentAgentId } = useAppContext();
  const { requirePro } = useProPaywall();
  const { t } = useTranslation('console');
  const navigation = useNavigation<SkillContentNavigation>();
  const route = useRoute<SkillContentRoute>();
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(theme.colors), [theme]);
  const { skillKey } = route.params;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contentDetail, setContentDetail] = useState<SkillContentDetail | null>(null);
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(route.params.filePath ?? null);
  const [draftContent, setDraftContent] = useState('');
  const [originalContent, setOriginalContent] = useState('');
  const [isEditing, setIsEditing] = useState(false);

  const linkedFiles = useMemo(() => flattenLinkedFiles(contentDetail?.linkedFiles ?? null), [contentDetail?.linkedFiles]);
  const hasChanges = isEditing && draftContent !== originalContent;

  usePreventRemove(hasChanges, ({ data }) => {
    Alert.alert(t('Discard changes?'), t('You have unsaved changes.'), [
      { text: t('Keep Editing'), style: 'cancel' },
      {
        text: t('Discard'),
        style: 'destructive',
        onPress: () => navigation.dispatch(data.action),
      },
    ]);
  });

  const loadContent = useCallback(async (filePath?: string | null) => {
    setLoading(true);
    try {
      const detail = await gateway.getSkillDetail(skillKey, {
        agentId: currentAgentId,
        filePath: filePath ?? undefined,
      });
      setContentDetail(detail);
      setSelectedFilePath(detail.filePath ?? null);
      setDraftContent(detail.content);
      setOriginalContent(detail.content);
      setIsEditing(false);
      setError(null);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('Failed to load instructions');
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [currentAgentId, gateway, skillKey, t]);

  useEffect(() => {
    loadContent(route.params.filePath ?? null).catch(() => {
      // Error state is handled in loadContent.
    });
  }, [loadContent, route.params.filePath]);

  const handleSaveConfirmed = useCallback(async () => {
    if (!contentDetail?.editable || saving || !hasChanges) return;
    setSaving(true);
    try {
      const result = await gateway.updateSkillContent(skillKey, draftContent, currentAgentId);
      if (!result.ok) {
        throw new Error(t('Save skill failed'));
      }
      Keyboard.dismiss();
      await loadContent(null);
      Alert.alert(t('Skill updated'), t('Your skill changes have been saved.'));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('Save skill failed');
      Alert.alert(t('Save skill failed'), message);
    } finally {
      setSaving(false);
    }
  }, [contentDetail?.editable, currentAgentId, draftContent, gateway, hasChanges, loadContent, saving, skillKey, t]);

  const handleSavePress = useCallback(() => {
    if (!contentDetail?.editable || saving || !hasChanges) return;
    Alert.alert(
      t('Confirm save'),
      t('Save changes to this skill?'),
      [
        { text: t('common:Cancel'), style: 'cancel' },
        {
          text: t('common:Save'),
          onPress: () => {
            handleSaveConfirmed().catch(() => {
              // Error state is handled in handleSaveConfirmed.
            });
          },
        },
      ],
    );
  }, [contentDetail?.editable, handleSaveConfirmed, hasChanges, saving, t]);

  const handleStartEdit = useCallback(() => {
    if (!contentDetail?.editable) return;
    if (!requirePro('coreFileEditing')) return;
    setDraftContent(originalContent);
    setIsEditing(true);
  }, [contentDetail?.editable, originalContent, requirePro]);

  const handleCancelEdit = useCallback(() => {
    setDraftContent(originalContent);
    setIsEditing(false);
    Keyboard.dismiss();
  }, [originalContent]);

  const handleOpenFile = useCallback((filePath?: string | null) => {
    if (hasChanges) {
      Alert.alert(
        t('Discard changes?'),
        t('You have unsaved changes.'),
        [
          { text: t('Keep Editing'), style: 'cancel' },
          {
            text: t('Discard'),
            style: 'destructive',
            onPress: () => {
              loadContent(filePath ?? null).catch(() => {
                // Error state is handled in loadContent.
              });
            },
          },
        ],
      );
      return;
    }
    loadContent(filePath ?? null).catch(() => {
      // Error state is handled in loadContent.
    });
  }, [hasChanges, loadContent, t]);

  const headerTitle = contentDetail?.name || t('Skill Instructions');
  const headerRight = useMemo(() => {
    if (isEditing) {
      return (
        <View style={styles.headerActions}>
          <TouchableOpacity
            onPress={handleCancelEdit}
            hitSlop={10}
            style={styles.secondaryHeaderButton}
          >
            <Text style={styles.exitText}>{t('common:Exit')}</Text>
          </TouchableOpacity>
          {(hasChanges || saving) ? (
            <TouchableOpacity
              onPress={handleSavePress}
              hitSlop={10}
              disabled={saving}
              style={[styles.primaryHeaderButton, saving && styles.primaryHeaderButtonDisabled]}
            >
              <Text style={[styles.primaryHeaderButtonText, saving && styles.saveTextDisabled]}>
                {saving ? t('common:Saving...') : t('common:Save')}
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>
      );
    }

    if (contentDetail?.editable) {
      return (
        <TouchableOpacity
          onPress={handleStartEdit}
          hitSlop={10}
          disabled={loading || !!error}
          style={[styles.primaryHeaderButton, (loading || !!error) && styles.primaryHeaderButtonDisabled]}
        >
          <Text style={[styles.primaryHeaderButtonText, (loading || !!error) && styles.saveTextDisabled]}>
            {t('common:Edit')}
          </Text>
        </TouchableOpacity>
      );
    }

    return undefined;
  }, [
    contentDetail?.editable,
    error,
    handleCancelEdit,
    handleSavePress,
    handleStartEdit,
    hasChanges,
    isEditing,
    loading,
    saving,
    t,
  ]);

  const header = (
    <ScreenHeader
      title={headerTitle}
      topInset={insets.top}
      onBack={() => navigation.goBack()}
      dismissStyle="close"
      leftSlotStyle={styles.headerActionSideSlot}
      rightSlotStyle={styles.headerActionsSlot}
      rightContent={headerRight}
    />
  );

  if (loading) {
    return (
      <View style={styles.root}>
        {header}
        <LoadingState message={t('Loading instructions...')} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.root}>
        {header}
        <View style={styles.centerState}>
          <Text style={styles.errorTitle}>{t('Failed to load instructions')}</Text>
          <Text style={styles.stateText}>{error}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={() => loadContent(selectedFilePath)}>
            <Text style={styles.retryText}>{t('common:Retry')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const fileTabs = (
    <View style={styles.fileTabsWrap}>
      <TouchableOpacity
        style={[styles.fileChip, !selectedFilePath && styles.fileChipActive]}
        onPress={() => handleOpenFile(null)}
      >
        <Text style={[styles.fileChipText, !selectedFilePath && styles.fileChipTextActive]}>
          {t('Main instructions')}
        </Text>
      </TouchableOpacity>
      {linkedFiles.map((file) => (
        <TouchableOpacity
          key={file.path}
          style={[styles.fileChip, selectedFilePath === file.path && styles.fileChipActive]}
          onPress={() => handleOpenFile(file.path)}
        >
          <Text style={[styles.fileChipText, selectedFilePath === file.path && styles.fileChipTextActive]}>
            {file.path}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );

  if (isEditing) {
    return (
      <KeyboardAvoidingView
        behavior={Platform.select({ ios: 'padding', android: undefined })}
        style={[styles.root, styles.rootEditing]}
      >
        {header}
        <ScrollView
          style={styles.pageScroll}
          contentContainerStyle={styles.pageContent}
          keyboardShouldPersistTaps="handled"
        >
          {fileTabs}
          <View style={styles.editorFrame}>
            <TextInput
              style={styles.editorInput}
              value={draftContent}
              onChangeText={setDraftContent}
              multiline
              scrollEnabled
              autoCorrect={false}
              autoCapitalize="none"
              spellCheck={false}
              placeholder={t('No skill instructions found.')}
              placeholderTextColor={theme.colors.textSubtle}
              textAlignVertical="top"
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  return (
    <View style={styles.root}>
      {header}
      <ScrollView style={styles.pageScroll} contentContainerStyle={styles.pageContent}>
        {fileTabs}
        <View style={styles.readOnlyFrame}>
          <Text style={styles.readOnlyText} selectable>
            {contentDetail?.content || t('No skill instructions found.')}
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: colors.background,
    },
    headerActionsSlot: {
      width: 170,
      paddingRight: Space.sm,
    },
    headerActionSideSlot: {
      width: 170,
    },
    headerActions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.sm,
      minWidth: 130,
      justifyContent: 'flex-end',
    },
    primaryHeaderButton: {
      borderRadius: Radius.md,
      backgroundColor: colors.primary,
      paddingHorizontal: Space.sm,
      paddingVertical: Space.xs + 2,
      minHeight: 32,
      minWidth: 44,
      alignItems: 'center',
      justifyContent: 'center',
    },
    primaryHeaderButtonDisabled: {
      backgroundColor: colors.surfaceMuted,
    },
    primaryHeaderButtonText: {
      fontSize: FontSize.base,
      fontWeight: FontWeight.semibold,
      color: colors.primaryText,
      textAlign: 'center',
    },
    secondaryHeaderButton: {
      borderRadius: Radius.md,
      backgroundColor: colors.surfaceMuted,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: Space.sm,
      paddingVertical: Space.xs + 2,
      minHeight: 32,
      alignItems: 'center',
      justifyContent: 'center',
    },
    exitText: {
      fontSize: FontSize.base,
      fontWeight: FontWeight.semibold,
      color: colors.textMuted,
    },
    saveTextDisabled: {
      color: colors.textSubtle,
    },
    rootEditing: {
      backgroundColor: colors.surfaceMuted,
    },
    pageScroll: {
      flex: 1,
    },
    pageContent: {
      padding: Space.md,
      gap: Space.md,
    },
    fileTabsWrap: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: Space.xs,
    },
    fileChip: {
      borderRadius: Radius.full,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceMuted,
      paddingHorizontal: 10,
      paddingVertical: 6,
    },
    fileChipActive: {
      borderColor: colors.primary,
      backgroundColor: colors.primarySoft,
    },
    fileChipText: {
      color: colors.textMuted,
      fontSize: FontSize.sm,
      fontWeight: FontWeight.medium,
    },
    fileChipTextActive: {
      color: colors.primary,
    },
    editorFrame: {
      minHeight: 420,
      backgroundColor: colors.surface,
      borderColor: colors.primary,
      borderWidth: 1,
      borderRadius: Radius.md,
    },
    editorInput: {
      minHeight: 420,
      backgroundColor: 'transparent',
      borderRadius: Radius.md,
      paddingHorizontal: Space.md,
      paddingVertical: Space.md,
      color: colors.text,
      fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
      fontSize: FontSize.md,
      lineHeight: 20,
      includeFontPadding: false,
    },
    readOnlyFrame: {
      backgroundColor: colors.surfaceMuted,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: Radius.md,
      paddingHorizontal: Space.md,
      paddingVertical: Space.md,
      minHeight: 420,
    },
    readOnlyText: {
      color: colors.text,
      fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
      fontSize: FontSize.md,
      lineHeight: 20,
    },
    centerState: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: Space.lg + Space.xs,
    },
    stateText: {
      marginTop: 8,
      color: colors.textMuted,
      fontSize: FontSize.md,
      textAlign: 'center',
    },
    errorTitle: {
      color: colors.error,
      fontSize: FontSize.base,
      fontWeight: FontWeight.bold,
    },
    retryButton: {
      marginTop: Space.md,
      backgroundColor: colors.primary,
      borderRadius: Radius.sm,
      paddingHorizontal: Space.md,
      paddingVertical: 6,
    },
    retryText: {
      color: colors.primaryText,
      fontSize: FontSize.sm,
      fontWeight: FontWeight.semibold,
    },
  });
}
