import React, { createRef } from 'react';
import { act, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AgentAdapter, AgentDescriptor } from '@clawket/agent-protocol';
import { createSessionForPresentation } from './create-session';
import type { SessionPanelRow } from './model';
import { SessionPanelHost, type SessionPanelHandle } from './SessionPanelHost';
import { SessionPanel } from './SessionPanel';

jest.mock('./SessionPanel', () => ({ SessionPanel: jest.fn(() => null) }));
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
const panel = jest.mocked(SessionPanel);
const current = () => panel.mock.calls.at(-1)![0];
const scope = { connectionId: 'claude-device', agentId: 'claude-code', sessionKey: 'native-history' };

it('opens and closes without rendering the parent, retains dismissal, and scopes each opening', () => {
  const ref = createRef<SessionPanelHandle>();
  const onVisibilityChange = jest.fn();
  const onAfterClose = jest.fn();
  let parentRenders = 0;
  function Parent() {
    parentRenders += 1;
    return <SessionPanelHost ref={ref} currentAgentId="main" currentSessionKey="main"
      onVisibilityChange={onVisibilityChange} onAfterClose={onAfterClose} onSelectSession={jest.fn()} />;
  }
  render(<Parent />);
  expect(current().visible).toBe(false);
  act(() => ref.current!.open(scope));
  expect(parentRenders).toBe(1);
  expect(current()).toMatchObject({ visible: true, connectionId: scope.connectionId, currentAgentId: scope.agentId, currentSessionKey: scope.sessionKey });
  act(() => ref.current!.open(scope));
  expect(onVisibilityChange.mock.calls).toEqual([[true]]);
  act(() => current().onClose());
  expect(current().visible).toBe(false);
  expect(current().onAfterClose).toBe(onAfterClose);
  act(() => current().onAfterClose!());
  expect(onAfterClose).toHaveBeenCalledTimes(1);
  act(() => ref.current!.close());
  expect(onVisibilityChange.mock.calls).toEqual([[true], [false]]);
  act(() => ref.current!.open({ connectionId: 'openclaw', agentId: 'main', sessionKey: 'main' }));
  expect(current()).toMatchObject({ visible: true, connectionId: 'openclaw', currentAgentId: 'main', currentSessionKey: 'main' });
  expect(parentRenders).toBe(1);
});

it('uses current action callbacks without remounting the presentation host', () => {
  const ref = createRef<SessionPanelHandle>();
  const props = { ref, currentAgentId: 'main', currentSessionKey: 'main', onVisibilityChange: jest.fn(), onSelectSession: jest.fn() };
  const tree = render(<SessionPanelHost {...props} />);
  act(() => ref.current!.open(scope));
  const select = jest.fn();
  tree.rerender(<SessionPanelHost {...props} onSelectSession={select} permissionDenied />);
  expect(current().visible).toBe(true);
  const row = { key: 'selected' } as SessionPanelRow;
  act(() => { current().onSelectSession(row); });
  expect(select).toHaveBeenCalledWith(row);
  expect(current().permissionDenied).toBe(true);
});

let fixtureIndex = 0;
function creationFixture(backend = 'codex', pendingStorage = false) {
  const connectionId = `create-${backend}-${++fixtureIndex}`;
  const agent = { connectionId, agentId: 'main' } as AgentDescriptor;
  const created = { key: `${connectionId}-new` };
  const createSession = jest.fn().mockResolvedValue(created);
  const adapter = { connection: { id: connectionId, backendKind: backend }, capabilities: { sessionCreate: true }, createSession } as unknown as AgentAdapter;
  const navigate = jest.fn();
  let adapterActive = true;
  // Use the App's real persistence boundary: the backend has accepted creation,
  // but the manual-session write can still finish after a newer reader action.
  const create = async (target: AgentDescriptor, projectId?: string, canPresent = () => true) => {
    const accepted = await createSessionForPresentation(adapter, target.agentId, projectId, () => canPresent() && adapterActive, session => navigate(session.key));
    return accepted ? undefined : false;
  };
  let finishStorage!: () => Promise<void>;
  if (pendingStorage) {
    const save = jest.mocked(AsyncStorage.setItem).getMockImplementation()!;
    jest.mocked(AsyncStorage.setItem).mockImplementationOnce((key, value) => new Promise<void>(resolve => {
      finishStorage = async () => { await save(key, value); resolve(); };
    }));
  }
  const ref = createRef<SessionPanelHandle>();
  const select = jest.fn();
  const tree = render(<SessionPanelHost ref={ref} currentAgentId="main" currentSessionKey="old"
    onVisibilityChange={jest.fn()} onSelectSession={select} onCreateSession={create} />);
  act(() => ref.current!.open({ connectionId, agentId: 'main', sessionKey: 'old' }));
  const presentation = current();
  let flight!: ReturnType<NonNullable<typeof presentation.onCreateSession>>;
  act(() => { flight = presentation.onCreateSession!(agent, 'project'); });
  return { agent, adapter, created, createSession, connectionId, ref, presentation, navigate, select, tree,
    retireAdapter: () => { adapterActive = false; },
    flight: () => flight, storageStarted: () => typeof finishStorage === 'function', finishStorage: () => finishStorage() };
}

it('preserves an accepted creation without navigating or closing a later reopened panel', async () => {
  const f = creationFixture('codex', true);
  await waitFor(() => expect(f.createSession).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(f.storageStarted()).toBe(true));
  act(() => {
    f.presentation.onClose();
    f.ref.current!.open({ connectionId: f.connectionId, agentId: 'main', sessionKey: 'later' });
  });
  let outcome: unknown;
  await act(async () => { await f.finishStorage(); outcome = await f.flight(); });
  expect(f.navigate).not.toHaveBeenCalled();
  expect(outcome).toBe(false);
  // A stale dismissal callback must not close the newly opened presentation.
  act(() => f.presentation.onClose());
  expect(current()).toMatchObject({ visible: true, currentSessionKey: 'later' });
  expect(JSON.parse((await AsyncStorage.getItem('clawket.manual-sessions.v1'))!))
    .toContainEqual({ connectionId: f.connectionId, agentId: 'main', key: f.created.key });
});

it('lets selecting another row supersede pending creation before its persistence completes', async () => {
  const f = creationFixture('hermes', true);
  await waitFor(() => expect(f.createSession).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(f.storageStarted()).toBe(true));
  const row = { connectionId: f.connectionId, agentId: 'main', key: 'reader-choice' } as SessionPanelRow;
  await act(async () => { await current().onSelectSession(row); });
  // The selection callback may itself be asynchronous, so creation must retire
  // on the tap rather than waiting for the sheet's eventual dismissal.
  expect(f.select).toHaveBeenCalledWith(row);
  let outcome: unknown;
  await act(async () => { await f.finishStorage(); outcome = await f.flight(); });
  expect(f.navigate).not.toHaveBeenCalled();
  expect(outcome).toBe(false);
  expect(current().visible).toBe(true);
});

it('keeps an accepted creation after unmount while retiring its UI handoff', async () => {
  const f = creationFixture('claude-code', true);
  await waitFor(() => expect(f.storageStarted()).toBe(true));
  f.tree.unmount();
  let outcome: unknown;
  await act(async () => { await f.finishStorage(); outcome = await f.flight(); });
  expect(outcome).toBe(false);
  expect(f.navigate).not.toHaveBeenCalled();
  expect(JSON.parse((await AsyncStorage.getItem('clawket.manual-sessions.v1'))!))
    .toContainEqual({ connectionId: f.connectionId, agentId: 'main', key: f.created.key });
});

it('preserves the panel and accepted session when its adapter retires during persistence', async () => {
  const f = creationFixture('codex', true);
  await waitFor(() => expect(f.storageStarted()).toBe(true));
  f.retireAdapter();
  let outcome: unknown;
  await act(async () => { await f.finishStorage(); outcome = await f.flight(); });
  expect(outcome).toBe(false);
  expect(f.navigate).not.toHaveBeenCalled();
  expect(current().visible).toBe(true);
  expect(JSON.parse((await AsyncStorage.getItem('clawket.manual-sessions.v1'))!))
    .toContainEqual({ connectionId: f.connectionId, agentId: 'main', key: f.created.key });
});

it.each([false, true])('keeps a current failure visible but retires a late failure after reopening: retired=%s', async retired => {
  const ref = createRef<SessionPanelHandle>();
  let fail!: (error: Error) => void;
  const error = new Error('creation unavailable');
  render(<SessionPanelHost ref={ref} currentAgentId="main" currentSessionKey="old" onVisibilityChange={jest.fn()}
    onSelectSession={jest.fn()} onCreateSession={() => new Promise<void>((_resolve, reject) => { fail = reject; })} />);
  act(() => ref.current!.open(scope));
  let observed!: Promise<unknown>;
  act(() => { observed = Promise.resolve(current().onCreateSession!({} as AgentDescriptor)).catch(failure => failure); });
  if (retired) act(() => { current().onClose(); ref.current!.open({ ...scope, sessionKey: 'later' }); });
  let outcome: unknown;
  await act(async () => { fail(error); outcome = await observed; });
  expect(outcome).toBe(retired ? false : error);
  expect(current().visible).toBe(true);
});

it.each(['current', 'closed', 'selected'] as const)('fences a deferred permission/paywall continuation when the presentation is %s', async state => {
  const ref = createRef<SessionPanelHandle>();
  const agent = { connectionId: `gated-${state}`, agentId: 'main' } as AgentDescriptor;
  const createSession = jest.fn().mockResolvedValue({ key: 'gated-created' });
  const adapter = { connection: { id: agent.connectionId }, capabilities: { sessionCreate: true }, createSession } as unknown as AgentAdapter;
  const navigate = jest.fn();
  const visibility = jest.fn();
  let continueCreation!: () => Promise<void>;
  render(<SessionPanelHost ref={ref} currentAgentId="main" currentSessionKey="old" onVisibilityChange={visibility}
    onSelectSession={jest.fn()} onCreateSession={(target, projectId, canPresent) => {
      continueCreation = async () => {
        const accepted = await createSessionForPresentation(adapter, target.agentId, projectId, canPresent, session => navigate(session.key));
        if (accepted && canPresent()) ref.current?.close();
      };
      return false;
    }} />);
  act(() => ref.current!.open({ connectionId: agent.connectionId, agentId: 'main', sessionKey: 'old' }));
  await act(async () => { expect(await current().onCreateSession!(agent)).toBe(false); });
  expect(current().visible).toBe(true);
  expect(createSession).not.toHaveBeenCalled();
  if (state === 'closed') act(() => { current().onClose(); ref.current!.open({ connectionId: agent.connectionId, agentId: 'main', sessionKey: 'later' }); });
  if (state === 'selected') act(() => { current().onSelectSession({ key: 'reader-choice' } as SessionPanelRow); });
  await act(async () => { await continueCreation(); });
  if (state === 'current') {
    expect(createSession).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('gated-created');
    expect(current().visible).toBe(false);
    expect(visibility.mock.calls).toEqual([[true], [false]]);
  } else {
    expect(createSession).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    expect(current().visible).toBe(true);
  }
});

it.each(['openclaw', 'hermes', 'codex', 'claude-code', 'pi'])('keeps normal %s creation eligible for automatic entry and dismissal', async backend => {
  const f = creationFixture(backend);
  let outcome: unknown;
  await act(async () => { outcome = await f.flight(); });
  expect(outcome).not.toBe(false);
  expect(f.navigate).toHaveBeenCalledWith(f.created.key);
  expect(f.createSession).toHaveBeenCalledWith('main', { projectId: 'project' });
  act(() => f.presentation.onClose());
  expect(current().visible).toBe(false);
});
