import type { UiMessage } from '../types/chat';
import { getTailEntranceMessageIds } from './threadMessageEntrance';

const user = (id: string, text = 'hello'): UiMessage => ({ id, role: 'user', text });
const assistant = (id: string, text: string, streaming = false): UiMessage => ({ id, role: 'assistant', text, streaming });

describe('getTailEntranceMessageIds', () => {
  it('never animates an initial load or an emptied list', () => {
    expect(getTailEntranceMessageIds([], [user('u1')])).toEqual([]);
    expect(getTailEntranceMessageIds([user('u1')], [])).toEqual([]);
  });

  it('animates a freshly sent turn and the reply placeholder that follows it', () => {
    const previous = [assistant('a0', 'Earlier')];
    const next = [assistant('streaming', '', true), user('usr_2'), ...previous];
    expect(getTailEntranceMessageIds(previous, next)).toEqual(['streaming', 'usr_2']);
  });

  it('ignores rows paged in above the reader', () => {
    const previous = [assistant('a1', 'Reply'), user('u1')];
    const next = [...previous, assistant('a0', 'Older'), user('u0')];
    expect(getTailEntranceMessageIds(previous, next)).toEqual([]);
  });

  it('suppresses id swaps whose content did not change', () => {
    const previous = [user('usr_1', 'same text')];
    const next = [user('server-1', 'same text')];
    expect(getTailEntranceMessageIds(previous, next)).toEqual([]);
  });

  it('suppresses a streaming reply that settles under a final id with different text', () => {
    const previous = [assistant('streaming', 'Partial re', true), user('u1')];
    const next = [assistant('final_run', 'Partial reply.'), user('u1')];
    expect(getTailEntranceMessageIds(previous, next)).toEqual([]);
  });

  it('lets a whole reply enter when it replaces the empty placeholder', () => {
    const previous = [assistant('streaming', '', true), user('u1')];
    const next = [assistant('final_run', 'Complete reply.'), user('u1')];
    expect(getTailEntranceMessageIds(previous, next)).toEqual(['final_run']);
  });

  it('keeps animating a new reply when the settled one is still present', () => {
    const previous = [assistant('final_run', 'Done'), user('u1')];
    const next = [assistant('streaming', '', true), user('u2'), ...previous];
    expect(getTailEntranceMessageIds(previous, next)).toEqual(['streaming', 'u2']);
  });

  it('treats a burst of new tail rows as a reconciliation', () => {
    const previous = [user('u0')];
    const next = [user('u4'), user('u3'), user('u2'), user('u1'), ...previous];
    expect(getTailEntranceMessageIds(previous, next)).toEqual([]);
    expect(getTailEntranceMessageIds(previous, next.slice(1))).toEqual(['u3', 'u2', 'u1']);
  });

  it('does not match attachment messages by text alone', () => {
    const previous = [user('usr_1', 'photo')];
    const next = [{ ...user('server-1', 'photo'), imageUris: ['file://a.jpg'] }];
    expect(getTailEntranceMessageIds(previous, next)).toEqual(['server-1']);
  });
});
