import type { ConnectionState } from '../types';

export const FOREGROUND_REFRESH_DELAY_MS_SHORT = 500;
export const FOREGROUND_REFRESH_DELAY_MS_LONG = 800;
export const FOREGROUND_RECONNECT_AWAY_MS = 8_000;
export const FOREGROUND_REFRESH_AFTER_RECONNECT_TIMEOUT_MS = 2_000;

export function shouldReconnectBeforeForegroundRefresh(input: {
  platformOs: string;
  awayMs: number;
  hasRunningChat: boolean;
  connectionState: ConnectionState;
}): boolean {
  if (input.hasRunningChat) return false;
  if (input.connectionState === 'pairing_pending') return false;
  if (input.platformOs === 'ios' && input.awayMs > 0) return true;
  if (input.awayMs < FOREGROUND_RECONNECT_AWAY_MS) return false;
  return true;
}

export function getForegroundRefreshDelayMs(awayMs: number): number {
  return awayMs >= 4_000 ? FOREGROUND_REFRESH_DELAY_MS_LONG : FOREGROUND_REFRESH_DELAY_MS_SHORT;
}
