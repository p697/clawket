import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Cable, Plus } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useConnections } from '../../connection';
import { useAppTheme } from '../../theme';
import { FontSize, LineHeight, Space } from '../../theme/tokens';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
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
      <ScreenHeader title={t('My connections')} topInset={insets.top} onBack={onBack} showBorder={false}
        style={{ backgroundColor: colors.canvasGrouped }}
        rightContent={<FloatingButton icon={Plus} appearance="plain" onPress={onAdd} accessibilityLabel={t('Add Connection')} />} />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Space.xl }]}>
        {runtime.connections.map((connection) => {
          const paused = runtime.pausedConnectionIds?.includes(connection.id);
          const online = runtime.activeConnectionId === connection.id && runtime.activeState === 'ready';
          return <SettingsGroup key={connection.id}>
            <SettingsRow testID={`connection-list-${connection.id}`} title={connection.label}
              leading={<Cable size={20} color={colors.inkSecondary} />}
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
  content: { padding: Space.lg, gap: Space.md },
  emptyState: { paddingVertical: Space.xxl, alignItems: 'center', gap: Space.lg },
  empty: { fontSize: FontSize.secondary, lineHeight: LineHeight.secondary, textAlign: 'center' },
});
