import { sanitizeSilentPreviewText } from '../utils/chat-message';

export type AgentActivityStatus = 'idle' | 'streaming' | 'tool_calling';

export type AgentActivity = {
  agentId: string;
  status: AgentActivityStatus;
  previewText: string | null;
  toolName: string | null;
  updatedAt: number;
};

/**
 * Extract the agent ID from a session key like "agent:<id>:<session>".
 * Returns null for keys that don't match the agent session pattern.
 */
export function agentIdFromSessionKey(key: string): string | null {
  if (!key.startsWith('agent:')) return null;
  const parts = key.split(':');
  if (parts.length < 3) return null;
  const id = parts[1];
  return id || null;
}

/**
 * Truncate text for preview display. Returns trimmed text with ellipsis
 * if exceeding max length.
 */
export function truncateForPreview(text: string, max = 80): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return trimmed.slice(0, max) + '…';
}

/**
 * Apply a run-start event for an agent.
 * Returns true if the agent transitioned from idle (count should increment).
 */
export function applyRunStart(
  map: Map<string, AgentActivity>,
  agentId: string,
): boolean {
  const prev = map.get(agentId);
  const wasIdle = !prev || prev.status === 'idle';
  map.set(agentId, {
    agentId,
    status: 'streaming',
    previewText: prev?.previewText ?? null,
    toolName: null,
    updatedAt: Date.now(),
  });
  return wasIdle;
}

/**
 * Apply a streaming delta for an agent. Updates preview text only.
 */
export function applyDelta(
  map: Map<string, AgentActivity>,
  agentId: string,
  text: string,
): void {
  const prev = map.get(agentId);
  const previewText = sanitizeSilentPreviewText(truncateForPreview(text)) ?? null;
  map.set(agentId, {
    agentId,
    status: prev?.status === 'tool_calling' ? 'tool_calling' : 'streaming',
    previewText,
    toolName: prev?.toolName ?? null,
    updatedAt: Date.now(),
  });
}

/**
 * Apply a tool-start event for an agent.
 */
export function applyToolStart(
  map: Map<string, AgentActivity>,
  agentId: string,
  toolName: string,
): void {
  const prev = map.get(agentId);
  map.set(agentId, {
    agentId,
    status: 'tool_calling',
    previewText: prev?.previewText ?? null,
    toolName,
    updatedAt: Date.now(),
  });
}

/**
 * Apply a run-end event for an agent (final, aborted, or error).
 * Returns true if the agent transitioned from active (count should decrement).
 */
export function applyRunEnd(
  map: Map<string, AgentActivity>,
  agentId: string,
): boolean {
  const prev = map.get(agentId);
  const wasActive = !!prev && prev.status !== 'idle';
  map.set(agentId, {
    agentId,
    status: 'idle',
    previewText: prev?.previewText ?? null,
    toolName: null,
    updatedAt: Date.now(),
  });
  return wasActive;
}
