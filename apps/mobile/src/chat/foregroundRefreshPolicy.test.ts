import {
  FOREGROUND_REFRESH_DELAY_MS_LONG,
  FOREGROUND_REFRESH_DELAY_MS_SHORT,
  FOREGROUND_RECONNECT_AWAY_MS,
  getForegroundRefreshDelayMs,
  shouldReconnectBeforeForegroundRefresh,
} from './foregroundRefreshPolicy';

describe('shouldReconnectBeforeForegroundRefresh', () => {
  it('does not force reconnect while a run is still active', () => {
    expect(shouldReconnectBeforeForegroundRefresh({
      platformOs: 'android',
      awayMs: FOREGROUND_RECONNECT_AWAY_MS + 1,
      hasRunningChat: true,
      connectionState: 'ready',
    })).toBe(false);
  });

  it('does not force reconnect after a short background gap', () => {
    expect(shouldReconnectBeforeForegroundRefresh({
      platformOs: 'android',
      awayMs: FOREGROUND_RECONNECT_AWAY_MS - 1,
      hasRunningChat: false,
      connectionState: 'ready',
    })).toBe(false);
  });

  it('forces reconnect for long-idle ready sessions before refreshing history', () => {
    expect(shouldReconnectBeforeForegroundRefresh({
      platformOs: 'android',
      awayMs: FOREGROUND_RECONNECT_AWAY_MS,
      hasRunningChat: false,
      connectionState: 'ready',
    })).toBe(true);
  });

  it('does not force reconnect while pairing approval is pending', () => {
    expect(shouldReconnectBeforeForegroundRefresh({
      platformOs: 'android',
      awayMs: FOREGROUND_RECONNECT_AWAY_MS + 1,
      hasRunningChat: false,
      connectionState: 'pairing_pending',
    })).toBe(false);
  });

  it('forces reconnect on iOS even after a brief background gap', () => {
    expect(shouldReconnectBeforeForegroundRefresh({
      platformOs: 'ios',
      awayMs: 1_000,
      hasRunningChat: false,
      connectionState: 'ready',
    })).toBe(true);
  });
});

describe('getForegroundRefreshDelayMs', () => {
  it('uses the short delay for quick returns', () => {
    expect(getForegroundRefreshDelayMs(3_999)).toBe(FOREGROUND_REFRESH_DELAY_MS_SHORT);
  });

  it('uses the longer delay after a noticeable background gap', () => {
    expect(getForegroundRefreshDelayMs(4_000)).toBe(FOREGROUND_REFRESH_DELAY_MS_LONG);
  });
});
