import type { HermesCronJob, HermesCronOutputEntry } from '../types/hermes-cron';

type GatewayHermesCronGateway = {
  listHermesCronJobs(params?: { includeDisabled?: boolean }): Promise<HermesCronJob[]>;
  getHermesCronJob(jobId: string): Promise<HermesCronJob | null>;
  listHermesCronOutputs(params?: { jobId?: string; limit?: number }): Promise<HermesCronOutputEntry[]>;
};

export async function loadGatewayHermesCronList(
  gateway: GatewayHermesCronGateway,
): Promise<{
  jobs: HermesCronJob[];
  outputs: HermesCronOutputEntry[];
}> {
  const [jobs, outputs] = await Promise.all([
    gateway.listHermesCronJobs({ includeDisabled: true }),
    gateway.listHermesCronOutputs({ limit: 100 }),
  ]);
  return { jobs, outputs };
}

export async function loadGatewayHermesCronDetail(
  gateway: GatewayHermesCronGateway,
  jobId: string,
): Promise<{
  job: HermesCronJob | null;
  outputs: HermesCronOutputEntry[];
}> {
  const [job, outputs] = await Promise.all([
    gateway.getHermesCronJob(jobId),
    gateway.listHermesCronOutputs({ jobId, limit: 50 }),
  ]);
  return { job, outputs };
}
