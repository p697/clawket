import type { BackendKind, TransportKind } from '@clawket/agent-protocol';
import * as Network from 'expo-network';
import { analyticsEvents } from './analytics/events';

export type ConnectionDiagnosticContext = Readonly<{
  backend: BackendKind | 'unknown';
  transport: TransportKind;
  operation: 'connect' | 'foreground_recovery' | 'pair_claim' | 'pair_claim_code' | 'pair_validation';
  environment?: 'production' | 'preview' | 'custom' | 'unknown';
  detected_backend?: BackendKind | 'unknown';
  detected_environment?: 'production' | 'preview' | 'custom' | 'unknown';
}>;
export type DiagnosticPhase = 'socket' | 'handshake' | 'ready' | 'fetch' | 'body'
  | 'pair_payload' | 'pair_claim_result' | 'pair_saved_connection';
type NetworkEvidence = 'offline' | 'wifi' | 'cellular' | 'ethernet' | 'other' | 'unknown' | 'not_sampled';
export type ConnectionDiagnosticResult = Readonly<{
  outcome: 'success' | 'error' | 'timeout';
  phase: DiagnosticPhase;
  code?: string;
  http_status?: number;
}>;
export type ConnectionDiagnosticEvent = ConnectionDiagnosticContext & ConnectionDiagnosticResult & {
  elapsed_ms: number;
  network: NetworkEvidence;
  evidence: 'http_response' | 'os_offline' | 'unconfirmed' | 'completed' | 'local_validation';
};

/** No IP, SSID, reachability probe, URL, request payload or persistent identity. */
async function sampleNetworkAtFailure(): Promise<NetworkEvidence> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const sample = Network.getNetworkStateAsync().then((state): NetworkEvidence => {
      if (state.isConnected === false) return 'offline';
      if (state.isConnected !== true) return 'unknown';
      // iOS isInternetReachable is merely a path flag, not an Internet/Relay probe.
      switch (state.type) {
        case 'WIFI': return 'wifi';
        case 'CELLULAR': return 'cellular';
        case 'ETHERNET': return 'ethernet';
        default: return 'other';
      }
    });
    return await Promise.race([sample, new Promise<NetworkEvidence>(resolve => {
      timer = setTimeout(() => resolve('unknown'), 1_000);
    })]);
  } catch { return 'unknown'; }
  finally { clearTimeout(timer); }
}

/** One outcome per operation. Diagnostics never delay or reject the operation. */
export function startConnectionDiagnostic(context: ConnectionDiagnosticContext) {
  const started = Date.now();
  let finished = false;
  return {
    cancel() { finished = true; },
    finish(result: ConnectionDiagnosticResult): void {
      if (finished) return;
      finished = true;
      const elapsed_ms = Math.min(86_400_000, Math.max(0, Date.now() - started));
      const http_status = Number.isInteger(result.http_status) && result.http_status! >= 100 && result.http_status! <= 599
        ? result.http_status : undefined;
      const publish = (network: NetworkEvidence) => {
        try {
          analyticsEvents.connectionDiagnostic({
            ...context, ...result, http_status, elapsed_ms, network,
            evidence: context.operation === 'pair_validation' ? 'local_validation'
              : result.outcome === 'success' ? 'completed' : http_status ? 'http_response'
              : network === 'offline' ? 'os_offline' : 'unconfirmed',
          });
        } catch { /* Observability must never change connection behavior. */ }
      };
      if (result.outcome === 'success' || context.operation === 'pair_validation') publish('not_sampled');
      else void sampleNetworkAtFailure().then(publish).catch(() => {});
    },
  };
}

export function connectionDiagnosticCode(error: unknown): string {
  return error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
    ? error.code : 'unknown';
}
