import type { ConnectionState, GatewayBackendKind } from '../../../types';

export function shouldShowConnectionRecoveryMessage(code?: string, message?: string): boolean {
  const normalizedCode = (code ?? '').toLowerCase();
  const normalizedMessage = (message ?? '').toLowerCase();
  if (
    normalizedCode === 'ws_error'
    || normalizedCode === 'auth_failed'
    || normalizedCode === 'challenge_timeout'
    || normalizedCode === 'ws_connect_timeout'
    || normalizedCode === 'relay_bootstrap_timeout'
    || normalizedCode === 'device_nonce_mismatch'
    || normalizedCode === 'device_signature_invalid'
    || normalizedCode === 'pairing_required'
    || normalizedCode === 'auth_rejected'
  ) {
    return true;
  }
  return normalizedMessage.includes('challenge timed out')
    || normalizedMessage.includes('websocket error')
    || normalizedMessage.includes('websocket open timed out')
    || normalizedMessage.includes('relay bootstrap timed out')
    || normalizedMessage.includes('pairing required')
    || normalizedMessage.includes('device authentication')
    || normalizedMessage.includes('nonce mismatch');
}

export function shouldDelayConnectionRecoveryMessage(code?: string, message?: string): boolean {
  const normalizedCode = (code ?? '').toLowerCase();
  const normalizedMessage = (message ?? '').toLowerCase();
  if (
    normalizedCode === 'ws_error'
    || normalizedCode === 'auth_failed'
    || normalizedCode === 'ws_connect_timeout'
    || normalizedCode === 'challenge_timeout'
    || normalizedCode === 'relay_bootstrap_timeout'
  ) {
    return true;
  }
  return normalizedMessage.includes('websocket error')
    || normalizedMessage.includes('websocket open timed out')
    || normalizedMessage.includes('challenge timed out')
    || normalizedMessage.includes('relay bootstrap timed out');
}

// This function encodes a Hermes-specific suppression rule: during the
// Hermes bridge boot window, transient websocket / auth errors should
// be silenced because the bridge is still coming up. It is named after
// Hermes intentionally — it is not a generic connection recovery rule.
// OpenClaw uses a different recovery model and is guarded out early.
export function shouldSuppressHermesStartupRecoveryMessage(input: {
  backendKind?: GatewayBackendKind;
  sessionKey?: string | null;
  connectionState?: ConnectionState;
  code?: string;
  message?: string;
}): boolean {
  if (input.backendKind !== 'hermes') return false;
  if (input.connectionState === 'ready') return false;

  const normalizedCode = (input.code ?? '').toLowerCase();
  const normalizedMessage = (input.message ?? '').toLowerCase();
  return normalizedCode === 'ws_error'
    || normalizedCode === 'ws_connect_timeout'
    || normalizedCode === 'challenge_timeout'
    || normalizedCode === 'auth_failed'
    || normalizedMessage.includes('websocket error')
    || normalizedMessage.includes('websocket open timed out')
    || normalizedMessage.includes('challenge timed out');
}
