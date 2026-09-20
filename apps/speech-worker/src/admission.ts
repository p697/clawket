import { DurableObject } from 'cloudflare:workers';
import { reserveQuota, quotaRejection, type Quota } from './quota';
/** Admission only: this object never receives audio, transcripts or provider credentials. */
export class SpeechAdmission extends DurableObject<Env> {
  async reserve(nonce: string, limit: number, period: number, exclusive = false): Promise<boolean> {
    return (await this.reserveDetailed(nonce, limit, period, exclusive)).allowed;
  }
  async reserveDetailed(nonce: string, limit: number, period: number, exclusive = false) {
    const now = Date.now();
    return this.ctx.storage.transaction(async (store) => {
      const previous = await store.get<Quota>('quota');
      const next = reserveQuota(previous, nonce, limit, period, exclusive, now);
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
