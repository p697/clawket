import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { getSharedPayloads } from 'expo-sharing';
import { IncomingShareStore } from '../../services/incoming-share';
import { IncomingShareCoordinator } from './IncomingShareCoordinator';

let mockForeground: (state: string) => void;
let mockLink: () => void;
jest.mock('react-native', () => {
  const R = require('react');
  const host = (name: string) => ({ children, ...props }: any) => R.createElement(name, props, children);
  return { View: host('View'), Text: host('Text'), Image: host('Image'), Pressable: host('Pressable'),
    StyleSheet: { create: (value: unknown) => value }, Keyboard: { dismiss: jest.fn() },
    TextInput: { State: { currentlyFocusedInput: () => null } },
    AppState: { addEventListener: (_: string, callback: typeof mockForeground) => { mockForeground = callback; return { remove: jest.fn() }; } },
    Linking: { addEventListener: (_: string, callback: typeof mockLink) => { mockLink = callback; return { remove: jest.fn() }; } } };
});
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('../../theme', () => ({ useAppTheme: () => ({ theme: { colors: {} } }) }));
jest.mock('@gorhom/bottom-sheet', () => ({ BottomSheetScrollView: ({ children }: any) => children }));
jest.mock('../../components/ui/Sheet', () => ({ Sheet: ({ visible, children, onClose }: any) => visible
  ? <>{children}{require('react').createElement(require('react-native').Pressable, { testID: 'close', onPress: onClose })}</> : null }));
jest.mock('../../components/ui/SettingsGroup', () => ({ SettingsDivider: () => null, SettingsRow: () => null }));
jest.mock('../../components/ui/AgentAvatar', () => ({ AgentAvatar: () => null }));
jest.mock('../../components/ui/Button', () => ({ Button: () => null }));
jest.mock('../../components/ui/Banner', () => ({ Banner: () => null }));
jest.mock('expo-sharing', () => ({ getSharedPayloads: jest.fn(() => []), clearSharedPayloads: jest.fn() }));
jest.mock('../../services/incoming-share', () => ({ IncomingShareStore: { list: jest.fn(), capture: jest.fn() } }));
const share = { id: 'one', fingerprint: 'hash', text: 'Retained share', createdAt: 1, files: [] };
const props = { ready: true, targets: [], onChoose: jest.fn(), onConnect: jest.fn() };
beforeEach(() => { jest.clearAllMocks(); jest.mocked(getSharedPayloads).mockReturnValue([]); jest.mocked(IncomingShareStore.list).mockResolvedValue([share]); });
test('retains a dismissed share without reopening on foreground or unrelated widget links', async () => {
  const view = render(<IncomingShareCoordinator {...props} />);
  await waitFor(() => expect(view.getByText(share.text)).toBeTruthy());
  fireEvent.press(view.getByTestId('close'));
  await act(async () => { mockForeground('active'); });
  await act(async () => { mockLink(); });
  expect(view.queryByText(share.text)).toBeNull();
  expect(IncomingShareStore.list).toHaveBeenCalledTimes(3);
  view.unmount();
  const restored = render(<IncomingShareCoordinator {...props} />);
  await waitFor(() => expect(restored.getByText(share.text)).toBeTruthy());
});
test('an explicit new OS share still opens after dismissing the same pending payload', async () => {
  const view = render(<IncomingShareCoordinator {...props} />);
  await waitFor(() => expect(view.getByText(share.text)).toBeTruthy());
  fireEvent.press(view.getByTestId('close'));
  jest.mocked(getSharedPayloads).mockReturnValue([{ shareType: 'text', value: share.text }]);
  jest.mocked(IncomingShareStore.capture).mockResolvedValue(share);
  await act(async () => { mockLink(); });
  await waitFor(() => expect(view.getByText(share.text)).toBeTruthy());
});
