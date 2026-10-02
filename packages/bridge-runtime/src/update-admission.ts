/** Drain only an idle owned runtime. The check and admission fence are synchronous. */
export class UpdateAdmission {
  private pending = 0;
  private draining = false;

  async request<T>(operation: () => Promise<T>): Promise<T> {
    if (this.draining) throw new Error('Bridge is restarting for an update. Reconnect shortly.');
    this.pending++;
    try { return await operation(); }
    finally { this.pending--; }
  }

  prepare(isBusy: () => boolean): boolean {
    if (this.draining) return true;
    if (this.pending || isBusy()) return false;
    this.draining = true;
    return true;
  }
}
