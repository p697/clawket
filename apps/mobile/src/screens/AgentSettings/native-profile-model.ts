import type { AgentProfileOperations, ProfileUsage } from '@clawket/agent-protocol';
import type { DocumentSource } from './document-model';

export function quotaRemaining(usage: ProfileUsage | null | undefined): number | null {
  const windows = usage?.quotas.flatMap(row => row.windows) ?? [];
  return windows.length ? Math.max(0, Math.min(100, 100 - Math.max(...windows.map(row => row.usedPercent)))) : null;
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
