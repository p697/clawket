/**
 * A send the computer refused for a named reason reads as that reason, not as
 * a generic failure. Exact Bridge-authored sentences only: any other text keeps
 * the generic line, and the original stays available under Details.
 * Keep literal keys and namespaces visible to the locale-pruning check.
 */
export function localizeSendFailure(
  details: string | null | undefined,
  t: (key: string, options: { ns: 'chat' }) => string,
): string {
  switch (details) {
    case 'This conversation is in use by Codex on your computer. Send again when it is idle there.':
    case 'This conversation is controlled by another Codex process. Continue there or release it before trying again.':
    case 'This conversation is still open in Claude. Close that conversation on your computer, then try again.':
      return t('This conversation is in use on your computer. Send again when it is idle there.', { ns: 'chat' });
    case 'A native task may still be running. Continue it on your computer.':
      return t('A task may still be running in this conversation. Continue it on your computer.', { ns: 'chat' });
    case 'Claude Code did not start in this folder. If your Mac is asking whether it may access the folder, allow it on the computer, then send again.':
      return t('The Agent did not start in this folder. If your computer is asking for access to the folder, allow it there, then send again.', { ns: 'chat' });
    case 'Claude Code could not initialize. Check native authentication and configuration.':
      return t('The Agent did not start. Check its sign-in on your computer.', { ns: 'chat' });
    // Bridges before the native-lock continuation answer this even while Codex is open.
    case 'Codex Desktop is unavailable. Open it on your computer to continue this conversation.':
      return t('This conversation cannot be continued from the phone yet. Update Clawket on your computer, or open Codex there.', { ns: 'chat' });
    default:
      return t('Sending failed. Check the conversation before trying again.', { ns: 'chat' });
  }
}
