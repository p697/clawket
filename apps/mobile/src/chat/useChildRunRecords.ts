import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChildSessionActivityCard } from './childSessionActivity';
import { areThreadRunSeedsEqual, type ThreadRunSeed } from '../screens/Thread/model';
import { ThreadActivityCacheService, type ThreadActivityScope } from '../services/thread-activity-cache';

const EMPTY: readonly ThreadRunSeed[] = [];
const MAX_RECORDS = 100;
const terminal = (run: ThreadRunSeed) => run.kind === 'subagent' && (run.status === 'completed' || run.status === 'failed');

/** A missing session is not a deletion of its execution record. */
export function mergeChildRunRecords(
  saved: readonly ThreadRunSeed[], incoming: readonly ThreadRunSeed[],
): ThreadRunSeed[] {
  const byId = new Map(saved.map(run => [run.id, run]));
  for (const run of incoming) {
    const previous = byId.get(run.id);
    if (previous && previous.updatedAt > run.updatedAt) continue;
    byId.set(run.id, {
      ...run,
      title: run.title === 'Subagent' && previous ? previous.title : run.title,
      summary: run.summary || previous?.summary,
    });
  }
  return [...byId.values()].sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id)).slice(0, MAX_RECORDS);
}

/** Store terminal records only; an old disk snapshot must never assert a live run. */
export function useChildRunRecords(scope: ThreadActivityScope, cards: readonly ChildSessionActivityCard[]) {
  const { connectionId, agentId, sessionKey } = scope;
  const key = JSON.stringify([connectionId, agentId, sessionKey]);
  const [snapshot, setSnapshot] = useState<{ key: string; runs: readonly ThreadRunSeed[]; hydrated: boolean }>({ key: '', runs: EMPTY, hydrated: false });
  const saved = snapshot.key === key ? snapshot.runs : EMPTY;
  const hydrated = snapshot.key === key && snapshot.hydrated;
  const writes = useRef(Promise.resolve());
  const persisted = useRef('');
  const live = useMemo(() => cards.map(card => ({
    id: card.sessionKey,
    kind: 'subagent' as const,
    sessionKey: card.sessionKey,
    ...(card.agentId ? { agentId: card.agentId } : {}),
    title: card.title,
    status: card.status,
    summary: card.resultText ?? card.previewText ?? undefined,
    updatedAt: card.updatedAt,
  })), [cards]);
  const runs = useMemo(() => mergeChildRunRecords(saved, live), [saved, live]);

  useEffect(() => {
    let cancelled = false;
    void ThreadActivityCacheService.read({ connectionId, agentId, sessionKey }, 'subagent').then(records => {
      if (cancelled) return;
      const disk = (records ?? []).filter(terminal);
      persisted.current = JSON.stringify([key, disk]);
      setSnapshot(previous => ({ key, hydrated: true, runs: mergeChildRunRecords(
        disk, previous.key === key ? previous.runs : EMPTY,
      ) }));
    });
    return () => { cancelled = true; };
  }, [key, connectionId, agentId, sessionKey]);

  useEffect(() => {
    const completed = runs.filter(terminal);
    if (areThreadRunSeedsEqual(saved, completed)) return;
    setSnapshot({ key, runs: completed, hydrated });
  }, [runs, saved, key, hydrated]);
  const completed = useMemo(() => runs.filter(terminal), [runs]);
  useEffect(() => {
    if (!hydrated) return;
    const revision = JSON.stringify([key, completed]);
    if (persisted.current === revision) return;
    persisted.current = revision;
    // Read/merge before writing, and serialize rapid terminal updates.
    writes.current = writes.current.then(() =>
      ThreadActivityCacheService.write({ connectionId, agentId, sessionKey }, completed, 'subagent'),
    ).catch(() => { if (persisted.current === revision) persisted.current = ''; });
  }, [completed, hydrated, key, connectionId, agentId, sessionKey]);
  return { runs, hydrated };
}
