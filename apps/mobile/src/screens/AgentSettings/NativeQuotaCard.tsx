import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AppState, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useIsFocused } from '@react-navigation/native';
import type { AgentProfileOperations } from '@clawket/agent-protocol';
import { SettingsGroup, SettingsRow } from '../../components/ui/SettingsGroup';
import { Skeleton } from '../../components/ui/Skeleton';
import { useAppTheme } from '../../theme';
import { FontSize, FontWeight, LineHeight, Space } from '../../theme/tokens';
import { quotaResetCountdown, quotaSummary } from './native-profile-model';
import { useProfileRead } from './useProfileRead';

export function NativeQuotaCard({ profile, online, refreshing, onPress }: { profile: AgentProfileOperations; online: boolean; refreshing: boolean; onPress: () => void }) {
  const { t } = useTranslation('settings'); const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);
  const load = useCallback(() => profile.usage(), [profile]);
  const read = useProfileRead(load, online, Number(refreshing));
  const summary = quotaSummary(read.value);
  const remaining = summary?.remaining ?? null;
  const resetsAt = summary?.resetsAt;
  const focused = useIsFocused();
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!online || !focused || resetsAt == null) return;
    let timer: ReturnType<typeof setInterval> | undefined;
    const update = (state = AppState.currentState) => {
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
      if (state === 'active') {
        setNow(Date.now());
        timer = setInterval(() => setNow(Date.now()), 60000);
      }
    };
    update();
    const subscription = AppState.addEventListener('change', update);
    return () => { if (timer !== undefined) clearInterval(timer); subscription.remove(); };
  }, [online, focused, resetsAt]);
  const countdown = quotaResetCountdown(resetsAt, now);
  const resetCaption = countdown === null ? t('profile.resetUnknown')
    : countdown.pending ? t('Reset pending')
      : countdown.days > 0 ? t('Resets in {{days}}d {{hours}}h', countdown)
        : countdown.hours > 0 ? t('Resets in {{hours}}h {{minutes}}m', countdown)
          : t('Resets in {{minutes}}m', countdown);
  return <SettingsGroup testID="native-quota-card"><SettingsRow onPress={onPress} showChevron accessibilityLabel={t('profile.quota')}>
    <View style={styles.quotaCopy}>
      <Text style={styles.label}>{t('profile.quota')}</Text>
      {read.pending && !read.value ? <Skeleton style={styles.numberSkeleton} /> : <Text testID="native-quota-remaining" style={styles.number}>{remaining === null ? '—' : `${Math.floor(remaining)}%`}</Text>}
      <Text style={styles.caption}>{!online ? t('profile.offline') : read.failed ? t('profile.loadError') : remaining === null ? t('profile.quotaUnavailable') : resetCaption}</Text>
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
