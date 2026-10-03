import { describe, expect, it } from 'vitest';
import { codexMessages, codexTurnFailure } from './history.js';

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
