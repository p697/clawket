export const SETUP_LEASE_MS = 25000;
export const SESSION_LEASE_MS = 150000;

export type Quota = {
  window: number; count: number; activeUntil: number; activeNonce: string;
  nonces: Array<{ nonce: string; expires: number }>;
};
/** Persisted admission is fail-closed. Keep replay proofs across fixed-window boundaries. */
export function reserveQuota(state: Quota | undefined, nonce: string, limit: number, period: number, exclusive: boolean, now: number, leaseMs = SESSION_LEASE_MS): Quota | null {
  if (![SETUP_LEASE_MS, SESSION_LEASE_MS].includes(leaseMs)) return null;
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000 || !Number.isFinite(period) || period < 60000 || !Number.isFinite(now)) return null;
  if (state && (!Number.isInteger(state.window) || !Number.isInteger(state.count) || state.count < 0 ||
      !Number.isFinite(state.activeUntil) || typeof state.activeNonce !== 'string' || !Array.isArray(state.nonces) ||
      state.nonces.some((entry) => !entry || typeof entry.nonce !== 'string' || !Number.isFinite(entry.expires)))) return null;
  const window = Math.floor(now / period);
  const count = state?.window === window ? state.count : 0;
  const nonces = (state?.nonces ?? []).filter((entry) => entry.expires > now);
  if (count >= limit || nonces.some((entry) => entry.nonce === nonce) || (exclusive && (state?.activeUntil ?? 0) > now)) return null;
  return { window, count: count + 1, nonces: [...nonces, { nonce, expires: now + 120000 }],
    activeUntil: exclusive ? now + leaseMs : 0, activeNonce: exclusive ? nonce : '' };
}

export function quotaRejection(state: Quota | undefined, nonce: string, limit: number, period: number, exclusive: boolean, now: number) {
  if (state && (!Number.isInteger(state.window) || !Number.isInteger(state.count) || state.count < 0 ||
    !Number.isFinite(state.activeUntil) || typeof state.activeNonce !== 'string' || !Array.isArray(state.nonces) ||
    state.nonces.some((entry) => !entry || typeof entry.nonce !== 'string' || !Number.isFinite(entry.expires)))) {
    return { allowed: false as const, reason: 'storage', retryAfterMs: 0 };
  }
  const window = Math.floor(now / period);
  if (state?.nonces.some((entry) => entry.nonce === nonce && entry.expires > now)) return { allowed: false as const, reason: 'replay', retryAfterMs: 0 };
  if (exclusive && (state?.activeUntil ?? 0) > now) return { allowed: false as const, reason: 'busy', retryAfterMs: state!.activeUntil - now };
  return { allowed: false as const, reason: 'quota', retryAfterMs: (window + 1) * period - now };
}

/** Promotion is fenced: delayed setup cannot revive an expired or replaced lease. */
export function activateQuota(state: Quota | undefined, nonce: string, now: number): Quota | null {
  if (!state || state.activeNonce !== nonce || !Number.isFinite(state.activeUntil) || state.activeUntil <= now) return null;
  return { ...state, activeUntil: now + SESSION_LEASE_MS };
}
