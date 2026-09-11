import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { SlashCommand } from '../../data/slash-commands';

/** Commands whose effect is destructive or restart-causing; menu taps confirm first. */
export const CONFIRMED_SLASH_COMMAND_KEYS: ReadonlySet<string> = new Set(['reset', 'restart', 'kill']);

/**
 * Catalog descriptions are natural-English keys. Listing them literally keeps
 * every key visible to static translation checks.
 */
export function useSlashCommandDescriptions(): (command: SlashCommand) => string {
  const { t } = useTranslation('chat');
  const translated = useMemo<Record<string, string>>(() => ({
    'Show session status': t('Show session status'),
    'Browse and switch models': t('Browse and switch models'),
    'Compact session context': t('Compact session context'),
    'Set thinking level (off/low/medium/high)': t('Set thinking level (off/low/medium/high)'),
    'Toggle fast mode': t('Toggle fast mode'),
    'Start a new session': t('Start a new session'),
    'Reset current session': t('Reset current session'),
    'Stop current generation': t('Stop current generation'),
    'Toggle reasoning mode': t('Toggle reasoning mode'),
    'Toggle elevated permissions': t('Toggle elevated permissions'),
    'Show token usage stats': t('Show token usage stats'),
    'Show context window usage': t('Show context window usage'),
    'Show current session info': t('Show current session info'),
    'List available agents': t('List available agents'),
    'List all commands': t('List all commands'),
    'Kill running subagents': t('Kill running subagents'),
    'Send instruction to a subagent': t('Send instruction to a subagent'),
    'Send message to another session': t('Send message to another session'),
    'Text-to-speech': t('Text-to-speech'),
    'Show or change queue mode': t('Show or change queue mode'),
    'Show available commands': t('Show available commands'),
    'Switch to a specific model': t('Switch to a specific model'),
    'Toggle verbose mode': t('Toggle verbose mode'),
    'Restart the gateway': t('Restart the gateway'),
  }), [t]);
  return (command) => translated[command.description] ?? command.description;
}
