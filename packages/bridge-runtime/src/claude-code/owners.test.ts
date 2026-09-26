import { describe, expect, it } from 'vitest';
import { parseClaudeOwners } from './owners.js';

describe('Claude native ownership', () => {
  it('retains idle owners and unfamiliar statuses as owned', () => {
    expect(parseClaudeOwners([
      { sessionId: 'one', cwd: '/project', pid: 42, kind: 'interactive', status: 'idle' },
      { sessionId: 'two', cwd: '/project', kind: 'background', status: 'new-status' },
    ])).toEqual({ known: true, owners: [
      { sessionId: 'one', cwd: '/project', pid: 42, status: 'idle' },
      { sessionId: 'two', cwd: '/project', status: 'unknown' },
    ] });
  });
  it.each([null, {}, { agents: [] }, [{ pid: 42 }], [null], '[]'])('does not treat malformed native data as no owner', input => {
    expect(parseClaudeOwners(input)).toEqual({ known: false, owners: [] });
  });
  it('distinguishes a validated empty roster from unknown ownership', () => {
    expect(parseClaudeOwners([])).toEqual({ known: true, owners: [] });
  });
});
