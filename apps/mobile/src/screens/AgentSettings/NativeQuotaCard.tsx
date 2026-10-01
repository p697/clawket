import React, { useCallback, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { AgentProfileOperations } from '@clawket/agent-protocol';
import { SettingsGroup, SettingsRow } from '../../components/ui/SettingsGroup';
import { Skeleton } from '../../components/ui/Skeleton';
import { useAppTheme } from '../../theme';
import { FontSize, FontWeight, LineHeight, Space } from '../../theme/tokens';
import { quotaRemaining } from './native-profile-model';
import { useProfileRead } from './useProfileRead';

export function NativeQuotaCard({ profile, online, refreshing, onPress }: { profile: AgentProfileOperations; online: boolean; refreshing: boolean; onPress: () => void }) {
  const { t } = useTranslation('settings'); const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);
  const load = useCallback(() => profile.usage(), [profile]);
  const read = useProfileRead(load, online, Number(refreshing));
  const remaining = quotaRemaining(read.value);
  return <SettingsGroup testID="native-quota-card"><SettingsRow onPress={onPress} showChevron accessibilityLabel={t('profile.quota')}>
    <View style={styles.quotaCopy}>
      <Text style={styles.label}>{t('profile.quota')}</Text>
      {read.pending && !read.value ? <Skeleton style={styles.numberSkeleton} /> : <Text testID="native-quota-remaining" style={styles.number}>{remaining === null ? '—' : `${Math.floor(remaining)}%`}</Text>}
      <Text style={styles.caption}>{!online ? t('profile.offline') : read.failed ? t('profile.loadError') : remaining === null ? t('profile.quotaUnavailable') : t('profile.tightestWindow')}</Text>
    </View>
  </SettingsRow></SettingsGroup>;
}

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    quotaCopy: { flex: 1, paddingVertical: Space.sm, gap: Space.sm },
    label: { color: colors.inkSecondary, fontSize: FontSize.secondary, lineHeight: LineHeight.secondary },
    caption: { color: colors.inkSecondary, fontSize: FontSize.secondary, lineHeight: LineHeight.secondary },
    number: { color: colors.ink, fontSize: FontSize.display, lineHeight: LineHeight.display, fontWeight: FontWeight.semibold, fontVariant: ['tabular-nums'] },
    numberSkeleton: { height: LineHeight.display, width: '40%' },
  });
}
