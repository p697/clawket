import type { UiMessage } from '../../types/chat';
import { formatTurnReceipt } from './tool-activity-model';
import {
  collectLiveTurnWork,
  collectTurnWorkAround,
  foldTurnSteps,
  isPendingExecApproval,
  opensTurn,
} from './turn-work';

const t = (key: string, options?: Record<string, unknown>) => (
  key.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, token: string) => String(options?.[token] ?? ''))
);

let sequence = 0;
function next(): string {
  sequence += 1;
  return String(sequence);
}
function prompt(text: string, patch: Partial<UiMessage> = {}): UiMessage {
  return { id: `user-${next()}`, role: 'user', text, ...patch };
}
function reply(text: string, patch: Partial<UiMessage> = {}): UiMessage {
  return { id: `reply-${next()}`, role: 'assistant', text, ...patch };
}
function call(toolName: string, args: Record<string, unknown> = {}, patch: Partial<UiMessage> = {}): UiMessage {
  return { id: `call-${next()}`, role: 'tool', text: '', toolName, toolArgs: JSON.stringify(args), toolStatus: 'success', ...patch };
}
function approval(status: 'pending' | 'allowed' | 'denied' | 'expired' = 'pending'): UiMessage {
  return {
    id: `approval-${next()}`,
    role: 'system',
    text: '',
    approval: { id: `a-${sequence}`, kind: 'exec', command: 'rm -rf build', expiresAtMs: null, status },
  };
}
/** Builds the controller's newest-first array from a conversation written oldest first. */
function newestFirst(...messages: UiMessage[]): UiMessage[] {
  return [...messages].reverse();
}
const keys = (messages: ReadonlyArray<UiMessage>) => messages.map((message) => message.id);

describe('opensTurn', () => {
  it('counts only prompts that reached the Agent', () => {
    expect(opensTurn(prompt('go'))).toBe(true);
    expect(opensTurn(prompt('later', { delivery: 'queued' }))).toBe(false);
    expect(opensTurn(prompt('sending', { delivery: 'sending' }))).toBe(false);
    expect(opensTurn(reply('done'))).toBe(false);
  });
});

describe('collectLiveTurnWork', () => {
  it('counts only the one confirmed running step after ten completed image views and an explicitly unknown tool', () => {
    const images = Array.from({ length: 10 }, () => call('view_image', {}, { toolStatusReported: true }));
    const running = call('exec', {}, { toolStatus: 'running', toolStatusReported: true });
    const unknown = call('read', {}, { toolStatus: 'unknown', toolStatusReported: true });
    const work = collectLiveTurnWork(newestFirst(prompt('inspect'), ...images, running, unknown));
    expect(work.steps).toHaveLength(12);
    expect(work.running).toBe(1);
    expect(work.current).toBe(running);
    const unconfirmed = collectLiveTurnWork(newestFirst(prompt('inspect'), ...images, unknown));
    expect(unconfirmed.running).toBe(0);
    expect(unconfirmed.current).toBeUndefined();
  });

  it('preserves the legacy Claude/Pi missing-result hint when the adapter has not reported execution state', () => {
    const pending = call('read', {}, { toolStatus: 'unknown' });
    const work = collectLiveTurnWork(newestFirst(prompt('go'), pending));
    expect(work.running).toBe(1);
    expect(work.current).toBe(pending);
  });
  it('names the newest running step and keeps failed steps in the turn', () => {
    const start = 1_700_000_000_000;
    const ask = prompt('fix the tests');
    const read = call('read', { path: 'a.ts' }, { toolStartedAt: start + 1_000 });
    const failed = call('apply_patch', {}, { toolStatus: 'error', toolStartedAt: start + 2_000 });
    const said = reply('The assertion read the wrong field; trying again.');
    const first = call('exec', { command: 'npm test' }, { toolStatus: 'running', toolStartedAt: start + 3_000 });
    const second = call('exec', { command: 'npm run lint' }, { toolStatus: 'running', toolStartedAt: start + 3_500 });
    const work = collectLiveTurnWork(newestFirst(prompt('older'), reply('older reply'), ask, read, failed, said, first, second));
    expect(keys(work.steps)).toEqual([read.id, failed.id, first.id, second.id]);
    expect(work.current?.id).toBe(second.id);
    expect(work.running).toBe(2);
    expect(work.firstStepAt).toBe(start + 1_000);
    expect(work.entries.map((entry) => `${entry.kind}:${entry.message.id}`)).toEqual([
      `step:${read.id}`, `step:${failed.id}`, `said:${said.id}`, `step:${first.id}`, `step:${second.id}`,
    ]);
  });

  it('keeps the final words out of the process and ignores earlier turns', () => {
    const step = call('exec');
    const work = collectLiveTurnWork(newestFirst(call('exec'), prompt('go'), step, reply('All green.')));
    expect(keys(work.steps)).toEqual([step.id]);
    expect(work.entries).toHaveLength(1);
  });

  it('carries a pending approval and treats a queued prompt as part of the running turn', () => {
    const waiting = approval('pending');
    const step = call('exec', {}, { toolStatus: 'error' });
    const work = collectLiveTurnWork(newestFirst(prompt('go'), step, waiting, prompt('also iOS', { delivery: 'queued' })));
    expect(work.pendingApproval?.id).toBe(waiting.id);
    expect(isPendingExecApproval(waiting)).toBe(true);
    expect(keys(work.steps)).toEqual([step.id]);
  });

  it('is empty before the Agent has done anything', () => {
    expect(collectLiveTurnWork(newestFirst(reply('hi'), prompt('go')))).toEqual(expect.objectContaining({ steps: [], running: 0 }));
    expect(collectLiveTurnWork([])).toEqual(expect.objectContaining({ entries: [] }));
  });
});

describe('collectTurnWorkAround', () => {
  it('collects the turn a receipt belongs to', () => {
    const one = call('exec');
    const two = call('read');
    const answer = reply('Done.');
    const messages = newestFirst(prompt('a'), call('exec'), reply('first'), prompt('b'), one, two, answer, prompt('c'), call('exec'));
    expect(keys(collectTurnWorkAround(messages, one.id).steps)).toEqual([one.id, two.id]);
    expect(collectTurnWorkAround(messages, 'missing').steps).toEqual([]);
  });
});

describe('foldTurnSteps', () => {
  it('moves a finished turn into a receipt under its last reply', () => {
    const ask = prompt('fix it');
    const said = reply('Found it.');
    const a = call('exec');
    const b = call('apply_patch', {}, { toolStatus: 'error' });
    const c = call('apply_patch');
    const answer = reply('Fixed.');
    const folded = foldTurnSteps(newestFirst(ask, a, said, b, c, answer), false);
    expect(keys(folded.messages)).toEqual(keys(newestFirst(ask, said, answer)));
    // A failed step is an ordinary step of the receipt.
    expect(folded.receipts.get(answer.id)).toEqual({ steps: [a, b, c] });
    expect(folded.standalone.size).toBe(0);
  });

  it('puts the receipt under the last words even when steps followed them, a final failure included', () => {
    const one = prompt('one');
    const two = prompt('two');
    const quiet = call('exec');
    const build = call('exec');
    const failing = call('exec', { command: 'gradle' }, { toolStatus: 'error' });
    const said = reply('Building.');
    const messages = newestFirst(one, call('read'), quiet, two, said, build, failing);
    const folded = foldTurnSteps(messages, false);
    // A turn that said nothing keeps its receipt where its newest step was.
    expect(keys(folded.messages)).toEqual(keys(newestFirst(one, quiet, two, said)));
    expect(folded.standalone.get(quiet.id)?.steps).toHaveLength(2);
    // Words before the steps still carry the turn's receipt, the failed step among them.
    expect(folded.receipts.get(said.id)).toEqual({ steps: [build, failing] });
    expect(folded.standalone.has(failing.id)).toBe(false);
  });

  it('keeps a failed step among the receipt of a turn that said nothing', () => {
    const failing = call('exec', {}, { toolStatus: 'error' });
    const retried = call('exec');
    const folded = foldTurnSteps(newestFirst(prompt('build'), failing, retried), false);
    expect(folded.standalone.get(retried.id)).toEqual({ steps: [failing, retried] });
  });

  it('hides the running turn steps without a receipt and keeps approvals in place', () => {
    const waiting = approval('pending');
    const said = reply('Need to clean the build first.');
    const messages = newestFirst(prompt('build'), call('exec', {}, { toolStatus: 'error' }), said, waiting, call('exec', {}, { toolStatus: 'running' }));
    const folded = foldTurnSteps(messages, true);
    expect(keys(folded.messages)).toEqual([waiting.id, said.id, messages.at(-1)!.id]);
    expect(folded.receipts.size).toBe(0);
    expect(folded.standalone.size).toBe(0);
  });

  it('returns the same array when no tool ran', () => {
    const messages = newestFirst(prompt('hi'), reply('hello'));
    expect(foldTurnSteps(messages, false).messages).toBe(messages);
  });
});

describe('formatTurnReceipt', () => {
  const start = 1_700_000_000_000;
  it('leads with edited files, then the steps and the time', () => {
    const steps = [
      call('exec', { command: 'npm test' }, { toolStartedAt: start, toolFinishedAt: start + 12_000 }),
      call('read', { path: 'a.ts' }),
      call('apply_patch', { changes: [{ path: 'a.ts' }] }, { toolStatus: 'error' }),
      call('apply_patch', { changes: [{ path: 'a.ts' }] }),
      call('exec', { command: 'npm test' }, { toolStartedAt: start + 150_000, toolFinishedAt: start + 160_000 }),
    ];
    expect(formatTurnReceipt(steps, t)).toBe('Edited a file · 5 steps · 2 min 40 s');
  });

  it('says when the turn asked the user a question', () => {
    expect(formatTurnReceipt([call('AskUserQuestion')], t)).toBe('Asked you a question');
    expect(formatTurnReceipt([call('AskUserQuestion'), call('AskUserQuestion'), call('exec')], t)).toBe('Asked you 2 questions · 3 steps');
  });

  it('drops the step count when the lead already says it', () => {
    expect(formatTurnReceipt([call('exec'), call('exec'), call('bash')], t)).toBe('Ran 3 commands');
    expect(formatTurnReceipt([call('exec'), call('exec'), call('read', { path: 'b.ts' })], t)).toBe('Ran 2 commands · 3 steps');
  });
});


describe('native work turn identity', () => {
  it('keeps two exact same-turn guides inside the live work and one final receipt', () => {
    const main = prompt('main', { turnId: 'turn', idempotencyKey: 'main-key' });
    const first = call('exec', {}, { turnId: 'turn' });
    const second = call('exec', {}, { turnId: 'turn', toolStatus: 'running' });
    const guide1 = prompt('same', { turnId: 'turn' });
    const guide2 = prompt('same', { turnId: 'turn' });
    const answer = reply('done', { turnId: 'turn' });
    const messages = newestFirst(main, first, guide1, second, guide2, answer);
    expect(collectLiveTurnWork(messages).steps).toEqual([first, second]);
    expect(collectTurnWorkAround(messages, first.id).steps).toEqual([first, second]);
    expect(foldTurnSteps(messages, true).receipts.size).toBe(0);
    expect(foldTurnSteps(messages, true).standalone.size).toBe(0);
    expect(foldTurnSteps(messages, false).receipts.get(answer.id)?.steps).toEqual([first, second]);
  });

  it.each([{ turnId: 'other-turn' }, { turnId: 'turn', idempotencyKey: 'new-send' }, {}])('keeps a genuine or unreported next input separate: %j', patch => {
    const main = prompt('main', { turnId: 'turn', idempotencyKey: 'main-key' });
    const first = call('exec', {}, { turnId: 'turn' });
    const next = prompt('same', patch);
    const second = call('exec', {}, { toolStatus: 'running' });
    expect(collectLiveTurnWork(newestFirst(main, first, next, second)).steps).toEqual([second]);
    expect(foldTurnSteps(newestFirst(main, first, next, second), true).standalone.get(first.id)?.steps).toEqual([first]);
  });

  it('does not hide or attach older unreported work to a partial active run', () => {
    const oldUser = prompt('old');
    const unreported = call('exec', {}, { toolStatus: 'unknown' });
    const current = call('exec', {}, { turnId: 'turn', toolStatus: 'running' });
    const guide = prompt('guide', { turnId: 'turn' });
    const identity = { scope: {}, sessionKey: 'session', runId: 'run', turnId: 'turn', inputMessageId: 'unloaded-main', startedAt: 1000 };
    const folded = foldTurnSteps(newestFirst(oldUser, unreported, current, guide), true, identity);
    expect(folded.messages).toEqual([guide, unreported, oldUser]);
    expect(folded.standalone.get(unreported.id)?.steps).toEqual([unreported]);
    expect(folded.receipts.size).toBe(0);
    expect(foldTurnSteps(newestFirst(oldUser, unreported, current), true, identity).messages).toEqual([unreported, oldUser]);
  });

  it('accepts only positively matching work on a partial active page and stops at an unproven user', () => {
    const current = call('exec', {}, { turnId: 'turn', toolStatus: 'running' });
    const guide = prompt('guide', { turnId: 'turn' });
    const old = call('exec', {}, { turnId: 'older-turn' });
    const identity = { scope: {}, sessionKey: 'session', runId: 'run', turnId: 'turn', inputMessageId: 'unloaded-main', startedAt: 1000 };
    expect(collectLiveTurnWork(newestFirst(old, prompt('unknown'), current, guide), identity).steps).toEqual([current]);
    expect(collectLiveTurnWork(newestFirst(old, current, guide), identity).steps).toEqual([current]);
    expect(collectLiveTurnWork(newestFirst(old, current, guide)).steps).toEqual([]);
  });
});

describe('turn timeline ends', () => {
  it('carries the prompt that opened each turn, and where a finished turn ended', () => {
    const ask = prompt('fix it', { timestampMs: 1_000 });
    const step = call('exec', {}, { timestampMs: 2_000 });
    const answer = reply('Fixed.', { timestampMs: 3_000 });
    const next = prompt('next', { timestampMs: 4_000 });
    const live = call('exec', {}, { toolStatus: 'running', timestampMs: 5_000 });
    const messages = newestFirst(ask, step, answer, next, live);
    const running = collectLiveTurnWork(messages);
    expect(running.prompt).toBe(next);
    expect(running.endedAt).toBeUndefined();
    const finished = collectTurnWorkAround(messages, step.id);
    expect(finished.prompt).toBe(ask);
    expect(finished.endedAt).toBe(3_000);
  });

  it('has no prompt when the loaded page starts inside the turn', () => {
    const step = call('exec', {}, { timestampMs: 2_000 });
    const finished = collectTurnWorkAround(newestFirst(step, reply('Done.', { timestampMs: 3_000 })), step.id);
    expect(finished.prompt).toBeUndefined();
    expect(finished.endedAt).toBe(3_000);
  });
});
