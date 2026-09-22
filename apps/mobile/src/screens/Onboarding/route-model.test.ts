import {
  getOnboardingPairingCommand,
  normalizePairableBackendKind,
  ONBOARDING_DOCUMENTATION_URLS,
  ONBOARDING_WEBSITE_URLS,
  resolveOnboardingAdapterError,
  resolveOnboardingRouteStatus,
} from './route-model';

describe('Onboarding route model', () => {
  it('uses the environment-specific pairing command and official documentation', () => {
    expect(getOnboardingPairingCommand('production')).toBe('npx @p697/clawket pair');
    expect(getOnboardingPairingCommand('preview')).toBe('npx @p697/clawket pair --preview');
    expect(ONBOARDING_DOCUMENTATION_URLS.openclaw).toBe('https://docs.openclaw.ai/install');
    expect(ONBOARDING_DOCUMENTATION_URLS.hermes).toContain('hermes-agent.nousresearch.com/docs/');
    // The local-model "See how to start it" action lands on the feature document, not the repository root.
    expect(ONBOARDING_DOCUMENTATION_URLS['local-model']).toBe('https://github.com/p697/clawket/blob/main/docs/3.0/15-local-model.md');
    expect(ONBOARDING_WEBSITE_URLS).toEqual({
      openclaw: 'https://openclaw.ai',
      hermes: 'https://hermes-agent.nousresearch.com',
      youmind: 'https://youmind.com',
    });
  });

  it('normalizes non-pairable route backends without treating YouMind as a transport', () => {
    expect(normalizePairableBackendKind('hermes')).toBe('hermes');
    expect(normalizePairableBackendKind('local-model')).toBe('local-model');
    expect(normalizePairableBackendKind('openclaw')).toBe('openclaw');
    expect(normalizePairableBackendKind('youmind')).toBe('openclaw');
  });

  it('maps transport failures to stable adapter errors', () => {
    expect(resolveOnboardingAdapterError({ code: 'network' })).toBe('network');
    expect(resolveOnboardingAdapterError(new Error('This QR code has expired.'))).toBe('pairing_expired');
    expect(resolveOnboardingAdapterError(new Error('Could not reach pairing service.'))).toBe('network');
    expect(resolveOnboardingAdapterError(new Error('Unexpected response.'))).toBe('server');
  });

  it.each(['expired', 'already been used', 'invalid'])(
    'does not mistake a %s QR regeneration instruction for rate limiting', (reason) => {
      expect(resolveOnboardingAdapterError(new Error(
        `This QR code has ${reason}. Generate a new QR code in Clawket Bridge and try again.`,
      ))).toBe('pairing_expired');
    },
  );

  it.each(['RATE_LIMITED', 'Rate limit exceeded', 'Too many pairing attempts', 'HTTP 429'])(
    'preserves the actual rate-limit failure %s', (message) => {
      expect(resolveOnboardingAdapterError(new Error(message))).toBe('rate_limited');
    },
  );

  it('derives loading, progress, offline, ready, and error page states', () => {
    const base = {
      initialized: true,
      activeConnectionId: null,
      activeState: 'idle' as const,
      operation: { active: false, phase: 'relay_connected' as const },
    };
    expect(resolveOnboardingRouteStatus({ ...base, initialized: false })).toEqual({ kind: 'loading' });
    expect(resolveOnboardingRouteStatus({
      ...base,
      operation: { active: true, phase: 'waiting_bridge' },
    })).toEqual({ kind: 'connecting', phase: 'waiting_bridge' });
    expect(resolveOnboardingRouteStatus({
      ...base,
      activeConnectionId: 'paired',
      activeState: 'offline',
      operation: { active: true, phase: 'waiting_bridge', targetConnectionId: 'paired' },
    })).toEqual({ kind: 'offline' });
    expect(resolveOnboardingRouteStatus({
      ...base,
      activeConnectionId: 'paired',
      activeState: 'ready',
      operation: { active: true, phase: 'waiting_bridge', targetConnectionId: 'paired' },
    })).toEqual({ kind: 'connecting', phase: 'ready' });
    expect(resolveOnboardingRouteStatus({
      ...base,
      activeConnectionId: 'paired',
      activeState: 'error',
      runtimeError: 'Could not reach pairing service.',
      operation: { active: true, phase: 'waiting_bridge', targetConnectionId: 'paired' },
    })).toEqual({ kind: 'error', code: 'network' });
    expect(resolveOnboardingRouteStatus({
      ...base,
      operation: { active: false, phase: 'relay_connected', errorCode: 'unsupported' },
    })).toEqual({ kind: 'error', code: 'unsupported' });
  });

  it('ignores the state of an unrelated existing connection', () => {
    // "Add connection" opened while the current connection is offline: the
    // pairing form must not report that as a network problem (owner report
    // 2026-09-19), and the old connection's readiness must not mark the new
    // pairing as ready or errored.
    const existing = {
      initialized: true,
      activeConnectionId: 'existing',
      runtimeError: 'OpenClaw is not responding',
    };
    for (const activeState of ['offline', 'reconnecting', 'error'] as const) {
      expect(resolveOnboardingRouteStatus({
        ...existing,
        activeState,
        operation: { active: false, phase: 'relay_connected' },
      })).toEqual({ kind: 'idle' });
      expect(resolveOnboardingRouteStatus({
        ...existing,
        activeState,
        operation: { active: true, phase: 'relay_connected', targetConnectionId: null },
      })).toEqual({ kind: 'connecting', phase: 'relay_connected' });
    }
    expect(resolveOnboardingRouteStatus({
      ...existing,
      activeState: 'ready',
      operation: { active: true, phase: 'waiting_bridge', targetConnectionId: 'paired' },
    })).toEqual({ kind: 'connecting', phase: 'waiting_bridge' });
  });
});
