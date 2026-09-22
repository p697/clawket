import React from 'react';
import { Text } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import * as Sharing from 'expo-sharing';
import { ConversationArchives } from '../../services/conversation-archives';
import { ConversationArchiveSheet } from './ConversationArchiveSheet';
jest.mock('react-native', () => {
  const R = require('react'); const host = (name: string) => ({ children, ...props }: any) => R.createElement(name, props, children);
  return { Keyboard: { dismiss: jest.fn() }, View: host('View'), Text: host('Text'), Pressable: host('Pressable'), StyleSheet: { create: (value: unknown) => value } };
});
jest.mock('../../theme', () => ({ useAppTheme: () => ({ theme: { colors: { inkSecondary: '#555' } } }) }));
jest.mock('@gorhom/bottom-sheet', () => ({ BottomSheetScrollView: ({ children }: any) => children,
  BottomSheetFlatList: ({ data, renderItem, ListHeaderComponent, ListFooterComponent }: any) => <>{ListHeaderComponent}{data.map((item: any, index: number) => <React.Fragment key={index}>{renderItem({ item })}</React.Fragment>)}{ListFooterComponent}</> }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
let mockAfterClose: (() => void) | undefined;
jest.mock('../../components/ui/Sheet', () => ({ Sheet: ({ visible, children, headerRight, onAfterClose }: any) => {
  mockAfterClose = onAfterClose; return visible ? <>{headerRight}{children}</> : null;
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

jest.mock('../../services/conversation-archives', () => ({ ...jest.requireActual('../../services/conversation-archives'), ConversationArchives: { list: jest.fn(), remove: jest.fn().mockResolvedValue(undefined), rename: jest.fn(), setPinned: jest.fn() } }));
jest.mock('../../components/ui/SheetHeaderButton', () => ({ SheetHeaderButton: (props: any) => require('react').createElement(require('react-native').Pressable, props) }));
jest.mock('../../components/ui/Button', () => ({ Button: (props: any) => require('react').createElement(require('react-native').Pressable, props) }));
jest.mock('../../components/ui/SearchInput', () => ({ SearchInput: (props: any) => require('react').createElement('TextInput', props) }));
jest.mock('../../components/ui/DirectionalIcon', () => ({ ChevronLeft: () => null }));
jest.mock('lucide-react-native', () => ({ MoreHorizontal: () => null, Pencil: () => null, Pin: () => null, Search: () => null, Share2: () => null, Trash2: () => null }));
jest.mock('../../components/ui/CompositionSafeBottomSheetTextInput', () => ({ CompositionSafeBottomSheetTextInput: (props: any) => require('react').createElement('TextInput', props) }));
jest.mock('../../components/ui/SegmentedTabs', () => ({ SegmentedTabs: ({ tabs, onSwitch, testID }: any) => tabs.map((tab: any) => require('react').createElement(require('react-native').Pressable, { key: tab.key, testID: `${testID}-${tab.key}`, onPress: () => onSwitch(tab.key) })) }));
jest.mock('react-native-enriched-markdown', () => ({ EnrichedMarkdownText: ({ markdown }: any) => <Text>{markdown}</Text> }));
jest.mock('../../components/chat/chatMarkdown', () => ({ createChatMarkdownStyle: () => ({}), getChatMarkdownFlavor: () => 'commonmark', openChatMarkdownLink: jest.fn() }));
const entry = { id: 'saved', connectionId: 'one', agentId: 'main', sessionKey: 'session', savedAt: 1234,
  transcript: { title: 'Saved example', messages: [{ role: 'assistant' as const, text: 'Retained answer', attachments: [] }] } };
const props = { visible: true, isPro: false, onRequirePro: jest.fn(), onClose: jest.fn() };
beforeEach(() => { jest.clearAllMocks(); jest.mocked(ConversationArchives.list).mockResolvedValue([entry]); });
test('reads a retained copy offline without a Pro wall and deletes only after confirmation', async () => {
  const view = render(<ConversationArchiveSheet {...props} />);
  await waitFor(() => expect(view.getByTestId('archive-saved')).toBeTruthy());
  fireEvent.press(view.getByTestId('archive-saved'));
  expect(view.getByText('Retained answer')).toBeTruthy();
  expect(props.onRequirePro).not.toHaveBeenCalled();
  fireEvent.press(view.getByTestId('archive-actions'));
  fireEvent.press(view.getByTestId('archive-delete'));
  expect(ConversationArchives.remove).not.toHaveBeenCalled();
  fireEvent.press(view.getByTestId('archive-delete-confirm'));
  await waitFor(() => expect(ConversationArchives.remove).toHaveBeenCalledWith('saved'));
  expect(view.queryByText('Retained answer')).toBeNull();
});
test('gates bulk export and search at the action and ignores an upgrade continuation after close', async () => {
  const view = render(<ConversationArchiveSheet {...props} />);
  await waitFor(() => expect(view.getByTestId('archive-saved')).toBeTruthy());
  fireEvent.press(view.getByTestId('archive-actions'));
  fireEvent.press(view.getByTestId('archive-search-toggle'));
  expect(props.onRequirePro).toHaveBeenCalledTimes(1);
  fireEvent.press(view.getByTestId('archive-export'));
  const continuation = props.onRequirePro.mock.calls[1][0];
  expect(Sharing.shareAsync).not.toHaveBeenCalled();
  view.rerender(<ConversationArchiveSheet {...props} visible={false} />);
  act(() => continuation()); act(() => mockAfterClose?.());
  expect(Sharing.shareAsync).not.toHaveBeenCalled();
});
test('shares a single saved copy only after dismissing the owning sheet', async () => {
  const view = render(<ConversationArchiveSheet {...props} />);
  await waitFor(() => expect(view.getByTestId('archive-saved')).toBeTruthy());
  fireEvent.press(view.getByTestId('archive-saved'));
  fireEvent.press(view.getByTestId('archive-actions'));
  fireEvent.press(view.getByTestId('archive-export'));
  expect(Sharing.shareAsync).not.toHaveBeenCalled();
  act(() => mockAfterClose?.());
  await waitFor(() => expect(Sharing.shareAsync).toHaveBeenCalledTimes(1));
  expect(props.onRequirePro).not.toHaveBeenCalled();
});
test('does not display a stale read after closing and reopening', async () => {
  let finish!: (value: typeof entry[]) => void;
  jest.mocked(ConversationArchives.list).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const view = render(<ConversationArchiveSheet {...props} />);
  view.rerender(<ConversationArchiveSheet {...props} visible={false} />);
  await act(async () => finish([entry]));
  expect(view.queryByTestId('archive-saved')).toBeNull();
});

test('renames locally, keeps the reader intact and retains the edit after a failed write', async () => {
  jest.mocked(ConversationArchives.rename).mockRejectedValueOnce(new Error('disk full')).mockResolvedValueOnce({ ...entry, name: 'New title' });
  const view = render(<ConversationArchiveSheet {...props} />);
  await waitFor(() => expect(view.getByTestId('archive-saved')).toBeTruthy());
  fireEvent.press(view.getByTestId('archive-saved'));
  fireEvent.press(view.getByTestId('archive-actions'));
  fireEvent.press(view.getByTestId('archive-rename'));
  fireEvent.changeText(view.getByTestId('archive-rename-input'), 'New title');
  fireEvent.press(view.getByTestId('archive-rename-save'));
  await waitFor(() => expect(view.getByText('Failed to save')).toBeTruthy());
  expect(view.getByTestId('archive-rename-input').props.value).toBe('New title');
  fireEvent.press(view.getByTestId('archive-rename-save'));
  await waitFor(() => expect(view.getByText('Retained answer')).toBeTruthy());
  fireEvent.press(view.getByTestId('archive-back'));
  expect(view.getByTestId('archive-saved').props.title).toBe('New title');
  expect(props.onRequirePro).not.toHaveBeenCalled();
});

test('pins once during a pending write and filters without gating the saved copy', async () => {
  let finish!: (value: typeof entry & { pinned: boolean }) => void;
  jest.mocked(ConversationArchives.setPinned).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const view = render(<ConversationArchiveSheet {...props} />);
  await waitFor(() => expect(view.getByTestId('archive-saved')).toBeTruthy());
  fireEvent.press(view.getByTestId('archive-filter-pinned'));
  expect(view.queryByTestId('archive-saved')).toBeNull();
  expect(view.getByText('No results')).toBeTruthy();
  fireEvent.press(view.getByTestId('archive-filter-all'));
  fireEvent.press(view.getByTestId('archive-saved'));
  fireEvent.press(view.getByTestId('archive-actions'));
  fireEvent.press(view.getByTestId('archive-pin'));
  fireEvent.press(view.getByTestId('archive-pin'));
  expect(ConversationArchives.setPinned).toHaveBeenCalledTimes(1);
  await act(async () => finish({ ...entry, pinned: true }));
  fireEvent.press(view.getByTestId('archive-back'));
  fireEvent.press(view.getByTestId('archive-filter-pinned'));
  expect(view.getByTestId('archive-saved')).toBeTruthy();
  expect(props.onRequirePro).not.toHaveBeenCalled();
});

test('ignores a metadata completion after close and reopen', async () => {
  let finish!: (value: typeof entry & { pinned: boolean }) => void;
  jest.mocked(ConversationArchives.setPinned).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const view = render(<ConversationArchiveSheet {...props} />);
  await waitFor(() => expect(view.getByTestId('archive-saved')).toBeTruthy());
  fireEvent.press(view.getByTestId('archive-saved'));
  fireEvent.press(view.getByTestId('archive-actions'));
  fireEvent.press(view.getByTestId('archive-pin'));
  view.rerender(<ConversationArchiveSheet {...props} visible={false} />);
  view.rerender(<ConversationArchiveSheet {...props} />);
  await waitFor(() => expect(view.getByTestId('archive-saved')).toBeTruthy());
  await act(async () => finish({ ...entry, pinned: true }));
  expect(view.queryByText('Retained answer')).toBeNull();
  fireEvent.press(view.getByTestId('archive-filter-pinned'));
  expect(view.queryByTestId('archive-saved')).toBeNull();
});
