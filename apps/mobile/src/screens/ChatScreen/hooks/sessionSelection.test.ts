import { SessionInfo } from '../../../types';
import { selectSessionForCurrentAgent } from './sessionSelection';

function makeSession(key: string, updatedAt = 0): SessionInfo {
  return {
    key,
    kind: 'direct',
    updatedAt,
  };
}

describe('selectSessionForCurrentAgent', () => {
  it('prefers the current selected session when it still exists', () => {
    const sessions = [
      makeSession('agent:main:main'),
      makeSession('agent:main:telegram:1'),
    ];

    const result = selectSessionForCurrentAgent({
      sessions,
      mainSessionKey: 'agent:main:main',
      currentKey: 'agent:main:telegram:1',
    });

    expect(result?.key).toBe('agent:main:telegram:1');
  });

  it('falls back to cached session when current selection is missing', () => {
    const sessions = [
      makeSession('agent:main:main'),
      makeSession('agent:main:telegram:1'),
    ];

    const result = selectSessionForCurrentAgent({
      sessions,
      mainSessionKey: 'agent:main:main',
      currentKey: 'agent:main:telegram:missing',
      cachedKey: 'agent:main:telegram:1',
    });

    expect(result?.key).toBe('agent:main:telegram:1');
  });

  it('falls back to the agent main session when no explicit session exists', () => {
    const sessions = [
      makeSession('agent:main:main'),
      makeSession('agent:other:main'),
    ];

    const result = selectSessionForCurrentAgent({
      sessions,
      mainSessionKey: 'agent:main:main',
      currentKey: 'agent:main:telegram:missing',
    });

    expect(result?.key).toBe('agent:main:main');
  });

  it('never picks a session from another agent', () => {
    const sessions = [
      makeSession('agent:other:main'),
      makeSession('agent:other:telegram:1'),
    ];

    const result = selectSessionForCurrentAgent({
      sessions,
      mainSessionKey: 'agent:main:main',
      currentKey: 'agent:main:telegram:missing',
    });

    expect(result).toBeNull();
  });

  it('uses backend-scoped Hermes sessions without agent prefix filtering', () => {
    const sessions = [
      makeSession('main'),
      makeSession('20260411_122441_d40735'),
    ];

    const result = selectSessionForCurrentAgent({
      sessions,
      mainSessionKey: 'main',
      currentKey: '20260411_122441_d40735',
    });

    expect(result?.key).toBe('20260411_122441_d40735');
  });
});
