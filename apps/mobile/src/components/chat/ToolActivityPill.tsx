import React, { useEffect, useState } from 'react';
import { Text } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Brain, CalendarClock, CircleAlert, FilePenLine, FileSearch, Globe, Layers, MessageSquare, Search, Terminal, Wrench, type LucideIcon } from 'lucide-react-native';
import type { UiMessage } from '../../types/chat';
import { formatToolActivity, formatToolDisplayName, toolCategory } from '../../utils/tool-display';
import { ServicePill, servicePillCodeStyle } from './ServicePill';
import {
  describeFailedStep,
  describeLiveStep,
  formatActivityDuration,
  formatToolActivitySummary,
  summarizeToolActivity,
  type TemplateParts,
} from './tool-activity-model';

const ELAPSED_TICK_MS = 1000;

/** One glyph per kind of tool, shared by the work record rows. */
export function toolIcon(name: string): LucideIcon {
  switch (toolCategory(name)) {
    case 'command': return Terminal;
    case 'read': return FileSearch;
    case 'edit': return FilePenLine;
    case 'search': return Search;
    case 'memory': return Brain;
    case 'web': return Globe;
    case 'schedule': return CalendarClock;
    case 'message': return MessageSquare;
    default: return Wrench;
  }
}

/** Seconds since a running step started, refreshed once a second while it runs. */
function useElapsed(startMs: number | undefined): number | undefined {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (startMs === undefined) return undefined;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), ELAPSED_TICK_MS);
    return () => clearInterval(timer);
  }, [startMs]);
  return startMs === undefined ? undefined : Math.max(0, now - startMs);
}

function InlineParts({ parts, code }: { parts: TemplateParts; code: boolean }): React.JSX.Element {
  return <>
    {parts.before}
    {parts.value ? <Text style={code ? servicePillCodeStyle : undefined}>{parts.value}</Text> : null}
    {parts.after}
  </>;
}

/**
 * Tool activity as one of three centred pills (A+ chat design, owner
 * decision 2026-09-30): a running step names itself with a spinner and its
 * elapsed time, a finished run of calls reads as one summary ("Ran 6
 * commands, read a file · 38 s"), and a failed call is a red pill of its
 * own. Every pill opens the turn's work record.
 */
export function ToolActivityPill({ messages, onPress, testID }: Readonly<{
  /** The calls this pill stands for, newest first. */
  messages: ReadonlyArray<UiMessage>;
  onPress: () => void;
  testID: string;
}>): React.JSX.Element {
  const { t } = useTranslation('chat');
  const running = messages.find((message) => message.toolStatus === 'running');
  const elapsed = useElapsed(running ? running.toolStartedAt ?? running.timestampMs : undefined);
  if (running) {
    const name = running.toolName?.trim() || t('Tool');
    const live = describeLiveStep(running, t);
    const label = live ? `${live.before}${live.value}${live.after}` : formatToolActivity(name, t);
    const time = elapsed !== undefined && elapsed >= ELAPSED_TICK_MS ? formatActivityDuration(elapsed, t) : undefined;
    return (
      <ServicePill
        testID={testID}
        busy
        trailing={time}
        onPress={onPress}
        accessibilityLabel={[label, time].filter(Boolean).join(', ')}
      >
        {live ? <InlineParts parts={live} code /> : label}
      </ServicePill>
    );
  }
  const only = messages.length === 1 ? messages[0]! : null;
  if (only?.toolStatus === 'error') {
    const failed = describeFailedStep(only, formatToolDisplayName(only.toolName?.trim() || t('Tool'), t), t);
    return (
      <ServicePill
        testID={testID}
        tone="bad"
        icon={CircleAlert}
        onPress={onPress}
        accessibilityLabel={`${failed.before}${failed.value}${failed.after}`}
      >
        <InlineParts parts={failed} code={failed.code} />
      </ServicePill>
    );
  }
  const summary = formatToolActivitySummary(summarizeToolActivity(messages), t);
  return <ServicePill testID={testID} icon={Layers} label={summary} onPress={onPress} />;
}
