import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { useTranslation } from 'react-i18next';
import type { CronRunContent, CronRunLogEntry } from '@clawket/agent-protocol';
import { Button } from '../../components/ui/Button';
import { SettingsDivider, SettingsGroup, SettingsRow } from '../../components/ui/SettingsGroup';
import { Sheet } from '../../components/ui/Sheet';
import { Skeleton } from '../../components/ui/Skeleton';
import { useAppTheme } from '../../theme';
import { ControlSize, FontSize, FontWeight, LineHeight, Space } from '../../theme/tokens';
import { formatChannelName } from '../../utils/chat-message';
import { formatDurationMs } from '../../utils/cron';
import { cronRunStatus } from './cron-model';

// The record can outgrow the screen: fixed detents plus the Gorhom-integrated
// scroll view (a plain ScrollView in a dynamic-height sheet hands its drags to
// the sheet, which snaps back instead of scrolling).
const RUN_SHEET_SNAP_POINTS: string[] = ['68%', '92%'];

export type CronRunSheetProps = Readonly<{
  run: CronRunLogEntry | null;
  /** Backend read of the run's delivered messages / stored output; omitted when the backend has none. */
  loadContent?: (entry: CronRunLogEntry) => Promise<CronRunContent>;
  /** Opens the session that still holds the run's transcript; runs after the sheet has dismissed. */
  onOpenSession?: (sessionKey: string) => void;
  onClose: () => void;
}>;

type ContentState = Readonly<{ key: string; status: 'loading' | 'ready' | 'failed'; value?: CronRunContent }>;

/**
 * The one execution-record surface (owner decision 2026-09-19): the chat-stream
 * Cron card, the Runs tab and the editor's runs card all open it. What the run
 * delivered leads — the messages it sent through a channel tool or the output the
 * backend stored — then the summary, the metadata rows and, when the transcript
 * still belongs to this run, a way into the full conversation.
 */
export function CronRunSheet({ run, loadContent, onOpenSession, onClose }: CronRunSheetProps): React.JSX.Element {
  const { t } = useTranslation(['common', 'settings']);
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);
  const [content, setContent] = useState<ContentState | null>(null);
  const pendingSession = useRef<string | null>(null);
  const loadContentRef = useRef(loadContent);
  loadContentRef.current = loadContent;
  const runKey = run ? cronRunKey(run) : null;
  const wantsContent = Boolean(run && loadContent && (run.sessionKey || run.outputRef));
  useEffect(() => {
    const load = loadContentRef.current;
    if (!run || !runKey || !load || !wantsContent) return;
    let active = true;
    setContent({ key: runKey, status: 'loading' });
    load(run).then((value) => {
      if (active) setContent({ key: runKey, status: 'ready', value });
    }).catch(() => {
      if (active) setContent({ key: runKey, status: 'failed' });
    });
    return () => { active = false; };
  }, [run, runKey, wantsContent]);
  const current = content && content.key === runKey ? content : null;
  const loaded = current?.status === 'ready' ? current.value : undefined;
  const deliveries = loaded?.deliveries ?? [];
  const sentTargets = run?.delivery?.messageToolSentTo ?? [];
  const announced = Boolean(run && !deliveries.length && (run.deliveryStatus === 'delivered' || run.delivered === true) && run.summary?.trim());
  const sessionKey = loaded?.sessionKey;
  const openSession = sessionKey && onOpenSession ? () => {
    pendingSession.current = sessionKey;
    onClose();
  } : undefined;

  return (
    <Sheet
      testID="agent-cron-run-detail"
      visible={run !== null}
      title={t('Execution Record', { ns: 'settings' })}
      snapPoints={RUN_SHEET_SNAP_POINTS}
      closeAccessibilityLabel={t('Back', { ns: 'common' })}
      onClose={onClose}
      onAfterClose={() => {
        const target = pendingSession.current;
        pendingSession.current = null;
        if (target) onOpenSession?.(target);
      }}
    >
      {run ? (
        <BottomSheetScrollView testID="agent-cron-run-detail-scroll" contentContainerStyle={styles.content}>
          <SettingsGroup testID="agent-cron-run-detail-group" style={styles.group}>
            <SettingsRow
              style={styles.row}
              title={run.jobName ?? run.jobId}
              subtitle={formatTimestamp(run.runAtMs ?? run.ts)}
              value={translateCronRunStatus(cronRunStatus(run), t)}
            />
          </SettingsGroup>

          {wantsContent && current?.status === 'loading' ? (
            <View testID="agent-cron-run-content-loading" style={styles.section}>
              <Text style={styles.label}>{t('Delivered content', { ns: 'settings' })}</Text>
              <Skeleton style={styles.skeletonLine} />
              <Skeleton style={styles.skeletonLineShort} />
            </View>
          ) : deliveries.length ? (
            <View testID="agent-cron-run-deliveries" style={styles.section}>
              <Text style={styles.label}>{t('Delivered content', { ns: 'settings' })}</Text>
              {deliveries.map((delivery, index) => (
                <View key={`${index}:${delivery.channel ?? ''}:${delivery.target ?? ''}`} style={styles.delivery}>
                  {describeTarget(delivery) ? <Text style={styles.caption}>{describeTarget(delivery)}</Text> : null}
                  <Text selectable testID={`agent-cron-run-delivery-${index}`} style={styles.body}>{delivery.text}</Text>
                </View>
              ))}
            </View>
          ) : loaded?.output ? (
            <View testID="agent-cron-run-output" style={styles.section}>
              <Text style={styles.label}>{t('Run output', { ns: 'settings' })}</Text>
              <Text selectable style={styles.body}>{loaded.output}</Text>
            </View>
          ) : announced ? (
            <View testID="agent-cron-run-announced" style={styles.section}>
              <Text style={styles.label}>{t('Delivered content', { ns: 'settings' })}</Text>
              {describeTarget(run.delivery?.resolved ?? run.delivery?.intended ?? {}) ? (
                <Text style={styles.caption}>{describeTarget(run.delivery?.resolved ?? run.delivery?.intended ?? {})}</Text>
              ) : null}
              <Text selectable style={styles.body}>{run.summary}</Text>
            </View>
          ) : sentTargets.length && current && current.status !== 'loading' ? (
            <View testID="agent-cron-run-content-unavailable" style={styles.section}>
              <Text style={styles.label}>{t('Delivered content', { ns: 'settings' })}</Text>
              <Text style={styles.caption}>{sentTargets.map((target) => describeTarget(target)).filter(Boolean).join(' · ')}</Text>
              <Text style={styles.muted}>{t('The conversation for this run is no longer available.', { ns: 'settings' })}</Text>
            </View>
          ) : null}

          {!announced && (run.error || run.summary) ? (
            <View testID="agent-cron-run-summary" style={styles.section}>
              <Text style={styles.label}>{t('Summary', { ns: 'settings' })}</Text>
              <Text selectable style={[styles.body, run.error ? { color: theme.colors.bad } : null]}>{run.error ?? run.summary}</Text>
            </View>
          ) : null}
          {run.deliveryError ? <Text selectable style={[styles.body, { color: theme.colors.bad }]}>{run.deliveryError}</Text> : null}

          <SettingsGroup testID="agent-cron-run-detail-meta" style={styles.group}>
            <SettingsRow style={styles.row} title={t('Duration', { ns: 'settings' })} value={formatDurationMs(run.durationMs)} />
            {run.model ? (
              <>
                <SettingsDivider inset="none" />
                <SettingsRow style={styles.row} title={t('Model', { ns: 'settings' })} value={run.model} />
              </>
            ) : null}
            <SettingsDivider inset="none" />
            <SettingsRow style={styles.row} title={t('Notifications', { ns: 'settings' })} value={describeDelivery(run, t)} />
          </SettingsGroup>

          {openSession ? (
            <Button testID="agent-cron-run-open-session" label={t('View full conversation', { ns: 'settings' })}
              variant="ghost" onPress={openSession} />
          ) : null}
        </BottomSheetScrollView>
      ) : null}
    </Sheet>
  );
}

function cronRunKey(run: CronRunLogEntry): string {
  return `${run.jobId}:${run.runId ?? run.sessionId ?? run.runAtMs ?? run.ts}`;
}

function describeTarget(target: Readonly<{ channel?: string; target?: string; to?: string | null }>): string {
  const channel = target.channel?.trim();
  const rawTarget = (target.target ?? target.to ?? '')?.trim() ?? '';
  const recipient = channel && rawTarget.toLowerCase().startsWith(`${channel.toLowerCase()}:`)
    ? rawTarget.slice(channel.length + 1)
    : rawTarget;
  return [channel ? formatChannelName(channel) : '', recipient].filter(Boolean).join(' · ');
}

function describeDelivery(run: CronRunLogEntry, t: ReturnType<typeof useTranslation>['t']): string {
  if (run.deliveryStatus === 'delivered' || run.delivered === true) return t('Delivered', { ns: 'settings' });
  if (run.delivery?.messageToolSentTo?.length) return t('Sent by the Agent', { ns: 'settings' });
  // Delivery mode `none` reports `delivered: false` alongside `not-requested`; the
  // explicit status wins so a job that never asked for delivery is not "not delivered".
  if (run.deliveryStatus === 'not-requested') return t('Not requested', { ns: 'settings' });
  if (run.deliveryStatus === 'not-delivered' || run.delivered === false) return t('Not delivered', { ns: 'settings' });
  return t('Unknown', { ns: 'common' });
}

function translateCronRunStatus(status: ReturnType<typeof cronRunStatus>, t: ReturnType<typeof useTranslation>['t']): string {
  if (status === 'Succeeded') return t('Succeeded', { ns: 'settings' });
  if (status === 'Failed') return t('Failed', { ns: 'settings' });
  if (status === 'Skipped') return t('Skipped', { ns: 'settings' });
  return t('Unknown', { ns: 'common' });
}

function formatTimestamp(value?: number): string {
  if (!value || !Number.isFinite(value)) return '—';
  return new Date(value).toLocaleString();
}


function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    // The skill-detail recipe: one 24-point content edge, borderless groups with
    // zero row insets and full-width hairlines so rows align with the text.
    content: { paddingHorizontal: Space.xl, paddingBottom: Space.xxl, gap: Space.xl },
    group: { backgroundColor: colors.canvas },
    row: { paddingHorizontal: 0, minHeight: ControlSize.settingsRowComfortable },
    section: { gap: Space.sm },
    delivery: { gap: Space.xs },
    label: { color: colors.inkSecondary, fontSize: FontSize.secondary, lineHeight: LineHeight.secondary, fontWeight: FontWeight.regular },
    caption: { color: colors.inkSecondary, fontSize: FontSize.caption, lineHeight: LineHeight.caption, fontWeight: FontWeight.regular },
    body: { color: colors.ink, fontSize: FontSize.body, lineHeight: LineHeight.body, fontWeight: FontWeight.regular },
    muted: { color: colors.inkSecondary, fontSize: FontSize.body, lineHeight: LineHeight.body, fontWeight: FontWeight.regular },
    skeletonLine: { height: LineHeight.body, width: '100%' },
    skeletonLineShort: { height: LineHeight.body, width: '60%' },
  });
}
