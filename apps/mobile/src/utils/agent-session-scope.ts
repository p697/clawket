type SessionSnapshotLike = {
  sessionKey?: string | null;
  agentId?: string | null;
};

export function isBackendScopedMainSessionKey(mainSessionKey: string | null | undefined): boolean {
  const normalized = mainSessionKey?.trim();
  return !!normalized && !normalized.startsWith('agent:');
}

export function resolveMainSessionKey(
  agentId: string | null | undefined,
  options?: { mainSessionKey?: string | null },
): string {
  if (isBackendScopedMainSessionKey(options?.mainSessionKey)) {
    return options?.mainSessionKey?.trim() || 'main';
  }
  const normalizedAgentId = agentId?.trim() || 'main';
  return `agent:${normalizedAgentId}:main`;
}

export function agentSessionPrefix(agentId: string | null | undefined): string | null {
  const normalizedAgentId = agentId?.trim();
  if (!normalizedAgentId) return null;
  return `agent:${normalizedAgentId}:`;
}

export function isSessionKeyInAgentScope(
  sessionKey: string | null | undefined,
  agentId: string | null | undefined,
  options?: { mainSessionKey?: string | null },
): boolean {
  const normalizedSessionKey = sessionKey?.trim();
  if (isBackendScopedMainSessionKey(options?.mainSessionKey)) {
    return !!normalizedSessionKey;
  }
  const prefix = agentSessionPrefix(agentId);
  if (!normalizedSessionKey || !prefix) return false;
  return normalizedSessionKey.startsWith(prefix);
}

export function sanitizeSnapshotForAgent<T extends SessionSnapshotLike>(
  snapshot: T | null | undefined,
  agentId: string | null | undefined,
  options?: { mainSessionKey?: string | null },
): T | null {
  if (!snapshot) return null;
  if (!isSessionKeyInAgentScope(snapshot.sessionKey, agentId, options)) return null;
  if (
    !isBackendScopedMainSessionKey(options?.mainSessionKey)
    && snapshot.agentId?.trim()
    && snapshot.agentId?.trim() !== agentId?.trim()
  ) {
    return null;
  }
  return snapshot;
}
