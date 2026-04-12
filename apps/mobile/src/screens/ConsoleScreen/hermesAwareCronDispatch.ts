import type { GatewayBackendCapabilities } from '../../services/gateway-backends';

/**
 * Pure decision type for the Cron editor / wizard dispatch.
 *
 * - `'createUnavailable'` — the backend cannot create new cron jobs from
 *   Clawket (Hermes phase 1), and the current route is a create request
 *   (no existing jobId). The component should render the "not available"
 *   short-circuit screen instead of dispatching to a backend screen.
 * - `'backendDispatch'` — let the normal backend-specific component
 *   render. This is the only path OpenClaw ever takes, because
 *   `capabilities.consoleCronCreate` is `true` for OpenClaw.
 */
export type CronEditorDispatchDecision = 'createUnavailable' | 'backendDispatch';

/**
 * Returns `'createUnavailable'` only when the current navigation request
 * is a *create* (no `jobId`) and the backend's capability registry flags
 * `consoleCronCreate: false`. Otherwise returns `'backendDispatch'`.
 *
 * This function is the single source of truth for the capability gate.
 * Keeping it pure lets us unit-test every combination without mounting
 * React components.
 */
export function resolveCronEditorDispatch(input: {
  jobId: string | null | undefined;
  capabilities: Pick<GatewayBackendCapabilities, 'consoleCronCreate'>;
}): CronEditorDispatchDecision {
  const isCreate = !input.jobId;
  if (isCreate && !input.capabilities.consoleCronCreate) {
    return 'createUnavailable';
  }
  return 'backendDispatch';
}
