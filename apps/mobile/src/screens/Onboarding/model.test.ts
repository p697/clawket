import {
  buildAgentPairingPrompt,
  buildLocalModelPairingCommand,
  LOCAL_MODEL_ENGINES,
  createPairingSubmission,
  formatVerificationCode,
  isPlausibleEmail,
  isVerificationCodeComplete,
  normalizeEmail,
  normalizeVerificationCode,
  resolveOnboardingError,
} from './model';

describe('Onboarding model', () => {
  it('builds an agent message that names the open-source CLI, the exact command, and the printed code line', () => {
    const t = (key: string, options: { ns: 'config'; pairCommand: string }) => key.replace('{{pairCommand}}', options.pairCommand);
    const prompt = buildAgentPairingPrompt(t, 'npx @p697/clawket pair --preview');
    expect(prompt).toContain('npx @p697/clawket pair --preview');
    expect(prompt).toContain('open-source');
    expect(prompt).toContain('"Pairing code:"');
    expect(buildAgentPairingPrompt(t)).toContain('npx @p697/clawket pair');
  });

  it('spells out engine and address for model servers that do not match the CLI default', () => {
    expect(LOCAL_MODEL_ENGINES).toEqual(['llamacpp', 'ollama', 'openai-compatible']);
    expect(buildLocalModelPairingCommand('llamacpp')).toBe('npx @p697/clawket pair --backend local-model');
    expect(buildLocalModelPairingCommand('ollama')).toBe('npx @p697/clawket pair --backend local-model --engine ollama --base-url http://127.0.0.1:11434');
    expect(buildLocalModelPairingCommand('openai-compatible')).toBe('npx @p697/clawket pair --backend local-model --engine openai-compatible --base-url http://127.0.0.1:1234');
  });

  it('removes separators without silently changing malformed invitation values', () => {
    expect(normalizeVerificationCode(' 12a3-45 67 ')).toBe('12A34567');
    expect(normalizeVerificationCode(' ab1c-2o34 ', 'hermes')).toBe('AB1C2O34');
    expect(normalizeVerificationCode('')).toBe('');
  });

  it('groups complete and partial codes without changing their value', () => {
    expect(formatVerificationCode('12')).toBe('12');
    expect(formatVerificationCode('123')).toBe('123');
    expect(formatVerificationCode('123456')).toBe('123 456');
    expect(formatVerificationCode('abc234', 'hermes')).toBe('ABC 234');
  });

  it('accepts only complete six-digit verification codes', () => {
    expect(isVerificationCodeComplete('123 456')).toBe(true);
    expect(isVerificationCodeComplete('12345')).toBe(false);
    expect(isVerificationCodeComplete('1234567')).toBe(false);
    expect(isVerificationCodeComplete('ab1c-2o34', 'hermes')).toBe(false);
    expect(isVerificationCodeComplete('ABC 234', 'hermes')).toBe(true);
  });

  it('preserves legacy encrypted OpenClaw codes without changing Hermes code semantics', () => {
    const legacy = 'ABCD EFGH JKMN';
    expect(formatVerificationCode(legacy)).toBe(legacy);
    expect(createPairingSubmission('openclaw', legacy)?.code).toBe('ABCDEFGHJKMN');
    expect(createPairingSubmission('hermes', legacy)).toBeNull();
  });

  it('keeps backend and transport identities separate in pairing submissions', () => {
    expect(createPairingSubmission('openclaw', '123 456')).toEqual({
      backendKind: 'openclaw',
      transportKind: 'relay',
      code: '123456',
    });
    expect(createPairingSubmission('hermes', 'abc234')).toEqual({
      backendKind: 'hermes',
      transportKind: 'relay',
      code: 'ABC234',
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
