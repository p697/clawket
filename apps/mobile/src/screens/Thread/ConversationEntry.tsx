import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { getConnectionRuntime, useConnections } from '../../connection';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { SessionPanel } from '../SessionPanel';
import { ManualSessions } from '../../services/manual-sessions';
import { SessionPreferencesService } from '../../services/session-preferences';
import { useAppTheme } from '../../theme';
import { useProPaywall } from '../../contexts/ProPaywallContext';
import type { ThreadScreenProps } from './ThreadScreen';
import type { RootStackParamList } from '../../navigation/root-stack';

/** Navigation only: never mounts a chat controller or creates a placeholder thread. */
export function ConversationEntry({ navigation, route, locked, lockedReason = 'agents', onSessionAction, onSessionPanelAfterClose, pinnedSessionKeys }: ThreadScreenProps) {
  const { connectionId, agentId } = route.params;
  const focused = useIsFocused();
  const connections = useConnections();
  const { theme } = useAppTheme();
  const { t } = useTranslation('common');
  const insets = useSafeAreaInsets();
  const { showPaywall } = useProPaywall();
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(true);
  const closed = useRef(false);
  const pending = useRef<RootStackParamList['Thread'] | null>(null);
  const scope = useRef({ connectionId, agentId, focused });
  scope.current = { connectionId, agentId, focused };
  const title = connections.roster.find(group => group.connection.id === connectionId)?.agents
    .find(row => row.agent.agentId === agentId)?.agent.name ?? t('Sessions');

  useEffect(() => {
    if (!focused || !connections.initialized) return;
    let current = true;
    closed.current = false;
    setLoading(true);
    setVisible(false);
    pending.current = null;
    void (async () => {
      if (locked) return;
      const runtime = getConnectionRuntime();
      await runtime.activate(connectionId);
      await runtime.refreshRoster();
      const last = await SessionPreferencesService.getLastSession(connectionId, agentId);
      if (!current || runtime.getSnapshot().activeConnectionId !== connectionId) return;
      const sessions = runtime.getSnapshot().roster.find(group => group.connection.id === connectionId)?.agents
        .find(row => row.agent.agentId === agentId)?.sessions;
      if (last && sessions?.some(session => session.key === last)) {
        navigation.replace('Thread', { ...route.params, sessionKey: last });
        current = false;
      }
    })().catch(() => { /* The session sheet retains cached history and reconnect controls. */ }).finally(() => {
      if (current) { setLoading(false); setVisible(true); }
    });
    return () => { current = false; closed.current = true; };
  }, [connectionId, agentId, focused, connections.initialized, locked, navigation]);

  const choose = (sessionKey: string) => {
    pending.current = { ...route.params, sessionKey, from: 'panel' };
    setVisible(false);
  };
  const close = () => { closed.current = true; setVisible(false); };
  return <View testID="conversation-entry" style={[styles.page, { backgroundColor: theme.colors.canvas }]}>
    {loading ? <>
      <ScreenHeader title={title} topInset={insets.top} onBack={() => navigation.goBack()} />
      <ActivityIndicator color={theme.colors.inkSecondary} />
    </> : null}
    <SessionPanel connectionId={connectionId} visible={visible && focused} currentAgentId={agentId} currentSessionKey=""
      permissionDenied={locked} pinnedSessionKeys={pinnedSessionKeys} onClose={close}
      onAfterClose={() => {
        if (!scope.current.focused) return;
        const target = pending.current;
        pending.current = null;
        onSessionPanelAfterClose?.();
        if (target) navigation.replace('Thread', target);
        else if (!loading) navigation.goBack();
      }}
      onSelectSession={row => choose(row.key)}
      onCreateSession={async (agent, projectId) => {
        const runtime = getConnectionRuntime();
        const adapter = runtime.getSnapshot().activeAdapter;
        if (locked || !adapter || adapter.connection.id !== connectionId) throw new Error('Connection unavailable');
        const created = await ManualSessions.create(adapter, agent.agentId, 'manual', projectId ? { projectId } : undefined);
        const current = scope.current;
        if (closed.current || !current.focused || current.connectionId !== connectionId || current.agentId !== agentId || runtime.getSnapshot().activeAdapter !== adapter) return;
        choose(created.key);
      }}
      onSessionAction={onSessionAction ? async (row, action, payload) => {
        await onSessionAction(row, action, payload);
        if (action === 'export') close();
      } : undefined}
      onOpenPermission={() => showPaywall(lockedReason)} />
  </View>;
}

const styles = StyleSheet.create({ page: { flex: 1 } });
