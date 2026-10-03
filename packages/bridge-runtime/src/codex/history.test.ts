import { describe, expect, it } from 'vitest';
import { codexMessages, codexTool, codexTurnFailure } from './history.js';

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
