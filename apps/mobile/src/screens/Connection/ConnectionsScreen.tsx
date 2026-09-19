import React, { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Pause, Play, Plus, Trash2 } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ConnectionDescriptor } from '@clawket/agent-protocol';
import { useConnections } from '../../connection';
import { useAppTheme } from '../../theme';
import { FontSize, LineHeight, Space } from '../../theme/tokens';
import { AccountSettingsPageHeader } from '../AccountSettings/AccountSettingsPageHeader';
import { PlatformMark } from '../../components/ui/PlatformMark';
import { FloatingButton } from '../../components/ui/FloatingButton';
import { Button } from '../../components/ui/Button';
import { ConfirmationModal } from '../../components/ui/ConfirmationModal';
import { SettingsGroup, SettingsRow } from '../../components/ui/SettingsGroup';
import {
  SwipeableRow,
  useSwipeableRowGroup,
  type SwipeableRowAction,
} from '../../components/ui/SwipeableRow';

type Props = {
  onBack: () => void;
  onAdd: () => void;
  onOpen: (id: string) => void;
  onPause?: (id: string) => Promise<unknown> | unknown;
  onResume?: (id: string) => Promise<unknown> | unknown;
  onRemove?: (id: string) => Promise<unknown> | unknown;
};

type PendingAction = Readonly<{ kind: 'pause' | 'remove'; connection: ConnectionDescriptor }>;

export function ConnectionsScreen({ onBack, onAdd, onOpen, onPause, onResume, onRemove }: Props): React.JSX.Element {
  const { t } = useTranslation(['config', 'common']);
  const { theme: { colors } } = useAppTheme();
  const insets = useSafeAreaInsets();
  const runtime = useConnections();
  const swipeGroup = useSwipeableRowGroup();
  const [pending, setPending] = useState<PendingAction | null>(null);
  // Swipe mirrors the connection page: pause / resume plus removal, each confirmed there and here alike.
  const swipeActions = useCallback((connection: ConnectionDescriptor, paused: boolean): ReadonlyArray<SwipeableRowAction> => [
    ...(paused
      ? onResume ? [{ key: 'resume', icon: Play, label: t('Resume', { ns: 'common' }),
        accessibilityLabel: t('Resume connection'), onPress: () => { void onResume(connection.id); } }] : []
      : onPause ? [{ key: 'pause', icon: Pause, label: t('Pause', { ns: 'common' }),
        accessibilityLabel: t('Pause connection'), onPress: () => setPending({ kind: 'pause', connection }) }] : []),
    ...(onRemove ? [{ key: 'remove', icon: Trash2, label: t('Remove', { ns: 'common' }), tone: 'destructive' as const,
      accessibilityLabel: t('Remove connection'), onPress: () => setPending({ kind: 'remove', connection }) }] : []),
  ], [onPause, onRemove, onResume, t]);
  return (
    <View style={[styles.screen, { backgroundColor: colors.canvasGrouped }]}>
      <AccountSettingsPageHeader testID="connections" title={t('My connections')} onBack={onBack}
        rightContent={<FloatingButton icon={Plus} appearance="plain" onPress={onAdd} accessibilityLabel={t('Add Connection')} />} />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Space.xl }]}
        onScrollBeginDrag={swipeGroup.closeAll}>
        {runtime.connections.map((connection) => {
          const paused = runtime.pausedConnectionIds?.includes(connection.id) ?? false;
          const online = runtime.activeConnectionId === connection.id && runtime.activeState === 'ready';
          return <SettingsGroup density="comfortable" key={connection.id}>
            <SwipeableRow rowKey={connection.id} testID={`connection-swipe-${connection.id}`}
              actions={swipeActions(connection, paused)} group={swipeGroup}>
              <SettingsRow testID={`connection-list-${connection.id}`} title={connection.label}
                leading={<PlatformMark platform={connection.backendKind} size={32} />}
                subtitle={runtime.roster.find((group) => group.connection.id === connection.id)?.agents.map(({ agent }) => agent.name).join(' · ')}
                value={paused ? t('Connection paused') : t(online ? 'Online' : 'Offline', { ns: 'common' })}
                showChevron onPress={() => onOpen(connection.id)} />
            </SwipeableRow>
          </SettingsGroup>;
        })}
        {runtime.connections.length === 0 ? <View style={styles.emptyState}><Text style={[styles.empty, { color: colors.inkSecondary }]}>{t('No connections yet')}</Text><Button label={t('Add Connection')} onPress={onAdd} /></View> : null}
      </ScrollView>
      <ConfirmationModal testID="connections-confirmation" visible={pending !== null} destructive={pending?.kind === 'remove'}
        title={pending?.kind === 'pause' ? t('Pause this connection?') : t('Remove connection')}
        message={pending?.kind === 'pause'
          ? t('All agents on this connection will go offline until you resume.')
          : t('Are you sure you want to delete "{{name}}"?', { name: pending?.connection.label ?? '' })}
        cancelLabel={t('Cancel', { ns: 'common' })}
        confirmLabel={pending?.kind === 'pause' ? t('Pause connection') : t('Remove', { ns: 'common' })}
        onClose={() => setPending(null)} onConfirm={() => {
          const action = pending;
          setPending(null);
          if (!action) return;
          void (action.kind === 'pause' ? onPause?.(action.connection.id) : onRemove?.(action.connection.id));
        }} />
    </View>
  );
}
const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: Space.lg, paddingTop: Space.lg, gap: Space.lg },
  emptyState: { paddingVertical: Space.xxl, alignItems: 'center', gap: Space.lg },
  empty: { fontSize: FontSize.secondary, lineHeight: LineHeight.secondary, textAlign: 'center' },
});
