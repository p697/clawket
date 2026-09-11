import { useEffect, useRef } from 'react';
import { StorageService } from '../services/storage';

type Params = {
  currentAgentId: string | null;
  input: string;
  sessionKey: string | null;
  setInput: (value: string) => void;
};

export function useChatComposerDraft({
  currentAgentId,
  input,
  sessionKey,
  setInput,
}: Params) {
  const draftSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftLoadedKeyRef = useRef<string | null>(null);
  const pendingDraftRef = useRef<{ agentId: string; sessionKey: string; input: string } | null>(null);

  // Flush the last keystrokes when leaving a scope; the debounce alone loses
  // edits made immediately before navigating back or switching conversations.
  useEffect(() => () => {
    const pending = pendingDraftRef.current;
    if (pending && pending.agentId === currentAgentId && pending.sessionKey === sessionKey) {
      pendingDraftRef.current = null;
      StorageService.setComposerDraft(pending.agentId, pending.sessionKey, pending.input).catch(() => {});
    }
  }, [currentAgentId, sessionKey]);

  useEffect(() => {
    if (!sessionKey || !currentAgentId) return;
    if (draftLoadedKeyRef.current !== `${currentAgentId}-${sessionKey}`) return;

    if (draftSaveTimerRef.current) clearTimeout(draftSaveTimerRef.current);
    pendingDraftRef.current = { agentId: currentAgentId, sessionKey, input };
    draftSaveTimerRef.current = setTimeout(() => {
      pendingDraftRef.current = null;
      StorageService.setComposerDraft(currentAgentId, sessionKey, input).catch(() => {});
    }, 300);

    return () => {
      if (draftSaveTimerRef.current) clearTimeout(draftSaveTimerRef.current);
    };
  }, [currentAgentId, input, sessionKey]);

  useEffect(() => {
    if (!sessionKey || !currentAgentId) return;
    const compositeKey = `${currentAgentId}-${sessionKey}`;
    if (draftLoadedKeyRef.current === compositeKey) return;

    let cancelled = false;
    StorageService.getComposerDraft(currentAgentId, sessionKey)
      .then((draft) => {
        if (cancelled) return;
        draftLoadedKeyRef.current = compositeKey;
        if (draft) {
          setInput(draft);
        }
      })
      .catch(() => {
        if (!cancelled) draftLoadedKeyRef.current = compositeKey;
      });

    return () => {
      cancelled = true;
    };
  }, [currentAgentId, sessionKey, setInput]);

  return {
    clearPersistedDraft: () => {
      if (!sessionKey || !currentAgentId) return;
      if (draftSaveTimerRef.current) clearTimeout(draftSaveTimerRef.current);
      pendingDraftRef.current = null;
      StorageService.setComposerDraft(currentAgentId, sessionKey, '').catch(() => {});
    },
    resetDraftLoadState: () => {
      draftLoadedKeyRef.current = null;
    },
  };
}
