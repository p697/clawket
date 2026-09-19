import { describe, expect, it } from 'vitest';
import { reserveQuota, type Quota } from './quota';
describe('durable admission decisions', () => {
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
