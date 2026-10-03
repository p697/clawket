import type { AgentAdapter, SessionDescriptor } from '@clawket/agent-protocol';
import { ManualSessions } from '../../services/manual-sessions';

/** Backend acceptance and local access persist even when the reader leaves the presentation. */
export async function createSessionForPresentation(
  adapter: AgentAdapter,
  agentId: string,
  projectId: string | undefined,
  canPresent: () => boolean,
  onCreated: (session: SessionDescriptor) => void,
): Promise<boolean> {
  if (!canPresent()) return false;
  const session = await ManualSessions.create(adapter, agentId, 'manual', projectId ? { projectId } : undefined);
  if (!canPresent()) return false;
  onCreated(session);
  return true;
}
