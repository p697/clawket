import { nativeSettings, type NativeSettings } from './settings.js';
import { DESKTOP_IPC_FRAME_BYTES, DesktopHistoryLimitError } from './desktop-limits.js';

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

/** Native stdio permits omission; Desktop's text consumers require an array. */
function desktopInput(input: any[]): any[] {
  return input.map(part => {
    if (part?.type !== 'text') return part;
    if (part.text_elements === undefined) return { ...part, text_elements: [] };
    if (!Array.isArray(part.text_elements) || part.text_elements.some((element: any) =>
      !element || typeof element !== 'object' || Array.isArray(element))) throw new Error('Invalid Desktop text elements');
    return part;
  });
}

export function desktopState(thread: any, requests: any[], settings: NativeSettings, olderCursor: string | null = null): any {
  if (!nativeSettings(settings) || settings.cwd !== thread.cwd) throw new Error('Native effective settings are unavailable');
  const turns = (thread.turns ?? []).map((t: any) => {
    const items = (t.items ?? []).map((item: any) => item.type === 'userMessage'
      ? { ...item, content: desktopInput(item.content ?? []) } : item);
    return { ...t, items, turnId: t.id,
      params: { cwd: settings.cwd, input: items.find((i: any) => i.type === 'userMessage')?.content ?? [], attachments: [],
        summary: settings.summary, personality: settings.personality, outputSchema: null, collaborationMode: settings.collaborationMode }, hookRuns: [],
      ...(t.itemsView === 'summary' ? { itemsPagination: { olderCursor: null, isLoadingOlder: false, hasLoadedOldest: false,
        summaryItemIds: items.map((item: any) => item.id) } } : {}),
    };
  });
  const entries = turns.map((t: any) => ({ key: `turn:${t.id}`, value: `turn:${t.id}` }));
  const entitiesByKey = Object.fromEntries(turns.map((t: any) => [`turn:${t.id}`, t]));
  const oldestLoadedTurnId = turns[0]?.id ?? null;
  const state = { id: thread.id, hostId: 'local', turns: [], requests, cwd: thread.cwd, title: thread.name ?? '',
    createdAt: thread.createdAt * 1000, updatedAt: thread.updatedAt * 1000, recencyAt: thread.updatedAt * 1000,
    source: 'appServer', threadSource: 'user', originator: 'clawket', historyMode: 'paginated', mode: settings.collaborationMode.mode, threadStartKind: 'default',
    modelProvider: settings.modelProvider, latestModel: settings.model, latestReasoningEffort: settings.effort,
    latestCollaborationMode: settings.collaborationMode, latestThreadSettings: settings,
    hasUnreadTurn: false, rolloutPath: thread.path ?? '', gitInfo: thread.gitInfo ?? null, resumeState: 'resumed', latestTokenUsageInfo: null,
    workspaceKind: 'project', workspaceBrowserRoot: thread.cwd, projectlessOutputDirectory: null,
    currentPermissions: { approvalPolicy: settings.approvalPolicy, approvalsReviewer: settings.approvalsReviewer,
      runtimeWorkspaceRoots: [thread.cwd], sandboxPolicy: settings.sandboxPolicy, activePermissionProfile: settings.activePermissionProfile },
    turnsPagination: { olderCursor, oldestLoadedTurnId, isLoadingOlder: false, hasLoadedOldest: olderCursor === null },
    turnHistory: { kind: 'canonical', history: { entitiesByKey, generation: 0, isComplete: olderCursor === null,
      islands: [{ id: 'tail:0', entries, olderBoundary: olderCursor === null ? { status: 'exhausted', boundaryId: 'tail:0:older' }
        : { status: 'available', boundaryId: 'tail:0:older', handle: { cursor: olderCursor, oldestLoadedTurnId }, progressKey: JSON.stringify([olderCursor, oldestLoadedTurnId]) },
        newerBoundary: { status: 'exhausted', boundaryId: 'tail:0:newer' } }] } },
  };
  // Count the actual projection, including repeated input and collaboration
  // settings. Leave room for the framed broadcast envelope; never drop images.
  if (Buffer.byteLength(JSON.stringify(state)) > DESKTOP_IPC_FRAME_BYTES - 16 * 1024) throw new DesktopHistoryLimitError();
  return state;
}
