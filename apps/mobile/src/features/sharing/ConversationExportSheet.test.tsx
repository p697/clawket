import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import type { AgentAdapter } from '@clawket/agent-protocol';
import * as Sharing from 'expo-sharing';
import { loadConversationExport } from '../../services/conversation-export';
import { ConversationExportSheet } from './ConversationExportSheet';
jest.mock('react-native', () => {
  const R = require('react'); const host = (name: string) => ({ children, ...props }: any) => R.createElement(name, props, children);
  return { View: host('View'), Text: host('Text'), Pressable: host('Pressable'), StyleSheet: { create: (value: unknown) => value } };
});
jest.mock('../../theme', () => ({ useAppTheme: () => ({ theme: { colors: { inkSecondary: '#555' } } }) }));
jest.mock('@gorhom/bottom-sheet', () => ({ BottomSheetScrollView: ({ children }: any) => children }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
let mockAfterClose: (() => void) | undefined;
jest.mock('../../components/ui/Sheet', () => ({ Sheet: ({ visible, children, onAfterClose }: any) => {
  mockAfterClose = onAfterClose; return visible ? children : null;
} }));
jest.mock('../../components/ui/SettingsGroup', () => ({
  SettingsGroup: ({ children }: any) => children, SettingsDivider: () => null,
  SettingsRow: (props: any) => require('react').createElement(require('react-native').Pressable, props),
}));
jest.mock('../../components/ui/Banner', () => ({ Banner: ({ message }: any) => require('react').createElement(require('react-native').Text, null, message) }));
jest.mock('../../components/ui/LoadingState', () => ({ LoadingState: () => null }));
jest.mock('../../services/conversation-export', () => ({ loadConversationExport: jest.fn(), formatConversationExport: () => '# Example' }));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn().mockResolvedValue(true), shareAsync: jest.fn().mockResolvedValue(undefined) }));
const mockWrite = jest.fn(); const mockDelete = jest.fn();
jest.mock('expo-file-system', () => ({ Paths: { cache: 'file:///cache/' },
  Directory: class { exists = true; create() {} delete() {} },
  File: class { uri = 'file:///cache/export.md'; exists = true; write = mockWrite; delete = mockDelete; } }));
const target = { key: 'main', title: 'Example' };
const adapter = { state: 'ready' } as AgentAdapter;
const data = { title: 'Example', messages: [] };
beforeEach(() => { jest.clearAllMocks(); jest.mocked(loadConversationExport).mockResolvedValue(data); });
test('prepares without opening native sharing, then shares only on an explicit format choice and cleans its file', async () => {
  const view = render(<ConversationExportSheet target={target} adapter={adapter} onClose={() => undefined} />);
  await waitFor(() => expect(view.getByTestId('conversation-export-markdown')).toBeTruthy());
  expect(Sharing.shareAsync).not.toHaveBeenCalled();
  fireEvent.press(view.getByTestId('conversation-export-markdown'));
  expect(Sharing.shareAsync).not.toHaveBeenCalled();
  act(() => mockAfterClose?.());
  await waitFor(() => expect(mockDelete).toHaveBeenCalledTimes(1));
  expect(mockWrite).toHaveBeenCalledWith('# Example');
  expect(Sharing.shareAsync).toHaveBeenCalledWith('file:///cache/export.md', expect.objectContaining({ mimeType: 'text/markdown' }));
});
test('closing invalidates a late completed export', async () => {
  let finish!: (value: typeof data) => void;
  jest.mocked(loadConversationExport).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const view = render(<ConversationExportSheet target={target} adapter={adapter} onClose={() => undefined} />);
  const signal = jest.mocked(loadConversationExport).mock.calls[0][3];
  view.rerender(<ConversationExportSheet target={null} adapter={adapter} onClose={() => undefined} />);
  await act(async () => finish(data));
  expect(signal.aborted).toBe(true);
  expect(Sharing.shareAsync).not.toHaveBeenCalled();
});
test('changing targets while the sheet closes cancels native sharing and leaves a new export usable', async () => {
  const view = render(<ConversationExportSheet target={target} adapter={adapter} onClose={() => undefined} />);
  await waitFor(() => expect(view.getByTestId('conversation-export-json')).toBeTruthy());
  fireEvent.press(view.getByTestId('conversation-export-json'));
  view.rerender(<ConversationExportSheet target={{ key: 'next', title: 'Next' }} adapter={adapter} onClose={() => undefined} />);
  act(() => mockAfterClose?.());
  expect(Sharing.shareAsync).not.toHaveBeenCalled();
  await waitFor(() => expect(view.getByTestId('conversation-export-json')).toBeTruthy());
  fireEvent.press(view.getByTestId('conversation-export-json'));
  act(() => mockAfterClose?.());
  await waitFor(() => expect(Sharing.shareAsync).toHaveBeenCalledTimes(1));
});
test('retains the sheet with a meaningful running-task error', async () => {
  jest.mocked(loadConversationExport).mockRejectedValue(new Error('export_running'));
  const view = render(<ConversationExportSheet target={target} adapter={adapter} onClose={() => undefined} />);
  await waitFor(() => expect(view.getByText('Wait until the task finishes.')).toBeTruthy());
  expect(view.queryByTestId('conversation-export-markdown')).toBeNull();
});

test('saves an explicitly chosen snapshot under its exact owner without opening native sharing', async () => {
  const { ConversationArchives } = require('../../services/conversation-archives');
  const save = jest.spyOn(ConversationArchives, 'save').mockResolvedValue({ id: 'saved' });
  const onClose = jest.fn();
  const view = render(<ConversationExportSheet target={{ ...target, connectionId: 'one', agentId: 'agent' }} adapter={adapter} onClose={onClose} />);
  await waitFor(() => expect(view.getByTestId('conversation-export-archive')).toBeTruthy());
  expect(save).not.toHaveBeenCalled();
  fireEvent.press(view.getByTestId('conversation-export-archive'));
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  expect(save).toHaveBeenCalledWith({ connectionId: 'one', agentId: 'agent', sessionKey: 'main' }, data);
  expect(Sharing.shareAsync).not.toHaveBeenCalled();
  save.mockRestore();
});
