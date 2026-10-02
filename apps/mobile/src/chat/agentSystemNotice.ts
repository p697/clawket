// OpenClaw transcript boundaries, normalized by `mapGatewayHistoryMessage`.
const TRANSCRIPT_BOUNDARY_NOTICES: ReadonlySet<string> = new Set(['Session reset', 'Context compacted']);

/**
 * A transcript boundary is part of the conversation: unlike other system
 * notices it is cached with the messages, so it paints with them on entry.
 */
export function isTranscriptBoundaryNotice(message: Readonly<{ role: string; text: string }>): boolean {
  return message.role === 'system' && TRANSCRIPT_BOUNDARY_NOTICES.has(message.text);
}

// Call only for normalized system notices. User/assistant text stays verbatim.
// Keep literal keys and namespaces visible to the locale-pruning check.
export function localizeAgentSystemNotice(
  text: string,
  t: (key: string, options: { ns: 'chat' }) => string,
): string {
  switch (text) {
    case 'Model authentication failed. Sign in again on your computer.':
      return t('Model authentication failed. Sign in again on your computer.', { ns: 'chat' });
    case 'The model account has insufficient credits or quota.':
      return t('The model account has insufficient credits or quota.', { ns: 'chat' });
    case 'The model is rate limited. Try again shortly.':
      return t('The model is rate limited. Try again shortly.', { ns: 'chat' });
    case 'This model is unavailable in the current Codex runtime. Choose another model or update Codex on your computer.':
      return t('This model is unavailable in the current Codex runtime. Choose another model or update Codex on your computer.', { ns: 'chat' });
    case "The agent couldn't complete this reply. Please try again.":
      return t("The agent couldn't complete this reply. Please try again.", { ns: 'chat' });
    // OpenClaw transcript boundaries, normalized by `mapGatewayHistoryMessage`.
    case 'Session reset':
      return t('Session reset', { ns: 'chat' });
    case 'Context compacted':
      return t('Context compacted', { ns: 'chat' });
    default:
      return text;
  }
}
