import { describe, expect, it } from 'vitest';

import { HUMAN_SESSION_KINDS, sessionActivityAt } from './descriptors';

describe('sessionActivityAt', () => {
  it('prefers the adapter-reported activity over the backend record write time', () => {
    expect(sessionActivityAt({ updatedAt: 500, lastActivityAt: 200 })).toBe(200);
  });

  it('treats an explicit null as no activity even when the record was written', () => {
    expect(sessionActivityAt({ updatedAt: 500, lastActivityAt: null })).toBeNull();
  });

  it('falls back to updatedAt when the adapter does not report activity', () => {
    expect(sessionActivityAt({ updatedAt: 500 })).toBe(500);
    expect(sessionActivityAt({ updatedAt: null })).toBeNull();
  });

  it('rejects non-finite or negative timestamps', () => {
    expect(sessionActivityAt({ updatedAt: Number.NaN })).toBeNull();
    expect(sessionActivityAt({ updatedAt: 1, lastActivityAt: -1 })).toBeNull();
    expect(sessionActivityAt({ updatedAt: 1, lastActivityAt: Number.POSITIVE_INFINITY })).toBeNull();
  });

  it('keeps background session kinds out of the human set', () => {
    expect([...HUMAN_SESSION_KINDS].sort()).toEqual(['channel', 'direct', 'group', 'main', 'other']);
    expect(HUMAN_SESSION_KINDS.has('subagent')).toBe(false);
    expect(HUMAN_SESSION_KINDS.has('cron')).toBe(false);
  });
});
