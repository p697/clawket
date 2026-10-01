import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DesktopIpc } from './desktop-ipc.js';
import { CodexSessionActivity } from './session-activity.js';
import { sessionActivityKeys } from '../session-activity.js';

class Desktop extends EventEmitter {
  ready = true;
  observe = vi.fn(() => true);
  unobserve = vi.fn();
  snapshot(id: string, state: unknown, fresh = true) { this.emit('snapshot', id, { state, fresh, source: 'owner' }); }
}
const readers: CodexSessionActivity[] = [];
afterEach(() => { readers.splice(0).forEach(reader => reader.stop()); vi.useRealTimers(); });
function fixture() {
  vi.useFakeTimers(); vi.setSystemTime(0);
  const desktop = new Desktop(), emit = vi.fn();
  const reader = new CodexSessionActivity(desktop as unknown as DesktopIpc, emit); readers.push(reader);
  const read = () => reader.read([{ key: 'native:visible', threadId: 'visible' }]);
  return { desktop, emit, reader, read };
}
describe('bounded read-only desktop activity', () => {
  it('projects running, input, approval and completion without exposing content', () => {
    const { desktop, emit, read } = fixture();
    expect(read()).toEqual([{ key: 'native:visible', state: 'unknown' }]);
    desktop.snapshot('other', { turns: [{ status: 'inProgress' }] }); expect(emit).not.toHaveBeenCalled();
    desktop.snapshot('visible', { turns: [{ status: 'inProgress', items: [{ text: 'private reply' }] }], requests: [] });
    expect(read()).toEqual([{ key: 'native:visible', state: 'running', attention: null }]);
    desktop.snapshot('visible', { turns: [{ status: 'inProgress' }], requests: [{ method: 'item/tool/requestUserInput' }] });
    expect(emit).toHaveBeenLastCalledWith({ key: 'native:visible', state: 'waiting', attention: 'input' });
    desktop.snapshot('visible', { turns: [{ status: 'inProgress' }], requests: [{ method: 'item/commandExecution/requestApproval' }] });
    expect(emit).toHaveBeenLastCalledWith({ key: 'native:visible', state: 'waiting', attention: 'approval' });
    desktop.snapshot('visible', { turns: [{ status: 'completed' }], requests: [{ method: 'item/tool/requestUserInput', completed: true }] });
    expect(emit).toHaveBeenLastCalledWith({ key: 'native:visible', state: 'idle', attention: null });
    expect(JSON.stringify(emit.mock.calls)).not.toContain('private reply');
  });
  it('reads canonical turns, clears on unsupported/offline, and never invents idle from invalid state', () => {
    const { desktop, emit, read } = fixture(); read();
    desktop.snapshot('visible', { turnHistory: { kind: 'canonical', history: { entitiesByKey: { one: { status: 'inProgress' } }, islands: [{ entries: ['one'] }] } } });
    expect(read()[0].state).toBe('running');
    desktop.emit('offline'); expect(read()[0].state).toBe('unknown');
    desktop.snapshot('visible', { turns: [{ status: 'futureState' }] }); expect(read()[0].state).toBe('unknown');
    for (const state of [{}, { turns: [null] }, { turns: [], requests: [null] }, { turnHistory: { kind: 'canonical' } }]) {
      expect(() => desktop.snapshot('visible', state)).not.toThrow(); expect(read()[0].state).toBe('unknown');
    }
    desktop.snapshot('visible', { turns: [{ status: 'inProgress' }] }, false); expect(read()[0].state).toBe('unknown');
    desktop.emit('unsupported', 'visible'); expect(emit).toHaveBeenLastCalledWith({ key: 'native:visible', state: 'unknown' });
  });
  it('bounds observation, expires hidden rows, and expires evidence even while subscriptions renew', () => {
    const { desktop, read } = fixture(); desktop.observe.mockReturnValueOnce(false);
    expect(read()[0].state).toBe('unknown'); read(); desktop.snapshot('visible', { turns: [{ status: 'inProgress' }] });
    for (let i = 0; i < 3; i++) { vi.advanceTimersByTime(15_000); read(); }
    expect(read()[0].state).toBe('unknown'); // An absent owner cannot keep an old running arc alive.
    vi.advanceTimersByTime(45_000); expect(desktop.unobserve).toHaveBeenCalledWith('visible');
    const calls = desktop.observe.mock.calls.length;
    vi.advanceTimersByTime(60_000); expect(desktop.observe).toHaveBeenCalledTimes(calls);
  });
  it('uses local activity without native observation and cleans up every listener', () => {
    const { desktop, reader, read } = fixture();
    expect(reader.read([{ key: 'local', local: { key: 'local', state: 'running' } }, { key: 'missing' }]))
      .toEqual([{ key: 'local', state: 'running' }, { key: 'missing', state: 'unknown' }]);
    expect(desktop.observe).not.toHaveBeenCalled(); read(); reader.stop();
    expect(desktop.unobserve).toHaveBeenCalledWith('visible');
    for (const name of ['snapshot', 'offline', 'unsupported']) expect(desktop.listenerCount(name)).toBe(0);
  });
});
it('rejects malformed activity windows before dispatch', () => {
  expect(sessionActivityKeys([])).toEqual([]);
  expect(sessionActivityKeys(['one', 'two'])).toEqual(['one', 'two']);
  for (const value of [undefined, {}, [''], [1], ['a', 'a'], ['x'.repeat(201)], Array.from({ length: 33 }, (_, i) => String(i))]) {
    expect(() => sessionActivityKeys(value)).toThrow('Invalid session activity request');
  }
});

it('coalesces native text patches and releases temporary evidence when the local writer becomes authoritative', () => {
  const { desktop, emit, reader, read } = fixture(); read();
  desktop.snapshot('visible', { turns: [{ status: 'inProgress', items: [{ text: 'a' }] }] });
  desktop.snapshot('visible', { turns: [{ status: 'inProgress', items: [{ text: 'ab' }] }] });
  expect(emit).toHaveBeenCalledTimes(1);
  expect(reader.read([{ key: 'native:visible', local: { key: 'native:visible', state: 'idle' } }])[0].state).toBe('idle');
  desktop.snapshot('visible', { turns: [{ status: 'inProgress' }] }); expect(emit).toHaveBeenCalledTimes(1);
  expect(desktop.unobserve).toHaveBeenCalledWith('visible');
});


it('awaits a renewed native snapshot for the existing RPC response and cleans every pending read', async () => {
  const { desktop, reader } = fixture();
  const query = reader.query([{ key: 'native:visible', threadId: 'visible' }]);
  desktop.snapshot('visible', { turns: [{ status: 'inProgress' }] });
  expect((await query)[0].state).toBe('running');
  const absent = reader.query([{ key: 'native:absent', threadId: 'absent' }]);
  await vi.advanceTimersByTimeAsync(1_500); expect((await absent)[0].state).toBe('unknown');
  const pending = reader.query([{ key: 'native:visible', threadId: 'visible' }]); reader.stop(); await pending;
  expect(desktop.listenerCount('snapshot')).toBe(0); expect(desktop.listenerCount('offline')).toBe(0);
});
