import { SessionInfo } from '../../types';
import {
  buildSessionBoardRows,
  filterSessionBoardRows,
  summarizeSessionBoardRows,
} from './list-model';

function makeSession(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    key: 'agent:main:main',
    updatedAt: 0,
    ...overrides,
  };
}

describe('SessionPanel list model', () => {
  it('classifies active recent and idle sessions by updatedAt', () => {
    const now = 1_000_000;
    const rows = buildSessionBoardRows([
      makeSession({ key: 'agent:main:main', updatedAt: now - 30_000 }),
      makeSession({ key: 'agent:main:telegram:1', updatedAt: now - 3 * 60_000 }),
      makeSession({ key: 'agent:main:discord:2', updatedAt: now - 20 * 60_000 }),
    ], { now });

    expect(rows.map((row) => ({ key: row.key, status: row.status }))).toEqual([
      { key: 'agent:main:main', status: 'active' },
      { key: 'agent:main:telegram:1', status: 'recent' },
      { key: 'agent:main:discord:2', status: 'idle' },
    ]);
  });

  it('derives kind channel model and preview fields', () => {
    const [row] = buildSessionBoardRows([
      makeSession({
        key: 'agent:main:subagent:coder',
        channel: 'lark',
        modelProvider: 'openai',
        model: 'gpt-5',
        lastMessagePreview: '  hello there  ',
      }),
    ]);

    expect(row.kind).toBe('subagent');
    expect(row.channelLabel).toBe('Feishu');
    expect(row.modelLabel).toBe('openai/gpt-5');
    expect(row.preview).toBe('hello there');
  });

  it('filters by query status and kind', () => {
    const now = 1_000_000;
    const rows = buildSessionBoardRows([
      makeSession({ key: 'agent:main:main', updatedAt: now - 10_000, model: 'gpt-main' }),
      makeSession({ key: 'agent:main:subagent:coder', updatedAt: now - 3 * 60_000, model: 'gpt-worker' }),
      makeSession({ key: 'agent:main:telegram:ops', updatedAt: now - 20 * 60_000, channel: 'telegram' }),
    ], { now });

    expect(filterSessionBoardRows(rows, { query: 'worker', status: 'all', kind: 'all' }).map((row) => row.key)).toEqual([
      'agent:main:subagent:coder',
    ]);
    expect(filterSessionBoardRows(rows, { query: '', status: 'recent', kind: 'subagent' }).map((row) => row.key)).toEqual([
      'agent:main:subagent:coder',
    ]);
  });

  it('summarizes status counts', () => {
    const rows = buildSessionBoardRows([
      makeSession({ key: 'agent:main:main', updatedAt: 119_500 }),
      makeSession({ key: 'agent:main:telegram:1', updatedAt: 50_000 }),
      makeSession({ key: 'agent:main:telegram:2', updatedAt: 119_500 }),
    ], { now: 120_000 });

    expect(summarizeSessionBoardRows(rows)).toEqual({
      active: 2,
      recent: 1,
      idle: 0,
    });
  });
});
