import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  compareIsoTimestamps,
  isRecord,
  normalizeStringArray,
  readBoolean,
  readNullablePositiveInt,
  readNumber,
  readPositiveInt,
  readString,
  requireNonEmptyString,
} from './internal.js';

export type HermesCronJob = {
  id: string;
  name: string;
  prompt: string;
  skills: string[];
  skill: string | null;
  model: string | null;
  provider: string | null;
  base_url: string | null;
  script: string | null;
  schedule: {
    kind?: string;
    expr?: string;
    minutes?: number;
    run_at?: string;
    display?: string;
  };
  schedule_display: string;
  repeat: {
    times: number | null;
    completed: number;
  };
  enabled: boolean;
  state: string;
  paused_at: string | null;
  paused_reason: string | null;
  created_at: string | null;
  next_run_at: string | null;
  last_run_at: string | null;
  last_status: string | null;
  last_error: string | null;
  deliver: string;
  origin: Record<string, unknown> | null;
  last_delivery_error: string | null;
};

export type HermesCronOutputEntry = {
  jobId: string;
  jobName: string;
  fileName: string;
  createdAt: number;
  createdAtIso: string | null;
  status: 'ok' | 'error' | 'unknown';
  title: string;
  preview: string;
};

export type HermesCronOutputDetail = HermesCronOutputEntry & {
  content: string;
  path: string;
};

function validateStringArray(value: unknown, field: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string' || !entry.trim())) {
    throw new Error(`${field} must be an array of non-empty strings.`);
  }
  return normalizeStringArray(value);
}

function validateOptionalString(value: unknown, field: string): string | null {
  if (value === undefined) return null;
  if (typeof value !== 'string') throw new Error(`${field} must be a string.`);
  return value.trim() || null;
}

function validateRepeat(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  const repeat = readNullablePositiveInt(value);
  if (repeat == null || repeat !== Number(value)) {
    throw new Error('repeat must be a positive integer.');
  }
  return repeat;
}

function validateIsoTimestamp(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new Error(`${field} must be a valid ISO timestamp.`);
  const timestamp = value.trim();
  const match = timestamp.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/);
  const year = Number(match?.[1]);
  const month = Number(match?.[2]);
  const day = Number(match?.[3]);
  const hour = Number(match?.[4]);
  const minute = Number(match?.[5]);
  const second = Number(match?.[6]);
  const calendarDate = new Date(Date.UTC(year, month - 1, day));
  const validCalendarDate = calendarDate.getUTCFullYear() === year
    && calendarDate.getUTCMonth() === month - 1
    && calendarDate.getUTCDate() === day;
  if (!match || !validCalendarDate || hour > 23 || minute > 59 || second > 59
    || !Number.isFinite(Date.parse(timestamp))) {
    throw new Error(`${field} must be a valid ISO timestamp.`);
  }
  return timestamp;
}


export abstract class HermesCronMethods {
  declare hermesHomePath: string;
  declare runHermesPython: <T>(script: string, stdinPayload?: unknown) => T;

  async listHermesCronJobs(payload: Record<string, unknown>): Promise<HermesCronJob[]> {
    const includeDisabled = readBoolean(payload.includeDisabled) ?? true;
    const jobs = Object.values(this.readHermesCronJobsFromDisk()).filter((job) => includeDisabled || job.enabled);
    jobs.sort((left, right) => compareIsoTimestamps(left.next_run_at, right.next_run_at) || left.name.localeCompare(right.name));
    return jobs;
  }

  async getHermesCronJob(jobId: string | null): Promise<HermesCronJob | null> {
    if (!jobId) {
      throw new Error('hermes.cron.jobs.get requires jobId.');
    }
    return this.readHermesCronJobsFromDisk()[jobId] ?? null;
  }

  async createHermesCronJob(payload: Record<string, unknown>): Promise<HermesCronJob> {
    const startAt = validateIsoTimestamp(payload.startAt, 'startAt');
    const scheduleDisplay = validateOptionalString(payload.scheduleDisplay, 'scheduleDisplay');
    const prompt = validateOptionalString(payload.prompt, 'prompt');
    const skills = validateStringArray(payload.skills, 'skills');
    if (!prompt && skills.length === 0) {
      throw new Error('Hermes scheduled tasks require prompt or at least one skill.');
    }
    const result = this.runHermesCronTool('create', {
      name: requireNonEmptyString(readString(payload.name), 'Task name is required.'),
      schedule: requireNonEmptyString(readString(payload.schedule), 'Schedule is required.'),
      prompt: prompt || '',
      deliver: validateOptionalString(payload.deliver, 'deliver'),
      skills,
      repeat: validateRepeat(payload.repeat),
      script: validateOptionalString(payload.script, 'script'),
    });
    const jobId = readString((isRecord(result) ? result.job_id : null));
    if (!jobId) {
      throw new Error('Hermes scheduled task creation did not return a job_id.');
    }
    this.applyHermesCronJobOverrides(jobId, {
      nextRunAt: startAt,
      scheduleDisplay,
    });
    const created = this.readHermesCronJobsFromDisk()[jobId];
    if (!created) throw new Error(`Hermes scheduled task ${jobId} was not persisted.`);
    return created;
  }

  async updateHermesCronJob(jobId: string | null, payload: Record<string, unknown>): Promise<HermesCronJob | null> {
    if (!jobId) {
      throw new Error('hermes.cron.jobs.update requires jobId.');
    }
    const updates: Record<string, unknown> = { jobId };
    if (payload.name !== undefined) updates.name = readString(payload.name);
    if (payload.schedule !== undefined) updates.schedule = readString(payload.schedule);
    if (payload.prompt !== undefined) updates.prompt = readString(payload.prompt);
    if (payload.deliver !== undefined) updates.deliver = readString(payload.deliver) || null;
    if (payload.skills !== undefined) updates.skills = validateStringArray(payload.skills, 'skills');
    if (payload.repeat !== undefined) updates.repeat = validateRepeat(payload.repeat);
    if (payload.script !== undefined) updates.script = readString(payload.script) || '';
    this.runHermesCronTool('update', updates);
    this.applyHermesCronJobOverrides(jobId, {
      nextRunAt: payload.startAt === undefined ? undefined : validateIsoTimestamp(payload.startAt, 'startAt'),
      scheduleDisplay: payload.scheduleDisplay === undefined ? undefined : (readString(payload.scheduleDisplay) || null),
    });
    return this.readHermesCronJobsFromDisk()[jobId] ?? null;
  }

  async pauseHermesCronJob(jobId: string | null): Promise<HermesCronJob | null> {
    return this.runHermesCronJobAction(jobId, 'pause');
  }

  async resumeHermesCronJob(jobId: string | null): Promise<HermesCronJob | null> {
    return this.runHermesCronJobAction(jobId, 'resume');
  }

  async runHermesCronJob(jobId: string | null): Promise<HermesCronJob | null> {
    return this.runHermesCronJobAction(jobId, 'run');
  }

  async removeHermesCronJob(jobId: string | null): Promise<boolean> {
    if (!jobId) {
      throw new Error('hermes.cron.jobs.remove requires jobId.');
    }
    const result = this.runHermesCronTool('remove', { jobId });
    return Boolean(result.success);
  }

  async runHermesCronJobAction(jobId: string | null, action: 'pause' | 'resume' | 'run'): Promise<HermesCronJob | null> {
    if (!jobId) {
      throw new Error(`hermes.cron.jobs.${action} requires jobId.`);
    }
    this.runHermesCronTool(action, { jobId });
    return this.readHermesCronJobsFromDisk()[jobId] ?? null;
  }

  listHermesCronOutputs(payload: Record<string, unknown>): HermesCronOutputEntry[] {
    const requestedJobId = readString(payload.jobId) || null;
    const limit = readPositiveInt(payload.limit, 100);
    const outputsRoot = join(this.hermesHomePath, 'cron', 'output');
    if (!existsSync(outputsRoot)) {
      return [];
    }

    const jobs = this.readHermesCronJobsFromDisk();
    const entries: HermesCronOutputDetail[] = [];
    const discoveredJobDirs = readdirSync(outputsRoot, { withFileTypes: true })
      .filter((dirent) => dirent.isDirectory())
      .map((dirent) => dirent.name);
    const jobDirs = requestedJobId
      ? [requestedJobId]
      : Array.from(new Set([...Object.keys(jobs), ...discoveredJobDirs]));

    for (const jobId of jobDirs) {
      const dirPath = join(outputsRoot, jobId);
      if (!existsSync(dirPath)) {
        continue;
      }
      for (const dirent of readdirSync(dirPath, { withFileTypes: true })) {
        if (!dirent.isFile() || !dirent.name.endsWith('.md')) {
          continue;
        }
        const output = this.readHermesCronOutputDetail(jobId, dirent.name, jobs[jobId]);
        if (output) {
          entries.push(output);
        }
      }
    }

    entries.sort((left, right) => right.createdAt - left.createdAt);
    return entries.slice(0, limit).map(({ content: _content, path: _path, ...entry }) => entry);
  }

  getHermesCronOutput(jobId: string | null, fileName: string | null): HermesCronOutputDetail | null {
    if (!jobId || !fileName) {
      throw new Error('hermes.cron.outputs.get requires jobId and fileName.');
    }
    const jobs = this.readHermesCronJobsFromDisk();
    return this.readHermesCronOutputDetail(jobId, fileName, jobs[jobId]);
  }

  readHermesCronJobsFromDisk(): Record<string, HermesCronJob> {
    const jobsPath = join(this.hermesHomePath, 'cron', 'jobs.json');
    if (!existsSync(jobsPath)) {
      return {};
    }
    try {
      const parsed = JSON.parse(readFileSync(jobsPath, 'utf8')) as { jobs?: unknown[] };
      const result: Record<string, HermesCronJob> = {};
      for (const entry of Array.isArray(parsed.jobs) ? parsed.jobs : []) {
        const job = normalizeHermesCronJob(entry);
        if (job) {
          result[job.id] = job;
        }
      }
      return result;
    } catch {
      return {};
    }
  }

  applyHermesCronJobOverrides(
    jobId: string,
    overrides: {
      nextRunAt?: string | null;
      scheduleDisplay?: string | null;
    },
  ): void {
    if (overrides.nextRunAt === undefined && overrides.scheduleDisplay === undefined) {
      return;
    }
    const jobsPath = join(this.hermesHomePath, 'cron', 'jobs.json');
    if (!existsSync(jobsPath)) {
      return;
    }
    try {
      const parsed = JSON.parse(readFileSync(jobsPath, 'utf8')) as { jobs?: unknown[]; updated_at?: unknown };
      const jobs = Array.isArray(parsed.jobs) ? parsed.jobs : [];
      let changed = false;
      for (const entry of jobs) {
        if (!isRecord(entry) || readString(entry.id) !== jobId) {
          continue;
        }
        if (overrides.nextRunAt !== undefined) {
          entry.next_run_at = overrides.nextRunAt;
          changed = true;
        }
        if (overrides.scheduleDisplay !== undefined && overrides.scheduleDisplay) {
          entry.schedule_display = overrides.scheduleDisplay;
          if (isRecord(entry.schedule)) {
            entry.schedule.display = overrides.scheduleDisplay;
          }
          changed = true;
        }
        break;
      }
      if (!changed) {
        return;
      }
      writeFileSync(
        jobsPath,
        JSON.stringify({
          jobs,
          updated_at: new Date().toISOString(),
        }, null, 2) + '\n',
        'utf8',
      );
    } catch {
      // Ignore override failures and fall back to Hermes defaults.
    }
  }

  readHermesCronOutputDetail(
    jobId: string,
    fileName: string,
    job?: HermesCronJob,
  ): HermesCronOutputDetail | null {
    if (!/^[A-Za-z0-9._-]+\.md$/.test(fileName)) {
      return null;
    }
    const outputPath = join(this.hermesHomePath, 'cron', 'output', jobId, fileName);
    if (!existsSync(outputPath)) {
      return null;
    }
    const content = readFileSync(outputPath, 'utf8');
    return parseHermesCronOutput(jobId, fileName, content, outputPath, job?.name);
  }

  runHermesCronTool(
    action: 'create' | 'update' | 'pause' | 'resume' | 'run' | 'remove',
    payload: Record<string, unknown>,
  ): { success?: boolean; job?: unknown; removed_job?: unknown; job_id?: unknown; error?: unknown } {
    const result = this.runHermesPython<{
      success?: boolean;
      job?: unknown;
      removed_job?: unknown;
      job_id?: unknown;
      error?: unknown;
    }>(
      [
        'import json',
        'import sys',
        'from tools.cronjob_tools import cronjob',
        'payload = json.load(sys.stdin)',
        'result = cronjob(',
        '  action=payload.get("action"),',
        '  job_id=payload.get("jobId"),',
        '  prompt=payload.get("prompt"),',
        '  schedule=payload.get("schedule"),',
        '  name=payload.get("name"),',
        '  repeat=payload.get("repeat"),',
        '  deliver=payload.get("deliver"),',
        '  skills=payload.get("skills"),',
        '  script=payload.get("script"),',
        ')',
        'print(result)',
      ].join('\n'),
      { ...payload, action },
    );
    if (result.success === false) {
      throw new Error(readString(result.error) || `Failed to ${action} Hermes scheduled task.`);
    }
    return result;
  }
}

function normalizeHermesCronJob(value: unknown): HermesCronJob | null {
  if (!isRecord(value)) return null;
  const id = readString(value.id);
  const name = readString(value.name);
  if (!id || !name) return null;
  const scheduleRecord = isRecord(value.schedule) ? value.schedule : {};
  const repeatRecord = isRecord(value.repeat) ? value.repeat : {};
  return {
    id,
    name,
    prompt: readString(value.prompt),
    skills: normalizeStringArray(value.skills),
    skill: readString(value.skill) || null,
    model: readString(value.model) || null,
    provider: readString(value.provider) || null,
    base_url: readString(value.base_url ?? value.baseUrl) || null,
    script: readString(value.script) || null,
    schedule: {
      kind: readString(scheduleRecord.kind) || undefined,
      expr: readString(scheduleRecord.expr) || undefined,
      minutes: readNumber(scheduleRecord.minutes) ?? undefined,
      run_at: readString(scheduleRecord.run_at) || undefined,
      display: readString(scheduleRecord.display) || undefined,
    },
    schedule_display: readString(value.schedule_display) || readString(scheduleRecord.display) || '',
    repeat: {
      times: readNullablePositiveInt(repeatRecord.times),
      completed: Math.max(0, readNumber(repeatRecord.completed) ?? 0),
    },
    enabled: readBoolean(value.enabled) ?? true,
    state: readString(value.state) || 'scheduled',
    paused_at: readString(value.paused_at) || null,
    paused_reason: readString(value.paused_reason) || null,
    created_at: readString(value.created_at) || null,
    next_run_at: readString(value.next_run_at) || null,
    last_run_at: readString(value.last_run_at) || null,
    last_status: readString(value.last_status) || null,
    last_error: readString(value.last_error) || null,
    deliver: readString(value.deliver) || 'local',
    origin: isRecord(value.origin) ? value.origin : null,
    last_delivery_error: readString(value.last_delivery_error) || null,
  };
}

function parseHermesCronOutput(
  jobId: string,
  fileName: string,
  content: string,
  path: string,
  fallbackJobName?: string | null,
): HermesCronOutputDetail {
  const jobNameMatch = content.match(/^# Cron Job: (.+)$/m);
  const heading = readString(jobNameMatch?.[1]);
  const failed = /\(FAILED\)$/i.test(heading);
  const title = heading.replace(/\s+\(FAILED\)$/i, '') || fallbackJobName || jobId;
  const responseBlock = content.split(/^## Response\s*$/m)[1] ?? '';
  const preview = responseBlock
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 2)
    .join(' ')
    .slice(0, 220);
  const timestampMatch = fileName.match(/^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})\.md$/);
  const createdAt = timestampMatch
    ? new Date(
      Number(timestampMatch[1]),
      Number(timestampMatch[2]) - 1,
      Number(timestampMatch[3]),
      Number(timestampMatch[4]),
      Number(timestampMatch[5]),
      Number(timestampMatch[6]),
    ).getTime()
    : Date.now();
  return {
    jobId,
    jobName: title,
    fileName,
    createdAt,
    createdAtIso: Number.isFinite(createdAt) ? new Date(createdAt).toISOString() : null,
    status: failed ? 'error' : 'ok',
    title,
    preview,
    content,
    path,
  };
}
