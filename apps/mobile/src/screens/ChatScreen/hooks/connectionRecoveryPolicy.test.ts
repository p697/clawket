import {
  shouldShowConnectionRecoveryMessage,
  shouldDelayConnectionRecoveryMessage,
  shouldSuppressHermesStartupRecoveryMessage,
} from './connectionRecoveryPolicy';

describe('shouldShowConnectionRecoveryMessage', () => {
  it('returns true for known recovery error codes', () => {
    expect(shouldShowConnectionRecoveryMessage('challenge_timeout')).toBe(true);
    expect(shouldShowConnectionRecoveryMessage('ws_connect_timeout')).toBe(true);
    expect(shouldShowConnectionRecoveryMessage('relay_bootstrap_timeout')).toBe(true);
    expect(shouldShowConnectionRecoveryMessage('device_nonce_mismatch')).toBe(true);
    expect(shouldShowConnectionRecoveryMessage('device_signature_invalid')).toBe(true);
    expect(shouldShowConnectionRecoveryMessage('pairing_required')).toBe(true);
    expect(shouldShowConnectionRecoveryMessage('auth_rejected')).toBe(true);
  });

  it('is case-insensitive for codes', () => {
    expect(shouldShowConnectionRecoveryMessage('CHALLENGE_TIMEOUT')).toBe(true);
    expect(shouldShowConnectionRecoveryMessage('Auth_Rejected')).toBe(true);
  });

  it('returns true for known recovery message substrings', () => {
    expect(shouldShowConnectionRecoveryMessage(undefined, 'challenge timed out after 5s')).toBe(true);
    expect(shouldShowConnectionRecoveryMessage(undefined, 'websocket open timed out')).toBe(true);
    expect(shouldShowConnectionRecoveryMessage(undefined, 'relay bootstrap timed out')).toBe(true);
    expect(shouldShowConnectionRecoveryMessage(undefined, 'pairing required for device')).toBe(true);
    expect(shouldShowConnectionRecoveryMessage(undefined, 'device authentication failed')).toBe(true);
    expect(shouldShowConnectionRecoveryMessage(undefined, 'nonce mismatch detected')).toBe(true);
  });

  it('returns false for unrelated error codes', () => {
    expect(shouldShowConnectionRecoveryMessage('rate_limit')).toBe(false);
    expect(shouldShowConnectionRecoveryMessage('unknown_error')).toBe(false);
  });

  it('returns false for unrelated messages', () => {
    expect(shouldShowConnectionRecoveryMessage(undefined, 'model not found')).toBe(false);
    expect(shouldShowConnectionRecoveryMessage(undefined, 'invalid request')).toBe(false);
  });

  it('returns false when both code and message are undefined', () => {
    expect(shouldShowConnectionRecoveryMessage()).toBe(false);
  });
});

describe('shouldDelayConnectionRecoveryMessage', () => {
  it('returns true for timeout-related codes', () => {
    expect(shouldDelayConnectionRecoveryMessage('ws_connect_timeout')).toBe(true);
    expect(shouldDelayConnectionRecoveryMessage('challenge_timeout')).toBe(true);
    expect(shouldDelayConnectionRecoveryMessage('relay_bootstrap_timeout')).toBe(true);
  });

  it('returns true for timeout-related messages', () => {
    expect(shouldDelayConnectionRecoveryMessage(undefined, 'websocket open timed out')).toBe(true);
    expect(shouldDelayConnectionRecoveryMessage(undefined, 'challenge timed out')).toBe(true);
    expect(shouldDelayConnectionRecoveryMessage(undefined, 'relay bootstrap timed out')).toBe(true);
  });

  it('returns false for non-timeout recovery codes', () => {
    expect(shouldDelayConnectionRecoveryMessage('device_nonce_mismatch')).toBe(false);
    expect(shouldDelayConnectionRecoveryMessage('pairing_required')).toBe(false);
    expect(shouldDelayConnectionRecoveryMessage('auth_rejected')).toBe(false);
  });

  it('returns false for non-timeout messages', () => {
    expect(shouldDelayConnectionRecoveryMessage(undefined, 'device authentication failed')).toBe(false);
    expect(shouldDelayConnectionRecoveryMessage(undefined, 'nonce mismatch')).toBe(false);
  });

  it('returns false when both are undefined', () => {
    expect(shouldDelayConnectionRecoveryMessage()).toBe(false);
  });
});

describe('shouldSuppressHermesStartupRecoveryMessage', () => {
  it('suppresses transient websocket startup noise for Hermes before a session is ready', () => {
    expect(shouldSuppressHermesStartupRecoveryMessage({
      backendKind: 'hermes',
      sessionKey: null,
      connectionState: 'connecting',
      code: 'ws_error',
      message: 'WebSocket error',
    })).toBe(true);
    expect(shouldSuppressHermesStartupRecoveryMessage({
      backendKind: 'hermes',
      sessionKey: null,
      connectionState: 'challenging',
      code: 'challenge_timeout',
      message: 'Gateway challenge timed out',
    })).toBe(true);
  });

  it('still suppresses startup noise for Hermes while the transport is not ready, even if a preview session key exists', () => {
    expect(shouldSuppressHermesStartupRecoveryMessage({
      backendKind: 'hermes',
      sessionKey: 'main',
      connectionState: 'connecting',
      code: 'ws_error',
      message: 'WebSocket error',
    })).toBe(true);
  });

  it('does not suppress Hermes recovery errors once the transport is ready', () => {
    expect(shouldSuppressHermesStartupRecoveryMessage({
      backendKind: 'hermes',
      sessionKey: 'main',
      connectionState: 'ready',
      code: 'ws_error',
      message: 'WebSocket error',
    })).toBe(false);
  });

  it('does not suppress OpenClaw recovery errors', () => {
    expect(shouldSuppressHermesStartupRecoveryMessage({
      backendKind: 'openclaw',
      sessionKey: null,
      connectionState: 'connecting',
      code: 'ws_error',
      message: 'WebSocket error',
    })).toBe(false);
  });
});
