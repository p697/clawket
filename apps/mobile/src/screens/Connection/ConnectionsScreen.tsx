import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Plus } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useConnections } from '../../connection';
import { useAppTheme } from '../../theme';
import { FontSize, LineHeight, Space } from '../../theme/tokens';
import { AccountSettingsPageHeader } from '../AccountSettings/AccountSettingsPageHeader';
import { PlatformMark } from '../../components/ui/PlatformMark';
import { FloatingButton } from '../../components/ui/FloatingButton';
import { Button } from '../../components/ui/Button';
import { SettingsGroup, SettingsRow } from '../../components/ui/SettingsGroup';

type Props = { onBack: () => void; onAdd: () => void; onOpen: (id: string) => void };

export function ConnectionsScreen({ onBack, onAdd, onOpen }: Props): React.JSX.Element {
  const { t } = useTranslation(['config', 'common']);
  const { theme: { colors } } = useAppTheme();
  const insets = useSafeAreaInsets();
  const runtime = useConnections();
  return (
    <View style={[styles.screen, { backgroundColor: colors.canvasGrouped }]}>
      <AccountSettingsPageHeader testID="connections" title={t('My connections')} onBack={onBack}
        rightContent={<FloatingButton icon={Plus} appearance="plain" onPress={onAdd} accessibilityLabel={t('Add Connection')} />} />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Space.xl }]}>
        {runtime.connections.map((connection) => {
          const paused = runtime.pausedConnectionIds?.includes(connection.id);
          const online = runtime.activeConnectionId === connection.id && runtime.activeState === 'ready';
          return <SettingsGroup density="comfortable" key={connection.id}>
            <SettingsRow testID={`connection-list-${connection.id}`} title={connection.label}
              leading={<PlatformMark platform={connection.backendKind} size={32} />}
              subtitle={runtime.roster.find((group) => group.connection.id === connection.id)?.agents.map(({ agent }) => agent.name).join(' · ')}
              value={paused ? t('Connection paused') : t(online ? 'Online' : 'Offline', { ns: 'common' })}
              showChevron onPress={() => onOpen(connection.id)} />
          </SettingsGroup>;
        })}
        {runtime.connections.length === 0 ? <View style={styles.emptyState}><Text style={[styles.empty, { color: colors.inkSecondary }]}>{t('No connections yet')}</Text><Button label={t('Add Connection')} onPress={onAdd} /></View> : null}
      </ScrollView>
    </View>
  );
}
const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: Space.lg, paddingTop: Space.sm, gap: Space.lg },
  emptyState: { paddingVertical: Space.xxl, alignItems: 'center', gap: Space.lg },
  empty: { fontSize: FontSize.secondary, lineHeight: LineHeight.secondary, textAlign: 'center' },
});
