import { AdapterError } from '@clawket/agent-protocol';
import type { PairingPayloadAssessment } from './gateway-scan-flow';

export type PairingValidationReason =
  | Extract<PairingPayloadAssessment, { kind: 'rejected' }>['reason']
  | 'saved_connection_mismatch';

const REASONS = new Set<PairingValidationReason>([
  'invalid_backend', 'backend_mismatch', 'preview_requires_debug_mode',
  'official_environment_mismatch', 'saved_connection_mismatch',
]);

/** Keep the legacy adapter code, without losing the local pairing failure. */
export class PairingValidationError extends AdapterError {
  constructor(public readonly pairingReason: PairingValidationReason, message: string) {
    super('unsupported', message);
  }
}

/** Read only fixed categories; never turn exception text into UI or telemetry. */
export function resolvePairingValidationReason(error: unknown): PairingValidationReason | undefined {
  if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'unsupported') return;
  const reason = 'pairingReason' in error ? error.pairingReason : undefined;
  return typeof reason === 'string' && REASONS.has(reason as PairingValidationReason)
    ? reason as PairingValidationReason : undefined;
}
