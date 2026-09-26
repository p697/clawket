import { describe, expect, it } from 'vitest';
import { desktopState, desktopTurns } from './desktop-state.js';

describe('native canonical history', () => {
  it('reads native graph order instead of an empty legacy array', () => {
    const a = { turnId: 'a', status: 'completed' }, b = { turnId: 'b', status: 'inProgress' };
    expect(desktopTurns({ turns: [], turnHistory: { kind: 'canonical', history: { entitiesByKey: { a, b }, islands: [{ entries: [{ key: 'a', value: 'a' }, { key: 'b', value: 'b' }] }] } } })).toEqual([{ ...a, id: 'a' }, { ...b, id: 'b' }]);
  });
  it('retains the same native IDs and inputs in an owner snapshot', () => {
    const state = desktopState({ id: 'thread', cwd: '/work', createdAt: 1, updatedAt: 2, turns: [{ id: 'turn', status: 'inProgress', items: [{ type: 'userMessage', id: 'message', content: [{ type: 'text', text: 'hello' }] }] }] }, [{ id: 7 }]);
    expect(desktopTurns(state)[0]).toMatchObject({ id: 'turn', params: { input: [{ type: 'text', text: 'hello' }] } });
    expect(state.requests).toEqual([{ id: 7 }]);
  });
});
