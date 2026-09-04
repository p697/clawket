import { UiMessage } from '../types/chat';
import { sessionKeysMatch } from '../utils/session-key';

export function shouldRestoreCacheBeforeHistoryRefresh(params: {
  targetKey: string;
  currentKey: string | null;
  historyLoaded: boolean;
  currentMessages: UiMessage[];
}): boolean {
  const { targetKey, currentKey, historyLoaded, currentMessages } = params;
  if (!sessionKeysMatch(currentKey, targetKey)) return true;
  if (!historyLoaded) return true;
  return currentMessages.length === 0;
}
