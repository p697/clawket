import { describe, expect, it } from 'vitest';
import { RelaySessionState } from './relay-session.js';

describe('RelaySessionState', () => {
  it('preserves linear reconnect backoff until health is confirmed', () => {
    const state = new RelaySessionState();

    expect(state.beginConnectAttempt()).toBe(1);
    expect(state.reconnectDelayMs(1_000, 15_000)).toBe(1_000);
    expect(state.beginConnectAttempt()).toBe(2);
    expect(state.reconnectDelayMs(1_000, 15_000)).toBe(2_000);
    expect(state.reconnectDelayMs(10_000, 15_000)).toBe(15_000);

    expect(state.confirmHealth(20_000)).toBe(true);
    expect(state.reconnectDelayMs(1_000, 15_000)).toBe(1_000);
    expect(state.confirmHealth(21_000)).toBe(false);
    expect(state.beginConnectAttempt()).toBe(1);
  });

  it('tracks activity with the existing strict heartbeat timeout boundary', () => {
    const state = new RelaySessionState();
    state.observeActivity(10_000);
    expect(state.activityAgeMs(9_000)).toBe(0);
    expect(state.activityAgeMs(45_000)).toBe(35_000);

    expect(state.heartbeatTimedOut(35_000, 45_000)).toBe(false);
    expect(state.heartbeatTimedOut(35_000, 45_001)).toBe(true);

    state.confirmHealth(50_000);
    expect(state.heartbeatTimedOut(35_000, 85_000)).toBe(false);
  });
});
