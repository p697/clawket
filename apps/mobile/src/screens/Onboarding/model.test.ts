import {
  createPairingSubmission,
  formatVerificationCode,
  isPlausibleEmail,
  isVerificationCodeComplete,
  normalizeEmail,
  normalizeVerificationCode,
  resolveOnboardingError,
} from './model';

describe('Onboarding model', () => {
  it('normalizes typed and pasted pairing codes to six digits', () => {
    expect(normalizeVerificationCode(' 12a3-45 67 ')).toBe('123456');
    expect(normalizeVerificationCode('')).toBe('');
  });

  it('groups complete and partial codes without changing their value', () => {
    expect(formatVerificationCode('12')).toBe('12');
    expect(formatVerificationCode('123')).toBe('123');
    expect(formatVerificationCode('123456')).toBe('123 456');
  });

  it('accepts only complete six-digit verification codes', () => {
    expect(isVerificationCodeComplete('123 456')).toBe(true);
    expect(isVerificationCodeComplete('12345')).toBe(false);
    expect(isVerificationCodeComplete('1234567')).toBe(true);
  });

  it('keeps backend and transport identities separate in pairing submissions', () => {
    expect(createPairingSubmission('openclaw', '123 456')).toEqual({
      backendKind: 'openclaw',
      transportKind: 'relay',
      code: '123456',
    });
    expect(createPairingSubmission('hermes', '654321')).toEqual({
      backendKind: 'hermes',
      transportKind: 'relay',
      code: '654321',
    });
    expect(createPairingSubmission('hermes', '12345')).toBeNull();
  });

  it('normalizes email without changing meaningful casing', () => {
    expect(normalizeEmail('  Lucy@Example.com  ')).toBe('Lucy@Example.com');
    expect(isPlausibleEmail('lucy@example.com')).toBe(true);
    expect(isPlausibleEmail('lucy@localhost')).toBe(false);
    expect(isPlausibleEmail('lucy@@example.com')).toBe(false);
  });

  it('uses backend-specific copy only for the backend response error', () => {
    expect(resolveOnboardingError('gateway_offline', 'openclaw')).toEqual({
      messageKey: 'OpenClaw is not responding',
      actionKey: 'Retry',
    });
    expect(resolveOnboardingError('gateway_offline', 'hermes')).toEqual({
      messageKey: 'Hermes is not responding',
      actionKey: 'Retry',
    });
  });

  it('maps every adapter error to concise copy and at most one action', () => {
    const codes = [
      'unauthorized',
      'pairing_required',
      'pairing_expired',
      'bridge_offline',
      'gateway_offline',
      'network',
      'timeout',
      'rate_limited',
      'frame_too_large',
      'unsupported',
      'server',
    ] as const;

    for (const code of codes) {
      const presentation = resolveOnboardingError(code, 'openclaw');
      expect(presentation.messageKey.length).toBeGreaterThan(0);
      expect(presentation.actionKey === undefined || presentation.actionKey.length > 0).toBe(true);
    }
  });
});
