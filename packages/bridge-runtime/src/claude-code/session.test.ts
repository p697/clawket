import { once } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import type { Query, SDKMessage, SDKUserMessage, query } from '@anthropic-ai/claude-agent-sdk';
import type { SessionUpdate } from '@clawket/agent-protocol';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { ClaudeSession, macProtectedFolder } from './session.js';

function fixture(cwd = '/qa-project') {
  let input!: AsyncIterator<SDKUserMessage>;
  let next: ((value: IteratorResult<SDKMessage>) => void) | undefined;
  let closed = false;
  const queue: SDKMessage[] = [];
  const push = (frame: Record<string, unknown>) => {
    const message = frame as unknown as SDKMessage;
    if (next) { const resolve = next; next = undefined; resolve({ value: message, done: false }); }
    else queue.push(message);
  };
  const iterator = {
    [Symbol.asyncIterator]() { return this; },
    async next(): Promise<IteratorResult<SDKMessage>> {
      if (queue.length) return { value: queue.shift()!, done: false };
      if (closed) return { value: undefined, done: true };
      return new Promise(resolve => { next = resolve; });
    },
    initializationResult: vi.fn().mockResolvedValue({}),
    supportedModels: vi.fn().mockResolvedValue([{ value: 'native-model', displayName: 'Native model', description: '' }]),
    getContextUsage: vi.fn().mockResolvedValue({ model: 'native-model' }),
    setModel: vi.fn().mockResolvedValue(undefined),
    interrupt: vi.fn().mockResolvedValue(undefined),
    close: vi.fn(() => { closed = true; next?.({ value: undefined, done: true }); next = undefined; }),
  };
  const factory = vi.fn((args: Parameters<typeof query>[0]) => {
    input = (args.prompt as AsyncIterable<SDKUserMessage>)[Symbol.asyncIterator]();
    return iterator as unknown as Query;
  });
  const session = new ClaudeSession({ key: 'owned', cwd, executable: '/native/claude' }, factory);
  const events: SessionUpdate[] = [];
  session.on('update', update => events.push(update));
  return { session, factory, iterator, events, push, takeInput: () => input.next() };
}

describe('Claude owned streaming session', () => {
  it('reads the effective model before any prompt or system init, without dispatching input', async () => {
    const { session, iterator, events } = fixture();
    await session.models();
    expect(session.currentModel).toBe('native-model');
    expect(iterator.getContextUsage).toHaveBeenCalledWith({ detail: 'summary' });
    expect(session.activeRun).toBeUndefined();
    expect(events).toEqual([]);
    await session.close();
  });

  it('does not overwrite a newer native init with a pending model snapshot', async () => {
    const { session, iterator, push } = fixture();
    let finish!: (value: { model: string }) => void;
    iterator.getContextUsage.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await session.start();
    const models = session.models(); await new Promise(resolve => setImmediate(resolve));
    push({ type: 'system', subtype: 'init', session_id: 'native', model: 'new-model' });
    await new Promise(resolve => setImmediate(resolve));
    finish({ model: 'old-model' }); await models;
    expect(session.currentModel).toBe('new-model');
    await session.close();
  });

  it('keeps native selection ahead of an older pending model read', async () => {
    const { session, iterator } = fixture();
    let finish!: (value: { model: string }) => void;
    iterator.getContextUsage.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await session.start();
    const read = session.models(); await new Promise(resolve => setImmediate(resolve));
    await session.setModel('native-model');
    finish({ model: 'old-model' }); await read;
    expect(session.currentModel).toBe('native-model');
    await session.close();
  });

  it.each([null, '', '<synthetic>', 42])('never invents a model from an invalid native snapshot (%s)', async model => {
    const { session, iterator } = fixture();
    iterator.getContextUsage.mockResolvedValueOnce({ model } as any);
    expect(await session.models()).toHaveLength(1);
    expect(session.currentModel).toBeUndefined();
    await session.close();
  });

  it('bounds an unsupported or stalled model read without retiring a usable owned process', async () => {
    vi.useFakeTimers();
    const { session, iterator } = fixture();
    try {
      iterator.getContextUsage.mockImplementationOnce(() => new Promise(() => {}));
      const read = session.models(); await vi.advanceTimersByTimeAsync(10_000);
      expect(await read).toHaveLength(1);
      expect(iterator.close).not.toHaveBeenCalled();
      iterator.getContextUsage.mockRejectedValueOnce(new Error('native private error'));
      expect(await session.models()).toHaveLength(1);
    } finally { await session.close(); vi.useRealTimers(); }
  });

  it('uses installed CLI, native settings and ordinary permissions, preserving streamed whitespace', async () => {
    const { session, factory, events, push, takeInput } = fixture();
    await session.start();
    expect(factory.mock.calls[0][0].options).toMatchObject({ pathToClaudeCodeExecutable: '/native/claude',
      settingSources: ['user', 'project', 'local'], permissionMode: 'default', supportedDialogKinds: [] });
    session.send('00000000-0000-4000-8000-000000000001', { text: 'Hello', idempotencyKey: 'send-1' });
    const input = (await takeInput()).value!;
    expect(input.message.content).toEqual([{ type: 'text', text: 'Hello' }]);
    push({ type: 'stream_event', parent_tool_use_id: null, event: { type: 'content_block_delta', delta: { type: 'text_delta', text: ' a' } } });
    push({ type: 'stream_event', parent_tool_use_id: null, event: { type: 'content_block_delta', delta: { type: 'text_delta', text: '\n b ' } } });
    const settled = once(session, 'settled');
    push({ type: 'result', subtype: 'success', is_error: false, result: ' a\n b ', user_message_uuid: input.uuid });
    await settled;
    expect(events.at(-1)).toMatchObject({ type: 'run_finished', stopReason: 'end_turn', message: { content: ' a\n b ' } });
    expect(session.activeRun).toBeUndefined();
    // A second turn uses the same stream and process.
    session.send('00000000-0000-4000-8000-000000000002', { text: 'Again', idempotencyKey: 'send-2' });
    expect((await takeInput()).value?.message.content).toEqual([{ type: 'text', text: 'Again' }]);
    expect(factory).toHaveBeenCalledTimes(1);
    await session.close();
  });

  it('does not equate an interruption receipt with native completion', async () => {
    const { session, events, push, takeInput } = fixture();
    await session.start();
    session.send('00000000-0000-4000-8000-000000000003', { text: 'Work', idempotencyKey: 'once' }); await takeInput();
    await expect(session.interrupt('00000000-0000-4000-8000-000000000004')).rejects.toThrow('no longer active');
    await session.interrupt('00000000-0000-4000-8000-000000000003');
    expect(session.activeRun?.runId).toBe('00000000-0000-4000-8000-000000000003');
    expect(events.some(event => event.type === 'run_finished')).toBe(false);
    const settled = once(session, 'settled');
    push({ type: 'result', subtype: 'success', is_error: false, result: '', terminal_reason: 'aborted_tools' });
    await settled;
    expect(events.at(-1)).toMatchObject({ type: 'run_finished', stopReason: 'cancelled' });
    await session.close();
  });

  it('rejects parallel sends and does not finish a run for a different echoed message', async () => {
    const { session, push, takeInput } = fixture();
    await session.start();
    session.send('00000000-0000-4000-8000-000000000003', { text: 'Work', idempotencyKey: 'once' }); await takeInput();
    expect(() => session.send('00000000-0000-4000-8000-000000000004', { text: 'Other', idempotencyKey: '00000000-0000-4000-8000-000000000004' })).toThrow('still working');
    push({ type: 'result', subtype: 'success', is_error: false, result: 'stale', user_message_uuid: 'other-send' });
    await new Promise(resolve => setImmediate(resolve));
    expect(session.activeRun?.runId).toBe('00000000-0000-4000-8000-000000000003');
    await session.close();
  });

  describe('a reply that has ended while the process is still closing the turn', () => {
    const delta = (text: string) => ({ type: 'stream_event', parent_tool_use_id: null, event: { type: 'content_block_delta', delta: { type: 'text_delta', text } } });
    const ended = (stop_reason = 'end_turn', parent: string | null = null) => ({ type: 'stream_event', parent_tool_use_id: parent, event: { type: 'message_delta', delta: { stop_reason } } });
    const tick = () => new Promise(resolve => setImmediate(resolve));
    async function replying() {
      const subject = fixture(); const { session, push, takeInput } = subject;
      const marks: string[] = [];
      session.on('replied', () => marks.push('replied')); session.on('settled', () => marks.push('settled'));
      await session.start();
      session.send('00000000-0000-4000-8000-000000000011', { text: 'Hello', idempotencyKey: 'a' });
      const input = (await takeInput()).value!;
      push(delta('Hi there')); push(ended()); await tick();
      return { ...subject, marks, input };
    }
    it('ends the run at the last message and settles when the native result arrives', async () => {
      const { session, events, marks, push, input } = await replying();
      expect(events.at(-1)).toMatchObject({ type: 'run_finished', runId: '00000000-0000-4000-8000-000000000011', stopReason: 'end_turn', message: { content: 'Hi there' } });
      expect(session.activeRun).toBeUndefined(); expect(session.settling).toBe(true); expect(marks).toEqual(['replied']);
      push({ type: 'system', subtype: 'post_turn_summary' });
      push({ type: 'result', subtype: 'success', is_error: false, result: 'Hi there', user_message_uuid: input.uuid }); await tick();
      expect(session.settling).toBe(false); expect(marks).toEqual(['replied', 'settled']);
      expect(events.filter(event => event.type === 'run_finished')).toHaveLength(1);
      await session.close();
    });
    it('accepts the next message while closing; the earlier result neither ends the new run nor settles the process', async () => {
      const { session, events, marks, push, input, takeInput } = await replying();
      session.send('00000000-0000-4000-8000-000000000012', { text: 'Again', idempotencyKey: 'b' });
      const second = (await takeInput()).value!;
      push({ type: 'result', subtype: 'success', is_error: false, result: 'Hi there', user_message_uuid: input.uuid }); await tick();
      expect(session.activeRun?.runId).toBe('00000000-0000-4000-8000-000000000012'); expect(session.settling).toBe(false); expect(marks).toEqual(['replied']);
      push(delta('Second')); push(ended()); await tick();
      push({ type: 'result', subtype: 'success', is_error: false, result: 'Second', user_message_uuid: second.uuid }); await tick();
      expect(marks).toEqual(['replied', 'replied', 'settled']);
      expect(events.filter(event => event.type === 'run_finished').map(event => (event as any).message.content)).toEqual(['Hi there', 'Second']);
      await session.close();
    });
    it('gives a result without an identity to the turn that is closing', async () => {
      const { session, marks, push, takeInput } = await replying();
      session.send('00000000-0000-4000-8000-000000000012', { text: 'Again', idempotencyKey: 'b' }); await takeInput();
      push({ type: 'result', subtype: 'success', is_error: false, result: 'Hi there' }); await tick();
      expect(session.activeRun?.runId).toBe('00000000-0000-4000-8000-000000000012'); expect(session.settling).toBe(false);
      push({ type: 'result', subtype: 'success', is_error: false, result: 'late' }); await tick();
      expect(session.activeRun).toBeUndefined(); expect(marks).toEqual(['replied', 'replied', 'settled']);
      await session.close();
    });
    it('shows work that continues after the reply as a run of its own', async () => {
      const { session, events, marks, push, input } = await replying();
      push({ type: 'stream_event', parent_tool_use_id: null, event: { type: 'message_start' } }); await tick();
      const started = events.at(-1) as { type: string; runId: string };
      expect(started.type).toBe('run_started'); expect(started.runId).not.toBe('00000000-0000-4000-8000-000000000011');
      expect(session.activeRun?.runId).toBe(started.runId); expect(session.settling).toBe(false);
      push(delta('More')); push({ type: 'result', subtype: 'success', is_error: false, result: 'More', user_message_uuid: input.uuid }); await tick();
      expect(events.at(-1)).toMatchObject({ type: 'run_finished', runId: started.runId, message: { content: 'More' } });
      expect(marks).toEqual(['replied', 'replied', 'settled']);
      await session.close();
    });
    it('stops waiting for a result that never arrives', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      try {
        const { session, marks } = await replying();
        await vi.advanceTimersByTimeAsync(119_000); expect(session.settling).toBe(true);
        await vi.advanceTimersByTimeAsync(2_000); expect(session.settling).toBe(false); expect(marks).toEqual(['replied', 'settled']);
        await session.close();
      } finally { vi.useRealTimers(); }
    });
    it.each([
      ['a tool call follows', [delta('Working'), ended('tool_use')]],
      ['the message belongs to a subagent', [delta('Working'), ended('end_turn', 'tool-1')]],
      ['nothing was written', [ended()]],
    ])('keeps the run when %s', async (_label, frames) => {
      const { session, events, push, takeInput } = fixture();
      await session.start();
      session.send('00000000-0000-4000-8000-000000000013', { text: 'Work', idempotencyKey: 'c' }); await takeInput();
      for (const frame of frames) push(frame); await tick();
      expect(session.activeRun?.runId).toBe('00000000-0000-4000-8000-000000000013'); expect(session.settling).toBe(false);
      expect(events.some(event => event.type === 'run_finished')).toBe(false);
      await session.close();
    });
    it('waits for the native result once a stop was requested', async () => {
      const { session, events, push, takeInput } = fixture();
      await session.start();
      session.send('00000000-0000-4000-8000-000000000014', { text: 'Work', idempotencyKey: 'd' }); await takeInput();
      push(delta('Partial')); await tick(); await session.interrupt('00000000-0000-4000-8000-000000000014');
      push(ended()); await tick();
      expect(session.activeRun).toBeDefined(); expect(events.some(event => event.type === 'run_finished')).toBe(false);
      await session.close();
    });
  });

  it('repeats the whole reply so far at intervals, so a phone that missed deltas catches up', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const { session, events, push, takeInput } = fixture();
      const chunk = (text: string) => push({ type: 'stream_event', parent_tool_use_id: null, event: { type: 'content_block_delta', delta: { type: 'text_delta', text } } });
      const tick = () => new Promise(resolve => setImmediate(resolve));
      await session.start();
      session.send('00000000-0000-4000-8000-000000000021', { text: 'Hello', idempotencyKey: 'k' }); await takeInput();
      chunk('One'); chunk(' two'); await tick();
      vi.advanceTimersByTime(1_600); chunk(' three'); chunk(' four'); await tick();
      vi.advanceTimersByTime(1_600); chunk('x'.repeat(64_000)); chunk(' end'); await tick();
      expect(events.filter(event => event.type === 'agent_message_chunk').map(event => [(event as any).textMode, (event as any).text.length > 40 ? 'long' : (event as any).text])).toEqual([
        ['snapshot', 'One'], ['delta', ' two'], ['snapshot', 'One two three'], ['delta', ' four'], ['delta', 'long'], ['delta', ' end'],
      ]);
      await session.close();
    } finally { vi.useRealTimers(); }
  });

  it('rejects unsupported attachment data before creating a run', async () => {
    const { session, events } = fixture();
    await session.start();
    expect(() => session.send('00000000-0000-4000-8000-000000000003', { text: 'Read', idempotencyKey: 'once',
      attachments: [{ type: 'file', mimeType: 'text/plain', content: 'secret' }] })).toThrow('Unsupported');
    expect(session.activeRun).toBeUndefined();
    expect(events).toHaveLength(0);
    await session.close();
  });
});

describe('Claude initialization in a macOS-protected folder', () => {
  it('recognizes Documents, Desktop and Downloads on macOS only', () => {
    expect(macProtectedFolder('/Users/qa/Documents/Clawket/Chats', '/Users/qa', 'darwin')).toBe(true);
    expect(macProtectedFolder('/Users/qa/Desktop', '/Users/qa', 'darwin')).toBe(true);
    expect(macProtectedFolder('/Users/qa/Downloads/x', '/Users/qa', 'darwin')).toBe(true);
    expect(macProtectedFolder('/Users/qa/DocumentsOther/x', '/Users/qa', 'darwin')).toBe(false);
    expect(macProtectedFolder('/Users/qa/code/app', '/Users/qa', 'darwin')).toBe(false);
    expect(macProtectedFolder('/Users/qa/Documents/x', '/Users/qa', 'linux')).toBe(false);
    expect(macProtectedFolder('C:\\Users\\qa\\Documents', 'C:\\Users\\qa', 'win32')).toBe(false);
  });
  it.each([
    [join(homedir(), 'Documents', 'Clawket', 'Chats'), process.platform === 'darwin' ? 'allow it on the computer' : 'could not initialize'],
    ['/qa-project', 'could not initialize'],
  ])('names the folder prompt only where macOS can be asking (%s)', async (cwd, expected) => {
    const { session, iterator } = fixture(cwd);
    iterator.initializationResult.mockRejectedValueOnce(new Error('aborted'));
    await expect(session.start()).rejects.toThrow(expected);
    expect(iterator.close).toHaveBeenCalled();
  });
});
