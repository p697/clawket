import type { AgentProfileOperations, ProfileUsage } from '@clawket/agent-protocol';
import type { DocumentSource } from './document-model';

/** The headline and reset belong to the same limiting window; tied limits recover at the latest reset. */
export function quotaSummary(usage: ProfileUsage | null | undefined): { remaining: number; resetsAt: number | null } | null {
  const windows = usage?.quotas.flatMap(row => row.windows) ?? [];
  if (!windows.length) return null;
  const usedPercent = Math.max(...windows.map(row => row.usedPercent));
  const limiting = windows.filter(row => row.usedPercent === usedPercent);
  return {
    remaining: Math.max(0, Math.min(100, 100 - usedPercent)),
    resetsAt: limiting.some(row => row.resetsAt === null) ? null : Math.max(...limiting.map(row => row.resetsAt!)),
  };
}

export function quotaRemaining(usage: ProfileUsage | null | undefined): number | null {
  return quotaSummary(usage)?.remaining ?? null;
}

export function quotaResetCountdown(resetsAt: number | null | undefined, now: number) {
  if (resetsAt == null) return null;
  const totalMinutes = Math.max(0, Math.ceil((resetsAt * 1000 - now) / 60000));
  return { days: Math.floor(totalMinutes / 1440), hours: Math.floor(totalMinutes / 60) % 24, minutes: totalMinutes % 60, pending: totalMinutes === 0 };
}

/** Keep native compare-and-swap versions private to this reader; rereading never silently retries a write. */
export function nativeProfileDocument(profile: AgentProfileOperations, connectionId: string, id: string, skill: boolean, messages?: { changed: string; load: string; save: string }): DocumentSource {
  let version: string | undefined;
  return {
    key: `${connectionId}:native-profile:${id}`, connectionId, skillMarkdown: skill,
    load: async () => {
      try {
        const result = await profile.document(id); version = result.version;
        return { content: result.content, editable: result.editable, missing: result.missing, size: result.size };
      } catch (error) { if (messages) throw new Error(messages.load); throw error; }
    },
    save: async content => {
      if (!version) throw new Error(messages?.changed ?? 'Refresh the document before saving');
      try {
        const result = await profile.saveDocument({ id, content, version });
        version = result.version;
        return { ok: result.content === content };
      } catch (error) {
        if (messages) throw new Error(error instanceof Error && /^Document changed; refresh before (saving|continuing)$/.test(error.message) ? messages.changed : messages.save);
        throw error;
      }
    },
  };
}
