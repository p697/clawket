export type Quota = {
  window: number; count: number; activeUntil: number; activeNonce: string;
  nonces: Array<{ nonce: string; expires: number }>;
};
/** Persisted admission is fail-closed. Keep replay proofs across fixed-window boundaries. */
export function reserveQuota(state: Quota | undefined, nonce: string, limit: number, period: number, exclusive: boolean, now: number): Quota | null {
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000 || !Number.isFinite(period) || period < 60000 || !Number.isFinite(now)) return null;
  if (state && (!Number.isInteger(state.window) || !Number.isInteger(state.count) || state.count < 0 ||
      !Number.isFinite(state.activeUntil) || typeof state.activeNonce !== 'string' || !Array.isArray(state.nonces) ||
      state.nonces.some((entry) => !entry || typeof entry.nonce !== 'string' || !Number.isFinite(entry.expires)))) return null;
  const window = Math.floor(now / period);
  const count = state?.window === window ? state.count : 0;
  const nonces = (state?.nonces ?? []).filter((entry) => entry.expires > now);
  if (count >= limit || nonces.some((entry) => entry.nonce === nonce) || (exclusive && (state?.activeUntil ?? 0) > now)) return null;
  return { window, count: count + 1, nonces: [...nonces, { nonce, expires: now + 120000 }],
    activeUntil: exclusive ? now + 150000 : 0, activeNonce: exclusive ? nonce : '' };
}
