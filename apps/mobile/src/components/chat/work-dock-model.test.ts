import type { UiMessage } from '../../types/chat';
import { collectLiveTurnWork } from './turn-work';
import { formatElapsedClock, formatWorkDockCaption, liveTurnHasWords, resolveWorkDockPhase } from './work-dock-model';

const prompt: UiMessage = { id: 'ask', role: 'user', text: 'go' };
const step = (id: string, toolStatus: UiMessage['toolStatus']): UiMessage => ({ id, role: 'tool', text: '', toolName: 'exec', toolStatus });
const phaseOf = (messages: UiMessage[], offline = false) => resolveWorkDockPhase({ work: collectLiveTurnWork(messages), messages, offline }).kind;

describe('resolveWorkDockPhase', () => {
  it('names the running step, then the streaming reply, then thinking', () => {
    expect(phaseOf([step('b', 'running'), step('a', 'success'), prompt])).toBe('step');
    expect(phaseOf([{ id: 'r', role: 'assistant', text: 'Fixed', streaming: true }, step('a', 'success'), prompt])).toBe('replying');
    expect(phaseOf([{ id: 'r', role: 'assistant', text: 'Fixed' }, step('a', 'success'), prompt])).toBe('thinking');
    expect(phaseOf([step('a', 'success'), prompt])).toBe('thinking');
  });

  it('keeps replying across same-turn guidance while a genuine next input returns to thinking', () => {
    const main = { ...prompt, turnId: 'turn', idempotencyKey: 'main-key' };
    const guide: UiMessage = { id: 'guide', role: 'user', text: 'Continue', turnId: 'turn' };
    const words: UiMessage = { id: 'words', role: 'assistant', text: 'Working', streaming: true, turnId: 'turn' };
    expect(phaseOf([guide, words, main])).toBe('replying');
    expect(phaseOf([{ ...guide, idempotencyKey: 'next-key' }, words, main])).toBe('thinking');
    expect(phaseOf([{ ...guide, turnId: undefined }, words, main])).toBe('thinking');
  });

  it('lets a pending approval outrank the step, and a lost connection outrank everything', () => {
    const approval: UiMessage = {
      id: 'approval_1', role: 'system', text: '',
      approval: { id: '1', kind: 'exec', command: 'ls', status: 'pending', expiresAtMs: null },
    };
    expect(phaseOf([approval, step('a', 'running'), prompt])).toBe('approval');
    expect(phaseOf([approval, step('a', 'running'), prompt], true)).toBe('offline');
  });

  it('treats the newest unrecorded step of the running turn as working', () => {
    // Claude Code and Pi history reloads mark a call without its result `unknown`.
    expect(phaseOf([step('b', 'unknown'), step('a', 'success'), prompt])).toBe('step');
  });
});

describe('formatElapsedClock', () => {
  it('reads minutes and seconds, adding hours only when needed', () => {
    expect(formatElapsedClock(0)).toBe('0:00');
    expect(formatElapsedClock(42_400)).toBe('0:42');
    expect(formatElapsedClock(160_000)).toBe('2:40');
    expect(formatElapsedClock(3_903_000)).toBe('1:05:03');
    expect(formatElapsedClock(-5)).toBe('0:00');
  });
});

describe('formatWorkDockCaption', () => {
  const t = (key: string, options?: Record<string, unknown>) => (
    key.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, token: string) => String(options?.[token] ?? ''))
  );
  const caption = (messages: UiMessage[], elapsed?: number) => {
    const work = collectLiveTurnWork(messages);
    return formatWorkDockCaption({ phase: resolveWorkDockPhase({ work, messages, offline: false }), work, elapsed, t });
  };

  it('says which step and how long, never how many failed', () => {
    expect(caption([step('c', 'running'), step('b', 'error'), step('a', 'success'), prompt], 160_000))
      .toBe('Step 3 · Elapsed 2:40');
    expect(caption([step('c', 'running'), step('b', 'running'), step('a', 'error'), step('z', 'error'), prompt]))
      .toBe('2 steps at once');
    expect(caption([step('a', 'success'), prompt], 500)).toBe('1 step');
  });

  it('shows what a request waits for, and what a lost connection means', () => {
    const work = collectLiveTurnWork([step('a', 'running'), prompt]);
    expect(formatWorkDockCaption({ phase: { kind: 'question' }, work, detail: '  Which   database? ', t })).toBe('Which database?');
    expect(formatWorkDockCaption({ phase: { kind: 'offline' }, work, t })).toBe('The Agent may still be working on your computer');
    const approval: UiMessage = {
      id: 'approval_1', role: 'system', text: '',
      approval: { id: '1', kind: 'exec', command: 'rm -rf\n  build', status: 'pending', expiresAtMs: null },
    };
    expect(formatWorkDockCaption({ phase: { kind: 'approval', request: approval }, work, t })).toBe('rm -rf build');
    const wrapped = { ...approval, approval: { ...approval.approval!, command: "/bin/zsh -lc 'curl --head https://example.com'" } } as UiMessage;
    expect(formatWorkDockCaption({ phase: { kind: 'approval', request: wrapped }, work, t })).toBe('curl --head https://example.com');
  });
});

describe('liveTurnHasWords', () => {
  const prompt: UiMessage = { id: 'p', role: 'user', text: 'Fix it' };
  it('reads only the newest turn and ignores a reply with no words yet', () => {
    const earlier: UiMessage = { id: 'e', role: 'assistant', text: 'Earlier answer' };
    expect(liveTurnHasWords([prompt, earlier])).toBe(false);
    expect(liveTurnHasWords([{ id: 's', role: 'assistant', text: '  ', streaming: true }, prompt, earlier])).toBe(false);
    expect(liveTurnHasWords([{ id: 's', role: 'assistant', text: 'On it', streaming: true }, prompt])).toBe(true);
  });

  it('keeps known same-run words across guidance and excludes unreported older words on a partial page', () => {
    const identity = { scope: {}, sessionKey: 'session', runId: 'run', turnId: 'turn', inputMessageId: 'main', startedAt: 1000 };
    const guide: UiMessage = { id: 'guide', role: 'user', text: 'Continue', turnId: 'turn' };
    const words: UiMessage = { id: 'words', role: 'assistant', text: 'Working', turnId: 'turn' };
    const earlier: UiMessage = { id: 'earlier', role: 'assistant', text: 'Old answer' };
    expect(liveTurnHasWords([guide, words, { ...prompt, id: 'main', turnId: 'turn' }], identity)).toBe(true);
    expect(liveTurnHasWords([guide, words, earlier], identity)).toBe(true);
    expect(liveTurnHasWords([guide, earlier], identity)).toBe(false);
  });

  it('keeps counting through a queued follow-up, which has not opened a turn', () => {
    const queued: UiMessage = { id: 'q', role: 'user', text: 'Also this', delivery: 'queued' };
    expect(liveTurnHasWords([queued, { id: 'a', role: 'assistant', text: 'Working on it' }, prompt])).toBe(true);
  });
});
