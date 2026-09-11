import type { ConnectionState as AdapterConnectionState } from '@clawket/agent-protocol';

type ForegroundConnectionState = AdapterConnectionState | 'pairing_pending' | 'closed';

export const APP_FOREGROUND_PROBE_AWAY_MS = 60_000;

export function shouldProbeGatewayOnForegroundResume(input: {
  platformOs: string;
  awayMs: number;
  connectionState: ForegroundConnectionState;
}): boolean {
  if (input.connectionState === 'pairing_pending') {
    return false;
  }

  // iOS commonly suspends backgrounded apps hard enough that an inherited
  // "ready" socket cannot be trusted after returning to foreground.
  if (input.platformOs === 'ios' && input.awayMs > 0) {
    return true;
  }

  return input.connectionState !== 'ready' || input.awayMs >= APP_FOREGROUND_PROBE_AWAY_MS;
}
