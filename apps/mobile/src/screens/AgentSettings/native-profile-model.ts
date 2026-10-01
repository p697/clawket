import type { AgentProfileOperations, ProfileUsage } from '@clawket/agent-protocol';
import type { DocumentSource } from './document-model';

export function quotaRemaining(usage: ProfileUsage | null | undefined): number | null {
  const windows = usage?.quotas.flatMap(row => row.windows) ?? [];
  return windows.length ? Math.max(0, Math.min(100, 100 - Math.max(...windows.map(row => row.usedPercent)))) : null;
}

/** Keep native compare-and-swap versions private to this reader; rereading never silently retries a write. */
export function nativeProfileDocument(profile: AgentProfileOperations, connectionId: string, id: string, skill: boolean): DocumentSource {
  let version: string | undefined;
  return {
    key: `${connectionId}:native-profile:${id}`, connectionId, skillMarkdown: skill,
    load: async () => {
      const result = await profile.document(id); version = result.version;
      return { content: result.content, editable: result.editable, missing: result.missing, size: result.size };
    },
    save: async content => {
      if (!version) throw new Error('Refresh the document before saving');
      const result = await profile.saveDocument({ id, content, version });
      version = result.version;
      return { ok: result.content === content };
    },
  };
}
