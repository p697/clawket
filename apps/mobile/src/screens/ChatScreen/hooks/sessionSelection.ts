import { SessionInfo } from '../../../types';

type Params = {
  sessions: SessionInfo[];
  mainSessionKey: string;
  currentKey?: string | null;
  cachedKey?: string | null;
};

export function selectSessionForCurrentAgent({
  sessions,
  mainSessionKey,
  currentKey,
  cachedKey,
}: Params): SessionInfo | null {
  const isBackendScoped = !mainSessionKey.startsWith('agent:');
  if (isBackendScoped) {
    const currentSelected = currentKey
      ? sessions.find((item) => item.key === currentKey)
      : undefined;
    const cachedSelected = cachedKey
      ? sessions.find((item) => item.key === cachedKey)
      : undefined;
    const main = sessions.find((item) => item.key === mainSessionKey);
    return currentSelected ?? cachedSelected ?? main ?? sessions[0] ?? null;
  }

  const agentPrefix = mainSessionKey.replace(/:main$/, ':');
  const currentSelected = (
    currentKey && currentKey.startsWith(agentPrefix)
      ? sessions.find((item) => item.key === currentKey)
      : undefined
  );
  const cachedSelected = (
    cachedKey && cachedKey.startsWith(agentPrefix)
      ? sessions.find((item) => item.key === cachedKey)
      : undefined
  );
  const main = sessions.find((item) => item.key === mainSessionKey);
  const agentFallback = sessions.find((item) => item.key.startsWith(agentPrefix));
  return currentSelected ?? cachedSelected ?? main ?? agentFallback ?? null;
}
