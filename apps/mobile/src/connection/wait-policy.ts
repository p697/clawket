import type { BackendKind } from '@clawket/agent-protocol';
import { Motion } from '../theme/tokens';

/** Codex device entry can need several bounded catalog pages after its handshake. */
export function connectionSlowHintMs(backend?: BackendKind): number {
  return backend === 'codex' ? 12_000 : Motion.loadingSlowHint;
}
