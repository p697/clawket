import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useAppContext } from '../../contexts/AppContext';
import { useAppTheme } from '../../theme';
import { FontSize, FontWeight, Space } from '../../theme/tokens';
import { Button, FormTextInput, ModalSheet } from '../ui';
import { EmojiPicker, getRandomEmoji } from './EmojiPicker';
import { shouldResetCreateAgentForm } from './createAgentModalState';
import { enrichAgentsWithIdentity } from '../../services/agent-identity';

type Props = {
  visible: boolean;
  onClose: () => void;
  onCreated?: (agentId: string) => void;
};

export function CreateAgentModal({ visible, onClose, onCreated }: Props): React.JSX.Element {
  const { t } = useTranslation('chat');
  const { gateway, agents, setAgents } = useAppContext();
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors), [theme]);

  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('');
  const [creating, setCreating] = useState(false);
  const [polling, setPolling] = useState(false);

  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wasVisibleRef = useRef(false);

  // Snapshot of agent IDs before creation, used to detect the new agent.
  const prevAgentIdsRef = useRef<Set<string>>(new Set());

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
      if (pollingTimeoutRef.current) clearTimeout(pollingTimeoutRef.current);
    };
  }, []);

  // Reset form when modal opens
  useEffect(() => {
    if (shouldResetCreateAgentForm(visible, wasVisibleRef.current)) {
      setName('');
      setEmoji(getRandomEmoji());
      setCreating(false);
      setPolling(false);
    }
    wasVisibleRef.current = visible;
  }, [visible]);

  const stopPolling = useCallback(() => {
    if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }
    if (pollingTimeoutRef.current) { clearTimeout(pollingTimeoutRef.current); pollingTimeoutRef.current = null; }
    setPolling(false);
  }, []);

  const handleCreate = useCallback(async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      Alert.alert(t('Name required'), t('Please enter a name for the agent.'));
      return;
    }
    const candidateId = trimmed.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '');
    if (!candidateId) {
      Alert.alert(
        t('Invalid name'),
        t('Agent name must contain at least one ASCII letter or digit.'),
      );
      return;
    }
    if (candidateId === 'main') {
      Alert.alert(
        t('Reserved name'),
        t('"main" is reserved and cannot be used as an agent name.'),
      );
      return;
    }

    // Snapshot current agent IDs before creation
    prevAgentIdsRef.current = new Set(agents.map((a) => a.id));

    setCreating(true);
    try {
      await gateway.createAgent({
        name: trimmed,
        emoji: emoji || undefined,
      });

      setCreating(false);
      setPolling(true);

      // Clear any previous polling
      if (pollingRef.current) clearInterval(pollingRef.current);
      if (pollingTimeoutRef.current) clearTimeout(pollingTimeoutRef.current);

      pollingRef.current = setInterval(async () => {
        try {
          const result = await gateway.listAgents();
          const newAgent = result.agents.find((a) => !prevAgentIdsRef.current.has(a.id));
          if (newAgent) {
            const enriched = await enrichAgentsWithIdentity(gateway, result.agents);
            setAgents(enriched);
            stopPolling();
            onClose();
            onCreated?.(newAgent.id);
          }
        } catch {
          // Retry on next interval
        }
      }, 500);

      // Timeout after 10 seconds — force refresh and close
      pollingTimeoutRef.current = setTimeout(async () => {
        stopPolling();
        try {
          const result = await gateway.listAgents();
          const enriched = await enrichAgentsWithIdentity(gateway, result.agents);
          setAgents(enriched);
          const newAgent = enriched.find((a) => !prevAgentIdsRef.current.has(a.id));
          onClose();
          if (newAgent) onCreated?.(newAgent.id);
        } catch {
          onClose();
        }
      }, 10000);
    } catch (err: unknown) {
      setCreating(false);
      const message = err instanceof Error ? err.message : t('Failed to create agent');
      Alert.alert(t('Error'), message);
    }
  }, [name, emoji, gateway, agents, setAgents, stopPolling, onClose, onCreated, t]);

  return (
    <ModalSheet visible={visible} onClose={onClose} title={t('Create Agent')} maxHeight="88%">
      <View style={styles.body}>
        <Text style={styles.description}>{t('create_agent_desc')}</Text>

        <Text style={styles.fieldLabel}>{t('Name')}</Text>
        <FormTextInput
          value={name}
          onChangeText={setName}
          placeholder={t('Agent name')}
          surface="sunken"
          autoCapitalize="none"
          autoCorrect={false}
          editable={!creating && !polling}
        />

        <Text style={styles.fieldLabel}>{t('Emoji')}</Text>
        <EmojiPicker
          value={emoji}
          onSelect={setEmoji}
          disabled={creating || polling}
        />

        {polling ? (
          <View style={styles.pollingRow}>
            <ActivityIndicator size="small" color={theme.colors.primary} />
            <Text style={styles.pollingText}>{t('Creating agent...')}</Text>
          </View>
        ) : (
          <Button
            label={creating ? t('Creating agent...') : t('common:Create')}
            onPress={handleCreate}
            disabled={creating}
            loading={creating}
            style={styles.createButton}
          />
        )}
      </View>
    </ModalSheet>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    body: {
      paddingHorizontal: Space.lg,
      paddingBottom: Space.xl,
    },
    description: {
      fontSize: FontSize.md,
      color: colors.textMuted,
      lineHeight: 18,
      marginBottom: Space.xs,
    },
    fieldLabel: {
      fontSize: FontSize.md,
      fontWeight: FontWeight.medium,
      color: colors.textMuted,
      marginBottom: Space.xs,
      marginTop: Space.md,
    },
    createButton: {
      marginTop: Space.xl,
    },
    pollingRow: {
      marginTop: Space.xl,
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      gap: Space.sm,
      paddingVertical: 11,
    },
    pollingText: {
      color: colors.textMuted,
      fontSize: FontSize.base,
      fontWeight: FontWeight.semibold,
    },
  });
}
