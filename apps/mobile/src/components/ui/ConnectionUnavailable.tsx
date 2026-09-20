import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Laptop } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '../../theme';
import { ControlSize, FontSize, FontWeight, LineHeight, Space } from '../../theme/tokens';
import { Button } from './Button';

export type ConnectionUnavailableProps = Readonly<{
  name: string;
  lastReadyAt?: number | null;
  message?: string;
  actionLabel?: string;
  onRetry?: () => void;
  onManage?: () => void;
  onViewSaved?: () => void;
  compact?: boolean;
  testID?: string;
}>;

/** An unavailable connection is not proof that the computer is powered off. */
export function ConnectionUnavailable({
  name, lastReadyAt, message, actionLabel, onRetry, onManage, onViewSaved,
  compact = false, testID = 'connection-unavailable',
}: ConnectionUnavailableProps): React.JSX.Element {
  const { t, i18n } = useTranslation('common');
  const { theme } = useAppTheme();
  const lastSeen = lastReadyAt && Number.isFinite(lastReadyAt) && lastReadyAt > 0
    ? new Date(lastReadyAt).toLocaleString(i18n?.language) : null;
  const content = <View style={styles.content}>
    <Laptop size={ControlSize.settingsRow} color={theme.colors.inkSecondary} strokeWidth={1.5} />
    <Text style={[styles.name, { color: theme.colors.ink }]}>{name}</Text>
    <Text accessibilityRole="header" style={[styles.body, { color: theme.colors.inkSecondary }]}>
      {message ?? t('Connection unavailable')}
    </Text>
    {lastSeen ? <Text style={[styles.body, { color: theme.colors.inkSecondary }]}>
      {t('Last connected: {{time}}', { time: lastSeen })}
    </Text> : null}
    {!message ? <Text style={[styles.body, { color: theme.colors.inkSecondary }]}>
      {t('Check your network and make sure the remote service is running.')}
    </Text> : null}
    <View style={styles.actions}>
      {onRetry ? <Button testID={`${testID}-retry`} label={actionLabel ?? t('Reconnect')} onPress={onRetry} multiline /> : null}
      {onManage ? <Button testID={`${testID}-manage`} label={t('Manage connection', { ns: 'config' })} variant="ghost" onPress={onManage} multiline /> : null}
      {onViewSaved ? <Button testID={`${testID}-saved`} label={t('View saved messages')} variant="text" onPress={onViewSaved} multiline /> : null}
    </View>
  </View>;
  return compact ? <View testID={testID}>{content}</View> : (
    <ScrollView testID={testID} contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>{content}</ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 1, justifyContent: 'center' },
  content: { alignItems: 'center', padding: Space.xl, gap: Space.md },
  name: { fontSize: FontSize.title, lineHeight: LineHeight.title, fontWeight: FontWeight.semibold, textAlign: 'center' },
  body: { fontSize: FontSize.secondary, lineHeight: LineHeight.secondary, fontWeight: FontWeight.regular, textAlign: 'center' },
  actions: { alignSelf: 'center', gap: Space.xs, marginTop: Space.sm },
});
