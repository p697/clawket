import type { HermesCronJob } from '../types/hermes-cron';

export function describeHermesCronSchedule(job: HermesCronJob): string {
  return job.schedule_display
    || job.schedule.display
    || job.schedule.expr
    || (typeof job.schedule.minutes === 'number' ? `every ${job.schedule.minutes}m` : '')
    || job.schedule.run_at
    || '';
}

export function formatHermesCronRepeat(job: HermesCronJob): string {
  if (job.repeat.times == null) return 'forever';
  return `${job.repeat.completed}/${job.repeat.times}`;
}

export function getHermesCronStateLabel(job: HermesCronJob): string {
  if (job.state) return job.state;
  if (job.enabled) return 'scheduled';
  return 'paused';
}

export function getHermesCronStatusTone(job: HermesCronJob): 'success' | 'warning' | 'error' | 'neutral' {
  if (job.last_status === 'error' || job.last_error || job.last_delivery_error) return 'error';
  if (job.state === 'paused') return 'warning';
  if (job.last_status === 'ok') return 'success';
  return 'neutral';
}

export function parseHermesCronSkills(input: string): string[] {
  return input
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part, index, list) => list.indexOf(part) === index);
}
