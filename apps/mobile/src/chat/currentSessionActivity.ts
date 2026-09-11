import { UiMessage } from '../types/chat';
import { SessionRunState } from './sessionRunState';

export type DerivedCurrentSessionActivity = {
  isSending: boolean;
  hasTrackedRun: boolean;
  hasRunningTool: boolean;
  latestRunningToolName: string | null;
  latestRunningToolTimestampMs: number | null;
};

export function deriveCurrentSessionActivity(
  messages: UiMessage[],
  runState: SessionRunState | null | undefined,
): DerivedCurrentSessionActivity {
  let latestRunningToolName: string | null = null;
  let latestRunningToolTimestampMs: number | null = null;
  let sawLaterAssistantMessage = false;
  let latestAssistantAfterTool = false;

  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.role === 'assistant' && message.text.trim().length > 0) {
      sawLaterAssistantMessage = true;
      continue;
    }
    if (latestRunningToolName === null && message.role === 'tool' && message.toolStatus === 'running') {
      latestRunningToolName = message.toolName ?? null;
      latestRunningToolTimestampMs = message.timestampMs ?? null;
      latestAssistantAfterTool = sawLaterAssistantMessage;
      break;
    }
  }

  const hasTrackedRun = !!runState?.runId;
  const hasRunningTool = latestRunningToolName !== null && !latestAssistantAfterTool;

  return {
    isSending: hasTrackedRun || hasRunningTool,
    hasTrackedRun,
    hasRunningTool,
    latestRunningToolName,
    latestRunningToolTimestampMs,
  };
}
