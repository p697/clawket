import type { TFunction } from 'i18next';
import type { ConsoleStackParamList } from '../screens/ConsoleScreen/sharedNavigator';

export type HermesConsoleActionIcon = 'sparkles' | 'sessions' | 'history' | 'docs' | 'memory' | 'usage' | 'cron' | 'skills';

export type HermesConsoleActionDescriptor = {
  key: string;
  screen: keyof ConsoleStackParamList;
  source: string;
  icon: HermesConsoleActionIcon;
  title: string;
  description: string;
  params?: Record<string, unknown>;
};

export function buildHermesConsoleActionDescriptors(params: {
  tConsole: TFunction<'console'>;
  tCommon: TFunction<'common'>;
  docsUrl: string | null;
}): HermesConsoleActionDescriptor[] {
  const { tConsole, docsUrl } = params;

  return [
    {
      key: 'sessions',
      screen: 'SessionsBoard',
      source: 'hermes_console_sessions',
      icon: 'sessions',
      title: tConsole('Sessions'),
      description: tConsole('Review Hermes session history and recent activity'),
    },
    {
      key: 'history',
      screen: 'ChatHistory',
      source: 'hermes_console_history',
      icon: 'history',
      title: tConsole('History'),
      description: tConsole('Search cached messages and saved chat history'),
    },
    {
      key: 'cron',
      screen: 'CronList',
      source: 'hermes_console_cron',
      icon: 'cron',
      title: tConsole('Scheduled Tasks'),
      description: tConsole('View scheduled tasks'),
    },
    {
      key: 'skills',
      screen: 'SkillList',
      source: 'hermes_console_skills',
      icon: 'skills',
      title: tConsole('Skills'),
      description: tConsole('Review and manage installed Hermes skills'),
    },
    {
      key: 'memory',
      screen: 'FileList',
      source: 'hermes_console_memory',
      icon: 'memory',
      title: tConsole('Memory'),
      description: tConsole('View and edit Hermes built-in MEMORY.md and USER.md'),
    },
    {
      key: 'usage',
      screen: 'Usage',
      source: 'hermes_console_usage',
      icon: 'usage',
      title: tConsole('Usage'),
      description: tConsole('Review Hermes token usage and estimated spend'),
    },
    {
      key: 'docs',
      screen: 'Docs',
      source: 'hermes_console_docs',
      icon: 'docs',
      title: tConsole('Documentation'),
      description: tConsole('Open Hermes project documentation'),
      ...(docsUrl ? { params: { url: docsUrl } } : {}),
    },
  ];
}
