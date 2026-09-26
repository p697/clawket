import { once } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import type { Query, SDKMessage, SDKUserMessage, query } from '@anthropic-ai/claude-agent-sdk';
import type { SessionUpdate } from '@clawket/agent-protocol';
import { ClaudeSession } from './session.js';

function fixture() {
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
    setModel: vi.fn().mockResolvedValue(undefined),
    interrupt: vi.fn().mockResolvedValue(undefined),
    close: vi.fn(() => { closed = true; next?.({ value: undefined, done: true }); next = undefined; }),
  };
  const factory = vi.fn((args: Parameters<typeof query>[0]) => {
    input = (args.prompt as AsyncIterable<SDKUserMessage>)[Symbol.asyncIterator]();
    return iterator as unknown as Query;
  });
  const session = new ClaudeSession({ key: 'owned', cwd: '/qa-project', executable: '/native/claude' }, factory);
  const events: SessionUpdate[] = [];
  session.on('update', update => events.push(update));
  return { session, factory, iterator, events, push, takeInput: () => input.next() };
}

describe('Claude owned streaming session', () => {
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
