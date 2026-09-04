import { UiMessage } from '../types/chat';
import { SessionRunState } from './sessionRunState';

const RUN_HISTORY_GRACE_MS = 1000;

export function hasCompletedAssistantForRememberedRun(
  messages: UiMessage[],
  remembered: SessionRunState | null | undefined,
): boolean {
  if (!remembered) return false;

  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.role !== 'assistant') continue;
    if (!message.text.trim()) continue;

    const timestamp = message.timestampMs ?? 0;
    if (timestamp <= 0) return false;
    // Treat an assistant message as belonging to the remembered run as long as
    // it is not older than the run start by more than the grace window. This
    // tolerates small timestamp skew and slight event/history ordering drift
    // around run start without requiring the assistant timestamp to be strictly
    // greater than startedAt.
    return timestamp + RUN_HISTORY_GRACE_MS >= remembered.startedAt;
  }

  return false;
}
