import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { ChevronRight, UserRound } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { LoadingState } from '../../components/ui';
import { useGatewayPatch } from '../../hooks/useGatewayPatch';
import { useNativeStackModalHeader } from '../../hooks/useNativeStackModalHeader';
import { EmojiPicker } from '../../components/agents/EmojiPicker';
import { ModelConfigSection } from '../../components/console/ModelConfigSection';
import { ModelPickerModal, resolveProviderModel } from '../../components/chat/ModelPickerModal';
import type { ModelInfo } from '../../components/chat/ModelPickerModal';
import { useAppContext } from '../../contexts/AppContext';
import { useAppTheme } from '../../theme';
import { analyticsEvents } from '../../services/analytics/events';
import { enrichAgentsWithIdentity } from '../../services/agent-identity';
import { loadGatewayAgentDetailBundle } from '../../services/gateway-agent-detail';
import { loadGatewayModelPickerOptions } from '../../services/gateway-models';
import { FontSize, FontWeight, Radius, Space } from '../../theme/tokens';
import type { AgentInfo } from '../../types/agent';
import {
  EMPTY_AGENT_IDENTITY_PROFILE,
  type AgentIdentityProfile,
} from '../../utils/agent-identity-profile';
import { persistAgentDetailChanges } from '../../utils/agent-detail-save';
import { addFallbackModel, moveFallbackModel, removeFallbackModelAt, sanitizeFallbackModels } from '../../utils/fallback-models';
import type { ConsoleStackParamList } from './ConsoleTab';
import { pendingAgentDeletes } from './AgentListScreen';

type AgentDetailNavigation = NativeStackNavigationProp<ConsoleStackParamList, 'AgentDetail'>;
type AgentDetailRoute = RouteProp<ConsoleStackParamList, 'AgentDetail'>;

type PickerTarget = 'primary' | 'fallback';

export function AgentDetailScreen(): React.JSX.Element {
  const { gateway, gatewayEpoch, currentAgentId, switchAgent, setAgents } = useAppContext();
  const { theme } = useAppTheme();
  const { t } = useTranslation('console');
  const { t: tCommon } = useTranslation('common');
  const { t: tChat } = useTranslation('chat');
  const navigation = useNavigation<AgentDetailNavigation>();
  const route = useRoute<AgentDetailRoute>();
  const styles = useMemo(() => createStyles(theme.colors), [theme]);

  const { agentId } = route.params;

  const [loading, setLoading] = useState(true);
  const [agent, setAgent] = useState<AgentInfo | null>(null);
  const [mainKey, setMainKey] = useState('main');
  const [saving, setSaving] = useState(false);
  const { patchWithRestart } = useGatewayPatch(gateway);

  // Form fields
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('');
  const [vibe, setVibe] = useState('');
  const [model, setModel] = useState('');
  const [fallbacks, setFallbacks] = useState<string[]>([]);

  // Initial values for dirty tracking
  const initialRef = useRef({ name: '', emoji: '', vibe: '', model: '', fallbacks: '' });
  const identityProfileRef = useRef<AgentIdentityProfile>(EMPTY_AGENT_IDENTITY_PROFILE);
  const identityFileContentRef = useRef('');

  // Config hash for patch
  const configHashRef = useRef<string | null>(null);
  const agentIndexRef = useRef<number>(-1);

  // Model picker
  const [modelPickerVisible, setModelPickerVisible] = useState(false);
  const [pickerTarget, setPickerTarget] = useState<PickerTarget>('primary');
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);

  const isMain = agentId === mainKey;
  const isCurrent = agentId === currentAgentId;
  const trimmedName = name.trim();
  const isDirty = trimmedName !== initialRef.current.name
    || emoji !== initialRef.current.emoji
    || vibe.trim() !== initialRef.current.vibe
    || model !== initialRef.current.model
    || JSON.stringify(fallbacks) !== initialRef.current.fallbacks;

  const loadAgent = useCallback(async () => {
    setLoading(true);
    try {
      const bundle = await loadGatewayAgentDetailBundle(gateway, agentId);
      setAgent(bundle.agent);
      setMainKey(bundle.mainKey);
      configHashRef.current = bundle.configHash;
      agentIndexRef.current = bundle.agentIndex;
      identityProfileRef.current = bundle.identityProfile;
      identityFileContentRef.current = bundle.identityFileContent;
      setName(bundle.form.name);
      setEmoji(bundle.form.emoji);
      setVibe(bundle.form.vibe);
      setModel(bundle.form.model);
      setFallbacks(bundle.form.fallbacks);
      initialRef.current = {
        name: bundle.form.name,
        emoji: bundle.form.emoji,
        vibe: bundle.form.vibe,
        model: bundle.form.model,
        fallbacks: JSON.stringify(bundle.form.fallbacks),
      };
    } catch {
      // handled by empty state
    } finally {
      setLoading(false);
    }
  }, [agentId, gateway, gatewayEpoch]);

  useEffect(() => {
    loadAgent();
  }, [loadAgent]);

  const commitSave = useCallback(async () => {
    const nextName = name.trim();
    if (!nextName) {
      Alert.alert(tCommon('Error'), tChat('Please enter a name for the agent.'));
      return;
    }
    if (nextName.length > 50) {
      Alert.alert(tCommon('Error'), t('Name must be 50 characters or fewer.'));
      return;
    }

    analyticsEvents.agentSaveTapped({
      fallback_count: fallbacks.length,
      has_model: Boolean(model),
      has_name: Boolean(nextName),
    });
    setSaving(true);
    try {
      const sanitizedFallbacks = sanitizeFallbackModels(fallbacks, { primaryModel: model });
      const nextVibe = vibe.trim();
      const nextIdentityProfile: AgentIdentityProfile = {
        ...identityProfileRef.current,
        name: nextName,
        emoji,
        vibe: nextVibe,
      };
      const shouldWriteIdentityFile =
        nextName !== initialRef.current.name
        || emoji !== initialRef.current.emoji
        || nextVibe !== initialRef.current.vibe;
      const shouldSyncConfig =
        shouldWriteIdentityFile
        || model !== initialRef.current.model
        || JSON.stringify(sanitizedFallbacks) !== initialRef.current.fallbacks;

      if (shouldSyncConfig && (!configHashRef.current || agentIndexRef.current < 0)) {
        throw new Error('Agent config is unavailable. Reload and try again.');
      }

      const { nextIdentityFileContent } = await persistAgentDetailChanges({
        agentId,
        gateway,
        patchWithRestart,
        agentName: nextName,
        identityProfile: nextIdentityProfile,
        model,
        fallbacks: sanitizedFallbacks,
        shouldWriteIdentityFile,
        shouldSyncConfig,
        previousIdentityFileContent: identityFileContentRef.current,
      });

      const shouldUpdateModelState =
        model !== initialRef.current.model
        || JSON.stringify(sanitizedFallbacks) !== initialRef.current.fallbacks;

      // Refresh global agents
      const result = await gateway.listAgents();
      const enrichedAgents = await enrichAgentsWithIdentity(gateway, result.agents);
      setAgents(enrichedAgents);
      const refreshedAgent = enrichedAgents.find((item) => item.id === agentId) ?? null;
      setAgent(refreshedAgent);

      // Reset dirty tracking to current values
      if (shouldUpdateModelState) {
        setFallbacks(sanitizedFallbacks);
      }
      if (shouldWriteIdentityFile) {
        identityProfileRef.current = nextIdentityProfile;
        identityFileContentRef.current = nextIdentityFileContent;
      }
      initialRef.current = {
        name: nextName,
        emoji,
        vibe: nextVibe,
        model,
        fallbacks: JSON.stringify(sanitizedFallbacks),
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to update agent';
      Alert.alert(tCommon('Error'), message);
    } finally {
      setSaving(false);
    }
  }, [agentId, name, emoji, vibe, model, fallbacks, gateway, setAgents, patchWithRestart, t, tChat, tCommon]);

  const handleSave = useCallback(() => {
    if (saving) {
      return;
    }

    const sanitizedFallbacks = sanitizeFallbackModels(fallbacks, { primaryModel: model });
    const shouldRestart =
      trimmedName !== initialRef.current.name
      || emoji !== initialRef.current.emoji
      || model !== initialRef.current.model
      || JSON.stringify(sanitizedFallbacks) !== initialRef.current.fallbacks;

    if (!shouldRestart) {
      void commitSave();
      return;
    }

    Alert.alert(
      tCommon('Confirm Save'),
      tCommon('This will restart Gateway. Continue?'),
      [
        { text: tCommon('Cancel'), style: 'cancel' },
        {
          text: tCommon('Save'),
          style: 'default',
          onPress: () => {
            void commitSave();
          },
        },
      ],
    );
  }, [commitSave, emoji, fallbacks, model, saving, tCommon, trimmedName]);

  const handleSwitch = useCallback(() => {
    switchAgent(agentId);
    Alert.alert(t('Switched'), t('Now using agent "{{name}}".', { name: name || agentId }));
  }, [agentId, name, switchAgent, t]);

  const handleDelete = useCallback(() => {
    Alert.alert(
      t('Delete Agent'),
      t('Are you sure you want to delete "{{name}}"? This cannot be undone.', { name: name || agentId }),
      [
        { text: tCommon('Cancel'), style: 'cancel' },
        {
          text: tCommon('Delete'),
          style: 'destructive',
          onPress: async () => {
            try {
              await gateway.deleteAgent(agentId);
              // Mark as pending-delete so the list screen filters it out
              // from fetch results until the gateway confirms removal.
              pendingAgentDeletes.add(agentId);
              // If the deleted agent was the active one, fall back to main
              if (agentId === currentAgentId) {
                switchAgent(mainKey);
              }
              navigation.goBack();
            } catch (err: unknown) {
              const message = err instanceof Error ? err.message : 'Failed to delete agent';
              Alert.alert(tCommon('Error'), message);
            }
          },
        },
      ],
    );
  }, [agentId, name, gateway, navigation, currentAgentId, switchAgent, mainKey, t, tCommon]);

  const handleOpenUserInfo = useCallback(() => {
    navigation.navigate('AgentUserInfo', { agentId });
  }, [agentId, navigation]);

  const loadModels = useCallback(async () => {
    setModelsLoading(true);
    try {
      setModels(await loadGatewayModelPickerOptions(gateway));
    } catch {
      setModels([]);
    } finally {
      setModelsLoading(false);
    }
  }, [gateway]);

  const openModelPicker = useCallback((target: PickerTarget) => {
    setPickerTarget(target);
    setModelPickerVisible(true);
    loadModels();
  }, [loadModels]);

  const selectModel = useCallback((selected: ModelInfo) => {
    const resolved = selected.id ? resolveProviderModel(selected) : '';
    if (pickerTarget === 'primary') {
      setModel(resolved);
      setFallbacks((prev) => sanitizeFallbackModels(prev, { primaryModel: resolved }));
    } else {
      setFallbacks((prev) => addFallbackModel(prev, resolved, { primaryModel: model }));
    }
    setModelPickerVisible(false);
  }, [model, pickerTarget]);

  const removeFallback = useCallback((index: number) => {
    setFallbacks((prev) => removeFallbackModelAt(prev, index));
  }, []);

  const reorderFallback = useCallback((fromIndex: number, toIndex: number) => {
    setFallbacks((prev) => moveFallbackModel(prev, fromIndex, toIndex));
  }, []);

  // Models to show in picker: filter out existing fallbacks when adding a new one
  const pickerModels = useMemo(() => {
    if (pickerTarget === 'fallback') {
      return models.filter((m) => !fallbacks.includes(m.id));
    }
    return models;
  }, [models, pickerTarget, fallbacks]);

  useNativeStackModalHeader({
    navigation,
    title: name || agent?.identity?.name || agent?.name || tCommon('Agent'),
    onClose: () => navigation.goBack(),
  });

  if (loading) {
    return (
      <View style={styles.root}>
        <LoadingState message={t('Loading agent...')} />
      </View>
    );
  }

  if (!agent) {
    return (
      <View style={styles.root}>
        <View style={styles.centerState}>
          <Text style={styles.stateText}>{t('Agent not found.')}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Name */}
        <Text style={styles.fieldLabel}>{t('Name')}</Text>
        <View style={styles.fieldRow}>
          <TextInput
            style={styles.textInput}
            value={name}
            onChangeText={setName}
            placeholder={t('Agent name')}
            placeholderTextColor={theme.colors.textSubtle}
            editable={!saving}
            maxLength={50}
            autoCapitalize="words"
            autoCorrect={false}
          />
        </View>

        {/* Emoji */}
        <Text style={styles.fieldLabel}>{t('Emoji')}</Text>
        <EmojiPicker
          value={emoji}
          onSelect={setEmoji}
          disabled={saving}
        />

        <Text style={styles.fieldLabel}>{t('Vibe')}</Text>
        <View style={styles.fieldRow}>
          <TextInput
            style={styles.textInput}
            value={vibe}
            onChangeText={setVibe}
            placeholder={t('How should this agent come across?')}
            placeholderTextColor={theme.colors.textSubtle}
            editable={!saving}
            autoCapitalize="sentences"
            autoCorrect={false}
          />
        </View>

        <Text style={styles.fieldLabel}>{t('My Info')}</Text>
        <Pressable
          onPress={handleOpenUserInfo}
          style={({ pressed }) => [
            styles.navCard,
            pressed && styles.navCardPressed,
          ]}
        >
          <View style={styles.navCardLead}>
            <View style={styles.navIconBadge}>
              <UserRound size={17} color={theme.colors.primary} strokeWidth={2.1} />
            </View>
            <View style={styles.navCardText}>
              <Text style={styles.navCardTitle}>{t('View and edit USER.md fields')}</Text>
            </View>
          </View>
          <ChevronRight size={16} color={theme.colors.textSubtle} strokeWidth={2} />
        </Pressable>

        {/* Model Configuration */}
        <ModelConfigSection
          model={model}
          fallbacks={fallbacks}
          models={models}
          onPickPrimary={() => openModelPicker('primary')}
          onPickFallback={() => openModelPicker('fallback')}
          onRemoveFallback={removeFallback}
          onMoveFallback={reorderFallback}
          reorderEnabled
          disabled={saving}
        />

        {/* Save button */}
        <TouchableOpacity
          style={[styles.primaryButton, (!isDirty || saving) && styles.buttonDisabled]}
          onPress={handleSave}
          disabled={!isDirty || saving}
          activeOpacity={0.88}
        >
          <Text style={styles.primaryButtonText}>
            {saving ? tCommon('Saving...') : t('Save Changes')}
          </Text>
        </TouchableOpacity>

        {/* Switch to agent */}
        {!isCurrent && (
          <TouchableOpacity
            style={styles.outlineButton}
            onPress={handleSwitch}
            activeOpacity={0.7}
          >
            <Text style={styles.outlineButtonText}>{t('Switch to This Agent')}</Text>
          </TouchableOpacity>
        )}

        {/* Delete agent */}
        {!isMain && (
          <TouchableOpacity
            style={styles.destructiveButton}
            onPress={handleDelete}
            activeOpacity={0.7}
          >
            <Text style={styles.destructiveButtonText}>{t('Delete Agent')}</Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      <ModelPickerModal
        visible={modelPickerVisible}
        onClose={() => setModelPickerVisible(false)}
        title={pickerTarget === 'primary' ? t('Primary Model') : t('Add Fallback')}
        models={pickerModels}
        loading={modelsLoading}
        selectedModelId={pickerTarget === 'primary' ? model : undefined}
        showDefault={pickerTarget === 'primary'}
        onSelectModel={selectModel}
      />

    </View>
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
      paddingBottom: Space.xxxl,
    },
    centerState: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    stateText: {
      color: colors.textMuted,
      fontSize: FontSize.md,
    },
    fieldLabel: {
      fontSize: FontSize.md,
      fontWeight: FontWeight.medium,
      color: colors.textMuted,
      marginBottom: Space.xs,
      marginTop: Space.lg,
    },
    fieldRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: colors.inputBackground,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: Radius.md,
      paddingHorizontal: Space.md,
      paddingVertical: Space.sm + 4,
    },
    fieldDisabled: {
      opacity: 0.5,
    },
    fieldRowText: {
      flex: 1,
      fontSize: FontSize.base,
      color: colors.text,
    },
    textInput: {
      flex: 1,
      fontSize: FontSize.base,
      color: colors.text,
      paddingVertical: 0,
    },
    navCard: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      borderRadius: Radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      paddingHorizontal: Space.md,
      paddingVertical: Space.md,
    },
    navCardPressed: {
      opacity: 0.85,
    },
    navCardLead: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.md,
      flex: 1,
      paddingRight: Space.md,
    },
    navIconBadge: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.inputBackground,
    },
    navCardText: {
      flex: 1,
      gap: 2,
    },
    navCardTitle: {
      color: colors.text,
      fontSize: FontSize.base,
      fontWeight: FontWeight.semibold,
    },
    navCardSubtitle: {
      color: colors.textMuted,
      fontSize: FontSize.sm,
    },
    // Buttons
    primaryButton: {
      marginTop: Space.xl,
      backgroundColor: colors.primary,
      borderRadius: Radius.md,
      paddingVertical: 11,
      alignItems: 'center',
    },
    buttonDisabled: {
      opacity: 0.6,
    },
    primaryButtonText: {
      color: colors.primaryText,
      fontSize: FontSize.base,
      fontWeight: FontWeight.semibold,
    },
    outlineButton: {
      marginTop: Space.md,
      backgroundColor: colors.surface,
      borderRadius: Radius.md,
      borderWidth: 1,
      borderColor: colors.primary,
      paddingVertical: 11,
      alignItems: 'center',
    },
    outlineButtonText: {
      color: colors.primary,
      fontSize: FontSize.base,
      fontWeight: FontWeight.semibold,
    },
    destructiveButton: {
      marginTop: Space.md,
      backgroundColor: colors.surface,
      borderRadius: Radius.md,
      borderWidth: 1,
      borderColor: colors.error,
      paddingVertical: 11,
      alignItems: 'center',
    },
    destructiveButtonText: {
      color: colors.error,
      fontSize: FontSize.base,
      fontWeight: FontWeight.semibold,
    },
  });
}
