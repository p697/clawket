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
    expect(ONBOARDING_WEBSITE_URLS).toEqual({
      openclaw: 'https://openclaw.ai',
      hermes: 'https://hermes-agent.nousresearch.com',
      youmind: 'https://youmind.com',
    });
  });

  it('normalizes non-pairable route backends without treating YouMind as a transport', () => {
    expect(normalizePairableBackendKind('hermes')).toBe('hermes');
    expect(normalizePairableBackendKind('openclaw')).toBe('openclaw');
    expect(normalizePairableBackendKind('youmind')).toBe('openclaw');
  });

  it('maps transport failures to stable adapter errors', () => {
    expect(resolveOnboardingAdapterError({ code: 'network' })).toBe('network');
    expect(resolveOnboardingAdapterError(new Error('This QR code has expired.'))).toBe('pairing_expired');
    expect(resolveOnboardingAdapterError(new Error('Could not reach pairing service.'))).toBe('network');
    expect(resolveOnboardingAdapterError(new Error('Unexpected response.'))).toBe('server');
  });

  it('derives loading, progress, offline, ready, and error page states', () => {
    const base = {
      initialized: true,
      connectionCount: 0,
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
      connectionCount: 1,
      activeState: 'offline',
    })).toEqual({ kind: 'offline' });
    expect(resolveOnboardingRouteStatus({
      ...base,
      activeState: 'ready',
      operation: { active: true, phase: 'waiting_bridge' },
    })).toEqual({ kind: 'connecting', phase: 'ready' });
    expect(resolveOnboardingRouteStatus({
      ...base,
      operation: { active: false, phase: 'relay_connected', errorCode: 'unsupported' },
    })).toEqual({ kind: 'error', code: 'unsupported' });
  });
});
