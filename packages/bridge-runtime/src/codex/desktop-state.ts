/** Codex Desktop v11 carries a canonical turn graph on current builds. */
export function desktopTurns(state: any): any[] {
  const history = state?.turnHistory?.kind === 'canonical' ? state.turnHistory.history : undefined;
  if (history?.entitiesByKey && Array.isArray(history.islands)) {
    const result: any[] = [], seen = new Set<string>();
    for (const island of history.islands) for (const entry of island.entries ?? []) {
      const key = typeof entry === 'string' ? entry : entry.value ?? entry.key;
      const turn = history.entitiesByKey[key];
      if (turn && !seen.has(key)) { seen.add(key); result.push({ ...turn, id: turn.turnId ?? turn.id }); }
    }
    if (result.length) return result;
  }
  return Array.isArray(state?.turns) ? state.turns : [];
}

export function desktopState(thread: any, requests: any[], model?: string, effort?: string): any {
  const turns = (thread.turns ?? []).map((t: any) => ({ ...t, turnId: t.id,
    params: { cwd: thread.cwd, input: (t.items ?? []).find((i: any) => i.type === 'userMessage')?.content ?? [], attachments: [], summary: 'none', personality: null, outputSchema: null, collaborationMode: null }, hookRuns: [],
  }));
  const entries = turns.map((t: any) => ({ key: `turn:${t.id}`, value: `turn:${t.id}` }));
  const entitiesByKey = Object.fromEntries(turns.map((t: any) => [`turn:${t.id}`, t]));
  return { id: thread.id, hostId: 'local', turns, requests, cwd: thread.cwd, title: thread.name ?? '',
    createdAt: thread.createdAt * 1000, updatedAt: thread.updatedAt * 1000, recencyAt: thread.updatedAt * 1000,
    source: 'appServer', threadSource: 'user', originator: 'clawket', historyMode: 'legacy', mode: 'default', threadStartKind: 'default',
    modelProvider: thread.modelProvider, latestModel: model ?? null, latestReasoningEffort: effort ?? null, latestCollaborationMode: null,
    hasUnreadTurn: false, rolloutPath: thread.path ?? '', gitInfo: thread.gitInfo ?? null, resumeState: 'resumed', latestTokenUsageInfo: null,
    workspaceKind: 'project', workspaceBrowserRoot: thread.cwd, projectlessOutputDirectory: null,
    currentPermissions: { approvalPolicy: 'on-request', approvalsReviewer: 'user', runtimeWorkspaceRoots: [thread.cwd], sandboxPolicy: { type: 'workspaceWrite', writableRoots: [thread.cwd], networkAccess: false, excludeTmpdirEnvVar: false, excludeSlashTmp: false } },
    turnsPagination: { olderCursor: null, oldestLoadedTurnId: turns[0]?.id ?? null, isLoadingOlder: false, hasLoadedOldest: true },
    turnHistory: { kind: 'canonical', history: { entitiesByKey, generation: 0, isComplete: true, islands: [{ id: 'tail:0', entries, olderBoundary: { status: 'exhausted', boundaryId: 'tail:0:older' }, newerBoundary: { status: 'exhausted', boundaryId: 'tail:0:newer' } }] } },
  };
}
