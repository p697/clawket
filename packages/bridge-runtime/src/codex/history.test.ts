import { describe, expect, it } from 'vitest';
import { codexDesktopItemClock, codexItemClock, codexMessages, codexTool, codexToolTiming, codexTurnFailure, mergeCodexLiveItems } from './history.js';

describe('active Codex history overlay', () => {
  it('places missing cached prefixes and gaps by shared identities, retaining native-only rows and live values', () => {
    const history = Object.freeze([{ id: 'a', text: 'Old' }, { id: 'native-only' }, { id: 'c' }].map(Object.freeze));
    const live = new Map(['prompt', 'a', 'b', 'c', 'tail'].map(id => [id, Object.freeze({ id, text: 'Current' })]));
    const result = mergeCodexLiveItems([...history], live);
    expect(result.map(item => item.id)).toEqual(['prompt', 'a', 'native-only', 'b', 'c', 'tail']);
    expect(result.find(item => item.id === 'a')?.text).toBe('Current');
    expect(history[0].text).toBe('Old');
    expect([...live.keys()]).toEqual(['prompt', 'a', 'b', 'c', 'tail']);
  });
  it('preserves native order on conflicting anchors and appends only unanchored live rows', () => {
    const live = new Map(['a', 'late', 'b', 'tail'].map(id => [id, { id }]));
    expect(mergeCodexLiveItems([{ id: 'b' }, { id: 'a' }], live).map(item => item.id)).toEqual(['late', 'b', 'a', 'tail']);
    expect(mergeCodexLiveItems([{ id: 'native-only' }], live).map(item => item.id)).toEqual(['native-only', 'a', 'late', 'b', 'tail']);
    expect(mergeCodexLiveItems([], live).map(item => item.id)).toEqual([...live.keys()]);
  });
});

describe('Codex tool execution evidence', () => {
  it.each([
    [{ type: 'imageView', path: 'file:///image.png' }, 'success'],
    [{ type: 'imageView', status: 'inProgress' }, 'running'],
    [{ type: 'imageView', status: 'failed' }, 'error'],
    [{ type: 'imageView', error: { message: 'Cannot read image' } }, 'error'],
    [{ type: 'imageView', status: 'future-native-state' }, 'unknown'],
    [{ type: 'webSearch', query: 'release notes', action: { type: 'search', query: 'release notes' } }, 'success'],
    [{ type: 'webSearch', status: 'future-native-state' }, 'unknown'],
    [{ type: 'commandExecution', command: 'pwd' }, 'unknown'],
    [{ type: 'mcpToolCall', tool: 'read' }, 'unknown'],
  ])('preserves native completion, failure and missing-state boundaries for %j', (item, status) => {
    // ImageViewThreadItem is {id, path, type}; the canonical history inserts it
    // from the completed-only legacy ViewImageToolCall, not ItemStarted.
    const tool = codexTool({ id: 'tool', ...item });
    expect(tool).toMatchObject({ callId: 'tool', status, statusReported: true });
    expect(codexMessages([{ id: 'turn', status: 'completed', items: [{ id: 'tool', ...item }] }])[0]?.tool).toEqual(tool);
  });

  it.each([
    [{ query: '', action: null, results: null }, 'unknown'],
    [{ query: 'search', results: [{ title: 'Result' }] }, 'unknown'],
    [{ query: '', action: false }, 'unknown'],
    [{ query: '', action: [] }, 'unknown'],
    [{ query: '', action: 'search' }, 'unknown'],
    [{ query: 1, action: { type: 'search' } }, 'unknown'],
    [{ query: '', action: { type: 'search', query: 1 } }, 'unknown'],
    [{ query: '', action: { type: 'search', queries: 'search' } }, 'unknown'],
    [{ query: '', action: { type: 'search', queries: ['search', 1] } }, 'unknown'],
    [{ query: '', action: { type: 'search', query: null, queries: null }, results: [] }, 'success'],
    [{ query: '', action: { type: 'search', queries: ['one', 'two'] } }, 'success'],
    [{ query: '', action: { type: 'openPage', url: null }, results: null }, 'success'],
    [{ query: '', action: { type: 'openPage', url: 'https://example.com' } }, 'success'],
    [{ query: '', action: { type: 'openPage', url: 1 } }, 'unknown'],
    [{ query: '', action: { type: 'findInPage', url: null, pattern: 'text' } }, 'success'],
    [{ query: '', action: { type: 'findInPage', pattern: false } }, 'unknown'],
    [{ query: '', action: { type: 'other' } }, 'success'],
    [{ query: '', action: { type: 'future-action' }, results: [{ title: 'Result' }] }, 'unknown'],
    [{ query: '', action: { type: 'search' }, results: {} }, 'unknown'],
    [{ query: '', action: { type: 'search' }, results: 'Result' }, 'unknown'],
  ])('requires the supported native End shape, even in terminal history: %j', (fields, status) => {
    const item = { id: 'search', type: 'webSearch', ...fields };
    expect(codexTool(item)?.status).toBe(status);
    for (const turnStatus of ['inProgress', 'completed', 'interrupted']) {
      expect(codexMessages([{ id: 'turn', status: turnStatus, items: [item] }])[0]?.tool?.status).toBe(status);
    }
  });

  it.each(['inProgress', 'completed', 'failed', 'future-native-state', null])('keeps explicit native %s ahead of an otherwise valid search End', status => {
    expect(codexTool({ id: 'search', type: 'webSearch', query: '', action: { type: 'other' }, results: [{ title: 'Result' }], status })?.status)
      .toBe(status === 'inProgress' ? 'running' : status === 'completed' ? 'success' : status === 'failed' ? 'error' : 'unknown');
  });

  it.each([undefined, null, []])('does not fabricate output for optional results %j', results => {
    expect(codexTool({ id: 'search', type: 'webSearch', query: '', action: { type: 'other' }, results }))
      .toMatchObject({ status: 'success', output: '' });
  });

  it('preserves opaque nonempty search results in the bounded tool output only', () => {
    const results = [{ type: 'text_result', title: 'Result', url: 'https://example.com', future_field: { kept: true }, snippet: 'x'.repeat(40000) }];
    const item = { id: 'search', type: 'webSearch', query: 'search', action: { type: 'search', query: 'search' }, results };
    expect(codexTool(item)).toMatchObject({ status: 'success', output: JSON.stringify(results).slice(0, 32000) });
    const messages = codexMessages([{ id: 'turn', status: 'completed', items: [item, { id: 'reply', type: 'agentMessage', text: 'Native reply' }] }]);
    expect(messages[0].tool?.output).toHaveLength(32000);
    expect(messages[1]).toMatchObject({ id: 'reply', role: 'assistant', text: 'Native reply' });
  });
});

describe('Codex final reply clocks', () => {
  const startedAt = 1727996280, completedAt = startedAt + 31 * 60;
  const user = { id: 'user', type: 'userMessage', content: [{ type: 'text', text: 'Wait for my answer' }] };
  it('uses terminal completion for the final answer while retaining user, commentary, plan and tool clocks', () => {
    const messages = codexMessages([{ id: 'turn', status: 'completed', startedAt, completedAt, items: [
      user, { id: 'progress', type: 'agentMessage', phase: 'commentary', text: 'Waiting' },
      { id: 'plan', type: 'plan', text: 'Wait' }, { id: 'tool', type: 'commandExecution', status: 'completed' },
      { id: 'final', type: 'agentMessage', phase: 'final_answer', text: 'Done' },
    ] }]);
    expect(messages.map(message => [message.id, message.timestampMs])).toEqual([
      ['user', startedAt * 1000], ['progress', startedAt * 1000], ['plan', startedAt * 1000],
      ['toolcall_tool', startedAt * 1000], ['final', completedAt * 1000],
    ]);
  });
  it('keeps paragraph clocks while the confirmed final retains its completion clock', () => {
    const progressClock = (startedAt + 60) * 1000, finalStartClock = (completedAt - 10) * 1000;
    const messages = codexMessages([{ id: 'turn', status: 'completed', startedAt, completedAt,
      itemClocks: new Map([['progress', { startedAtMs: progressClock }], ['final', { startedAtMs: finalStartClock }]]), items: [
        user, { id: 'progress', type: 'agentMessage', phase: 'commentary', text: 'Still working' },
        { id: 'final', type: 'agentMessage', phase: 'final_answer', text: 'Done' },
      ] }]);
    expect(messages.map(message => [message.id, message.timestampMs])).toEqual([
      ['user', startedAt * 1000], ['progress', progressClock], ['final', completedAt * 1000],
    ]);
  });
  it('retains the known paragraph clock for a partial legacy turn without borrowing completion', () => {
    const paragraphClock = (startedAt + 60) * 1000;
    const turn = { id: 'partial', status: 'completed', startedAt, completedAt,
      itemClocks: new Map([['paragraph', { startedAtMs: paragraphClock }]]),
      items: [{ id: 'paragraph', type: 'agentMessage', text: 'Earlier progress' }] };
    expect(codexMessages([turn], { unconfirmedLegacyTurnId: 'partial' })[0].timestampMs).toBe(paragraphClock);
    expect(codexMessages([turn])[0].timestampMs).toBe(completedAt * 1000);
  });
  it.each([undefined, null])('retains native last-message compatibility for phase %j without retiming every legacy paragraph', phase => {
    const messages = codexMessages([{ status: 'completed', startedAt, completedAt, items: [
      { id: 'earlier', type: 'agentMessage', phase, text: 'Earlier paragraph' },
      { id: 'final', type: 'agentMessage', phase, text: 'Done' },
      { id: 'empty', type: 'agentMessage', phase, text: '  ' },
      { id: 'future', type: 'agentMessage', phase: 'future-phase', text: 'Unclassified' },
    ] }]);
    expect(messages.map(message => [message.id, message.timestampMs])).toEqual([
      ['earlier', startedAt * 1000], ['final', completedAt * 1000],
      ['empty', startedAt * 1000], ['future', startedAt * 1000],
    ]);
  });
  it('uses the same terminal clock for an image-only final attachment', () => {
    const image = { id: 'image', type: 'imageGeneration', status: 'completed', result: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString('base64') };
    const messages = codexMessages([{ status: 'completed', startedAt, completedAt, items: [user, image] }]);
    expect(messages.find(message => message.id === 'image:image')).toMatchObject({ role: 'assistant', timestampMs: completedAt * 1000 });
    expect(messages.find(message => message.id === 'toolcall_image')?.timestampMs).toBe(startedAt * 1000);
  });
  it('does not date a phase-less paragraph from a partial older turn as its unseen final reply', () => {
    const messages = codexMessages([{ id: 'partial', status: 'completed', startedAt, completedAt, items: [
      { id: 'old-paragraph', type: 'agentMessage', text: 'Earlier progress' },
    ] }, { id: 'confirmed', status: 'completed', startedAt, completedAt, items: [
      { id: 'old-final', type: 'agentMessage', text: 'Older final answer' },
    ] }], { unconfirmedLegacyTurnId: 'partial' });
    expect(messages.map(message => [message.id, message.timestampMs])).toEqual([
      ['old-paragraph', startedAt * 1000], ['old-final', completedAt * 1000],
    ]);
    expect(codexMessages([{ id: 'partial', status: 'completed', startedAt, completedAt, items: [
      { id: 'known-final', type: 'agentMessage', phase: 'final_answer', text: 'Done' },
    ] }], { unconfirmedLegacyTurnId: 'partial' })[0].timestampMs).toBe(completedAt * 1000);
  });
  it.each([
    { status: 'inProgress', completedAt }, { status: 'future-status', completedAt }, { completedAt },
    { status: 'completed' }, { status: 'completed', completedAt: null },
    { status: 'completed', completedAt: Infinity }, { status: 'completed', completedAt: NaN },
    { status: 'completed', completedAt: -1 }, { status: 'completed', completedAt: startedAt - 1 },
    { status: 'completed', completedAt: 1e15 }, { status: 'completed', completedAt: completedAt + 0.5 },
  ])('keeps the existing clock fallback without confirmed valid completion: %j', turn => {
    expect(codexMessages([{ startedAt, ...turn, items: [{ id: 'final', type: 'agentMessage', phase: 'final_answer', text: 'Done' }] }])[0].timestampMs)
      .toBe(startedAt * 1000);
  });
});

describe('Codex user item clocks', () => {
  const user = (id: string, clientId?: string) => ({ id, type: 'userMessage', content: [{ type: 'text', text: 'Keep waiting' }], ...(clientId ? { clientId } : {}) });

  it('keeps two same-turn guides at their native times without changing their identities or order', () => {
    const turn = Object.freeze({ id: 'original-turn', startedAt: 100,
      itemClocks: new Map([['main', { startedAtMs: 100100 }], ['guide-1', { startedAtMs: 160100 }], ['guide-2', { startedAtMs: 220100 }]]),
      items: [user('main', 'receipt-1'), { id: 'progress', type: 'agentMessage', text: 'Waiting' },
        user('guide-1'), { id: 'tool', type: 'commandExecution', command: 'sleep', status: 'inProgress' }, user('guide-2')] });
    const messages = codexMessages([turn]);
    expect(messages.map(message => [message.id, message.role, message.timestampMs])).toEqual([
      ['main', 'user', 100100], ['progress', 'assistant', 100000], ['guide-1', 'user', 160100],
      ['toolcall_tool', 'tool', 100000], ['guide-2', 'user', 220100],
    ]);
    expect(messages[0].idempotencyKey).toBe('receipt-1');
    expect(messages[2].text).toBe(messages[4].text);
    expect(messages[2].idempotencyKey).toBeUndefined();
    expect(messages[4].idempotencyKey).toBeUndefined();
  });

  it.each([undefined, null, 0, -1, NaN, Infinity, 100.5, '160100', 8.64e15 + 1])(
    'keeps the legacy turn clock when the user item clock is invalid: %s', clock => {
      const messages = codexMessages([{ startedAt: 100, itemClocks: new Map([['guide', { startedAtMs: clock }]]), items: [user('guide')] }]);
      expect(messages[0].timestampMs).toBe(100000);
    });

  it('keeps legacy history without item timing metadata unchanged', () => {
    expect(codexMessages([{ startedAt: 100, items: [user('legacy')] }])[0].timestampMs).toBe(100000);
    expect(codexMessages([{ items: [user('undated')] }])[0].timestampMs).toBeUndefined();
  });
});

describe('Codex tool step clocks', () => {
  const user = { id: 'user', type: 'userMessage', content: [{ type: 'text', text: 'Run the checks' }] };
  const command = (id: string, extra: object = {}) => ({ id, type: 'commandExecution', command: 'npm test', status: 'completed', exitCode: 0, durationMs: 376609, ...extra });

  it('dates each step by its native start and keeps the native run time after reload', () => {
    const [message] = codexMessages([{ id: 'turn', status: 'completed', startedAt: 100, completedAt: 900,
      itemClocks: new Map([['long', { startedAtMs: 466430, completedAtMs: 843040 }]]), items: [command('long')] }]);
    expect(message).toMatchObject({ id: 'toolcall_long', timestampMs: 466430,
      tool: { status: 'success', startedAtMs: 466430, finishedAtMs: 843040, durationMs: 376609 } });
  });

  it('derives a missing native run time from the settled lifecycle and never times an unsettled step', () => {
    const clocks = new Map([['search', { startedAtMs: 1000, completedAtMs: 4500 }], ['running', { startedAtMs: 2000 }], ['unknown', { startedAtMs: 3000, completedAtMs: 3500 }]]);
    const messages = codexMessages([{ id: 'turn', startedAt: 1, itemClocks: clocks, items: [
      { id: 'search', type: 'webSearch', query: 'docs', action: { type: 'other' } },
      { id: 'running', type: 'commandExecution', command: 'sleep 9', status: 'inProgress', durationMs: null },
      { id: 'unknown', type: 'mcpToolCall', tool: 'read' },
    ] }]);
    expect(messages.map(message => message.tool)).toEqual([
      expect.objectContaining({ status: 'success', startedAtMs: 1000, finishedAtMs: 4500, durationMs: 3500 }),
      expect.objectContaining({ status: 'running', startedAtMs: 2000 }),
      expect.objectContaining({ status: 'unknown', startedAtMs: 3000 }),
    ]);
    expect(messages[1].tool).not.toHaveProperty('finishedAtMs');
    expect(messages[1].tool).not.toHaveProperty('durationMs');
    expect(messages[2].tool).not.toHaveProperty('finishedAtMs');
  });

  it.each([-1, 1.5, '20', NaN, Infinity, 8.64e15 + 1])('ignores a malformed native run time %j', durationMs => {
    expect(codexToolTiming({ durationMs }, 'success', { startedAtMs: 1000, completedAtMs: 1600 })).toEqual({ startedAtMs: 1000, finishedAtMs: 1600, durationMs: 600 });
    expect(codexToolTiming({ durationMs }, 'error', { startedAtMs: 1000 })).toEqual({ startedAtMs: 1000 });
  });

  it('keeps legacy tool rows on the turn clock without inventing timing', () => {
    const [message] = codexMessages([{ id: 'turn', status: 'completed', startedAt: 100, items: [command('legacy', { durationMs: null })] }]);
    expect(message.timestampMs).toBe(100000);
    expect(message.tool).not.toHaveProperty('startedAtMs');
    expect(message.tool).not.toHaveProperty('finishedAtMs');
    expect(message.tool).not.toHaveProperty('durationMs');
  });

  it('restores start order when native history recorded a long command after later replies', () => {
    const items = [user, { id: 'before', type: 'agentMessage', phase: 'commentary', text: 'Starting the long check.' },
      { id: 'after', type: 'agentMessage', phase: 'commentary', text: 'Still waiting for it.' },
      command('long'), { id: 'final', type: 'agentMessage', phase: 'final_answer', text: 'Done.' }];
    const itemClocks = new Map([['user', { startedAtMs: 1000, completedAtMs: 1000 }], ['before', { startedAtMs: 2000, completedAtMs: 2500 }],
      ['after', { startedAtMs: 9000, completedAtMs: 9500 }], ['long', { startedAtMs: 3000, completedAtMs: 12000 }], ['final', { startedAtMs: 13000, completedAtMs: 13000 }]]);
    const messages = codexMessages([{ id: 'turn', status: 'completed', startedAt: 1, completedAt: 14, itemClocks, items }]);
    expect(messages.map(message => [message.id, message.timestampMs])).toEqual([
      ['user', 1000], ['before', 2000], ['toolcall_long', 3000], ['after', 9000], ['final', 14000],
    ]);
    expect(items.map(item => item.id)).toEqual(['user', 'before', 'after', 'long', 'final']);
  });

  it.each([
    ['a rendered item without a clock', new Map([['before', { startedAtMs: 2000 }], ['long', { startedAtMs: 1000 }]])],
    ['a reversed native pair', new Map([['before', { startedAtMs: 2000 }], ['after', { startedAtMs: 9000 }], ['long', { startedAtMs: 3000, completedAtMs: 2000 }]])],
  ])('keeps native order with %s', (_case, itemClocks) => {
    const messages = codexMessages([{ id: 'turn', startedAt: 1, itemClocks, items: [
      { id: 'before', type: 'agentMessage', text: 'Before.' }, { id: 'after', type: 'agentMessage', text: 'After.' }, command('long'),
    ] }]);
    expect(messages.map(message => message.id)).toEqual(['before', 'after', 'toolcall_long']);
  });

  it('orders by start without letting unrendered native items block it', () => {
    const messages = codexMessages([{ id: 'turn', startedAt: 1, itemClocks: new Map([['a', { startedAtMs: 5000 }], ['tool', { startedAtMs: 4000 }]]), items: [
      { id: 'a', type: 'agentMessage', text: 'Paragraph.' }, { id: 'reasoning', type: 'reasoning', summary: [] },
      { id: 'pause', type: 'sleep' }, command('tool'),
    ] }]);
    expect(messages.map(message => message.id)).toEqual(['toolcall_tool', 'a']);
  });
});

describe('Codex Desktop native item clocks', () => {
  const turn = {
    aeonAssistantMessageStartedAtMsById: { reply: 1000, broken: 'soon' },
    agentMessageCompletedAtMsById: { reply: 1800, reversed: 500 },
    commandExecutionStartedAtMsById: { exec: 2000 },
  };
  it('reads Desktop reply and command lifecycle maps', () => {
    expect(codexDesktopItemClock(turn, { id: 'reply', type: 'agentMessage' })).toEqual({ startedAtMs: 1000, completedAtMs: 1800 });
    expect(codexDesktopItemClock(turn, { id: 'exec', type: 'commandExecution', durationMs: 450 })).toEqual({ startedAtMs: 2000, completedAtMs: 2450 });
    expect(codexDesktopItemClock(turn, { id: 'exec', type: 'commandExecution', durationMs: null })).toEqual({ startedAtMs: 2000 });
  });
  it.each([
    [turn, { id: 'broken', type: 'agentMessage' }],
    [{ ...turn, aeonAssistantMessageStartedAtMsById: { reversed: 900 } }, { id: 'reversed', type: 'agentMessage' }],
    [turn, { id: 'missing', type: 'commandExecution', durationMs: 5 }],
    [turn, { id: 'exec', type: 'mcpToolCall' }],
    [turn, { id: '__proto__', type: 'commandExecution' }],
    [{ commandExecutionStartedAtMsById: [2000] }, { id: '0', type: 'commandExecution' }],
    [null, { id: 'exec', type: 'commandExecution' }],
  ])('treats malformed or absent Desktop clocks as unknown: %j %j', (desktopTurn, item) => {
    expect(codexDesktopItemClock(desktopTurn, item)).toBeUndefined();
  });
  it('validates native clock pairs once for every producer', () => {
    expect(codexItemClock(1000, 2000)).toEqual({ startedAtMs: 1000, completedAtMs: 2000 });
    expect(codexItemClock(undefined, 2000)).toEqual({ completedAtMs: 2000 });
    expect(codexItemClock(2000, 1000)).toBeUndefined();
    expect(codexItemClock(null, null)).toBeUndefined();
  });
});

describe('Codex failed turn history', () => {
  const unsupported = "The 'gpt-6.1-sol' model is not supported when using Codex with a ChatGPT account.";
  it.each([unsupported, JSON.stringify({ type: 'error', status: 400, error: { type: 'invalid_request_error', message: unsupported }, private: 'secret provider detail' })])('projects the exact unsupported-model refusal without exposing the response: %s', message => {
    const turn = { id: 'native-turn', status: 'failed', completedAt: 12, error: { codexErrorInfo: 'other', message } };
    expect(codexTurnFailure(turn)).toEqual({ id: 'codex-turn-error:native-turn', role: 'system', timestampMs: 12000,
      text: 'This model is unavailable in the current Codex runtime. Choose another model or update Codex on your computer.' });
    expect(codexMessages([turn])[0]).toEqual(codexTurnFailure(turn));
    expect(JSON.stringify(codexTurnFailure(turn))).not.toMatch(/gpt-6|secret/);
  });
  it.each([undefined, {}, '{broken', 'private prefix ' + unsupported, unsupported + ' token=secret',
    JSON.stringify({ type: 'error', status: 403, error: { type: 'invalid_request_error', message: unsupported } }),
    JSON.stringify({ type: 'error', status: 400, error: { type: 'other', message: unsupported } }),
    JSON.stringify({ type: 'error', status: 400, error: { type: 'invalid_request_error', message: unsupported }, private: 'x'.repeat(16384) }),
  ])('does not infer model availability from malformed or unknown errors: %j', message => {
    expect(codexTurnFailure({ id: 'turn', status: 'failed', error: { message } })?.text)
      .toBe("The agent couldn't complete this reply. Please try again.");
  });
  it('keeps a stable authentication notice after native history reload without provider text', () => {
    const turn = { id: 'native-turn', status: 'failed', startedAt: 10, completedAt: 12,
      error: { codexErrorInfo: 'unauthorized', message: 'private credential detail', additionalDetails: 'private provider response' },
      items: [{ id: 'user', type: 'userMessage', content: [{ type: 'text', text: 'hello' }] }] };
    const messages = codexMessages([turn]);
    expect(messages).toHaveLength(2);
    expect(messages[1]).toEqual({ id: 'codex-turn-error:native-turn', role: 'system', timestampMs: 12000,
      text: 'Model authentication failed. Sign in again on your computer.' });
    expect(messages[1]).toEqual(codexTurnFailure(turn));
    expect(JSON.stringify(messages)).not.toContain('private');
  });
  it.each(['serverOverloaded', { httpConnectionFailed: { httpStatusCode: 500 } }, undefined])('uses safe generic copy for other native errors: %j', codexErrorInfo => {
    expect(codexTurnFailure({ id: 'turn', status: 'failed', error: { codexErrorInfo, message: 'private details' } })?.text)
      .toBe("The agent couldn't complete this reply. Please try again.");
  });
  it.each(['inProgress', 'interrupted', 'completed', 'incomplete', undefined])('does not invent a failure for %s', status => {
    expect(codexMessages([{ id: 'turn', status, error: { codexErrorInfo: 'unauthorized' }, items: [] }])).toEqual([]);
  });
});
