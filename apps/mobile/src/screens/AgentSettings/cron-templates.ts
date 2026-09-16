import type { TFunction } from 'i18next';
import { Activity, CalendarDays, ListChecks, Moon, Newspaper, NotebookPen, Sun, Sunrise } from 'lucide-react-native';
import type { ScheduleDraft } from './cron-schedule';

export function cronTemplates(t: TFunction) {
  return [
    { id: 'daily-briefing', icon: Sun, name: t('Daily briefing', { ns: 'settings' }), prompt: t('Summarize my calendar, tasks and important updates for today.', { ns: 'settings' }), schedule: { frequency: 'daily', hour: 9 } },
    { id: 'weekly-report', icon: CalendarDays, name: t('Weekly review', { ns: 'settings' }), prompt: t('Review this week’s progress, unfinished tasks and next steps.', { ns: 'settings' }), schedule: { frequency: 'weekly', weekdays: [1], hour: 9 } },
    { id: 'check-reminders', icon: ListChecks, name: t('Check reminders', { ns: 'settings' }), prompt: t('Review upcoming and overdue tasks, ordered by priority.', { ns: 'settings' }), schedule: { frequency: 'daily', hour: 8 } },
    { id: 'news-digest', icon: Newspaper, name: t('News digest', { ns: 'settings' }), prompt: t('Summarize recent news on my topics of interest, with sources.', { ns: 'settings' }), schedule: { frequency: 'daily', hour: 8 } },
    { id: 'morning-motivation', icon: Sunrise, name: t('Morning motivation', { ns: 'settings' }), prompt: t('Share a short encouragement to help me focus today.', { ns: 'settings' }), schedule: { frequency: 'daily', hour: 7 } },
    { id: 'evening-summary', icon: Moon, name: t('Evening summary', { ns: 'settings' }), prompt: t('Summarize today’s achievements and priorities for tomorrow.', { ns: 'settings' }), schedule: { frequency: 'daily', hour: 18 } },
    { id: 'weekly-cleanup', icon: NotebookPen, name: t('Weekly cleanup', { ns: 'settings' }), prompt: t('Review my notes and tasks, and suggest what to organize or follow up.', { ns: 'settings' }), schedule: { frequency: 'weekly', weekdays: [0], hour: 10 } },
    { id: 'health-check', icon: Activity, name: t('Service check', { ns: 'settings' }), prompt: t('Check configured services and summarize problems and suggested fixes.', { ns: 'settings' }), schedule: { frequency: 'interval', amount: '6', unit: 'hours' } },
  ] satisfies { id: string; icon: typeof Sun; name: string; prompt: string; schedule: Partial<ScheduleDraft> }[];
}
