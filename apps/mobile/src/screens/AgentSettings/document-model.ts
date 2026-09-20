import type { AgentAdapter, AgentDescriptor } from '@clawket/agent-protocol';
import { analyticsAgentDocument, analyticsEvents } from '../../services/analytics/events';
import { canEditAgentFile } from './files-model';

export type DocumentActivity = 'edit' | 'saved' | 'failed';

export type DocumentContent = Readonly<{
  content: string;
  /** The backend accepts a write for this document through the source's `save`. */
  editable: boolean;
  /** Listed but absent: the page opens straight into an empty editor and the first save creates it. */
  missing?: boolean;
  /** Binary payloads are never rendered or edited. */
  binary?: boolean;
  size?: number;
  linkedFiles?: readonly string[];
  plainText?: boolean;
  updatedAtMs?: number;
  /** Header subtitle resolved by the read when the route did not carry one. */
  subtitle?: string;
}>;

/**
 * One document behind the shared `DocumentScreen`: an Agent workspace file or a
 * skill's SKILL.md. The screen owns reading, editing and dirty handling; the
 * source owns the backend contract and telemetry.
 */
export type DocumentSource = Readonly<{
  /** A different key is a different document: the screen reloads and drops the draft. */
  key: string;
  load: () => Promise<DocumentContent>;
  save?: (content: string) => Promise<Readonly<{ ok: boolean }>>;
  onActivity?: (action: DocumentActivity) => void;
}>;

export function agentFileDocument(
  adapter: AgentAdapter,
  agent: AgentDescriptor,
  fileName: string,
): DocumentSource | null {
  const files = adapter.management?.agents?.files;
  const get = files?.get;
  if (!get) return null;
  const set = files.set;
  const editable = canEditAgentFile(adapter.capabilities, files);
  const backend = adapter.connection.backendKind;
  const document = analyticsAgentDocument(fileName);
  return {
    key: `${agent.connectionId}:${agent.agentId}:file:${fileName}`,
    load: async () => {
      const file = await get(fileName, agent.agentId);
      return {
        content: file.missing ? '' : file.content ?? '',
        editable,
        missing: file.missing,
        ...(file.size === undefined ? {} : { size: file.size }),
        ...(file.updatedAtMs === undefined ? {} : { updatedAtMs: file.updatedAtMs }),
      };
    },
    ...(editable && set ? { save: (content: string) => set(fileName, content, agent.agentId) } : {}),
    onActivity: (action) => analyticsEvents.agentFileActivity({ action, backend, document }),
  };
}

export function skillSourceDocument(
  adapter: AgentAdapter,
  agentId: string,
  skillKey: string,
  filePath?: string,
): DocumentSource | null {
  const skills = adapter.management?.skills;
  const get = skills?.get;
  if (!get) return null;
  const updateContent = filePath ? undefined : skills.updateContent;
  return {
    key: `${adapter.connection.id}:${agentId}:skill:${skillKey}${filePath ? `:file:${filePath}` : ''}`,
    load: async () => {
      const detail = await get(skillKey, { agentId, ...(filePath ? { filePath } : {}) });
      return {
        content: detail.content,
        editable: Boolean(adapter.capabilities.skills && detail.editable && !detail.isBinary && updateContent),
        ...(detail.isBinary ? { binary: true } : {}),
        subtitle: detail.name,
        ...(detail.linkedFiles ? { linkedFiles: [...new Set(Object.values(detail.linkedFiles).flat())].filter(path => path !== filePath) } : {}),
        ...(filePath && !/\.md$/i.test(filePath) ? { plainText: true } : {}),
      };
    },
    ...(updateContent ? { save: (content: string) => updateContent(skillKey, content, agentId) } : {}),
  };
}
