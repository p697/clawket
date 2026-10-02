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
  it('names the newest running step and counts failures without dropping them', () => {
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
    expect(work.failed).toBe(1);
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
    // A failure the Agent moved past stays quiet: the receipt is not red.
    expect(folded.receipts.get(answer.id)).toEqual({ steps: [a, b, c], failed: false });
    expect(folded.pills.size).toBe(0);
  });

  it('leaves one pill when the turn said nothing after its last step, red only for a failure', () => {
    const one = prompt('one');
    const two = prompt('two');
    const quiet = call('exec');
    const failing = call('exec', { command: 'gradle' }, { toolStatus: 'error' });
    const said = reply('Building.');
    const messages = newestFirst(one, call('read'), quiet, two, said, call('exec'), failing);
    const folded = foldTurnSteps(messages, false);
    expect(keys(folded.messages)).toEqual(keys(newestFirst(one, quiet, two, said, failing)));
    expect(folded.pills.get(quiet.id)?.failed).toBe(false);
    expect(folded.pills.get(quiet.id)?.steps).toHaveLength(2);
    expect(folded.pills.get(failing.id)?.failed).toBe(true);
    expect(folded.receipts.has(said.id)).toBe(false);
  });

  it('hides the running turn steps without a receipt and keeps approvals in place', () => {
    const waiting = approval('pending');
    const said = reply('Need to clean the build first.');
    const messages = newestFirst(prompt('build'), call('exec', {}, { toolStatus: 'error' }), said, waiting, call('exec', {}, { toolStatus: 'running' }));
    const folded = foldTurnSteps(messages, true);
    expect(keys(folded.messages)).toEqual([waiting.id, said.id, messages.at(-1)!.id]);
    expect(folded.receipts.size).toBe(0);
    expect(folded.pills.size).toBe(0);
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

  it('drops the step count when the lead already says it', () => {
    expect(formatTurnReceipt([call('exec'), call('exec'), call('bash')], t)).toBe('Ran 3 commands');
    expect(formatTurnReceipt([call('exec'), call('exec'), call('read', { path: 'b.ts' })], t)).toBe('Ran 2 commands · 3 steps');
  });
});
