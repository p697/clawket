import { describe, it, expect, vi } from 'vitest';
import { providerFailure, logSpeech } from './diagnostics';
import { quotaRejection, reserveQuota } from './quota';
describe('actionable and private speech diagnostics', () => {
  it('maps provider failures without returning provider text or credentials', () => {
    expect(providerFailure('Throttling')).toBe('speech_provider_busy');
    expect(providerFailure('InvalidApiKey')).toBe('speech_provider_auth');
    expect(providerFailure('QuotaExhausted')).toBe('speech_provider_quota');
    expect(providerFailure('unknown secret payload')).toBe('speech_provider_failed');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    logSpeech('server-uuid', 'session', 'speech_provider_failed', { bytes: 3200 });
    expect(JSON.parse(log.mock.calls[0]![0])).toEqual({ event: 'speech_session', requestId: 'server-uuid', stage: 'session', code: 'speech_provider_failed', bytes: 3200 });
    log.mockRestore();
  });
  it('distinguishes occupancy, replay, exhausted quota and corrupt storage with exact waits', () => {
    const state = reserveQuota(undefined, 'nonce', 1, 3600000, true, 1000)!;
    expect(quotaRejection(state, 'new', 1, 3600000, true, 2000)).toMatchObject({ reason: 'busy', retryAfterMs: 149000 });
    expect(quotaRejection(state, 'nonce', 1, 3600000, true, 2000).reason).toBe('replay');
    expect(quotaRejection({ ...state, activeUntil: 0 }, 'new', 1, 3600000, true, 2000)).toMatchObject({ reason: 'quota', retryAfterMs: 3598000 });
    expect(quotaRejection({ ...state, count: -1 }, 'new', 1, 3600000, true, 2000).reason).toBe('storage');
  });
});
