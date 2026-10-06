export interface UpdateTarget {
  backend: string;
  running: boolean;
  preflight(): Promise<void>;
  stop(): Promise<void>;
  start(entry: string): Promise<void>;
  verify(version: string): Promise<void>;
  previousEntry: string | null;
  previousVersion?: string;
  verifyPrevious?(): Promise<void>;
  /** Confirms the captured source is running again and returns the version it reports. */
  verifyRestored?(): Promise<string | undefined>;
  prepareStopped?(entry: string): Promise<(() => void) | null>;
  manual?: boolean;
}
export type UpdateResult = { backend: string; state: 'updated' | 'stopped' | 'restored' | 'failed' | 'manual'; reason?: string; version?: string };

const startOrder = (a: UpdateTarget, b: UpdateTarget) =>
  (a.backend === 'openclaw' ? 2 : a.backend === 'hermes-relay' ? 1 : 0) - (b.backend === 'openclaw' ? 2 : b.backend === 'hermes-relay' ? 1 : 0);
// Independent agent runtimes stop first, so one that cannot be stopped fails before the shared service and
// Hermes are touched; the service/watchdog still stops before its Hermes children.
const stopRank = (target: UpdateTarget) => target.backend === 'openclaw' ? 1 : target.backend === 'hermes-relay' ? 2 : target.backend === 'hermes' ? 3 : 0;

/** Stage/validate the package before calling this. Never run pair/reset or rewrite configuration. */
export async function activateUpdate(targets: UpdateTarget[], entry: string, version: string): Promise<UpdateResult[]> {
  // A failed/uncertain owner must leave every runtime untouched.
  for (const target of targets) await target.preflight();
  const stopped: UpdateTarget[] = [], started: UpdateTarget[] = [];
  const registrations: Array<{ target: UpdateTarget; restore: () => void }> = [];
  let preparing: UpdateTarget | undefined, stopping: UpdateTarget | undefined;
  try {
    // Stop the shared service/watchdog before its Hermes children; start it last.
    for (const target of targets.filter(t => t.running).sort((a, b) => stopRank(a) - stopRank(b))) {
      try { await target.stop(); }
      catch (error) { stopping = target; throw error; }
      stopped.push(target);
    }
    for (const target of [...stopped].sort(startOrder)) {
      started.push(target); await target.start(entry);
      await target.verify(version);
    }
    for (const target of targets.filter(t => !t.running && t.prepareStopped)) {
      preparing = target;
      const restore = await target.prepareStopped!(entry);
      if (restore) registrations.push({ target, restore });
      preparing = undefined;
    }
    return targets.map(t => ({ backend: t.backend, state: t.manual ? 'manual' : t.running ? 'updated' : 'stopped' }));
  } catch {
    const results: UpdateResult[] = [], failedStops = new Set<UpdateTarget>();
    for (const registration of [...registrations].reverse()) {
      try { registration.restore(); }
      catch { results.push({ backend: registration.target.backend, state: 'failed', reason: 'registration_restore_unverified' }); }
    }
    for (const target of [...started].reverse()) {
      try { await target.stop(); }
      catch { failedStops.add(target); results.push({ backend: target.backend, state: 'failed', reason: 'replacement_stop_unverified' }); }
    }
    for (const target of [...stopped].sort(startOrder)) {
      if (failedStops.has(target)) continue;
      try {
        if (!target.previousEntry) throw new Error();
        await target.start(target.previousEntry);
        // npx may have replaced a captured source in place, so report the version that is actually running.
        let version: string | undefined;
        if (target.verifyRestored) version = await target.verifyRestored();
        else if (target.previousVersion) { await target.verify(target.previousVersion); version = target.previousVersion; }
        else if (target.verifyPrevious) await target.verifyPrevious();
        results.push({ backend: target.backend, state: 'restored', ...(version ? { version } : {}) });
      } catch { results.push({ backend: target.backend, state: 'failed', reason: 'restore_unverified' }); }
    }
    for (const target of targets) if (!stopped.includes(target)) results.push({ backend: target.backend, state: target === preparing ? 'failed' : target.manual ? 'manual' : target.running ? 'failed' : 'stopped', ...(target === preparing ? { reason: 'registration_update_unverified' } : target === stopping ? { reason: 'stop_unverified' } : target.running ? { reason: 'update_not_applied' } : {}) });
    return results;
  }
}
