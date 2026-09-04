import { SessionInfo } from '../types';
import {
  ChildSessionActivity,
  applyChildDelta,
  applyChildRunEnd,
  applyChildRunStart,
  applyChildToolStart,
  buildChildSessionActivityCards,
  COMPLETED_CHILD_ACTIVITY_TTL_MS,
  getChildSessionStatusLabel,
  inferChildSessionOwnership,
  pruneChildSessionActivity,
} from './childSessionActivity';

describe('inferChildSessionOwnership', () => {
  it('matches direct ownership through spawnedBy', () => {
    expect(
      inferChildSessionOwnership(
        'agent:main:main',
        'main',
        'agent:main:subagent:coder',
        'agent:main:main',
      ),
    ).toBe(true);
  });

  it('falls back to main-session key heuristics', () => {
    expect(
      inferChildSessionOwnership(
        'agent:main:main',
        'main',
        'agent:main:subagent:planner',
      ),
    ).toBe(true);
  });

  it('supports nested child-session prefixes', () => {
    expect(
      inferChildSessionOwnership(
        'agent:main:subagent:orchestrator',
        'main',
        'agent:main:subagent:orchestrator:subagent:worker',
      ),
    ).toBe(true);
  });

  it('rejects unrelated subagent sessions', () => {
    expect(
      inferChildSessionOwnership(
        'agent:main:subagent:orchestrator',
        'main',
        'agent:main:subagent:someone-else',
      ),
    ).toBe(false);
  });
});

describe('child session activity mutations', () => {
  it('tracks streaming, tool use, and completion per session key', () => {
    const map = new Map();
    applyChildRunStart(map, 'agent:main:subagent:coder');
    applyChildDelta(map, 'agent:main:subagent:coder', 'drafting notes');
    applyChildToolStart(map, 'agent:main:subagent:coder', 'read');
    applyChildRunEnd(map, 'agent:main:subagent:coder');

    expect(map.get('agent:main:subagent:coder')).toMatchObject({
      status: 'completed',
      previewText: 'drafting notes',
      toolName: 'read',
      agentId: 'main',
    });
  });

  it('prunes stale completed entries', () => {
    const now = 100_000;
    const map = new Map<string, ChildSessionActivity>([
      [
        'agent:main:subagent:old',
        {
          sessionKey: 'agent:main:subagent:old',
          agentId: 'main',
          status: 'completed',
          previewText: null,
          toolName: null,
          updatedAt: now - COMPLETED_CHILD_ACTIVITY_TTL_MS - 1,
        },
      ],
      [
        'agent:main:subagent:new',
        {
          sessionKey: 'agent:main:subagent:new',
          agentId: 'main',
          status: 'completed',
          previewText: null,
          toolName: null,
          updatedAt: now - 10,
        },
      ],
    ]);

    pruneChildSessionActivity(map, { now });

    expect(map.has('agent:main:subagent:old')).toBe(false);
    expect(map.has('agent:main:subagent:new')).toBe(true);
  });
});

describe('buildChildSessionActivityCards', () => {
  const resolveSessionTitle = (session: SessionInfo) => session.label ?? session.key;

  it('builds cards only for the current session tree', () => {
    const sessions: SessionInfo[] = [
      {
        key: 'agent:main:subagent:orchestrator:subagent:coder',
        label: 'Code Worker',
        spawnedBy: 'agent:main:subagent:orchestrator',
      },
      {
        key: 'agent:main:subagent:someone-else',
        label: 'Other Worker',
        spawnedBy: 'agent:main:subagent:someone-else',
      },
    ];
    const activityMap = new Map<string, ChildSessionActivity>([
      [
        'agent:main:subagent:orchestrator:subagent:coder',
        {
          sessionKey: 'agent:main:subagent:orchestrator:subagent:coder',
          agentId: 'main',
          status: 'streaming',
          previewText: 'Writing test cases',
          toolName: null,
          updatedAt: 200,
        },
      ],
      [
        'agent:main:subagent:other',
        {
          sessionKey: 'agent:main:subagent:other',
          agentId: 'main',
          status: 'streaming',
          previewText: 'Should stay hidden',
          toolName: null,
          updatedAt: 300,
        },
      ],
    ]);

    expect(
      buildChildSessionActivityCards({
        currentSessionKey: 'agent:main:subagent:orchestrator',
        currentAgentId: 'main',
        sessions,
        activityMap,
        resolveSessionTitle,
      }),
    ).toEqual([
      expect.objectContaining({
        sessionKey: 'agent:main:subagent:orchestrator:subagent:coder',
        title: 'Code Worker',
      }),
    ]);
  });

  it('keeps recent completed cards visible', () => {
    const activityMap = new Map<string, ChildSessionActivity>([
      [
        'agent:main:subagent:coder',
        {
          sessionKey: 'agent:main:subagent:coder',
          agentId: 'main',
          status: 'completed',
          previewText: 'Done',
          toolName: 'read',
          updatedAt: 500,
        },
      ],
    ]);

    expect(
      buildChildSessionActivityCards({
        currentSessionKey: 'agent:main:main',
        currentAgentId: 'main',
        sessions: [],
        activityMap,
        now: 500 + COMPLETED_CHILD_ACTIVITY_TTL_MS - 5,
        resolveSessionTitle,
      }),
    ).toHaveLength(1);
  });

  it('prefers readable names and avoids exposing long ids', () => {
    const sessions: SessionInfo[] = [
      {
        key: 'agent:main:subagent:1234567890abcdef123456',
        displayName: 'Deep repository inspection worker',
      },
      {
        key: 'agent:main:subagent:abcdef1234567890abcdef',
      },
    ];
    const activityMap = new Map<string, ChildSessionActivity>([
      [
        'agent:main:subagent:1234567890abcdef123456',
        {
          sessionKey: 'agent:main:subagent:1234567890abcdef123456',
          agentId: 'main',
          status: 'streaming',
          previewText: null,
          toolName: null,
          updatedAt: 1,
        },
      ],
      [
        'agent:main:subagent:abcdef1234567890abcdef',
        {
          sessionKey: 'agent:main:subagent:abcdef1234567890abcdef',
          agentId: 'main',
          status: 'streaming',
          previewText: null,
          toolName: null,
          updatedAt: 2,
        },
      ],
    ]);

    expect(
      buildChildSessionActivityCards({
        currentSessionKey: 'agent:main:main',
        currentAgentId: 'main',
        sessions,
        activityMap,
        resolveSessionTitle,
      }).map((card) => card.title),
    ).toEqual([
      'Subagent',
      'Deep repository in…',
    ]);
  });
});

describe('getChildSessionStatusLabel', () => {
  const t = (key: string, options?: Record<string, unknown>) =>
    key.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, token: string) => String(options?.[token] ?? ''));

  it('uses tool-specific labels while calling tools', () => {
    expect(getChildSessionStatusLabel('tool_calling', null, 'read', t)).toBe('Reading file');
  });

  it('uses completed label after the run ends', () => {
    expect(getChildSessionStatusLabel('completed', 'Done', null, t)).toBe('Completed');
  });
});
