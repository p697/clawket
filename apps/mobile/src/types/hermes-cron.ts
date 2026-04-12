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

export type HermesCronJobUpsert = {
  name: string;
  schedule: string;
  prompt: string;
  deliver?: string;
  skills?: string[];
  repeat?: number | null;
  script?: string;
  startAt?: string;
  scheduleDisplay?: string;
};
