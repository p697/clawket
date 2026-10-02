import type { UiMessage } from '../../types/chat';
import {
  collectTurnToolSteps,
  describeFailedStep,
  failureReason,
  describeLiveStep,
  formatActivityDuration,
  formatToolActivitySummary,
  stepDurationMs,
  summarizeToolActivity,
  toolActivityDuration,
  toolCallFiles,
} from './tool-activity-model';

const t = (key: string, options?: Record<string, unknown>) => (
  key.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, token: string) => String(options?.[token] ?? ''))
);

let sequence = 0;
function call(toolName: string, args: Record<string, unknown> = {}, patch: Partial<UiMessage> = {}): UiMessage {
  sequence += 1;
  return { id: `call-${sequence}`, role: 'tool', text: '', toolName, toolArgs: JSON.stringify(args), toolStatus: 'success', ...patch };
}

describe('summarizeToolActivity', () => {
  it('counts commands and distinct files, most frequent first', () => {
    const summary = summarizeToolActivity([
      call('exec', { command: 'git status' }),
      call('Read', { file_path: '/repo/a.ts' }),
      call('exec', { command: 'git log' }),
      call('Read', { file_path: '/repo/a.ts' }),
      call('bash', { command: 'npm test' }),
    ]);
    expect(summary).toEqual({ steps: 5, kinds: [{ kind: 'command', count: 3 }, { kind: 'read', count: 1 }], durationMs: undefined });
    expect(formatToolActivitySummary(summary, t)).toBe('Ran {{count}} commands, read a file'.replace('{{count}}', '3'));
  });

  it('counts every file in a Codex file change', () => {
    const change = call('apply_patch', { changes: [{ path: 'src/a.ts', diff: '' }, { path: 'src/b.ts', diff: '' }] });
    expect(toolCallFiles(change)).toEqual(['src/a.ts', 'src/b.ts']);
    expect(formatToolActivitySummary(summarizeToolActivity([change]), t)).toBe('Edited 2 files');
  });

  it('reads a busy run as its step count and a single call in the singular', () => {
    const busy = summarizeToolActivity([call('exec'), call('read'), call('web_search'), call('custom_tool')]);
    expect(formatToolActivitySummary(busy, t)).toBe('Used 4 tools');
    expect(formatToolActivitySummary(summarizeToolActivity([call('exec')]), t)).toBe('Ran a command');
    expect(formatToolActivitySummary(summarizeToolActivity([call('mcp__linear__save_issue')]), t)).toBe('Used a tool');
  });

  it('appends the wall-clock span when it is at least a second', () => {
    const start = 1_700_000_000_000;
    const summary = summarizeToolActivity([
      call('exec', {}, { toolStartedAt: start, toolFinishedAt: start + 4_000 }),
      call('exec', {}, { toolStartedAt: start + 30_000, toolDurationMs: 8_000 }),
    ]);
    expect(summary.durationMs).toBe(38_000);
    expect(formatToolActivitySummary(summary, t)).toBe('Ran 2 commands · 38 s');
  });
});

describe('toolActivityDuration', () => {
  it('falls back to summed durations and hides unknown or sub-second work', () => {
    expect(toolActivityDuration([call('exec', {}, { toolDurationMs: 1_500 }), call('exec', {}, { toolDurationMs: 700 })])).toBe(2_200);
    expect(toolActivityDuration([call('exec', {}, { toolDurationMs: 400 })])).toBeUndefined();
    expect(toolActivityDuration([call('exec'), call('exec', {}, { toolDurationMs: 9_000 })])).toBeUndefined();
    expect(toolActivityDuration([])).toBeUndefined();
  });

  it('times a step by its reported duration, else by the start and finish the phone saw', () => {
    expect(stepDurationMs(call('exec', {}, { toolDurationMs: 1_500, toolStartedAt: 1_000, toolFinishedAt: 9_000 }))).toBe(1_500);
    expect(stepDurationMs(call('bash', {}, { toolStartedAt: 10_000, toolFinishedAt: 25_400 }))).toBe(15_400);
    expect(stepDurationMs(call('bash', {}, { toolStartedAt: 10_000 }))).toBeUndefined();
    expect(stepDurationMs(call('bash', {}, { toolStartedAt: 10_000, toolFinishedAt: 9_000 }))).toBeUndefined();
    expect(stepDurationMs(call('bash', {}, { toolDurationMs: Number.NaN }))).toBeUndefined();
  });

  it('formats seconds, minutes and hours compactly', () => {
    expect(formatActivityDuration(38_900, t)).toBe('38 s');
    expect(formatActivityDuration(160_000, t)).toBe('2 min 40 s');
    expect(formatActivityDuration(3_900_000, t)).toBe('1 h 5 min');
  });
});

describe('pill copy', () => {
  it('names a running step by its verb and target, split so the target can be styled as code', () => {
    expect(describeLiveStep(call('exec', { command: 'npm run mobile:check' }), t)).toEqual({ before: 'Running ', value: 'npm run mobile:check', after: '' });
    expect(describeLiveStep(call('custom_tool', { command: 'x' }), t)).toBeNull();
    expect(describeLiveStep(call('exec'), t)).toBeNull();
    const long = describeLiveStep(call('exec', { command: `echo ${'x'.repeat(80)}` }), t);
    expect(long?.value.length).toBe(48);
    expect(long?.value.endsWith('…')).toBe(true);
  });

  it('names a failed step by its command, or by the tool when there is none', () => {
    expect(describeFailedStep(call('exec', { command: 'gh pr checks 50' }), 'Command', t))
      .toEqual({ before: '', value: 'gh pr checks 50', after: ' failed', code: true });
    expect(describeFailedStep(call('exec'), 'Command', t)).toEqual({ before: '', value: 'Command', after: ' failed', code: false });
  });
});

describe('collectTurnToolSteps', () => {
  // Newest first, as the controller keeps them.
  const prompt2: UiMessage = { id: 'p2', role: 'user', text: 'Next' };
  const late: UiMessage = { ...call('exec'), id: 'late' };
  const reply: UiMessage = { id: 'r1', role: 'assistant', text: 'Done' };
  const second: UiMessage = { ...call('read'), id: 'second', renderKey: 'toolcall_second' };
  const approval: UiMessage = { id: 'ask', role: 'tool', text: '', approval: { id: 'x', kind: 'exec', command: 'rm', status: 'allowed', expiresAtMs: null } as never };
  const first: UiMessage = { ...call('exec'), id: 'first' };
  const prompt1: UiMessage = { id: 'p1', role: 'user', text: 'Go' };
  const earlier: UiMessage = { ...call('exec'), id: 'earlier' };
  const messages = [late, prompt2, reply, second, approval, first, prompt1, earlier];

  it('collects the calls of one turn oldest first, across replies and without approvals', () => {
    expect(collectTurnToolSteps(messages, 'first').map((message) => message.id)).toEqual(['first', 'second']);
    expect(collectTurnToolSteps(messages, 'toolcall_second').map((message) => message.id)).toEqual(['first', 'second']);
    expect(collectTurnToolSteps(messages, 'late').map((message) => message.id)).toEqual(['late']);
    expect(collectTurnToolSteps(messages, 'earlier').map((message) => message.id)).toEqual(['earlier']);
  });

  it('treats an incoming participant as part of the turn, not a new prompt', () => {
    const participant: UiMessage = { id: 'bob', role: 'user', text: 'Hi', attribution: { channel: 'telegram', sender: { id: 'bob' } } };
    expect(collectTurnToolSteps([late, participant, first, prompt1], 'first').map((message) => message.id)).toEqual(['first', 'late']);
  });

  it('yields nothing for an unknown anchor', () => {
    expect(collectTurnToolSteps(messages, 'missing')).toEqual([]);
  });
});

describe('failureReason', () => {
  it('finds the line that names the error, even inside a progress meter redrawn with carriage returns', () => {
    const curl = '  % Total    % Received\r  0     0    0     0    0     0      0      0 --:--:-- --:--:-- --:--:--     0\rcurl: (6) Could not resolve host: example.org\n';
    expect(failureReason(curl)).toBe('curl: (6) Could not resolve host: example.org');
    expect(failureReason('npm ERR! missing script: lint\nnpm ERR! A complete log of this run can be found in ~/.npm')).toBe('npm ERR! A complete log of this run can be found in ~/.npm');
  });

  it('falls back to the last line, clips long lines and says nothing without output', () => {
    expect(failureReason('first\nlast words')).toBe('last words');
    expect(failureReason(`Error: ${'x'.repeat(200)}`)!.length).toBe(80);
    expect(failureReason(undefined)).toBeUndefined();
    expect(failureReason('  \n\r ')).toBeUndefined();
  });
});
