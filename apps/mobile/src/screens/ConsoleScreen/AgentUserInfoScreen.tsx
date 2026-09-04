import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { LayoutChangeEvent } from 'react-native';
import {
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { RouteProp, useNavigation, usePreventRemove, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { PencilLine } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, FormTextInput } from '../../components/ui';
import { useAppContext } from '../../contexts/AppContext';
import { useProPaywall } from '../../contexts/ProPaywallContext';
import { useNativeStackModalHeader } from '../../hooks/useNativeStackModalHeader';
import { useAppTheme } from '../../theme';
import { FontSize, FontWeight, Radius, Space } from '../../theme/tokens';
import {
  EMPTY_AGENT_USER_PROFILE,
  mergeAgentUserMarkdown,
  parseAgentUserProfile,
  type AgentUserProfile,
} from '../../utils/agent-user-profile';
import type { ConsoleStackParamList } from './ConsoleTab';

type Navigation = NativeStackNavigationProp<ConsoleStackParamList, 'AgentUserInfo'>;
type Route = RouteProp<ConsoleStackParamList, 'AgentUserInfo'>;
type FieldKey = keyof AgentUserProfile;

type FieldConfig = {
  key: FieldKey;
  label: string;
  placeholder: string;
  multiline?: boolean;
  minHeight?: number;
  autoCapitalize?: 'none' | 'sentences' | 'words';
};

export function AgentUserInfoScreen(): React.JSX.Element {
  const { gateway } = useAppContext();
  const { requirePro } = useProPaywall();
  const { theme } = useAppTheme();
  const { t } = useTranslation('console');
  const { t: tCommon } = useTranslation('common');
  const navigation = useNavigation<Navigation>();
  const route = useRoute<Route>();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);
  const { agentId } = route.params;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState<AgentUserProfile>(EMPTY_AGENT_USER_PROFILE);
  const [initialProfile, setInitialProfile] = useState<AgentUserProfile>(EMPTY_AGENT_USER_PROFILE);
  const [rawContent, setRawContent] = useState('');
  const [fieldOffsets, setFieldOffsets] = useState<Partial<Record<FieldKey, number>>>({});

  const isDirty = JSON.stringify(profile) !== JSON.stringify(initialProfile);

  const fields = useMemo<FieldConfig[]>(() => [
    { key: 'name', label: t('My name'), placeholder: t('Enter my name'), autoCapitalize: 'words' },
    {
      key: 'whatToCallThem',
      label: t('What should the agent call me?'),
      placeholder: t('Enter how the agent should address me'),
      autoCapitalize: 'words',
    },
    {
      key: 'pronouns',
      label: t('Pronouns'),
      placeholder: t('Enter pronouns'),
      autoCapitalize: 'none',
    },
    {
      key: 'timezone',
      label: t('Timezone'),
      placeholder: t('Enter timezone'),
      autoCapitalize: 'none',
    },
    {
      key: 'notes',
      label: t('What should your agent know about you?'),
      placeholder: t('Enter what your agent should know about you'),
      multiline: true,
      minHeight: 112,
      autoCapitalize: 'sentences',
    },
    {
      key: 'context',
      label: t('What have you been up to recently?'),
      placeholder: t('Enter what you have been doing recently'),
      multiline: true,
      minHeight: 112,
      autoCapitalize: 'sentences',
    },
  ], [t]);

  const loadProfile = useCallback(async () => {
    setLoading(true);
    try {
      const file = await gateway.getAgentFile('USER.md', agentId);
      setRawContent(file.content ?? '');
      const nextProfile = parseAgentUserProfile(file.content ?? '');
      setProfile(nextProfile);
      setInitialProfile(nextProfile);
      setError(null);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('Failed to load user info');
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [agentId, gateway, t]);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  usePreventRemove(editing && isDirty, ({ data }) => {
    Alert.alert(t('Discard changes?'), t('You have unsaved changes.'), [
      { text: t('Keep Editing'), style: 'cancel' },
      {
        text: t('Discard'),
        style: 'destructive',
        onPress: () => navigation.dispatch(data.action),
      },
    ]);
  });

  const updateField = useCallback((key: FieldKey, value: string) => {
    setProfile((current) => ({ ...current, [key]: value }));
  }, []);

  const handleFieldLayout = useCallback((key: FieldKey, event: LayoutChangeEvent) => {
    const nextY = event.nativeEvent.layout.y;
    setFieldOffsets((current) => (current[key] === nextY ? current : { ...current, [key]: nextY }));
  }, []);

  const scrollRef = React.useRef<ScrollView | null>(null);

  const handleFieldFocus = useCallback((key: FieldKey) => {
    const offsetY = fieldOffsets[key];
    if (offsetY == null) return;
    setTimeout(() => {
      scrollRef.current?.scrollTo({
        y: Math.max(0, offsetY - Space.lg),
        animated: true,
      });
    }, 180);
  }, [fieldOffsets]);

  const handleStartEdit = useCallback(() => {
    if (!requirePro('coreFileEditing')) return;
    setEditing(true);
  }, [requirePro]);

  const exitEditMode = useCallback(() => {
    setProfile(initialProfile);
    setEditing(false);
  }, [initialProfile]);

  const handleCancelEdit = useCallback(() => {
    if (!isDirty) {
      exitEditMode();
      return;
    }
    Alert.alert(t('Discard changes?'), t('You have unsaved changes.'), [
      { text: t('Keep Editing'), style: 'cancel' },
      {
        text: t('Discard'),
        style: 'destructive',
        onPress: exitEditMode,
      },
    ]);
  }, [exitEditMode, isDirty, t]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const content = mergeAgentUserMarkdown(rawContent, profile);
      const result = await gateway.setAgentFile('USER.md', content, agentId);
      if (!result.ok) {
        throw new Error(t('Gateway rejected save request'));
      }
      setRawContent(content);
      setInitialProfile(profile);
      setEditing(false);
      Alert.alert(t('My Info updated'), t('Your changes have been saved.'), [
        { text: tCommon('Done') },
      ]);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('Failed to save user info');
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
  }, [agentId, gateway, profile, rawContent, t, tCommon]);

  useNativeStackModalHeader({
    navigation,
    title: t('My Info'),
    onClose: () => navigation.goBack(),
  });

  if (loading) {
    return (
      <View style={styles.root}>
        <View style={styles.centerState}>
          <Text style={styles.stateText}>{t('Loading user info...')}</Text>
        </View>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.root}>
        <View style={styles.centerState}>
          <Text style={styles.errorTitle}>{t('Failed to load user info')}</Text>
          <Text style={styles.stateText}>{error}</Text>
          <Pressable style={styles.retryButton} onPress={() => void loadProfile()}>
            <Text style={styles.retryText}>{tCommon('Retry')}</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.select({ ios: 'padding', android: undefined })}
      keyboardVerticalOffset={insets.bottom}
      style={styles.root}
    >
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
      >
        {fields.map((field) => {
          const value = profile[field.key];
          return (
            <View
              key={field.key}
              style={styles.section}
              onLayout={(event) => handleFieldLayout(field.key, event)}
            >
              <Text style={styles.fieldLabel}>{field.label}</Text>
              {editing ? (
                <FormTextInput
                  value={value}
                  onChangeText={(nextValue) => updateField(field.key, nextValue)}
                  placeholder={field.placeholder}
                  editable={!saving}
                  autoCapitalize={field.autoCapitalize ?? 'sentences'}
                  autoCorrect={false}
                  multiline={field.multiline}
                  minHeight={field.multiline ? field.minHeight ?? 164 : undefined}
                  surface="sunken"
                  onFocus={() => handleFieldFocus(field.key)}
                />
              ) : (
                <View
                  style={[
                    styles.valueCard,
                    field.multiline && styles.valueCardMultiline,
                    field.multiline && field.minHeight != null
                      ? { minHeight: field.minHeight }
                      : null,
                  ]}
                >
                  <Text style={[styles.valueText, !value && styles.emptyValueText]}>
                    {value || t('Not set')}
                  </Text>
                </View>
              )}
            </View>
          );
        })}
      </ScrollView>

      <View
        style={[
          styles.footer,
          { paddingBottom: Math.max(insets.bottom, Space.md) + Space.sm },
        ]}
      >
        {editing ? (
          <>
            <Button
              label={tCommon('Cancel')}
              variant="secondary"
              onPress={handleCancelEdit}
              style={styles.footerButton}
            />
            <Button
              label={saving ? tCommon('Saving...') : tCommon('Save')}
              onPress={() => void handleSave()}
              disabled={!isDirty || saving}
              loading={saving}
              style={styles.footerButton}
            />
          </>
        ) : (
          <Button
            label={tCommon('Edit')}
            icon={PencilLine}
            onPress={handleStartEdit}
            style={styles.footerButton}
          />
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

function createStyles(colors: ReturnType<typeof import('../../theme').useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: colors.background,
    },
    content: {
      padding: Space.lg,
      paddingBottom: 280,
      gap: Space.md,
    },
    section: {
      gap: Space.xs,
    },
    fieldLabel: {
      fontSize: FontSize.md,
      fontWeight: FontWeight.medium,
      color: colors.textMuted,
    },
    valueCard: {
      minHeight: 52,
      borderRadius: Radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.inputBackground,
      paddingHorizontal: Space.md,
      paddingVertical: Space.md,
      justifyContent: 'center',
    },
    valueCardMultiline: {
      minHeight: 164,
      justifyContent: 'flex-start',
    },
    valueText: {
      color: colors.text,
      fontSize: FontSize.base,
      lineHeight: 22,
    },
    emptyValueText: {
      color: colors.textSubtle,
    },
    footer: {
      flexDirection: 'row',
      gap: Space.md,
      paddingHorizontal: Space.lg,
      paddingTop: Space.md,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
      backgroundColor: colors.background,
    },
    footerButton: {
      flex: 1,
    },
    centerState: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      padding: Space.xl,
      gap: Space.md,
    },
    stateText: {
      color: colors.textMuted,
      fontSize: FontSize.md,
      textAlign: 'center',
    },
    errorTitle: {
      color: colors.text,
      fontSize: FontSize.lg,
      fontWeight: FontWeight.semibold,
      textAlign: 'center',
    },
    retryButton: {
      minHeight: 44,
      paddingHorizontal: Space.lg,
      borderRadius: Radius.md,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    retryText: {
      color: colors.primaryText,
      fontSize: FontSize.base,
      fontWeight: FontWeight.semibold,
    },
  });
}
