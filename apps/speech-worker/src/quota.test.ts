import { describe, expect, it } from 'vitest';
import { activateQuota, quotaRejection, reserveQuota, SETUP_LEASE_MS, type Quota } from './quota';
describe('durable admission decisions', () => {
  it('expires abandoned setup in 25 seconds without refunding quota or replay protection', () => {
    const pending = reserveQuota(undefined, 'old', 60, 3600000, true, 1000000, SETUP_LEASE_MS)!;
    expect(quotaRejection(pending, 'new', 60, 3600000, true, 1000001)).toMatchObject({ reason: 'busy', retryAfterMs: 24999 });
    expect(reserveQuota(pending, 'new', 60, 3600000, true, 1024999, SETUP_LEASE_MS)).toBeNull();
    const replacement = reserveQuota(pending, 'new', 60, 3600000, true, 1025000, SETUP_LEASE_MS)!;
    expect(replacement.count).toBe(2);
    expect(activateQuota(pending, 'old', 1025000)).toBeNull();
    expect(activateQuota(replacement, 'old', 1025001)).toBeNull();
    expect(quotaRejection(replacement, 'old', 60, 3600000, true, 1025001).reason).toBe('replay');
  });
  it('promotes only the current setup and retains the full normal recording allowance', () => {
    const pending = reserveQuota(undefined, 'a', 60, 3600000, true, 1000000, SETUP_LEASE_MS)!;
    const active = activateQuota(pending, 'a', 1010000)!;
    expect(active.activeUntil).toBe(1160000);
    expect(active.count).toBe(1);
    expect(reserveQuota(active, 'b', 60, 3600000, true, 1130000, SETUP_LEASE_MS)).toBeNull();
    expect(activateQuota(undefined, 'a', 0)).toBeNull();
    expect(activateQuota({ ...pending, activeUntil: NaN }, 'a', 0)).toBeNull();
    expect(reserveQuota(undefined, 'a', 60, 3600000, true, 0, 1)).toBeNull();
  });
  it('reserves the full attempt, rejects concurrency and retains replay defense across the hour', () => {
    const first = reserveQuota(undefined, 'a', 60, 3600000, true, 3599000)!;
    expect(reserveQuota(first, 'b', 60, 3600000, true, 3600000)).toBeNull();
    const released = { ...first, activeUntil: 0, activeNonce: '' };
    expect(reserveQuota(released, 'a', 60, 3600000, true, 3600000)).toBeNull();
    expect(reserveQuota(released, 'b', 60, 3600000, true, 3600000)?.count).toBe(1);
  });
  it('enforces a fixed budget despite failures/cancellations and resets next day', () => {
    let state: Quota | undefined;
    for (let i = 0; i < 200; i++) state = reserveQuota(state, String(i), 200, 86400000, false, 1000000)!;
    expect(reserveQuota(state, 'over', 200, 86400000, false, 1000001)).toBeNull();
    expect(reserveQuota(state, 'tomorrow', 200, 86400000, false, 86400000)?.count).toBe(1);
  });
  it('expires replay records and fails closed on malformed persistent inputs', () => {
    const state = reserveQuota(undefined, 'a', 60, 3600000, false, 1000000)!;
    expect(reserveQuota(state, 'b', 60, 3600000, false, 1200000)?.nonces).toHaveLength(1);
    for (const bad of [{}, { ...state, count: -1 }, { ...state, nonces: [null] }]) {
      expect(reserveQuota(bad as Quota, 'b', 60, 3600000, true, 1000001)).toBeNull();
    }
    expect(reserveQuota(undefined, 'a', 0, 3600000, false, 1000000)).toBeNull();
  });
});
