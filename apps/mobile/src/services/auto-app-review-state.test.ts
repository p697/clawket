import { completedReviewTurn, emptyReviewState, normalizeAutoAppReviewState, recordReviewAttempt, reviewEligibility, REVIEW_COOLDOWN_MS, REVIEW_YEAR_MS } from './auto-app-review-state';
const day = 86_400_000;
const now = new Date(2026, 9, 13, 12).getTime();
function eligible() {
  return [now - day, now, now].reduce(completedReviewTurn, emptyReviewState());
}
describe('review qualification and durable limits', () => {
  it('needs three completed turns across two local dates, not sends or launches', () => {
    expect(reviewEligibility(emptyReviewState(), now, '1')).toBe('experience');
    const sameDay = [now, now, now].reduce(completedReviewTurn, emptyReviewState());
    expect(reviewEligibility(sameDay, now, '1')).toBe('experience');
    expect(reviewEligibility(eligible(), now, '1')).toBe('eligible');
  });
  it('requires recent completion and rejects clock rollback', () => {
    expect(reviewEligibility(eligible(), now + 8 * day, '1')).toBe('stale');
    expect(reviewEligibility(eligible(), now - 1, '1')).toBe('stale');
  });
  it('resets experience after every attempt and respects cooldown including legacy/manual invitations', () => {
    const requested = recordReviewAttempt(eligible(), now, '1');
    expect(requested.completedTurns).toBe(0);
    for (const extra of [{ attempts: requested.attempts }, { lastManualAtMs: now }, { attempts: [{ atMs: now, appVersion: 'legacy' }] }]) {
      const state = { ...eligible(), ...extra, lastCompletedAtMs: now + REVIEW_COOLDOWN_MS - 1 };
      expect(reviewEligibility(state, now + REVIEW_COOLDOWN_MS - 1, '2')).toBe('cooldown');
      expect(reviewEligibility(state, now + REVIEW_COOLDOWN_MS, '2')).toBe('eligible');
    }
  });
  it('allows at most three attempts in a rolling year and one per recorded app version', () => {
    const state = { ...eligible(), attempts: [300, 200, 100].map((days, i) => ({ atMs: now - days * day, appVersion: String(i) })) };
    expect(reviewEligibility(state, now, 'new')).toBe('annual_limit');
    state.attempts[0].atMs = now - REVIEW_YEAR_MS;
    expect(reviewEligibility(state, now, 'new')).toBe('eligible');
    state.attempts = state.attempts.slice(1);
    expect(reviewEligibility(state, now, '1')).toBe('version');
  });
  it.each(['reviewAttemptedAtMs', 'reviewRequestedAtMs', 'lastAttemptAtMs'])('preserves %s without carrying over old send counters', key => {
    expect(normalizeAutoAppReviewState({ version: 2, [key]: now, firstSuccessfulSendAtMs: now, coldStartsAfterFirstSuccessfulSend: 3 }))
      .toEqual({ ...emptyReviewState(), attempts: [{ atMs: now, appVersion: 'legacy' }] });
  });
  it('roundtrips state and caps stored counts and dates', () => {
    let state = eligible();
    for (let i = 0; i < 10; i++) state = completedReviewTurn(state, now + i * day);
    expect(state.completedTurns).toBe(3);
    expect(state.successfulDays).toHaveLength(2);
    expect(normalizeAutoAppReviewState(JSON.parse(JSON.stringify(state)))).toEqual(state);
  });
  it.each([
    { completedTurns: -1 }, { completedTurns: 4 }, { completedTurns: NaN },
    { successfulDays: ['2026-99-99'] }, { successfulDays: ['2026-02-30'] },
    { attempts: [{ atMs: 0, appVersion: '1' }] }, { attempts: [{ atMs: now, appVersion: {} }] },
    { lastManualAtMs: -1 }, { lastCompletedAtMs: Infinity },
  ])('rejects corrupted persisted input: %j', extra => {
    expect(normalizeAutoAppReviewState({ ...eligible(), ...extra })).toBeNull();
  });
});
