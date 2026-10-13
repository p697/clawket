const DAY_MS = 86_400_000;
export const REVIEW_COOLDOWN_MS = 60 * DAY_MS;
export const REVIEW_YEAR_MS = 365 * DAY_MS;
export const REVIEW_RECENCY_MS = 7 * DAY_MS;
export type AutoAppReviewState = {
  version: 3;
  completedTurns: number;
  successfulDays: string[];
  lastCompletedAtMs?: number;
  attempts: { atMs: number; appVersion: string }[];
  lastManualAtMs?: number;
};
export type ReviewEligibility = 'eligible' | 'experience' | 'stale' | 'cooldown' | 'annual_limit' | 'version';
export const emptyReviewState = (): AutoAppReviewState => ({ version: 3, completedTurns: 0, successfulDays: [], attempts: [] });
const timestamp = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 8.64e15;

export function normalizeAutoAppReviewState(value: unknown): AutoAppReviewState | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (record.version !== 3) {
    // Old send/launch counters prove no completed conversation. Preserve only invitations.
    const legacy = [record.reviewAttemptedAtMs, record.reviewRequestedAtMs, record.lastAttemptAtMs].filter(timestamp);
    if (record.version !== 2 && !timestamp(record.firstSeenAtMs) && !legacy.length) return null;
    return { ...emptyReviewState(), attempts: legacy.length ? [{ atMs: Math.max(...legacy), appVersion: 'legacy' }] : [] };
  }
  // Corrupted counters must never authorize a prompt. Storage reads fail closed.
  if (!Number.isInteger(record.completedTurns) || (record.completedTurns as number) < 0 || (record.completedTurns as number) > 3
    || !Array.isArray(record.successfulDays) || record.successfulDays.length > 2
    || !record.successfulDays.every(day => typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(Date.parse(`${day}T00:00:00Z`)) && new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) === day)
    || !Array.isArray(record.attempts) || record.attempts.length > 3
    || !record.attempts.every(attempt => attempt && timestamp(attempt.atMs) && typeof attempt.appVersion === 'string' && attempt.appVersion.length > 0 && attempt.appVersion.length <= 64)
    || (record.lastCompletedAtMs !== undefined && !timestamp(record.lastCompletedAtMs))
    || (record.lastManualAtMs !== undefined && !timestamp(record.lastManualAtMs))) return null;
  return {
    version: 3, completedTurns: record.completedTurns as number,
    successfulDays: [...new Set(record.successfulDays)],
    attempts: record.attempts.map(({ atMs, appVersion }) => ({ atMs, appVersion })).sort((a, b) => a.atMs - b.atMs),
    ...(timestamp(record.lastCompletedAtMs) ? { lastCompletedAtMs: record.lastCompletedAtMs } : {}),
    ...(timestamp(record.lastManualAtMs) ? { lastManualAtMs: record.lastManualAtMs } : {}),
  };
}

export function completedReviewTurn(state: AutoAppReviewState, now: number): AutoAppReviewState {
  if (!timestamp(now)) return state;
  const date = new Date(now);
  const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  return { ...state, completedTurns: Math.min(3, state.completedTurns + 1),
    successfulDays: [...new Set([...state.successfulDays, day])].slice(-2), lastCompletedAtMs: now };
}

export function reviewEligibility(state: AutoAppReviewState, now: number, appVersion: string): ReviewEligibility {
  if (!timestamp(now) || !appVersion || state.completedTurns < 3 || state.successfulDays.length < 2) return 'experience';
  if (!state.lastCompletedAtMs || now < state.lastCompletedAtMs || now - state.lastCompletedAtMs > REVIEW_RECENCY_MS) return 'stale';
  const lastInvitation = Math.max(state.lastManualAtMs ?? 0, ...state.attempts.map(attempt => attempt.atMs));
  if (lastInvitation && now - lastInvitation < REVIEW_COOLDOWN_MS) return 'cooldown';
  if (state.attempts.filter(attempt => now - attempt.atMs < REVIEW_YEAR_MS).length >= 3) return 'annual_limit';
  if (state.attempts.some(attempt => attempt.appVersion === appVersion)) return 'version';
  return 'eligible';
}

export function recordReviewAttempt(state: AutoAppReviewState, now: number, appVersion: string): AutoAppReviewState {
  return { ...emptyReviewState(), ...(state.lastManualAtMs ? { lastManualAtMs: state.lastManualAtMs } : {}),
    attempts: [...state.attempts.filter(attempt => now - attempt.atMs < REVIEW_YEAR_MS), { atMs: now, appVersion }].slice(-3) };
}
