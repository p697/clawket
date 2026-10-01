/** Why a Clawket Hermes Bridge cannot use the Hermes API, as its `/health` reports it. */
export type HermesApiIssue = 'credential_mismatch' | 'unreachable' | 'unavailable';

/**
 * Returns null while the Bridge can use the Hermes API. A Bridge that predates
 * `hermesApiReachable` keeps the previous success path; one that reports an
 * unusable API without a known cause is `unavailable`.
 */
export function readHermesApiIssue(health: unknown): HermesApiIssue | null {
  if (typeof health !== 'object' || health === null || Array.isArray(health)) return null;
  const { hermesApiReachable, hermesApiIssue } = health as Record<string, unknown>;
  if (hermesApiReachable !== false) return null;
  return hermesApiIssue === 'credential_mismatch' || hermesApiIssue === 'unreachable' ? hermesApiIssue : 'unavailable';
}

export function describeHermesApiIssue(issue: HermesApiIssue, apiBaseUrl: string): string {
  if (issue === 'credential_mismatch') {
    return `Hermes is not ready: the Hermes gateway at ${apiBaseUrl} rejected Clawket's API key. `
      + 'Clawket replaces only a gateway it can prove it started, so it left this one running. '
      + 'Rerun this command with --restart-hermes to stop the running Hermes gateway and let Clawket start its own, '
      + "or start the Clawket Hermes bridge with CLAWKET_HERMES_API_KEY set to that gateway's API_SERVER_KEY.";
  }
  if (issue === 'unreachable') {
    return `Hermes is not ready: the Clawket Hermes bridge cannot reach the Hermes API at ${apiBaseUrl}. `
      + 'Run clawket doctor and clawket logs to see why, then rerun this command.';
  }
  return `Hermes is not ready: the Clawket Hermes bridge reports that the Hermes API at ${apiBaseUrl} is unavailable. `
    + 'Run clawket doctor, or rerun this command with --restart-hermes to restart the Hermes gateway.';
}

/** A Hermes pairing the App could not use yet; callers report it instead of printing a QR. */
export class HermesApiNotReadyError extends Error {
  constructor(
    readonly issue: HermesApiIssue,
    message: string,
    readonly jsonValue: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'HermesApiNotReadyError';
  }
}
