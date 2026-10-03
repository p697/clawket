import React, { useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { AgentDescriptor } from '@clawket/agent-protocol';
import { SessionPanel, type SessionPanelProps } from './SessionPanel';

type Scope = Readonly<{ connectionId: string; agentId: string; sessionKey: string }>;
export type SessionPanelHandle = Readonly<{
  open: (scope: Scope) => void;
  close: () => void;
}>;

/** Keep sheet presentation out of the navigator's state: opening must not
 * render every mounted screen (including long transcripts and the roster). */
export function SessionPanelHost({
  ref,
  onVisibilityChange,
  onCreateSession,
  onSelectSession,
  ...props
}: Omit<SessionPanelProps, 'visible' | 'onClose' | 'onCreateSession'> & {
  ref: React.Ref<SessionPanelHandle>;
  onVisibilityChange: (visible: boolean) => void;
  /** Persist the accepted result before checking whether its UI handoff is still current. */
  onCreateSession?: (agent: AgentDescriptor, projectId: string | undefined, canPresent: () => boolean) => void | false | Promise<void | false>;
}): React.JSX.Element {
  const [visible, setVisible] = useState(false);
  const [presentation, setPresentation] = useState<{ scope: Scope; generation: number } | null>(null);
  const presentationGeneration = useRef(0);
  const requestGeneration = useRef(0);
  const scope = presentation?.scope;
  const visibleRef = useRef(false);
  const changeVisibility = useCallback((next: boolean) => {
    if (visibleRef.current === next) return;
    visibleRef.current = next;
    setVisible(next);
    onVisibilityChange(next);
  }, [onVisibilityChange]);
  const close = useCallback(() => {
    requestGeneration.current += 1;
    changeVisibility(false);
  }, [changeVisibility]);
  const generation = presentation?.generation ?? 0;
  const closePresentation = useCallback(() => {
    if (visibleRef.current && presentationGeneration.current === generation) close();
  }, [close, generation]);
  const select = useCallback<SessionPanelProps['onSelectSession']>((row) => {
    if (!visibleRef.current || presentationGeneration.current !== generation) return;
    requestGeneration.current += 1;
    return onSelectSession(row);
  }, [generation, onSelectSession]);
  const create = useCallback<NonNullable<SessionPanelProps['onCreateSession']>>(async (agent, projectId) => {
    if (!onCreateSession || !visibleRef.current || presentationGeneration.current !== generation) return false;
    const request = ++requestGeneration.current;
    const canPresent = () => visibleRef.current
      && presentationGeneration.current === generation && requestGeneration.current === request;
    try {
      const result = await onCreateSession(agent, projectId, canPresent);
      return result !== false && canPresent() ? undefined : false;
    } catch (error) {
      if (canPresent()) throw error;
      return false;
    }
  }, [generation, onCreateSession]);
  useEffect(() => () => {
    visibleRef.current = false;
    requestGeneration.current += 1;
  }, []);
  useImperativeHandle(ref, () => ({
    open: (next) => {
      requestGeneration.current += 1;
      setPresentation({ scope: next, generation: ++presentationGeneration.current });
      changeVisibility(true);
    },
    close,
  }), [changeVisibility, close]);
  return <SessionPanel {...props}
    connectionId={scope?.connectionId ?? props.connectionId}
    currentAgentId={scope?.agentId ?? props.currentAgentId}
    currentSessionKey={scope?.sessionKey ?? props.currentSessionKey}
    visible={visible} onClose={closePresentation} onSelectSession={select}
    onCreateSession={onCreateSession ? create : undefined} />;
}
