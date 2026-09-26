import React from 'react';
import { act, render, waitFor } from '@testing-library/react-native';
import { ConversationEntry } from './ConversationEntry';

jest.mock('react-native', () => ({ ...jest.requireActual('react-native'), View: 'View', ActivityIndicator: 'ActivityIndicator' }));

let mockPanel: any;
const mockAdapter = { connection: { id: 'c' } };
const mockSnapshot = { initialized: true, activeConnectionId: 'c', activeAdapter: mockAdapter,
  roster: [{ connection: { id: 'c' }, agents: [{ agent: { agentId: 'codex', name: 'Codex' }, sessions: [{ key: 'existing' }] }] }] };
const mockRuntime = { activate: jest.fn(async () => {}), refreshRoster: jest.fn(async () => {}), getSnapshot: () => mockSnapshot };
const mockPreferences = { getLastSession: jest.fn(async (): Promise<string | null> => null) };
const mockCreate = jest.fn(async (..._args: any[]) => ({ key: 'created' }));
jest.mock('../../connection', () => ({ useConnections: () => mockSnapshot, getConnectionRuntime: () => mockRuntime }));
jest.mock('@react-navigation/native', () => ({ useIsFocused: () => true }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0 }) }));
jest.mock('../../theme', () => ({ useAppTheme: () => ({ theme: { colors: { canvas: '#fff', inkSecondary: '#888' } } }) }));
jest.mock('../../contexts/ProPaywallContext', () => ({ useProPaywall: () => ({ showPaywall: jest.fn() }) }));
jest.mock('../../components/ui/ScreenHeader', () => ({ ScreenHeader: () => null }));
jest.mock('../SessionPanel', () => ({ SessionPanel: (props: any) => { mockPanel = props; return null; } }));
jest.mock('../../services/session-preferences', () => ({ SessionPreferencesService: { getLastSession: (...args: any[]) => mockPreferences.getLastSession() } }));
jest.mock('../../services/manual-sessions', () => ({ ManualSessions: { create: (...args: any[]) => mockCreate(...args) } }));

const navigation = { replace: jest.fn(), goBack: jest.fn() };
const props = { navigation, route: { params: { connectionId: 'c', agentId: 'codex', sessionKey: '', from: 'roster' } } } as any;
beforeEach(() => { jest.clearAllMocks(); mockPreferences.getLastSession.mockResolvedValue(null); mockCreate.mockResolvedValue({ key: 'created' }); });

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
