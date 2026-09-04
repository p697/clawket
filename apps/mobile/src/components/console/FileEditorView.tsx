import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Keyboard,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useTranslation } from 'react-i18next';
import { LoadingState, ScreenHeader } from '../ui';
import { useProPaywall } from '../../contexts/ProPaywallContext';
import { GatewayClient } from '../../services/gateway';
import { useAppTheme } from '../../theme';
import { FontSize, FontWeight, Radius, Space } from '../../theme/tokens';

type Props = {
  gateway: GatewayClient;
  topInset: number;
  fileName: string;
  onBack: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  agentId?: string;
  dismissStyle?: 'back' | 'close';
};

export function FileEditorView({
  gateway,
  topInset,
  fileName,
  onBack,
  onDirtyChange,
  agentId,
  dismissStyle = 'back',
}: Props): React.JSX.Element {
  const { t } = useTranslation('console');
  const { requirePro } = useProPaywall();
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors), [theme]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [content, setContent] = useState('');
  const [originalContent, setOriginalContent] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);

  const hasChanges = content !== originalContent;

  useEffect(() => {
    onDirtyChange?.(hasChanges);
  }, [hasChanges, onDirtyChange]);

  const loadFile = useCallback(async () => {
    setLoading(true);
    try {
      const result = await gateway.getAgentFile(fileName, agentId);
      const nextContent = result.content ?? '';
      setContent(nextContent);
      setOriginalContent(nextContent);
      setIsEditing(false);
      setError(null);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('Unknown error');
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [agentId, fileName, gateway, t]);

  useEffect(() => {
    loadFile().catch(() => {
      // Error state already handled in loadFile.
    });
  }, [loadFile]);

  const handleBack = useCallback(() => {
    onBack();
  }, [onBack]);

  const handleSaveConfirmed = useCallback(async () => {
    if (!isEditing || !hasChanges || saving) return;

    setSaving(true);
    try {
      const result = await gateway.setAgentFile(fileName, content, agentId);
      if (!result.ok) {
        throw new Error(t('Gateway rejected save request'));
      }
      setOriginalContent(content);
      setIsEditing(false);
      Keyboard.dismiss();
      Alert.alert(t('File updated'), t('Your changes have been saved.'), [
        { text: t('common:Done') },
      ]);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('Unknown error');
      if (message.includes('missing scope: operator.admin')) {
        Alert.alert(
          t('Save failed'),
          t('Missing permission: operator.admin. Reconnect with an admin-capable Gateway token and try again.'),
        );
      } else {
        Alert.alert(t('Save failed'), message);
      }
    } finally {
      setSaving(false);
    }
  }, [agentId, content, fileName, gateway, hasChanges, isEditing, saving, t]);

  const handleStartEdit = useCallback(() => {
    if (!requirePro('coreFileEditing')) return;
    setIsEditing(true);
  }, [requirePro]);

  const handleExitEdit = useCallback(() => {
    setIsEditing(false);
    Keyboard.dismiss();
  }, []);

  const handleSavePress = useCallback(() => {
    if (!isEditing || !hasChanges || saving) return;
    Alert.alert(
      t('Confirm save'),
      t('Save changes to {{fileName}}?', { fileName }),
      [
        { text: t('common:Cancel'), style: 'cancel' },
        {
          text: t('common:Save'),
          onPress: () => {
            handleSaveConfirmed().catch(() => {
              // Save errors are already handled in handleSaveConfirmed.
            });
          },
        },
      ],
    );
  }, [fileName, handleSaveConfirmed, hasChanges, isEditing, saving, t]);

  const header = (
    <ScreenHeader
      title={fileName}
      topInset={topInset}
      onBack={handleBack}
      dismissStyle={dismissStyle}
      leftSlotStyle={styles.headerActionSideSlot}
      rightSlotStyle={styles.headerActionsSlot}
      rightContent={isEditing ? (
        <View style={styles.headerActions}>
          <TouchableOpacity
            onPress={handleExitEdit}
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
      ) : (
        <TouchableOpacity
          onPress={handleStartEdit}
          hitSlop={10}
          disabled={loading || !!error}
          style={[styles.primaryHeaderButton, (loading || !!error) && styles.primaryHeaderButtonDisabled]}
        >
          <Text style={[styles.primaryHeaderButtonText, (loading || !!error) && styles.saveTextDisabled]}>{t('common:Edit')}</Text>
        </TouchableOpacity>
      )}
    />
  );

  if (loading) {
    return (
      <View style={styles.root}>
        {header}
        <LoadingState message={t('Loading {{fileName}}...', { fileName })} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.root}>
        {header}
        <View style={styles.centerState}>
          <Text style={styles.errorTitle}>{t('Failed to load file')}</Text>
          <Text style={styles.stateText}>{error}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={loadFile}>
            <Text style={styles.retryText}>{t('common:Retry')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (isEditing) {
    return (
      <KeyboardAvoidingView
        behavior={Platform.select({ ios: 'padding', android: undefined })}
        style={[styles.root, styles.rootEditing]}
      >
        {header}
        <View style={styles.editorWrap}>
          <View style={styles.editorFrame}>
            <TextInput
              style={styles.editorInput}
              value={content}
              onChangeText={setContent}
              multiline
              scrollEnabled
              autoCorrect={false}
              autoCapitalize="none"
              spellCheck={false}
              placeholder={t('File content')}
              placeholderTextColor={theme.colors.textSubtle}
              textAlignVertical="top"
            />
          </View>
        </View>
      </KeyboardAvoidingView>
    );
  }

  // Read-only mode: header (index 0) + ScrollView (index 1) as direct
  // children so iOS formSheet recognises the sticky-header layout.
  return (
    <View style={styles.root}>
      {header}
      <ScrollView
        style={styles.readOnlyScroll}
        contentContainerStyle={styles.readOnlyContent}
      >
        <Text style={styles.readOnlyText} selectable>
          {content || t('File content')}
        </Text>
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
    primaryHeaderButtonText: {
      fontSize: FontSize.base,
      fontWeight: FontWeight.semibold,
      color: colors.primaryText,
      textAlign: 'center',
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
    secondaryHeaderButton: {
      borderRadius: Radius.md,
      backgroundColor: colors.surfaceMuted,
      borderWidth: StyleSheet.hairlineWidth,
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
    rootEditing: {
      backgroundColor: colors.surfaceMuted,
    },
    editorWrap: {
      flex: 1,
      padding: Space.md,
      backgroundColor: colors.surfaceMuted,
    },
    editorFrame: {
      flex: 1,
      backgroundColor: colors.surface,
      borderColor: colors.primary,
      borderWidth: StyleSheet.hairlineWidth,
      borderRadius: Radius.md,
    },
    editorInput: {
      flex: 1,
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
    readOnlyScroll: {
      flex: 1,
      margin: Space.md,
      backgroundColor: colors.surfaceMuted,
      borderColor: colors.border,
      borderWidth: StyleSheet.hairlineWidth,
      borderRadius: Radius.md,
    },
    readOnlyContent: {
      paddingHorizontal: Space.md,
      paddingVertical: Space.md,
    },
    readOnlyText: {
      color: colors.text,
      fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
      fontSize: FontSize.md,
      lineHeight: 20,
    },
  });
}
