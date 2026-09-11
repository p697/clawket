import React, { useCallback, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { captureRef } from 'react-native-view-shot';
import * as MediaLibrary from 'expo-media-library';
import * as Sharing from 'expo-sharing';
import type { AgentDescriptor } from '@clawket/agent-protocol';
import { AgentAvatar } from '../../components/ui/AgentAvatar';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { Sheet } from '../../components/ui/Sheet';
import { useAppTheme } from '../../theme';
import {
  FontSize,
  FontWeight,
  LineHeight,
  Radius,
  Space,
} from '../../theme/tokens';

export type UsagePosterData = Readonly<{
  cost: string;
  tokens: string;
  messages: string;
  toolCalls: string;
}>;

export type UsagePosterSheetProps = Readonly<{
  visible: boolean;
  agent: AgentDescriptor;
  data: UsagePosterData;
  onClose: () => void;
}>;

export function UsagePosterSheet({
  visible,
  agent,
  data,
  onClose,
}: UsagePosterSheetProps): React.JSX.Element {
  const { t, i18n } = useTranslation(['common', 'settings']);
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);
  const posterRef = useRef<View>(null);
  const [busy, setBusy] = useState<'save' | 'share' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en';
  const date = useMemo(
    () => new Date().toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' }),
    [locale],
  );

  const capture = useCallback(async () => {
    if (!posterRef.current) throw new Error(t('Poster unavailable', { ns: 'settings' }));
    return captureRef(posterRef, { format: 'png', quality: 1 });
  }, [t]);

  const save = useCallback(async () => {
    if (busy) return;
    setBusy('save');
    setMessage(null);
    try {
      const permission = await MediaLibrary.requestPermissionsAsync();
      if (permission.status !== 'granted') {
        setMessage(t('Permission denied', { ns: 'settings' }));
        return;
      }
      const uri = await capture();
      await MediaLibrary.saveToLibraryAsync(uri.startsWith('file://') ? uri : `file://${uri}`);
      setMessage(t('Saved to Photos!', { ns: 'settings' }));
    } catch (saveError: unknown) {
      setMessage(errorMessage(saveError, t('Failed to save', { ns: 'settings' })));
    } finally {
      setBusy(null);
    }
  }, [busy, capture, t]);

  const share = useCallback(async () => {
    if (busy) return;
    setBusy('share');
    setMessage(null);
    try {
      const uri = await capture();
      await Sharing.shareAsync(uri, { mimeType: 'image/png' });
    } catch (shareError: unknown) {
      setMessage(errorMessage(shareError, t('Share failed', { ns: 'settings' })));
    } finally {
      setBusy(null);
    }
  }, [busy, capture, t]);

  return (
    <Sheet
      testID="agent-usage-poster"
      visible={visible}
      title={t('Stats Poster', { ns: 'settings' })}
      closeAccessibilityLabel={t('Close', { ns: 'common' })}
      dismissOnBackdropPress={!busy}
      onClose={onClose}
    >
      <View style={styles.content}>
        {message ? <Banner testID="agent-usage-poster-message" message={message} /> : null}
        <View ref={posterRef} collapsable={false} style={styles.poster}>
          <View style={styles.identity}>
            <AgentAvatar
              agentId={agent.agentId}
              name={agent.name}
              emoji={agent.emoji}
              avatarUrl={agent.avatarUrl}
              variant="settings"
            />
            <View style={styles.identityCopy}>
              <Text style={styles.agentName}>{agent.name}</Text>
              <Text style={styles.secondaryText}>{date}</Text>
            </View>
          </View>
          <Text testID="agent-usage-poster-cost" style={styles.hero}>{data.cost}</Text>
          <Text style={styles.secondaryText}>{t('Total cost', { ns: 'settings' })}</Text>
          <View style={styles.grid}>
            <PosterMetric label={t('Tokens', { ns: 'common' })} value={data.tokens} />
            <PosterMetric label={t('Messages', { ns: 'common' })} value={data.messages} />
            <PosterMetric label={t('Tool calls', { ns: 'common' })} value={data.toolCalls} />
          </View>
          <Text style={styles.brand}>Clawket</Text>
        </View>
        <View style={styles.actions}>
          <Button
            testID="agent-usage-poster-save"
            label={t('Save', { ns: 'common' })}
            variant="secondary"
            loading={busy === 'save'}
            disabled={Boolean(busy)}
            onPress={() => { void save(); }}
            style={styles.actionButton}
          />
          <Button
            testID="agent-usage-poster-share"
            label={t('Share', { ns: 'settings' })}
            loading={busy === 'share'}
            disabled={Boolean(busy)}
            onPress={() => { void share(); }}
            style={styles.actionButton}
          />
        </View>
      </View>
    </Sheet>
  );
}

function PosterMetric({ label, value }: Readonly<{ label: string; value: string }>): React.JSX.Element {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);
  return (
    <View style={styles.metric}>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.secondaryText}>{label}</Text>
    </View>
  );
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  return fallback;
}

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    content: {
      paddingHorizontal: Space.xl,
      paddingBottom: Space.xxl,
      gap: Space.xl,
    },
    poster: {
      padding: Space.xl,
      gap: Space.lg,
      borderRadius: Radius.card,
      backgroundColor: colors.canvas,
      alignItems: 'center',
    },
    identity: {
      width: '100%',
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.md,
    },
    identityCopy: { flex: 1 },
    agentName: {
      color: colors.ink,
      fontSize: FontSize.body,
      lineHeight: LineHeight.body,
      fontWeight: FontWeight.semibold,
    },
    hero: {
      color: colors.accent,
      fontSize: FontSize.display,
      lineHeight: LineHeight.display,
      fontWeight: FontWeight.semibold,
      fontVariant: ['tabular-nums'],
    },
    secondaryText: {
      color: colors.inkSecondary,
      fontSize: FontSize.secondary,
      lineHeight: LineHeight.secondary,
      fontWeight: FontWeight.regular,
    },
    grid: {
      width: '100%',
      flexDirection: 'row',
      gap: Space.sm,
    },
    metric: {
      flex: 1,
      padding: Space.md,
      gap: Space.xs,
      borderRadius: Radius.card,
      backgroundColor: colors.surface,
      alignItems: 'center',
    },
    metricValue: {
      color: colors.ink,
      fontSize: FontSize.body,
      lineHeight: LineHeight.body,
      fontWeight: FontWeight.semibold,
      fontVariant: ['tabular-nums'],
    },
    brand: {
      color: colors.ink,
      fontSize: FontSize.body,
      lineHeight: LineHeight.body,
      fontWeight: FontWeight.semibold,
    },
    actions: { flexDirection: 'row', gap: Space.md },
    actionButton: { flex: 1 },
  });
}
