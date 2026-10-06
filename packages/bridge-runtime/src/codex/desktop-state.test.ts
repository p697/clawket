import { describe, expect, it } from 'vitest';
import { nativeSettings } from './settings.js';
import { desktopState, desktopTurns } from './desktop-state.js';
import { codexMessages } from './history.js';

const settings = nativeSettings({ cwd: '/work', model: 'native', modelProvider: 'custom', effort: 'high', serviceTier: 'fast', approvalPolicy: 'never', approvalsReviewer: 'user', sandboxPolicy: { type: 'dangerFullAccess' }, activePermissionProfile: null, collaborationMode: { mode: 'default', settings: { model: 'native', reasoning_effort: 'high', developer_instructions: null } } })!;

// Installed Desktop's continuation detector reads this array in both turn
// params and user items. Stdio accepts omission, but the renderer does not.
function desktopContinuation(input: any[]): boolean {
  return input.some(item => item.type === 'text' && item.text_elements.some(({ placeholder }: any) => placeholder === 'aeon-continuation'));
}

it('keeps plain native text renderable in both Desktop input representations without mutating history', () => {
  const content = Object.freeze([Object.freeze({ type: 'text', text: '  Same input\n' }), Object.freeze({ type: 'image', url: 'data:image/png;base64,aA==' })]);
  const user = Object.freeze({ id: 'native-user', type: 'userMessage', content });
  const turn = Object.freeze({ id: 'native-turn', items: Object.freeze([user]), status: 'completed' });
  const state = desktopState({ id: 'thread', cwd: '/work', turns: [turn] }, [], settings);
  const projected = desktopTurns(state)[0];
  expect(() => desktopContinuation(projected.params.input)).not.toThrow();
  expect(() => desktopContinuation(projected.items[0].content)).not.toThrow();
  expect(projected.params.input[0]).toEqual({ type: 'text', text: '  Same input\n', text_elements: [] });
  expect(projected.items[0]).toMatchObject({ id: 'native-user', content: projected.params.input });
  expect(projected.params.input[1]).toBe(content[1]);
  expect(content[0]).not.toHaveProperty('text_elements');
});

it('preserves valid native text elements and other input metadata in Desktop history', () => {
  const elements = [{ byteRange: { start: 0, end: 3 }, placeholder: 'aeon-continuation' }];
  const input = { type: 'text', text: '...', text_elements: elements, futureMetadata: { preserved: true } };
  const state = desktopState({ id: 'thread', cwd: '/work', turns: [{ id: 't', items: [{ type: 'userMessage', id: 'u', content: [input] }] }] }, [], settings);
  const turn = desktopTurns(state)[0];
  expect(desktopContinuation(turn.params.input)).toBe(true);
  expect(desktopContinuation(turn.items[0].content)).toBe(true);
  expect(turn.params.input[0]).toEqual(input);
  expect(turn.items[0].content[0]).toEqual(input);
});

it.each([null, {}, 'invalid', [null]])('rejects malformed existing text elements before publishing a Desktop snapshot: %j', text_elements => {
  expect(() => desktopState({ id: 'thread', cwd: '/work', turns: [{ id: 't', items: [{ type: 'userMessage', id: 'u', content: [{ type: 'text', text: 'input', text_elements }] }] }] }, [], settings)).toThrow('Invalid Desktop text elements');
});

describe('native canonical history', () => {
  it('reads native graph order instead of an empty legacy array', () => {
    const a = { turnId: 'a', status: 'completed' }, b = { turnId: 'b', status: 'inProgress' };
    expect(desktopTurns({ turns: [], turnHistory: { kind: 'canonical', history: { entitiesByKey: { a, b }, islands: [{ entries: [{ key: 'a', value: 'a' }, { key: 'b', value: 'b' }] }] } } })).toEqual([{ ...a, id: 'a' }, { ...b, id: 'b' }]);
  });
  it('retains the same native IDs and inputs in an owner snapshot', () => {
    const state = desktopState({ id: 'thread', cwd: '/work', createdAt: 1, updatedAt: 2, turns: [{ id: 'turn', status: 'inProgress', items: [{ type: 'userMessage', id: 'message', content: [{ type: 'text', text: 'hello' }] }] }] }, [{ id: 7 }], settings);
    expect(desktopTurns(state)[0]).toMatchObject({ id: 'turn', params: { input: [{ type: 'text', text: 'hello' }] } });
    expect(state.requests).toEqual([{ id: 7 }]);
    expect(state.turns).toEqual([]); // Canonical graph is the only transcript copy.
    expect(state.latestCollaborationMode.settings.model).toBe('native');
    expect(desktopTurns(state)[0].params.collaborationMode.settings.reasoning_effort).toBe('high');
    expect(state.currentPermissions).toMatchObject({ approvalPolicy: 'never', sandboxPolicy: { type: 'dangerFullAccess' } });
    expect(state.latestThreadSettings).toMatchObject({ modelProvider: 'custom', serviceTier: 'fast' });
  });
});

it('keeps native pagination boundaries instead of claiming the tail is complete', () => {
  const state = desktopState({ id: 'thread', cwd: '/work', createdAt: 1, updatedAt: 2,
    turns: [{ id: 'last', items: [], itemsView: 'summary' }] }, [], settings, 'older-page');
  expect(state.turnHistory.history.isComplete).toBe(false);
  expect(state.turnHistory.history.islands[0].olderBoundary).toMatchObject({ status: 'available', handle: { cursor: 'older-page', oldestLoadedTurnId: 'last' } });
  expect(desktopTurns(state)[0].itemsPagination.hasLoadedOldest).toBe(false);
});
it('rejects incomplete native settings rather than emitting null collaboration or invented permissions', () => {
  expect(() => desktopState({ cwd: '/work' }, [], { ...settings, collaborationMode: null } as any)).toThrow('effective settings');
  expect(nativeSettings({ ...settings, sandboxPolicy: null })).toBeUndefined();
});
it('preserves a nominal 5 MiB image in history and both native Desktop input representations', () => {
  const content = Buffer.alloc(5 * 1024 * 1024).toString('base64');
  const turn = { id: 'image-turn', items: [{ id: 'u', type: 'userMessage', content: [{ type: 'image', url: `data:image/png;base64,${content}` }] }] };
  const state = desktopState({ id: 'thread', cwd: '/work', turns: [turn] }, [], settings);
  expect(Buffer.byteLength(JSON.stringify(state))).toBeGreaterThan(8 * 1024 * 1024);
  const projected = desktopTurns(state)[0];
  expect(projected.params.input[0].url.length).toBe(projected.items[0].content[0].url.length);
  expect(codexMessages([turn])[0].attachments?.[0].content?.length).toBe(content.length);
});
it('rejects an oversized final projection without trimming its original input', () => {
  const input = [{ type: 'text', text: 'x'.repeat(8 * 1024 * 1024) }];
  expect(() => desktopState({ id: 'thread', cwd: '/work', turns: [{ id: 't', items: [{ id: 'u', type: 'userMessage', content: input }] }] }, [], settings)).toThrow('synchronization limit');
  expect(input[0].text.length).toBe(8 * 1024 * 1024);
});
