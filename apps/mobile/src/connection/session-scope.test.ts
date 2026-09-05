import {
  isSessionKeyInAgentScope,
  resolveConnectedThreadTarget,
  sanitizeSnapshotForAgent,
} from './session-scope';

describe('connection session scope', () => {
  it('rejects legacy OpenClaw agent session keys for backend-scoped Hermes sessions', () => {
    expect(isSessionKeyInAgentScope('agent:main:main', 'main', { mainSessionKey: 'main' })).toBe(false);
    expect(isSessionKeyInAgentScope('20260411_122441_d40735', 'main', { mainSessionKey: 'main' })).toBe(true);
  });

  it('rejects backend-scoped snapshots whose agent id does not match the current agent', () => {
    expect(
      sanitizeSnapshotForAgent(
        {
          sessionKey: '20260411_122441_d40735',
          agentId: 'writer',
        },
        'main',
        { mainSessionKey: 'main' },
      ),
    ).toBeNull();
  });

  it('opens the declared main Agent session after pairing', () => {
    expect(resolveConnectedThreadTarget('openclaw', [{
      connectionId: 'connection-one',
      agentId: 'writer',
      name: 'Writer',
      isMain: true,
      mainSessionKey: 'agent:writer:main',
    }])).toEqual({
      agentId: 'writer',
      sessionKey: 'agent:writer:main',
    });
  });

  it('falls back to backend-scoped main sessions when roster hydration lags pairing', () => {
    expect(resolveConnectedThreadTarget('hermes')).toEqual({
      agentId: 'main',
      sessionKey: 'main',
    });
    expect(resolveConnectedThreadTarget('youmind')).toEqual({
      agentId: 'main',
      sessionKey: 'main',
    });
    expect(resolveConnectedThreadTarget('openclaw')).toEqual({
      agentId: 'main',
      sessionKey: 'agent:main:main',
    });
  });
});
