import React, { useEffect, useState } from 'react';
import { Text } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Brain, CalendarClock, CircleAlert, FilePenLine, FileSearch, Globe, Layers, MessageSquare, Search, Terminal, Wrench, type LucideIcon } from 'lucide-react-native';
import type { UiMessage } from '../../types/chat';
import { formatToolDisplayName, resolveToolTitle, toolCategory } from '../../utils/tool-display';
import { ServicePill, servicePillCodeStyle } from './ServicePill';
import {
  describeFailedStep,
  effectiveTool,
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

/** Milliseconds since a running step started, refreshed once a second while it runs. */
export function useElapsed(startMs: number | undefined): number | undefined {
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
 * A finished turn that said nothing after its last step keeps one centred
 * pill (A+ chat design 2026-09-30; tool process design C 2026-10-02): the
 * turn's summary ("Ran 6 commands, read a file · 38 s"), or — only when that
 * last step failed and the turn ended there — a red pill naming it. A
 * failure the Agent moved past never turns it red. It opens the turn's
 * work record. Running steps live in the work dock, not here.
 */
export function ToolActivityPill({ messages, failed = false, onPress, testID }: Readonly<{
  /** The turn's calls, newest first. */
  messages: ReadonlyArray<UiMessage>;
  /** The turn ended on its failed newest step. */
  failed?: boolean;
  onPress: () => void;
  testID: string;
}>): React.JSX.Element {
  const { t } = useTranslation('chat');
  const last = messages[0];
  if (failed && last) {
    const tool = effectiveTool(last);
    const failure = describeFailedStep(last, resolveToolTitle(tool.args) ?? formatToolDisplayName(tool.name || t('Tool'), t), t);
    return (
      <ServicePill
        testID={testID}
        tone="bad"
        icon={CircleAlert}
        onPress={onPress}
        accessibilityLabel={`${failure.before}${failure.value}${failure.after}`}
      >
        <InlineParts parts={failure} code={failure.code} />
      </ServicePill>
    );
  }
  const summary = formatToolActivitySummary(summarizeToolActivity(messages), t);
  return <ServicePill testID={testID} icon={Layers} label={summary} onPress={onPress} />;
}
