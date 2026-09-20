import { DurableObject } from 'cloudflare:workers';
import { reserveQuota, type Quota } from './quota';
/** Admission only: this object never receives audio, transcripts or provider credentials. */
export class SpeechAdmission extends DurableObject<Env> {
  async reserve(nonce: string, limit: number, period: number, exclusive = false): Promise<boolean> {
    const now = Date.now();
    return this.ctx.storage.transaction(async (store) => {
      const next = reserveQuota(await store.get<Quota>('quota'), nonce, limit, period, exclusive, now);
      if (!next) return false;
      await store.put('quota', next);
      await store.setAlarm((next.window + 2) * period);
      return true;
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
