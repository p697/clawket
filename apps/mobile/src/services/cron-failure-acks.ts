import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CronJob } from '@clawket/agent-protocol';
import { cronFailureSignature, failedCronJobs } from '../screens/AgentSettings/cron-failures';

/**
 * Which cron failures the user has already seen on an Agent's Runs tab. The profile badge is a
 * notification, not the job state: it counts failed jobs whose signature is not stored here.
 * Records are connection/Agent scoped and hold only the failures that still exist, so a store
 * never grows past the Agent's job count.
 */
const CRON_FAILURE_ACKS_PREFIX = 'clawket.cronFailureAcks.v1.';

export type CronFailureAckScope = Readonly<{ connectionId: string; agentId: string }>;

type Listener = (scope: CronFailureAckScope) => void;

const listeners = new Set<Listener>();

function makeScopeKey(connectionId: string, agentId: string): string {
  return `${CRON_FAILURE_ACKS_PREFIX}${connectionId}::${agentId}`;
}

export function normalizeCronFailureAcks(value: unknown): ReadonlySet<string> {
  if (!Array.isArray(value)) return new Set();
  return new Set(value.filter((item): item is string => typeof item === 'string' && item.length > 0));
}

function sameSet(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  if (left.size !== right.size) return false;
  for (const item of left) if (!right.has(item)) return false;
  return true;
}

export const CronFailureAckService = {
  async read(connectionId: string, agentId: string): Promise<ReadonlySet<string>> {
    try {
      const raw = await AsyncStorage.getItem(makeScopeKey(connectionId, agentId));
      if (!raw) return new Set();
      return normalizeCronFailureAcks(JSON.parse(raw));
    } catch {
      return new Set();
    }
  },

  /**
   * Marks every current failure among `jobs` as seen and forgets acknowledgements for failures
   * that no longer exist. Listeners hear about the scope only when the stored set changed.
   */
  async acknowledge(connectionId: string, agentId: string, jobs: ReadonlyArray<CronJob>): Promise<void> {
    const next = new Set(failedCronJobs(jobs).map(cronFailureSignature));
    const current = await this.read(connectionId, agentId);
    if (sameSet(current, next)) return;
    const key = makeScopeKey(connectionId, agentId);
    if (next.size === 0) await AsyncStorage.removeItem(key);
    else await AsyncStorage.setItem(key, JSON.stringify([...next]));
    const scope: CronFailureAckScope = { connectionId, agentId };
    for (const listener of [...listeners]) listener(scope);
  },

  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },

  async clearConnection(connectionId: string): Promise<void> {
    const connectionPrefix = `${CRON_FAILURE_ACKS_PREFIX}${connectionId}::`;
    const keys = (await AsyncStorage.getAllKeys()).filter((key) => key.startsWith(connectionPrefix));
    if (keys.length > 0) await AsyncStorage.multiRemove(keys);
  },
};
