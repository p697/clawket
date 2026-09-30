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
    default:
      return text;
  }
}
