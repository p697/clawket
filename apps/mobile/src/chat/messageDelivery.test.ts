import type { UiMessage } from '../types/chat';
import { resolveUserMessageStatus, resolveUserMessageStatuses } from './messageDelivery';

const user = (id: string, extra: Partial<UiMessage> = {}): UiMessage => ({ id, role: 'user', text: `text ${id}`, ...extra });
const assistant = (id: string, text = 'reply'): UiMessage => ({ id, role: 'assistant', text });
const tool = (id: string): UiMessage => ({ id, role: 'tool', text: '', toolName: 'exec', toolStatus: 'running' });

describe('resolveUserMessageStatus', () => {
  it('reports sending while the prompt is unconfirmed', () => {
    const messages = [user('usr_1')];
    expect(resolveUserMessageStatus({ messages, index: 0, unconfirmedIds: new Set(['usr_1']) })).toBe('sending');
  });

  it('reports sent once the backend accepted the prompt and nothing answered yet', () => {
    const messages = [user('usr_1')];
    expect(resolveUserMessageStatus({ messages, index: 0, unconfirmedIds: new Set() })).toBe('sent');
  });

  it('reports delivered for the newest turn once its run is acknowledged', () => {
    const messages = [user('usr_1'), assistant('a0'), user('usr_0')];
    expect(resolveUserMessageStatus({ messages, index: 0, runAcknowledged: true })).toBe('delivered');
    // An older turn is not the current run; it keeps its own evidence.
    expect(resolveUserMessageStatus({ messages, index: 2, runAcknowledged: true })).toBe('delivered');
  });

  it('treats a later reply, streaming text or tool call as proof of delivery', () => {
    expect(resolveUserMessageStatus({ messages: [assistant('a1'), user('u1')], index: 1 })).toBe('delivered');
    expect(resolveUserMessageStatus({ messages: [{ ...assistant('streaming', 'Partial'), streaming: true }, user('u1')], index: 1 })).toBe('delivered');
    expect(resolveUserMessageStatus({ messages: [tool('t1'), user('u1')], index: 1 })).toBe('delivered');
  });

  it('ignores an empty streaming placeholder and activity that belongs to a later turn', () => {
    expect(resolveUserMessageStatus({ messages: [{ ...assistant('streaming', ''), streaming: true }, user('u1')], index: 1 })).toBe('sent');
    // u1 was never answered; the reply after u2 must not count for it.
    expect(resolveUserMessageStatus({ messages: [assistant('a2'), user('u2'), user('u1')], index: 2 })).toBe('sent');
  });

  it('keeps local delivery distinct from backend evidence and excludes other roles', () => {
    const messages = [user('q1', { delivery: 'queued' }), assistant('a1'), user('u1')];
    expect(resolveUserMessageStatus({ messages, index: 0, runAcknowledged: true })).toBe('queued');
    expect(resolveUserMessageStatus({ messages, index: 1 })).toBeNull();
    expect(resolveUserMessageStatus({ messages, index: 3 })).toBeNull();
    // A queued bubble is not a settled turn, so it does not shadow the sent one.
    expect(resolveUserMessageStatus({ messages, index: 2 })).toBe('delivered');
  });

  it('builds the status map for every settled user message', () => {
    const messages = [user('usr_3'), assistant('a2'), user('u2'), user('q1', { delivery: 'held' })];
    const statuses = resolveUserMessageStatuses({ messages, unconfirmedIds: new Set(['usr_3']) });
    expect([...statuses.entries()]).toEqual([['usr_3', 'sending'], ['u2', 'delivered'], ['q1', 'held']]);
  });
});
