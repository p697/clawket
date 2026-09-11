import type { UiMessage } from '../types/chat';
import { isMainConversation, projectSessionPreview } from './session-preview';

const body = (id: string, role: UiMessage['role'] = 'assistant'): UiMessage => ({ id, role, text: id });

describe('session preview policy', () => {
  it.each([
    ['agent:lucy:main', undefined, undefined, true],
    ['main', undefined, undefined, true],
    ['hermes-main-id', 'hermes-main-id', undefined, true],
    ['sprite-default', undefined, 'main', true],
    ['agent:lucy:slack:channel:one', undefined, 'channel', false],
    ['agent:lucy:cron:job', undefined, 'cron', false],
    ['hermes-session', 'hermes-main', 'direct', false],
    ['agent:lucy:main', undefined, 'direct', false],
  ])('classifies %s independently of backend', (sessionKey, mainSessionKey, kind, expected) => {
    expect(isMainConversation({ sessionKey, mainSessionKey, kind })).toBe(expected);
  });

  it('exposes two latest bodies and pending approvals, never tool args or older content', () => {
    const approval: UiMessage = { ...body('approval', 'system'), text: '', approval: {
      id: 'a', command: 'pwd', expiresAtMs: 100, status: 'pending',
    } };
    const tool = { ...body('tool', 'tool'), toolArgs: 'secret' };
    const result = projectSessionPreview('one', [tool, body('reply'), approval, body('question', 'user'), body('old')], null, false);
    expect(result.messages.map((m) => m.id)).toEqual(['approval', 'reply', 'question']);
    expect(result.hasHiddenHistory).toBe(true);
  });

  it('does not invent locked history when all two messages fit', () => {
    expect(projectSessionPreview('one', [body('reply'), body('question')], null, false).hasHiddenHistory).toBe(false);
    expect(projectSessionPreview('one', [body('reply')], null, true).hasHiddenHistory).toBe(true);
  });

  it('preserves the reading window during streaming, new messages and reconciliation', () => {
    const initial = projectSessionPreview('one', [body('reply'), body('question')], null, false);
    const next = projectSessionPreview('one', [body('new'), { ...body('reply'), text: 'updated' }, body('question')], initial.snapshot, false);
    expect(next.messages.map((m) => m.id)).toEqual(['reply', 'question']);
    expect(next.messages[0].text).toBe('updated');
    expect(projectSessionPreview('one', [], next.snapshot, true).messages).toEqual(next.messages);
    expect(projectSessionPreview('two', [body('other')], next.snapshot, false).messages).toEqual([body('other')]);
  });

  it('starts previewing after an initially empty session receives its first reply', () => {
    const empty = projectSessionPreview('one', [], null, false);
    expect(projectSessionPreview('one', [body('hello')], empty.snapshot, false).messages).toEqual([body('hello')]);
  });
});
