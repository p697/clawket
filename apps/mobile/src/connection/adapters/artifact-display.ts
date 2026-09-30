import type { SessionHistory, SessionUpdate } from '@clawket/agent-protocol';

export function artifactHistoryDisplay(history: SessionHistory): SessionHistory {
  return { ...history, messages: history.messages.map(message => message.role === 'assistant'
    && message.attachments?.some(a => a.artifactId) && typeof message.artifactDisplayText === 'string'
    ? { ...message, text: message.artifactDisplayText } : message) };
}

export function artifactUpdateDisplay(update: SessionUpdate): SessionUpdate {
  return update?.type === 'run_finished' && update.message?.attachments?.some(a => a.artifactId)
    && typeof update.message.artifactDisplayText === 'string'
    ? { ...update, message: { ...update.message, content: update.message.artifactDisplayText } } : update;
}
