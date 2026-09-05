import {
  findPendingApprovalTarget,
  isApprovalScanFresh,
  remainingLaunchPaywallDelay,
  resolveStartupNavigation,
  type ResolveStartupNavigationInput,
  type StartupThreadTarget,
} from './launch-paywall';

const onboardingTarget: StartupThreadTarget = {
  connectionId: 'active',
  agentId: 'main',
  sessionKey: 'agent:main:main',
  from: 'onboarding',
};

function input(
  patch: Partial<ResolveStartupNavigationInput> = {},
): ResolveStartupNavigationInput {
  return {
    rosterRendered: true,
    approvalScanReady: true,
    activeState: 'ready',
    subscriptionLoading: false,
    isPro: false,
    launchPaywallShownThisProcess: false,
    pendingAutoOpen: null,
    pendingApproval: null,
    threePointZeroIntroPending: false,
    ...patch,
  };
}

describe('resolveStartupNavigation', () => {
  it('waits until the roster is rendered and the active backend is ready', () => {
    expect(resolveStartupNavigation(input({ rosterRendered: false }))).toEqual({ type: 'wait' });
    expect(resolveStartupNavigation(input({ activeState: 'connecting' }))).toEqual({ type: 'wait' });
    expect(resolveStartupNavigation(input({ activeState: 'error' }))).toEqual({ type: 'wait' });
  });

  it('waits for approval evidence refreshed after the current ready transition', () => {
    expect(resolveStartupNavigation(input({ approvalScanReady: false }))).toEqual({ type: 'wait' });
  });

  it('does not decide while subscription state is still loading', () => {
    expect(resolveStartupNavigation(input({ subscriptionLoading: true }))).toEqual({ type: 'wait' });
  });

  it('shows the generic launch paywall once a free user is ready', () => {
    expect(resolveStartupNavigation(input())).toEqual({ type: 'show_launch_paywall' });
    expect(resolveStartupNavigation(input({ pendingAutoOpen: onboardingTarget })))
      .toEqual({ type: 'show_launch_paywall' });
  });

  it('shows the one-time 3.0 intro instead of the generic launch paywall, including for Pro', () => {
    expect(resolveStartupNavigation(input({ threePointZeroIntroPending: true }))).toEqual({
      type: 'show_three_point_zero_intro',
    });
    expect(resolveStartupNavigation(input({
      isPro: true,
      pendingAutoOpen: onboardingTarget,
      threePointZeroIntroPending: true,
    }))).toEqual({ type: 'show_three_point_zero_intro' });
  });

  it('opens a pending onboarding thread after the launch opportunity was consumed', () => {
    expect(resolveStartupNavigation(input({
      launchPaywallShownThisProcess: true,
      pendingAutoOpen: onboardingTarget,
      threePointZeroIntroPending: true,
    }))).toEqual({
      type: 'open_thread',
      target: onboardingTarget,
      skipLaunchPaywall: false,
    });
  });

  it('opens a pending onboarding thread directly for Pro users', () => {
    expect(resolveStartupNavigation(input({
      isPro: true,
      pendingAutoOpen: onboardingTarget,
    }))).toEqual({
      type: 'open_thread',
      target: onboardingTarget,
      skipLaunchPaywall: false,
    });
  });

  it('keeps pending approvals on the roster until ready and a fresh approval scan', () => {
    const approval = { ...onboardingTarget, sessionKey: 'approval', from: 'roster' as const };
    expect(resolveStartupNavigation(input({
      activeState: 'offline',
      subscriptionLoading: true,
      pendingApproval: approval,
      threePointZeroIntroPending: true,
    }))).toEqual({ type: 'wait' });
    expect(resolveStartupNavigation(input({
      approvalScanReady: false,
      pendingApproval: approval,
    }))).toEqual({ type: 'wait' });
  });

  it('lets a freshly scanned pending approval pre-empt subscription UI', () => {
    const approval = { ...onboardingTarget, sessionKey: 'approval', from: 'roster' as const };
    expect(resolveStartupNavigation(input({
      subscriptionLoading: true,
      pendingApproval: approval,
      threePointZeroIntroPending: true,
    }))).toEqual({
      type: 'open_thread',
      target: approval,
      skipLaunchPaywall: true,
    });
  });

  it('does not auto-open an approval again after its launch opportunity was consumed', () => {
    const approval = { ...onboardingTarget, sessionKey: 'approval', from: 'roster' as const };
    expect(resolveStartupNavigation(input({
      launchPaywallShownThisProcess: true,
      pendingApproval: approval,
    }))).toEqual({ type: 'stay' });
  });

  it('stays on the roster after a consumed launch opportunity without a pending thread', () => {
    expect(resolveStartupNavigation(input({
      launchPaywallShownThisProcess: true,
      threePointZeroIntroPending: true,
    })))
      .toEqual({ type: 'stay' });
  });
});

describe('approval scan freshness', () => {
  it('rejects cache and stale live roster evidence', () => {
    expect(isApprovalScanFresh('cache', 200, 100)).toBe(false);
    expect(isApprovalScanFresh('live', 99, 100)).toBe(false);
    expect(isApprovalScanFresh('live', 100, 100)).toBe(true);
  });

  it('starts the 500 ms delay after both roster render and ready, without delaying a slow scan again', () => {
    expect(remainingLaunchPaywallDelay(1_000, null, null)).toBe(500);
    expect(remainingLaunchPaywallDelay(1_600, 1_000, 1_600)).toBe(500);
    expect(remainingLaunchPaywallDelay(1_600, 1_600, 1_000)).toBe(500);
    expect(remainingLaunchPaywallDelay(2_200, 1_000, 1_600)).toBe(0);
  });
});

describe('findPendingApprovalTarget', () => {
  const roster = [{
    connection: { id: 'active' },
    agents: [{
      sessions: [
        { agentId: 'main', key: 'older', updatedAt: 10, attention: 'approval' },
        { agentId: 'worker', key: 'newer', updatedAt: 20, attention: 'approval' },
        { agentId: 'main', key: 'error', updatedAt: 30, attention: 'error' },
      ],
    }],
  }, {
    connection: { id: 'inactive' },
    agents: [{
      sessions: [{ agentId: 'main', key: 'inactive', updatedAt: 40, attention: 'approval' }],
    }],
  }];

  it('selects the newest approval on the active connection', () => {
    expect(findPendingApprovalTarget(roster, 'active')).toEqual({
      connectionId: 'active',
      agentId: 'worker',
      sessionKey: 'newer',
      from: 'roster',
    });
  });

  it('ignores inactive and missing connection approvals', () => {
    expect(findPendingApprovalTarget(roster, 'missing')).toBeNull();
    expect(findPendingApprovalTarget(roster, null)).toBeNull();
  });
});
