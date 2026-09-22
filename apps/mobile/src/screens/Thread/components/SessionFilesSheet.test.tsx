import React from 'react';
import { Platform } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import type { AgentAdapter } from '@clawket/agent-protocol';
import * as Sharing from 'expo-sharing';
import { SessionFilesSheet } from './SessionFilesSheet';
jest.mock('react-native', () => {
  const R = require('react'); const host = (name: string) => ({ children, ...props }: any) => R.createElement(name, props, children);
  return { Platform: { OS: 'ios' }, View: host('View'), Text: host('Text'), Pressable: host('Pressable'), ActivityIndicator: host('ActivityIndicator'), StyleSheet: { create: (v: unknown) => v } };
});
jest.mock('../../../theme', () => ({ useAppTheme: () => ({ theme: { colors: { inkSecondary: '#555' } } }) }));
jest.mock('@gorhom/bottom-sheet', () => ({ BottomSheetScrollView: ({ children }: any) => children }));
jest.mock('lucide-react-native', () => ({ Download: () => null, FileText: () => null, RotateCw: () => null }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
let mockAfterClose: (() => void) | undefined;
jest.mock('../../../components/ui/Sheet', () => ({ Sheet: ({ visible, children, onAfterClose }: any) => { mockAfterClose = onAfterClose; return visible ? children : null; } }));
jest.mock('../../../components/ui/SheetHeaderButton', () => ({ SheetHeaderButton: () => null }));
jest.mock('../../../components/ui/SettingsGroup', () => ({ SettingsDivider: () => null, SettingsRow: (props: any) => require('react').createElement(require('react-native').Pressable, props) }));
jest.mock('../../../components/ui/Banner', () => ({ Banner: () => null }));
jest.mock('../../../components/ui/LoadingState', () => ({ LoadingState: () => null }));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn().mockResolvedValue(true), shareAsync: jest.fn().mockResolvedValue(undefined) }));
const mockWrite = jest.fn(); const mockDelete = jest.fn();
jest.mock('expo-file-system', () => ({ Paths: { cache: 'file:///cache/' }, FileMode: { WriteOnly: 'w' },
  Directory: class { exists = true; create() {} list() { return []; } delete = mockDelete; },
  File: class { uri = 'file:///cache/report.pdf'; create() {} open() { return { writeBytes: mockWrite, close() {} }; } } }));
const file = { id: 'handle', name: 'report.pdf', size: 3, mimeType: 'application/pdf' };
const chunk = { offset: 0, total: 3, data: 'YWJj', done: true };
function setup() {
  const read = jest.fn().mockResolvedValue(chunk); const list = jest.fn().mockResolvedValue({ files: [file] });
  return { read, adapter: { sessionFiles: { read, list } } as unknown as AgentAdapter };
}
beforeEach(() => { jest.clearAllMocks(); Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true }); });
test('lists without downloading, shares after sheet dismissal, and cleans temporary data', async () => {
  const { adapter, read } = setup(); const onClose = jest.fn();
  const view = render(<SessionFilesSheet visible adapter={adapter} sessionKey="one" online onClose={onClose} />);
  await waitFor(() => expect(view.getByTestId('session-file-0')).toBeTruthy()); expect(read).not.toHaveBeenCalled();
  fireEvent.press(view.getByTestId('session-file-0')); await waitFor(() => expect(onClose).toHaveBeenCalled());
  expect(Sharing.shareAsync).not.toHaveBeenCalled();
  view.rerender(<SessionFilesSheet visible={false} adapter={adapter} sessionKey="one" online onClose={onClose} />);
  act(() => mockAfterClose?.()); await waitFor(() => expect(Sharing.shareAsync).toHaveBeenCalledTimes(1));
  expect(mockWrite).toHaveBeenCalledWith(new Uint8Array([97, 98, 99])); expect(mockDelete).toHaveBeenCalledTimes(1);
});
test('closing during a read discards late data and cleans the partial file', async () => {
  const { adapter, read } = setup(); let finish!: (v: typeof chunk) => void;
  read.mockImplementation(() => new Promise(resolve => { finish = resolve; })); const onClose = jest.fn();
  const view = render(<SessionFilesSheet visible adapter={adapter} sessionKey="one" online onClose={onClose} />);
  await waitFor(() => expect(view.getByTestId('session-file-0')).toBeTruthy()); fireEvent.press(view.getByTestId('session-file-0'));
  await waitFor(() => expect(read).toHaveBeenCalled());
  view.rerender(<SessionFilesSheet visible={false} adapter={adapter} sessionKey="one" online onClose={onClose} />);
  await act(async () => finish(chunk));
  expect(mockWrite).not.toHaveBeenCalled(); expect(Sharing.shareAsync).not.toHaveBeenCalled(); expect(mockDelete).toHaveBeenCalledTimes(1);
});
test('changing sessions before the native share handoff invalidates the downloaded file', async () => {
  const { adapter } = setup(); const onClose = jest.fn();
  const view = render(<SessionFilesSheet visible adapter={adapter} sessionKey="one" online onClose={onClose} />);
  await waitFor(() => expect(view.getByTestId('session-file-0')).toBeTruthy()); fireEvent.press(view.getByTestId('session-file-0'));
  await waitFor(() => expect(onClose).toHaveBeenCalled());
  view.rerender(<SessionFilesSheet visible={false} adapter={adapter} sessionKey="two" online onClose={onClose} />);
  act(() => mockAfterClose?.()); expect(Sharing.shareAsync).not.toHaveBeenCalled(); expect(mockDelete).toHaveBeenCalledTimes(1);
});

test('keeps Android grants readable after the chooser returns', async () => {
  Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
  const { adapter } = setup(); const onClose = jest.fn();
  const view = render(<SessionFilesSheet visible adapter={adapter} sessionKey="one" online onClose={onClose} />);
  await waitFor(() => expect(view.getByTestId('session-file-0')).toBeTruthy()); fireEvent.press(view.getByTestId('session-file-0'));
  await waitFor(() => expect(onClose).toHaveBeenCalled()); act(() => mockAfterClose?.());
  await waitFor(() => expect(Sharing.shareAsync).toHaveBeenCalledTimes(1)); expect(mockDelete).not.toHaveBeenCalled();
});
