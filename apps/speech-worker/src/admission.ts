import { DurableObject } from 'cloudflare:workers';
import { activateQuota, reserveQuota, quotaRejection, SETUP_LEASE_MS, SESSION_LEASE_MS, type Quota } from './quota';
/** Admission only: this object never receives audio, transcripts or provider credentials. */
export class SpeechAdmission extends DurableObject<Env> {
  async reserve(nonce: string, limit: number, period: number, exclusive = false): Promise<boolean> {
    return (await this.reserveDetailed(nonce, limit, period, exclusive)).allowed;
  }
  async reservePending(nonce: string) {
    return this.reserveDetailed(nonce, 60, 3600000, true, SETUP_LEASE_MS);
  }
  async activate(nonce: string): Promise<boolean> {
    return this.ctx.storage.transaction(async (store) => {
      const next = activateQuota(await store.get<Quota>('quota'), nonce, Date.now());
      if (!next) return false;
      await store.put('quota', next);
      return true;
    });
  }
  async reserveDetailed(nonce: string, limit: number, period: number, exclusive = false, leaseMs = SESSION_LEASE_MS) {
    const now = Date.now();
    return this.ctx.storage.transaction(async (store) => {
      const previous = await store.get<Quota>('quota');
      const next = reserveQuota(previous, nonce, limit, period, exclusive, now, leaseMs);
      if (!next) return quotaRejection(previous, nonce, limit, period, exclusive, now);
      await store.put('quota', next);
      await store.setAlarm((next.window + 2) * period);
      return { allowed: true as const, reason: '', retryAfterMs: 0 };
    });
  }
  async release(nonce: string): Promise<void> {
    await this.ctx.storage.transaction(async (store) => {
      const state = await store.get<Quota>('quota');
      if (state?.activeNonce === nonce) await store.put('quota', { ...state, activeUntil: 0, activeNonce: '' });
    });
  }
  async alarm(): Promise<void> { await this.ctx.storage.deleteAll(); }
}
