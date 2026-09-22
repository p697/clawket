import type { AgentAdapter, SessionHistory } from '@clawket/agent-protocol';
import { formatConversationExport, loadConversationExport } from './conversation-export';
const page = (patch: Partial<SessionHistory> = {}): SessionHistory => ({ key: 'main', sessionId: 'session-1', messages: [{ id: '2', role: 'assistant', text: 'answer', timestampMs: 2000 }], hasActiveRun: false, ...patch });
const adapter = (loadSession: jest.Mock) => ({ loadSession } as unknown as AgentAdapter);
const capture = (load: jest.Mock, signal = new AbortController().signal) => loadConversationExport(adapter(load), 'main', 'Example', signal);

describe('complete conversation export', () => {
  it('reads every page, removes overlapping identities and excludes system/tool data and attachment contents', async () => {
    const first = page({ nextCursor: 'older' });
    const earlier = page({ messages: [{ id: '1', role: 'user', text: 'question', timestampMs: 1000, attachments: [{ type: 'file', mimeType: 'text/plain', name: 'notes.txt', uri: 'private-device-path', content: 'private-base64' }] }, ...first.messages, { id: 'system', role: 'system', text: 'hidden' }] });
    const load = jest.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(earlier).mockResolvedValueOnce(first);
    const result = await capture(load);
    expect(result.messages.map(message => message.text)).toEqual(['question', 'answer']);
    expect(result.messages[0].attachments).toEqual(['notes.txt']);
    expect(JSON.stringify(result)).not.toMatch(/private|hidden/);
    expect(load.mock.calls[1]).toEqual(['main', { limit: 100, cursor: 'older' }]);
  });
  it.each([
    ['running', page({ hasActiveRun: true }), 'export_running'],
    ['wrong scope', page({ key: 'other' }), 'export_changed'],
    ['too large', page({ messages: [{ id: '1', role: 'user', text: 'x'.repeat(2_000_001) }] }), 'export_too_large'],
  ])('rejects %s without producing a partial file', async (_, snapshot, reason) => {
    await expect(capture(jest.fn().mockResolvedValue(snapshot))).rejects.toThrow(reason);
  });
  it('rejects repeated cursors and changed or reset conversations', async () => {
    await expect(capture(jest.fn().mockResolvedValue(page({ nextCursor: 'loop' })))).rejects.toThrow('export_changed');
    const load = jest.fn().mockResolvedValueOnce(page()).mockResolvedValueOnce(page({ sessionId: 'reset' }));
    await expect(capture(load)).rejects.toThrow('export_changed');
    const changed = jest.fn().mockResolvedValueOnce(page()).mockResolvedValueOnce(page({ messages: [] }));
    await expect(capture(changed)).rejects.toThrow('export_changed');
  });
  it('discards a late page after cancellation', async () => {
    const controller = new AbortController();
    let finish!: (value: SessionHistory) => void;
    const load = jest.fn().mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const pending = capture(load, controller.signal);
    controller.abort(); finish(page());
    await expect(pending).rejects.toThrow('export_cancelled');
    expect(load).toHaveBeenCalledTimes(1);
  });
  it('preserves backend page order when clocks are missing or move backwards', async () => {
    const first = page({ messages: [{ id: '3', role: 'assistant', text: 'Final', timestampMs: 10 }], nextCursor: 'older' });
    const earlier = page({ messages: [{ id: '1', role: 'user', text: 'Request', timestampMs: 100 }, { id: '2', role: 'assistant', text: 'Progress' }] });
    const load = jest.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(earlier).mockResolvedValueOnce(first);
    expect((await capture(load)).messages.map(message => message.text)).toEqual(['Request', 'Progress', 'Final']);
  });
  it('preserves message Markdown and Unicode in both portable formats', () => {
    const value = { title: 'Example\nheading', messages: [{ role: 'assistant' as const, text: '**你好**\n\n```js\n  x()\n```', timestampMs: 1000, attachments: ['notes.txt'] }] };
    const md = formatConversationExport(value, 'markdown', { user: '用户', assistant: '助手' });
    expect(md).toContain('# Example heading\n');
    expect(md).toContain(value.messages[0].text);
    expect(JSON.parse(formatConversationExport(value, 'json', { user: 'User', assistant: 'Assistant' }))).toMatchObject({ version: 1, ...value });
  });
});
