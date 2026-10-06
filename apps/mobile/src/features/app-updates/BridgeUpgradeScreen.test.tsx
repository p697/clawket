import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { Share } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import type { ConnectionDescriptor } from '@clawket/agent-protocol';
import { BridgeUpgradeScreen } from './BridgeUpgradeScreen';
jest.mock('react-native', () => {
  const ReactRuntime = require('react');
  const host = (name: string) => ({ children, ...props }: any) => ReactRuntime.createElement(name, props, children);
  return { Platform: { OS: 'ios', select: (value: any) => value.ios ?? value.default }, View: host('View'), Text: host('Text'), Pressable: host('Pressable'), ScrollView: host('ScrollView'), ActivityIndicator: host('ActivityIndicator'), Share: { share: jest.fn().mockResolvedValue(undefined) }, StyleSheet: { create: (styles: any) => styles } };
});
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn().mockResolvedValue(undefined) }));
jest.mock('lucide-react-native', () => {
  const ReactRuntime = require('react');
  return new Proxy({}, { get: () => (props: any) => ReactRuntime.createElement('Icon', props) });
});
jest.mock('../../components/ui/DirectionalIcon', () => ({ ChevronRight: () => null }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, options?: Record<string, unknown>) => key.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(options?.[name] ?? '')) }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));
jest.mock('../../theme', () => ({ useAppTheme: () => ({ theme: { colors: { canvasGrouped: 'grey', surfaceFloating: 'white', ink: 'black', inkSecondary: 'gray', inkTertiary: 'silver', good: 'green' } } }) }));
jest.mock('../../screens/AccountSettings/AccountSettingsPageHeader', () => {
  const { Text } = require('react-native'); return { AccountSettingsPageHeader: ({ title }: any) => <Text>{title}</Text> };
});
jest.mock('../../components/ui/SettingsGroup', () => {
  const { View, Text, Pressable } = require('react-native');
  return {
    SettingsGroup: ({ children, testID }: any) => <View testID={testID}>{children}</View>,
    SettingsDivider: () => null,
    SettingsRow: ({ title, value, attention, trailing, onPress, testID }: any) => <Pressable testID={testID} onPress={onPress}><Text>{title}</Text><Text>{value}</Text>{attention ? <View testID={`${testID}-attention`} /> : null}{trailing}</Pressable>,
  };
});
jest.mock('../../components/ui/Button', () => {
  const { Text, Pressable } = require('react-native');
  return { Button: ({ label, onPress, testID, loading }: any) => <Pressable testID={testID} onPress={onPress} accessibilityState={{ busy: Boolean(loading) }}><Text>{label}</Text></Pressable> };
});

const connection = (id: string, label: string, backendKind: ConnectionDescriptor['backendKind'] = 'codex', transportKind: ConnectionDescriptor['transportKind'] = 'relay'): ConnectionDescriptor =>
  ({ id, label, backendKind, transportKind, createdAt: 1, isFreeSlot: false });
const release = { version: '3.1.12', unifiedUpdate: true, checkedAt: 1 };
const command = 'npx -y @p697/clawket@3.1.12 update';
const props = {
  onBack: jest.fn(), onCheck: jest.fn(), onOpenConnection: jest.fn(), release, checking: false, failed: false,
  connections: [connection('lucy', 'lucy', 'openclaw'), connection('mini', 'Codex · Mac mini'), connection('direct', 'Direct Gateway', 'openclaw', 'local')],
  versions: { lucy: '3.1.6', mini: '3.1.12' } as Record<string, string>,
  outdatedIds: ['lucy'],
};
const viewIds = (view: ReturnType<typeof render>) => view.UNSAFE_root.findAll(node => (node.type as unknown) === 'View' && typeof node.props.testID === 'string').map(node => node.props.testID as string);
beforeEach(() => { jest.clearAllMocks(); });

it('leads with outdated connections, then the command, then the rest', () => {
  const view = render(<BridgeUpgradeScreen {...props} />);
  expect(view.getByText('Bridge updates')).toBeTruthy();
  expect(view.getByText('Update to 3.1.12')).toBeTruthy();
  expect(view.getByText('3.1.6')).toBeTruthy();
  expect(view.getByTestId('bridge-version-lucy-attention')).toBeTruthy();
  expect(view.getByTestId('bridge-upgrade-command').props.children).toBe(command);
  expect(view.getByText('Up to date')).toBeTruthy();
  expect(view.queryByTestId('bridge-version-mini-attention')).toBeNull();
  expect(view.queryByText('Direct Gateway')).toBeNull();
  expect(view.queryByTestId('bridge-status')).toBeNull();
  expect(view.queryByTestId('bridge-check-updates')).toBeNull();
  const ids = viewIds(view);
  expect(ids.indexOf('bridge-outdated')).toBeLessThan(ids.indexOf('bridge-upgrade-steps'));
  expect(ids.indexOf('bridge-upgrade-steps')).toBeLessThan(ids.indexOf('bridge-others'));
});

it('copies and shares the pinned command without reporting an update', async () => {
  const view = render(<BridgeUpgradeScreen {...props} />);
  await act(async () => { fireEvent.press(view.getByTestId('bridge-upgrade-copy')); });
  expect(Clipboard.setStringAsync).toHaveBeenCalledWith(command);
  expect(view.getByText('Copied')).toBeTruthy();
  await act(async () => { fireEvent.press(view.getByTestId('bridge-upgrade-share')); });
  expect(Share.share).toHaveBeenCalledWith({ message: ['Run on the computer with your Agent', command, 'Run it after the current reply finishes. Clawket reconnects on its own, no pairing needed.'].join('\n\n') });
  expect(view.getByTestId('bridge-version-lucy-attention')).toBeTruthy();
  expect(view.queryByText('Update complete')).toBeNull();
  (Clipboard.setStringAsync as jest.Mock).mockRejectedValueOnce(new Error('denied'));
  await act(async () => { fireEvent.press(view.getByTestId('bridge-upgrade-copy')); });
  expect(view.getByText('Could not copy or share. You can select the commands above.')).toBeTruthy();
});

it('opens the Connection page from a row', () => {
  const view = render(<BridgeUpgradeScreen {...props} />);
  fireEvent.press(view.getByTestId('bridge-version-lucy'));
  fireEvent.press(view.getByTestId('bridge-version-mini'));
  expect(props.onOpenConnection.mock.calls).toEqual([['lucy'], ['mini']]);
});

it('confirms an update that lands while the page is open', () => {
  const view = render(<BridgeUpgradeScreen {...props} outdatedIds={['lucy', 'mini']} versions={{ lucy: '3.1.6', mini: '3.1.10' }} />);
  view.rerender(<BridgeUpgradeScreen {...props} outdatedIds={['lucy']} versions={{ lucy: '3.1.6', mini: '3.1.12' }} />);
  expect(view.getByTestId('bridge-version-mini-updated')).toBeTruthy();
  expect(view.getByText('Up to date')).toBeTruthy();
  expect(view.getByTestId('bridge-upgrade-command')).toBeTruthy();
  view.rerender(<BridgeUpgradeScreen {...props} outdatedIds={[]} versions={{ lucy: '3.1.12', mini: '3.1.12' }} />);
  expect(view.getByText('Update complete')).toBeTruthy();
  expect(view.getByTestId('bridge-status-current')).toBeTruthy();
  expect(view.getByTestId('bridge-version-lucy-updated')).toBeTruthy();
  expect(view.queryByTestId('bridge-upgrade-command')).toBeNull();
});

it('is a status page without the command when every Bridge is current', () => {
  const versions = { lucy: '3.1.12', mini: '3.1.13' };
  const view = render(<BridgeUpgradeScreen {...props} outdatedIds={[]} versions={versions} />);
  expect(view.getByText("You're up to date")).toBeTruthy();
  expect(view.getByText('Bridge 3.1.12')).toBeTruthy();
  expect(view.getByTestId('bridge-status-current')).toBeTruthy();
  expect(view.queryByTestId('bridge-upgrade-command')).toBeNull();
  expect(view.queryByTestId('bridge-version-lucy-updated')).toBeNull();
  fireEvent.press(view.getByTestId('bridge-check-updates'));
  expect(props.onCheck).toHaveBeenCalledTimes(1);
  view.rerender(<BridgeUpgradeScreen {...props} outdatedIds={[]} versions={versions} checking />);
  expect(view.getByTestId('bridge-check-updates').props.accessibilityState).toEqual({ busy: true });
  view.rerender(<BridgeUpgradeScreen {...props} outdatedIds={[]} versions={versions} failed />);
  expect(view.getByText("You're up to date")).toBeTruthy();
  expect(view.getByText('Could not check Bridge updates. Try again later.')).toBeTruthy();
});

it('never claims an unknown version is current', () => {
  const view = render(<BridgeUpgradeScreen {...props} outdatedIds={[]} versions={{ mini: '3.1.12' }} />);
  expect(view.getByText('Latest version')).toBeTruthy();
  expect(view.getByText('Unknown')).toBeTruthy();
  expect(view.queryByTestId('bridge-status-current')).toBeNull();
  view.rerender(<BridgeUpgradeScreen {...props} outdatedIds={['mini']} versions={{ mini: '3.1.10' }} />);
  expect(view.getByText('Other connections')).toBeTruthy();
  expect(view.queryByText('Up to date')).toBeNull();
});

it('guides a legacy Bridge even before the latest release is known', () => {
  const view = render(<BridgeUpgradeScreen {...props} versions={{ mini: '3.1.12' }} release={null} failed />);
  expect(view.getByText('Needs update')).toBeTruthy();
  expect(view.getByText('Old version')).toBeTruthy();
  expect(view.getByText("Couldn't check for updates")).toBeTruthy();
  expect(view.queryByTestId('bridge-upgrade-command')).toBeNull();
  expect(view.getByText('Retry')).toBeTruthy();
  fireEvent.press(view.getByTestId('bridge-check-updates'));
  expect(props.onCheck).toHaveBeenCalledTimes(1);
});

it('does not offer an unreleased updater', () => {
  const view = render(<BridgeUpgradeScreen {...props} release={{ ...release, unifiedUpdate: false }} />);
  expect(view.queryByTestId('bridge-upgrade-copy')).toBeNull();
  expect(view.getByText('The unified updater is available in newer Bridge releases. Use your original deployment method for this release.')).toBeTruthy();
});

describe('phone-started update', () => {
  const remote = (view: any, available = true) => ({ available, connectionLabel: 'Codex · Mac mini', view, onStart: jest.fn() });
  const running = (status: any, reconnecting = false) => ({ phase: 'running', connectionId: 'lucy', status, reconnecting });
  const statusText = (view: ReturnType<typeof render>) => view.getByTestId('bridge-remote-update-status').props.children;

  it('leads with one action for the current computer and keeps the command one tap away', () => {
    const controls = remote({ phase: 'idle' });
    const view = render(<BridgeUpgradeScreen {...props} remoteUpdate={controls} />);
    expect(view.getByText('Update now')).toBeTruthy();
    expect(view.getByText('Updates every Bridge on the computer running Codex · Mac mini. They restart after the current reply finishes.')).toBeTruthy();
    expect(view.queryByTestId('bridge-upgrade-command')).toBeNull();
    fireEvent.press(view.getByTestId('bridge-remote-update-start'));
    expect(controls.onStart).toHaveBeenCalledTimes(1);
    fireEvent.press(view.getByTestId('bridge-upgrade-manual'));
    expect(view.getByTestId('bridge-upgrade-command')).toBeTruthy();
    const ids = viewIds(view);
    expect(ids.indexOf('bridge-remote-update')).toBeLessThan(ids.indexOf('bridge-upgrade-steps'));
  });

  it('shows the command alone when the current computer cannot update from the phone', () => {
    const view = render(<BridgeUpgradeScreen {...props} remoteUpdate={remote({ phase: 'idle' }, false)} />);
    expect(view.queryByTestId('bridge-remote-update')).toBeNull();
    expect(view.getByTestId('bridge-upgrade-command')).toBeTruthy();
  });

  it('describes each stage of a running update in one line', () => {
    const view = render(<BridgeUpgradeScreen {...props} remoteUpdate={remote(running(null))} />);
    expect(statusText(view)).toBe('Checking the new version…');
    view.rerender(<BridgeUpgradeScreen {...props} remoteUpdate={remote(running({ id: 'x', state: 'installing', startedAt: 1, version: '3.1.14' }))} />);
    expect(statusText(view)).toBe('Downloading 3.1.14…');
    view.rerender(<BridgeUpgradeScreen {...props} remoteUpdate={remote(running({ id: 'x', state: 'waiting', startedAt: 1, waitingFor: 'claude-code' }))} />);
    expect(statusText(view)).toBe('Waiting for Claude Code to finish its task…');
    view.rerender(<BridgeUpgradeScreen {...props} remoteUpdate={remote(running({ id: 'x', state: 'installing', startedAt: 1 }, true))} />);
    expect(statusText(view)).toBe('Restarting Bridge…');
    view.rerender(<BridgeUpgradeScreen {...props} remoteUpdate={remote({ phase: 'updated', connectionId: 'lucy', status: { id: 'x', state: 'updated', startedAt: 1, version: '3.1.14' } })} />);
    expect(statusText(view)).toBe('Updated to 3.1.14');
    expect(view.queryByText('Update now')).toBeNull();
  });

  it('explains a failure, offers a retry and brings the command back', () => {
    const controls = remote({ phase: 'failed', connectionId: 'lucy', reason: 'busy', waitingFor: 'codex' });
    const view = render(<BridgeUpgradeScreen {...props} remoteUpdate={controls} />);
    expect(view.getByText('The update did not finish')).toBeTruthy();
    expect(view.getByTestId('bridge-remote-update-reason').props.children).toBe('Codex is still running a task, so nothing was updated.');
    expect(view.getByTestId('bridge-upgrade-command')).toBeTruthy();
    fireEvent.press(view.getByTestId('bridge-remote-update-retry'));
    expect(controls.onStart).toHaveBeenCalledTimes(1);
    view.rerender(<BridgeUpgradeScreen {...props} remoteUpdate={remote({ phase: 'failed', connectionId: 'lucy', reason: 'disabled' })} />);
    expect(view.getByTestId('bridge-remote-update-reason').props.children).toBe('Phone updates are turned off on this computer.');
    expect(view.queryByTestId('bridge-remote-update-retry')).toBeNull();
    view.rerender(<BridgeUpgradeScreen {...props} remoteUpdate={remote({ phase: 'failed', connectionId: 'lucy', reason: 'lost' })} />);
    expect(view.getByTestId('bridge-remote-update-reason').props.children).toBe('The update stopped partway. Check the Bridge on the computer.');
  });
});
