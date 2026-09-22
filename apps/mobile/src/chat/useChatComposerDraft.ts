import { useEffect, useRef, useState } from 'react';
import { StorageService } from '../services/storage';

type Params = {
  connectionId: string | null;
  currentAgentId: string | null;
  input: string;
  sessionKey: string | null;
  setInput: (value: string) => void;
};

export function useChatComposerDraft({ connectionId, currentAgentId, input, sessionKey, setInput }: Params) {
  const scope = connectionId && currentAgentId && sessionKey ? JSON.stringify([connectionId, currentAgentId, sessionKey]) : null;
  const [revision, setRevision] = useState(0);
  const [loadedScope, setLoadedScope] = useState<string | null>(null);
  const [draftReadFailed, setDraftReadFailed] = useState(false);
  const persistableScope = useRef<string | null>(null);
  const [legacy, setLegacy] = useState<{ scope: string; text: string } | null>(null);
  const draftSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const current = useRef({ scope, input }); current.current = { scope, input };
  const pendingDraftRef = useRef<{ scope: string; connectionId: string; agentId: string; sessionKey: string; input: string } | null>(null);
  const save = (pending: NonNullable<typeof pendingDraftRef.current>) =>
    StorageService.setComposerDraft(pending.agentId, pending.sessionKey, pending.input, pending.connectionId).catch(() => {});

  useEffect(() => {
    current.current.scope = scope;
    return () => {
      if (current.current.scope === scope) current.current.scope = null;
      const pending = pendingDraftRef.current;
      if (pending?.scope === scope) { pendingDraftRef.current = null; void save(pending); }
    };
  }, [scope]);

  useEffect(() => {
    if (!scope || !connectionId || !currentAgentId || !sessionKey || loadedScope !== scope || persistableScope.current !== scope) return;
    if (draftSaveTimerRef.current) clearTimeout(draftSaveTimerRef.current);
    const pending = { scope, connectionId, agentId: currentAgentId, sessionKey, input };
    pendingDraftRef.current = pending;
    draftSaveTimerRef.current = setTimeout(() => {
      if (pendingDraftRef.current !== pending) return;
      pendingDraftRef.current = null; void save(pending);
    }, 300);
    return () => { if (draftSaveTimerRef.current) clearTimeout(draftSaveTimerRef.current); };
  }, [scope, connectionId, currentAgentId, input, sessionKey, loadedScope]);

  useEffect(() => {
    if (!scope || !connectionId || !currentAgentId || !sessionKey) return;
    let cancelled = false;
    persistableScope.current = null;
    setDraftReadFailed(false);
    // Legacy keys carry no connection ownership. Offer explicit recovery only;
    // never infer ownership from the currently selected connection.
    void Promise.all([
      StorageService.getComposerDraft(currentAgentId, sessionKey, connectionId),
      StorageService.getComposerDraft(currentAgentId, sessionKey),
    ]).then(([draft, oldDraft]) => {
      if (cancelled || current.current.scope !== scope) return;
      persistableScope.current = scope;
      setLegacy(oldDraft ? { scope, text: oldDraft } : null);
      if (draft && !current.current.input) setInput(draft);
      setLoadedScope(scope);
    }).catch(() => { if (!cancelled) { setDraftReadFailed(true); setLoadedScope(scope); } });
    return () => { cancelled = true; };
    // Input changes do not restart a storage read or replace newer keystrokes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, connectionId, currentAgentId, sessionKey, setInput, revision]);

  return {
    draftReadFailed,
    draftReady: Boolean(scope) && loadedScope === scope,
    recoverableDraft: legacy?.scope === scope ? legacy.text : null,
    recoverLegacyDraft: async () => {
      if (!scope || !connectionId || !currentAgentId || !sessionKey || current.current.scope !== scope || current.current.input.trim() || legacy?.scope !== scope) return false;
      if (draftSaveTimerRef.current) clearTimeout(draftSaveTimerRef.current);
      pendingDraftRef.current = null;
      setInput(legacy.text);
      const text = legacy.text;
      // Persist the explicit destination before removing the old copy. A
      // failed write keeps the recoverable original and the editable input.
      await StorageService.setComposerDraft(currentAgentId, sessionKey, text, connectionId);
      await StorageService.clearComposerDraftIfMatches(currentAgentId, sessionKey, text);
      if (current.current.scope === scope) setLegacy(null);
      return true;
    },
    clearPersistedDraft: () => {
      if (!connectionId || !sessionKey || !currentAgentId) return;
      if (draftSaveTimerRef.current) clearTimeout(draftSaveTimerRef.current);
      pendingDraftRef.current = null;
      void StorageService.setComposerDraft(currentAgentId, sessionKey, '', connectionId).catch(() => {});
    },
    resetDraftLoadState: () => { setLoadedScope(null); setRevision(value => value + 1); },
  };
}
