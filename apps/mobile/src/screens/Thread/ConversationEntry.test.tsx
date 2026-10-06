import React from 'react';
import { act, render, waitFor } from '@testing-library/react-native';
import { ConversationEntry } from './ConversationEntry';

jest.mock('react-native', () => ({ ...jest.requireActual('react-native'), View: 'View' }));
jest.mock('lucide-react-native', () => ({ ChevronLeft: () => null }));

let mockPanel: any;
let mockLoading: any = null;
let mockPill: any = null;
const mockAdapter = { connection: { id: 'c' } };
const mockSnapshot: any = { initialized: true, activeConnectionId: 'c', activeAdapter: mockAdapter,
  roster: [{ connection: { id: 'c' }, agents: [{ agent: { agentId: 'codex', name: 'Codex' }, sessions: [{ key: 'existing' }] }] }] };
const mockRuntime = { activate: jest.fn(async (_connectionId: string): Promise<any> => ({ ...mockSnapshot })), refreshRoster: jest.fn(async () => {}), getSnapshot: () => mockSnapshot };
const mockPreferences = { getLastSession: jest.fn(async (_connectionId: string, _agentId: string): Promise<string | null> => null) };
const mockCreate = jest.fn(async (..._args: any[]) => ({ key: 'created' }));
jest.mock('../../connection', () => ({ useConnections: () => mockSnapshot, getConnectionRuntime: () => mockRuntime }));
jest.mock('@react-navigation/native', () => ({ useIsFocused: () => true }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0 }) }));
jest.mock('../../theme', () => ({ useAppTheme: () => ({ theme: { colors: { canvas: '#fff', surface: '#f2f2f4', inkSecondary: '#888' } } }) }));
jest.mock('../../contexts/ProPaywallContext', () => ({ useProPaywall: () => ({ showPaywall: jest.fn() }) }));
let mockWallpaperKind = 'pattern';
jest.mock('../../contexts/AppContext', () => ({ useAppContext: () => ({ chatAppearance: {
  version: 1, background: { kind: mockWallpaperKind, enabled: false, blur: 8, dim: 0, fillMode: 'cover' }, bubbles: { style: 'solid', opacity: 1 },
} }) }));
jest.mock('../../components/chat/ChatBackgroundLayer', () => ({ ChatBackgroundLayer: (props: any) => { mockWallpaper = props; return null; } }));
let mockWallpaper: any;
jest.mock('../../components/ui/FloatingButton', () => ({ FloatingButton: () => null }));
jest.mock('../../components/ui/HeaderPill', () => ({ HeaderPill: (props: any) => { mockPill = props; return null; } }));
jest.mock('../../components/ui/LoadingState', () => ({
  LoadingState: (props: any) => { mockLoading = props; return null; },
  useLoadingHandoff: (loading: boolean) => (loading ? 'wait' : null),
}));
jest.mock('../SessionPanel', () => ({ SessionPanel: (props: any) => { mockPanel = props; return null; } }));
jest.mock('../../services/session-preferences', () => ({ SessionPreferencesService: { getLastSession: (connectionId: string, agentId: string) => mockPreferences.getLastSession(connectionId, agentId) } }));
jest.mock('../../services/manual-sessions', () => ({ ManualSessions: { create: (...args: any[]) => mockCreate(...args) } }));

const navigation = { replace: jest.fn(), goBack: jest.fn(), navigate: jest.fn() };
const props = { navigation, route: { params: { connectionId: 'c', agentId: 'codex', sessionKey: '', from: 'roster' } } } as any;
beforeEach(() => {
  jest.clearAllMocks(); mockLoading = null; mockPill = null;
  Object.assign(mockSnapshot, { initialized: true, activeConnectionId: 'c', activeAdapter: mockAdapter, activeState: 'connecting', error: null,
    roster: [{ connection: { id: 'c', backendKind: 'codex' }, source: 'live', agents: [{ agent: { agentId: 'codex', name: 'Codex' }, sessions: [{ key: 'existing' }] }] }] });
  mockRuntime.activate.mockReset().mockImplementation(async () => {
    mockSnapshot.activeState = 'ready';
    return { ...mockSnapshot };
  });
  mockRuntime.refreshRoster.mockReset().mockResolvedValue(undefined);
  mockPreferences.getLastSession.mockResolvedValue(null); mockCreate.mockResolvedValue({ key: 'created' });
});

it('waits with the chat header and the shared Companion loading state, following the real stage', async () => {
  mockSnapshot.roster[0].source = 'cache';
  let finishActivate!: (snapshot: any) => void;
  let finishRoster!: () => void;
  mockRuntime.activate.mockReturnValueOnce(new Promise(resolve => { finishActivate = resolve; }));
  mockRuntime.refreshRoster.mockReturnValueOnce(new Promise<void>(resolve => { finishRoster = resolve; }));
  const view = render(<ConversationEntry {...props} />);
  expect(mockPill).toMatchObject({ agentId: 'codex', name: 'Codex', subtitle: '' });
  expect(mockLoading).toMatchObject({ pose: 'connecting', message: 'Connecting', slowAfterMs: 12_000, waitKey: 'c:connecting' });
  // A long wait offers the connection page, where status and reconnect live.
  mockLoading.slowAction.onPress();
  expect(navigation.navigate).toHaveBeenCalledWith('Connection', { connectionId: 'c' });
  await act(async () => { mockSnapshot.activeState = 'ready'; finishActivate({ ...mockSnapshot }); });
  view.rerender(<ConversationEntry {...props} />);
  expect(mockLoading).toMatchObject({ message: 'Loading sessions', waitKey: 'c:sessions' });
  await act(async () => { finishRoster(); });
  await waitFor(() => expect(mockPanel.visible).toBe(true));
  // The loading state leaves once the picker opens; the header stays behind the sheet.
  mockLoading = null;
  view.rerender(<ConversationEntry {...props} />);
  expect(mockLoading).toBeNull();
  expect(mockPill).toMatchObject({ name: 'Codex' });
});

it('shows catalog progress as soon as the handshake is ready, while activation still awaits its list', async () => {
  mockRuntime.activate.mockReturnValueOnce(new Promise(() => {}));
  const view = render(<ConversationEntry {...props} />);
  mockSnapshot.activeState = 'ready';
  view.rerender(<ConversationEntry {...props} />);
  expect(mockLoading).toMatchObject({ message: 'Loading sessions', waitKey: 'c:sessions', slowAfterMs: 12_000 });
  view.unmount();
});

it('opens the picker from a cold activation catalog without a duplicate read even with no last conversation', async () => {
  render(<ConversationEntry {...props} />);
  await waitFor(() => expect(mockPanel.visible).toBe(true));
  expect(mockRuntime.activate).toHaveBeenCalledWith('c');
  expect(mockRuntime.refreshRoster).not.toHaveBeenCalled();
  expect(mockCreate).not.toHaveBeenCalled();
});

it('retries a failed activation catalog instead of treating its retained live rows as a fresh read', async () => {
  mockSnapshot.error = { operation: 'roster' };
  render(<ConversationEntry {...props} />);
  await waitFor(() => expect(mockPanel.visible).toBe(true));
  expect(mockRuntime.refreshRoster).toHaveBeenCalledTimes(1);
});

it.each(['openclaw', 'hermes', 'pi', 'claude-code'])('preserves the ordinary slow-hint budget for %s', async backendKind => {
  mockSnapshot.roster[0].connection.backendKind = backendKind;
  mockRuntime.activate.mockReturnValueOnce(new Promise(() => {}));
  const view = render(<ConversationEntry {...props} />);
  expect(mockLoading.slowAfterMs).toBe(6_000);
  view.unmount();
});

it('waits on the thread\'s own wallpaper and glass header, or the plain canvas when chosen', async () => {
  const view = render(<ConversationEntry {...props} />);
  expect(mockWallpaper.appearance.background.kind).toBe('pattern');
  expect(mockPill).toMatchObject({ material: 'glass' });
  // The cat's desk is a card of the page it waits on: white over the wallpaper, not the canvas gray.
  expect(mockLoading.surface).toBe('#FFFFFF');
  mockWallpaperKind = 'plain';
  view.rerender(<ConversationEntry {...props} />);
  expect(mockPill).toMatchObject({ material: 'surface' });
  expect(mockLoading.surface).toBe('#f2f2f4');
  mockWallpaperKind = 'pattern';
  await waitFor(() => expect(mockPanel.visible).toBe(true));
});

it('opens the scoped picker without creating a placeholder conversation', async () => {
  render(<ConversationEntry {...props} />);
  await waitFor(() => expect(mockPanel.visible).toBe(true));
  expect(mockPanel.connectionId).toBe('c');
  expect(mockCreate).not.toHaveBeenCalled();
  expect(navigation.replace).not.toHaveBeenCalled();
});
it('restores a known last conversation but falls back when it was deleted', async () => {
  mockPreferences.getLastSession.mockResolvedValue('existing');
  const first = render(<ConversationEntry {...props} />);
  await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('Thread', expect.objectContaining({ sessionKey: 'existing' })));
  first.unmount(); navigation.replace.mockClear();
  mockPreferences.getLastSession.mockResolvedValue('deleted');
  render(<ConversationEntry {...props} />);
  await waitFor(() => expect(mockPanel.visible).toBe(true));
  expect(navigation.replace).not.toHaveBeenCalled();
});
it('waits for sheet dismissal before opening the selected conversation', async () => {
  render(<ConversationEntry {...props} />);
  await waitFor(() => expect(mockPanel.visible).toBe(true));
  act(() => mockPanel.onSelectSession({ key: 'existing' }));
  expect(navigation.replace).not.toHaveBeenCalled();
  act(() => mockPanel.onAfterClose());
  expect(navigation.replace).toHaveBeenCalledWith('Thread', expect.objectContaining({ sessionKey: 'existing' }));
});
it('opens the Agent profile over the entry once the sheet has gone', async () => {
  render(<ConversationEntry {...props} />);
  await waitFor(() => expect(mockPanel.visible).toBe(true));
  act(() => { mockPanel.onClose(); mockPanel.onOpenAgentProfile({ connectionId: 'c', agentId: 'codex' }); });
  expect(navigation.navigate).not.toHaveBeenCalledWith('AgentSettings', expect.anything());
  act(() => mockPanel.onAfterClose());
  expect(navigation.navigate).toHaveBeenCalledWith('AgentSettings', { connectionId: 'c', agentId: 'codex' });
  expect(navigation.goBack).not.toHaveBeenCalled();
  expect(navigation.replace).not.toHaveBeenCalled();
});
it('creates only on explicit request, using the selected project', async () => {
  render(<ConversationEntry {...props} />);
  await waitFor(() => expect(mockPanel.visible).toBe(true));
  await act(async () => { await mockPanel.onCreateSession({ agentId: 'codex' }, 'project-2'); });
  expect(mockCreate).toHaveBeenCalledWith(mockAdapter, 'codex', 'manual', { projectId: 'project-2' });
  act(() => mockPanel.onAfterClose());
  expect(navigation.replace).toHaveBeenCalledWith('Thread', expect.objectContaining({ sessionKey: 'created' }));
});
it('ignores creation completing after the user closes the picker', async () => {
  let finish!: (value: { key: string }) => void;
  mockCreate.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  render(<ConversationEntry {...props} />);
  await waitFor(() => expect(mockPanel.visible).toBe(true));
  let creating: Promise<void>;
  act(() => { creating = mockPanel.onCreateSession({ agentId: 'codex' }); mockPanel.onClose(); });
  act(() => mockPanel.onAfterClose());
  await act(async () => { finish({ key: 'created' }); await creating; });
  expect(navigation.goBack).toHaveBeenCalledTimes(1);
  expect(navigation.replace).not.toHaveBeenCalled();
});
it('does not activate or restore a locked connection', async () => {
  render(<ConversationEntry {...props} locked />);
  await waitFor(() => expect(mockPanel.visible).toBe(true));
  expect(mockPanel.permissionDenied).toBe(true);
  expect(mockRuntime.activate).not.toHaveBeenCalled();
  expect(mockPreferences.getLastSession).not.toHaveBeenCalled();
});

it('reopens a ready known conversation before the background catalog refresh completes', async () => {
  mockSnapshot.activeState = 'ready';
  mockPreferences.getLastSession.mockResolvedValue('existing');
  mockRuntime.refreshRoster.mockReturnValueOnce(new Promise<void>(() => {}));
  render(<ConversationEntry {...props} />);
  await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('Thread', expect.objectContaining({ sessionKey: 'existing' })));
  expect(mockPreferences.getLastSession).toHaveBeenCalledWith('c', 'codex');
  expect(mockRuntime.activate).not.toHaveBeenCalled();
  expect(mockRuntime.refreshRoster).toHaveBeenCalledTimes(1);
  expect(navigation.replace.mock.invocationCallOrder[0]).toBeLessThan(mockRuntime.refreshRoster.mock.invocationCallOrder[0]);
  expect(mockCreate).not.toHaveBeenCalled();
});

it.each(['missing', 'archived', 'cached', 'other-agent', 'other-connection'])('keeps the catalog/picker path for a %s last-session target', async kind => {
  mockSnapshot.activeState = 'ready';
  mockPreferences.getLastSession.mockResolvedValue('existing');
  const group = mockSnapshot.roster[0];
  if (kind === 'missing') group.agents[0].sessions = [];
  if (kind === 'archived') group.agents[0].sessions[0].archived = true;
  if (kind === 'cached') group.source = 'cache';
  if (kind === 'other-agent') group.agents[0].agent.agentId = 'other';
  if (kind === 'other-connection') group.connection.id = 'other';
  let refreshed!: () => void;
  mockRuntime.refreshRoster.mockReturnValueOnce(new Promise<void>(resolve => { refreshed = resolve; }));
  render(<ConversationEntry {...props} />);
  await waitFor(() => expect(mockRuntime.refreshRoster).toHaveBeenCalledTimes(1));
  expect(mockRuntime.activate).toHaveBeenCalledWith('c');
  expect(navigation.replace).not.toHaveBeenCalled();
  // Failed refreshes may retain an archived row; it must remain unselectable.
  if (kind !== 'archived') mockSnapshot.roster[0].agents[0].sessions = [];
  await act(async () => { refreshed(); });
  await waitFor(() => expect(mockPanel.visible).toBe(true));
  expect(navigation.replace).not.toHaveBeenCalled();
});

it('waits for cold activation, then reuses its live catalog without a second scan', async () => {
  mockSnapshot.activeState = 'ready'; mockSnapshot.activeConnectionId = 'other';
  mockPreferences.getLastSession.mockResolvedValue('existing');
  let activated!: (snapshot: any) => void;
  mockRuntime.activate.mockReturnValueOnce(new Promise(resolve => { activated = resolve; }));
  render(<ConversationEntry {...props} />);
  expect(mockRuntime.activate).toHaveBeenCalledWith('c');
  expect(mockRuntime.refreshRoster).not.toHaveBeenCalled();
  expect(navigation.replace).not.toHaveBeenCalled();
  mockSnapshot.activeConnectionId = 'c';
  await act(async () => { activated({ ...mockSnapshot }); });
  await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('Thread', expect.objectContaining({ sessionKey: 'existing' })));
  expect(mockRuntime.refreshRoster).not.toHaveBeenCalled();
});

it('does not reopen from a late preference read after leaving the entry', async () => {
  mockSnapshot.activeState = 'ready';
  let lastRead!: (key: string) => void;
  mockPreferences.getLastSession.mockReturnValueOnce(new Promise(resolve => { lastRead = resolve; }));
  const view = render(<ConversationEntry {...props} />);
  view.unmount();
  await act(async () => { lastRead('existing'); });
  expect(navigation.replace).not.toHaveBeenCalled();
  expect(mockRuntime.activate).not.toHaveBeenCalled();
  expect(mockRuntime.refreshRoster).not.toHaveBeenCalled();
});

it('rechecks adapter identity after the preference read before using the shortcut', async () => {
  mockSnapshot.activeState = 'ready';
  let lastRead!: (key: string) => void;
  mockPreferences.getLastSession.mockReturnValueOnce(new Promise(resolve => { lastRead = resolve; }));
  mockRuntime.refreshRoster.mockReturnValueOnce(new Promise<void>(() => {}));
  mockRuntime.activate.mockImplementationOnce(async () => ({ ...mockSnapshot, activeAdapter: mockAdapter }));
  render(<ConversationEntry {...props} />);
  mockSnapshot.activeAdapter = { connection: { id: 'c' } };
  await act(async () => { lastRead('existing'); });
  expect(mockRuntime.activate).toHaveBeenCalledWith('c');
  expect(navigation.replace).not.toHaveBeenCalled();
});

it.each(['cached', 'archived', 'missing', 'other-agent', 'other-connection', 'not-ready'])(
  'does not reuse an activation catalog with a %s target', async kind => {
    mockPreferences.getLastSession.mockResolvedValue('existing');
    mockRuntime.activate.mockImplementationOnce(async () => {
      mockSnapshot.activeState = kind === 'not-ready' ? 'reconnecting' : 'ready';
      const group = mockSnapshot.roster[0];
      if (kind === 'cached') group.source = 'cache';
      if (kind === 'archived') group.agents[0].sessions[0].archived = true;
      if (kind === 'missing') group.agents[0].sessions = [];
      if (kind === 'other-agent') group.agents[0].agent.agentId = 'other';
      if (kind === 'other-connection') group.connection.id = 'other';
      return { ...mockSnapshot };
    });
    render(<ConversationEntry {...props} />);
    await waitFor(() => expect(mockPanel.visible).toBe(true));
    expect(mockRuntime.refreshRoster).toHaveBeenCalledTimes(['archived', 'missing'].includes(kind) ? 0 : 1);
    expect(navigation.replace).not.toHaveBeenCalled();
  },
);

it('uses a successful fallback refresh when activation retained only cached sessions', async () => {
  mockSnapshot.roster[0].source = 'cache';
  mockPreferences.getLastSession.mockResolvedValue('existing');
  mockRuntime.refreshRoster.mockImplementationOnce(async () => { mockSnapshot.roster[0].source = 'live'; });
  render(<ConversationEntry {...props} />);
  await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('Thread', expect.objectContaining({ sessionKey: 'existing' })));
  expect(mockRuntime.refreshRoster).toHaveBeenCalledTimes(1);
});

it.each(['adapter-replaced', 'disconnected', 'left', 'connection-switched'])(
  'does not reopen an activation snapshot after %s while preferences are pending', async kind => {
    let lastRead!: (key: string) => void;
    mockPreferences.getLastSession.mockReturnValueOnce(new Promise(resolve => { lastRead = resolve; }));
    const view = render(<ConversationEntry {...props} />);
    await act(async () => {});
    expect(mockRuntime.activate).toHaveBeenCalledTimes(1);
    if (kind === 'adapter-replaced') mockSnapshot.activeAdapter = { connection: { id: 'c' } };
    if (kind === 'disconnected') { mockSnapshot.activeState = 'reconnecting'; mockSnapshot.roster[0].source = 'cache'; }
    if (kind === 'connection-switched') mockSnapshot.activeConnectionId = 'other';
    if (kind === 'left') view.unmount();
    await act(async () => { lastRead('existing'); });
    expect(navigation.replace).not.toHaveBeenCalled();
  },
);
