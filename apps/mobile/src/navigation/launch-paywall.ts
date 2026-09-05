import type { ConnectionState } from '@clawket/agent-protocol';

export type StartupThreadTarget = Readonly<{
  connectionId: string;
  agentId: string;
  sessionKey: string;
  from: 'onboarding' | 'roster';
}>;

type ApprovalSession = Readonly<{
  agentId: string;
  key: string;
  updatedAt: number | null;
  attention?: string | null;
}>;

type ApprovalRosterGroup = Readonly<{
  connection: Readonly<{ id: string }>;
  agents: ReadonlyArray<Readonly<{
    sessions: ReadonlyArray<ApprovalSession>;
  }>>;
}>;

export type StartupNavigationAction =
  | Readonly<{ type: 'wait' | 'stay' }>
  | Readonly<{ type: 'show_launch_paywall' }>
  | Readonly<{ type: 'show_three_point_zero_intro' }>
  | Readonly<{ type: 'open_thread'; target: StartupThreadTarget; skipLaunchPaywall: boolean }>;

export type ResolveStartupNavigationInput = Readonly<{
  rosterRendered: boolean;
  approvalScanReady: boolean;
  activeState: ConnectionState;
  subscriptionLoading: boolean;
  isPro: boolean;
  launchPaywallShownThisProcess: boolean;
  pendingAutoOpen: StartupThreadTarget | null;
  pendingApproval: StartupThreadTarget | null;
  threePointZeroIntroPending?: boolean;
}>;

/**
 * Resolves the only root-level startup decision. Pending approvals pre-empt
 * subscription UI; all other automatic navigation waits for backend-ready so
 * failed connections remain visibly recoverable on the roster.
 */
export function resolveStartupNavigation(
  input: ResolveStartupNavigationInput,
): StartupNavigationAction {
  if (!input.rosterRendered) return { type: 'wait' };
  if (input.activeState !== 'ready') return { type: 'wait' };
  if (!input.approvalScanReady) return { type: 'wait' };

  // A pending approval consumes this cold-start opportunity before navigation.
  // Once claimed, returning to Roster must not auto-open that approval again.
  if (input.launchPaywallShownThisProcess) {
    if (input.pendingAutoOpen) {
      return {
        type: 'open_thread',
        target: input.pendingAutoOpen,
        skipLaunchPaywall: false,
      };
    }
    return { type: 'stay' };
  }

  if (input.pendingApproval) {
    return {
      type: 'open_thread',
      target: input.pendingApproval,
      skipLaunchPaywall: true,
    };
  }

  if (input.subscriptionLoading) return { type: 'wait' };

  if (input.threePointZeroIntroPending) {
    return { type: 'show_three_point_zero_intro' };
  }

  if (!input.isPro) {
    return { type: 'show_launch_paywall' };
  }

  if (input.pendingAutoOpen) {
    return {
      type: 'open_thread',
      target: input.pendingAutoOpen,
      skipLaunchPaywall: false,
    };
  }

  return { type: 'stay' };
}

/** True only when roster evidence was refreshed after the current ready transition. */
export function isApprovalScanFresh(
  source: 'live' | 'cache' | undefined,
  syncedAt: number | undefined,
  lastReadyAt: number | null | undefined,
): boolean {
  return source === 'live'
    && typeof syncedAt === 'number'
    && typeof lastReadyAt === 'number'
    && syncedAt >= lastReadyAt;
}

export const LAUNCH_PAYWALL_DELAY_MS = 500;

/** Starts the delay only after both the Roster is rendered and the backend is ready. */
export function remainingLaunchPaywallDelay(
  now: number,
  lastReadyAt: number | null,
  rosterRenderedAt: number | null,
): number {
  if (lastReadyAt === null || rosterRenderedAt === null) return LAUNCH_PAYWALL_DELAY_MS;
  const eligibleAt = Math.max(lastReadyAt, rosterRenderedAt);
  return Math.max(0, (eligibleAt + LAUNCH_PAYWALL_DELAY_MS) - now);
}

/** Selects the newest actionable approval on the active connection only. */
export function findPendingApprovalTarget(
  roster: ReadonlyArray<ApprovalRosterGroup>,
  activeConnectionId: string | null,
): StartupThreadTarget | null {
  if (!activeConnectionId) return null;
  const group = roster.find((candidate) => candidate.connection.id === activeConnectionId);
  if (!group) return null;

  const newest = group.agents
    .flatMap((agent) => agent.sessions)
    .filter((session) => session.attention === 'approval')
    .sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0))[0];
  if (!newest) return null;

  return {
    connectionId: activeConnectionId,
    agentId: newest.agentId,
    sessionKey: newest.key,
    from: 'roster',
  };
}
