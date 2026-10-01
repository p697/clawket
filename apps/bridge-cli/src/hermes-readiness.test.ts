import { describe, expect, it } from 'vitest';
import { describeHermesApiIssue, readHermesApiIssue } from './hermes-readiness.js';

describe('Hermes pairing readiness', () => {
  it('reads the cause a Bridge reports for an unusable Hermes API', () => {
    expect(readHermesApiIssue({ hermesApiReachable: true })).toBeNull();
    expect(readHermesApiIssue({ hermesApiReachable: false, hermesApiIssue: 'credential_mismatch' })).toBe('credential_mismatch');
    expect(readHermesApiIssue({ hermesApiReachable: false, hermesApiIssue: 'unreachable' })).toBe('unreachable');
    expect(readHermesApiIssue({ hermesApiReachable: false })).toBe('unavailable');
    expect(readHermesApiIssue({ hermesApiReachable: false, hermesApiIssue: 'please-restart' })).toBe('unavailable');
  });

  it('keeps Bridges that predate the readiness field, and malformed values, on the success path', () => {
    expect(readHermesApiIssue({ ok: true, running: true })).toBeNull();
    for (const payload of [null, undefined, 'degraded', 0, [], [{ hermesApiReachable: false }], { hermesApiReachable: 'false' }]) {
      expect(readHermesApiIssue(payload)).toBeNull();
    }
  });

  it('gives each issue an actionable remedy', () => {
    const mismatch = describeHermesApiIssue('credential_mismatch', 'http://127.0.0.1:8642');
    expect(mismatch).toContain('http://127.0.0.1:8642');
    expect(mismatch).toContain('--restart-hermes');
    expect(mismatch).toContain('CLAWKET_HERMES_API_KEY');
    expect(describeHermesApiIssue('unreachable', 'http://127.0.0.1:8642')).toContain('clawket doctor');
    expect(describeHermesApiIssue('unavailable', 'http://127.0.0.1:8642')).toContain('--restart-hermes');
  });
});
