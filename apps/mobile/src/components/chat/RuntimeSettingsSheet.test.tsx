import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { RuntimeSettingsSheet, type RuntimeSettingsSheetProps } from './RuntimeSettingsSheet';
import { Button } from '../ui/Button';
import { ControlSize, FontSize } from '../../theme/tokens';

jest.mock('react-native', () => {
  const ReactRuntime = require('react');
  const primitive = (name: string) => ({ children, ...props }: Record<string, unknown> & { children?: React.ReactNode }) => ReactRuntime.createElement(name,
    { ...props, ...(name === 'Pressable' ? { onStartShouldSetResponder: () => !props.disabled } : {}) }, children);
  return { Platform: { OS: 'ios', select: (values: Record<string, unknown>) => values.ios ?? values.default },
    useWindowDimensions: () => ({ fontScale: 1, height: 852 }),
    ActivityIndicator: primitive('ActivityIndicator'), Pressable: primitive('Pressable'), Text: primitive('Text'), View: primitive('View'),
    StyleSheet: { create: (value: unknown) => value, flatten: (value: unknown) => value, hairlineWidth: 1 } };
});
jest.mock('@gorhom/bottom-sheet', () => ({ BottomSheetScrollView: require('react-native').View, BottomSheetFlatList: ({ data, renderItem, ...props }: { data: unknown[]; renderItem: (info: { item: unknown }) => React.ReactNode }) => require('react').createElement(require('react-native').View, props, data.map((item, index) => require('react').createElement(require('react').Fragment, { key: index }, renderItem({ item })))) }));
jest.mock('lucide-react-native', () => new Proxy({}, { get: (_target, name) => (props: unknown) => require('react').createElement(String(name), props) }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('../../theme', () => ({ useAppTheme: () => ({ theme: { colors: { ink: 'ink', inkSecondary: 'secondary', inkTertiary: 'tertiary', line: 'line', accent: 'accent', onAccent: 'onAccent', surface: 'surface', warn: 'warn', bad: 'bad' } } }) }));
jest.mock('../../services/haptics', () => ({ triggerLightImpact: jest.fn() }));
jest.mock('../ui', () => ({ Button: require('../ui/Button').Button, SearchInput: require('react-native').View,
  SheetHeaderSpinner: (props: Record<string, unknown>) => require('react').createElement('SheetHeaderSpinner', props),
  Sheet: ({ children, visible, headerRight, ...props }: { children: React.ReactNode; visible: boolean; headerRight?: React.ReactNode }) => visible ? require('react').createElement(require('react-native').View, props, headerRight, children) : null }));
function props(overrides: Partial<RuntimeSettingsSheetProps> = {}): RuntimeSettingsSheetProps {
  return { visible: true, loading: false, busy: false, error: null,
    models: [{ id: 'native-alias', name: 'Native model', provider: 'provider', resolvedModel: 'resolved-model' }],
    currentModel: 'native-alias', currentProvider: 'provider', thinkingLevel: 'high', thinkingLevels: ['low', 'high'],
    fastMode: { enabled: null, available: true }, permissions: { mode: 'custom', available: true, scope: 'session', availableModes: ['workspace', 'full-access'] },
    onClose: jest.fn(), onRetry: jest.fn(), onSelectModel: jest.fn(), onSelectThinking: jest.fn(), onSelectFastMode: jest.fn(), onSelectPermissions: jest.fn(), ...overrides };
}
it('keeps one model/thinking/speed sheet and displays the resolved native model', () => {
  const view = render(<RuntimeSettingsSheet {...props()} />);
  expect(view.getByText('resolved-model')).toBeTruthy();
  expect(view.getByTestId('runtime-settings-thinking')).toBeTruthy();
  fireEvent.press(view.getByTestId('runtime-settings-speed'));
  expect(view.getByTestId('runtime-settings-speed-standard').props.accessibilityState.selected).toBe(false);
  expect(view.getByTestId('runtime-settings-speed-fast').props.accessibilityState.selected).toBe(false);
});
it('lists permissions, context left and the project in the overview (A+ composer)', () => {
  const view = render(<RuntimeSettingsSheet {...props({ permissions: { mode: 'full-access', available: true, scope: 'session', availableModes: ['workspace', 'full-access'] },
    contextRemainingPercent: 54, project: { label: '~/repo', path: '/Users/lucy/repo' } })} />);
  const permissions = view.getByTestId('runtime-settings-permissions');
  expect(view.getByText('Full access')).toBeTruthy();
  expect(view.getByText('Permissions').props.style).toEqual(expect.arrayContaining([expect.objectContaining({ color: 'warn' })]));
  // Context and project are facts: readable, never pressable.
  const context = view.getByTestId('runtime-settings-context');
  expect(context.props.onPress).toBeUndefined();
  expect(context.props.accessibilityLabel).toBe('Context remaining: {{percent}}%');
  expect(view.getByTestId('runtime-settings-project').props.accessibilityLabel).toBe('Project: /Users/lucy/repo');
  expect(view.getByText('~/repo').props.ellipsizeMode).toBe('middle');
  fireEvent.press(permissions);
  expect(view.getByTestId('runtime-settings-permission-full-access')).toBeTruthy();
});
it('does not optimistically show Fast as selected and blocks duplicate writes while pending', () => {
  const callbacks = props({ fastMode: { enabled: false, available: true } });
  const view = render(<RuntimeSettingsSheet {...callbacks} />);
  fireEvent.press(view.getByTestId('runtime-settings-speed'));
  fireEvent.press(view.getByTestId('runtime-settings-speed-fast'));
  expect(callbacks.onSelectFastMode).toHaveBeenCalledWith(true);
  expect(view.getByTestId('runtime-settings-speed-fast').props.accessibilityState.selected).toBe(false);
  view.rerender(<RuntimeSettingsSheet {...callbacks} busy />);
  expect(view.getByTestId('runtime-settings-speed-fast').props.accessibilityState.disabled).toBe(true);
});
it('preserves inherited/custom permission state and only offers native allowed modes', () => {
  const callbacks = props({ permissionsOnly: true });
  const view = render(<RuntimeSettingsSheet {...callbacks} />);
  expect(view.queryByTestId('runtime-settings-permission-read-only')).toBeNull();
  expect(view.getByTestId('runtime-settings-permission-workspace').props.accessibilityState.selected).toBe(false);
  fireEvent.press(view.getByTestId('runtime-settings-permission-full-access'));
  expect(callbacks.onSelectPermissions).toHaveBeenCalledWith('full-access');
  expect(view.getByText('Applies to this conversation.', { exact: false })).toBeTruthy();
});
it('exposes a plaintext transport warning before full access can be selected', () => {
  const view = render(<RuntimeSettingsSheet {...props({ permissionsOnly: true,
    permissions: { mode: 'workspace', available: true, scope: 'session', unencryptedTransport: true } })} />);
  expect(view.getByText('This connection is not encrypted. Use a trusted network or switch to Relay.')).toBeTruthy();
});
it('hides speed when the selected native model does not advertise it', () => {
  const view = render(<RuntimeSettingsSheet {...props({ fastMode: { enabled: null, available: false } })} />);
  expect(view.queryByTestId('runtime-settings-speed')).toBeNull();
});

it('searches the native model catalog without changing its recommendation order or clipping views', () => {
  const view = render(<RuntimeSettingsSheet {...props({ models: [
    { id: 'new', name: 'New recommended', provider: 'provider' },
    { id: 'old', name: 'Older recommended', provider: 'provider' },
  ] })} />);
  fireEvent.press(view.getByTestId('runtime-settings-model'));
  expect(view.getByTestId('runtime-settings-model-list').props.removeClippedSubviews).toBe(false);
  fireEvent(view.getByTestId('runtime-settings-search'), 'changeText', 'old');
  expect(view.queryByTestId('runtime-settings-model-provider-new')).toBeNull();
  expect(view.getByTestId('runtime-settings-model-provider-old')).toBeTruthy();
});
it('explains why native permission controls are unavailable', () => {
  const view = render(<RuntimeSettingsSheet {...props({ permissionsOnly: true,
    permissions: { mode: null, available: false, scope: 'session' } })} />);
  expect(view.getByText('Permission changes are unavailable for this conversation. Check Codex on your computer.')).toBeTruthy();
});

it('opens a required permission choice without marking an unconfirmed native mode as accepted', () => {
  const callbacks = props({ permissions: { mode: 'full-access', available: true, scope: 'session', requiresConfirmation: true } });
  const view = render(<RuntimeSettingsSheet {...callbacks} />);
  expect(view.getByText('Choose permissions again before sending.')).toBeTruthy();
  expect(view.getByTestId('runtime-settings-permission-full-access').props.accessibilityState.selected).toBe(false);
  expect(view.getByTestId('runtime-settings-permission-full-access').props.accessibilityState.disabled).toBe(false);
  fireEvent.press(view.getByTestId('runtime-settings-permission-full-access'));
  expect(callbacks.onSelectPermissions).toHaveBeenCalledWith('full-access');
  view.rerender(<RuntimeSettingsSheet {...callbacks} permissions={{ ...callbacks.permissions!, requiresConfirmation: false }} permissionsOnly />);
  expect(view.queryByText('Choose permissions again before sending.')).toBeNull();
  expect(view.getByTestId('runtime-settings-permission-full-access').props.accessibilityState.selected).toBe(true);
});


it.each([undefined, { mode: null, available: false, scope: 'session' } as const])('offers one manual read retry for unknown permissions %j without selecting a permission', (permissions) => {
  const callbacks = props({ permissionsOnly: true, permissions });
  const view = render(<RuntimeSettingsSheet {...callbacks} />);
  expect(view.getByText('Unknown · Applies to this conversation.')).toBeTruthy();
  const retry = view.getByTestId('runtime-settings-permissions-retry');
  expect(view.getAllByText('Retry')).toHaveLength(1);
  for (const mode of ['workspace', 'read-only', 'full-access']) {
    expect(view.getByTestId(`runtime-settings-permission-${mode}`).props.accessibilityState.selected).toBe(false);
  }
  const unavailable = view.queryByText('Permission changes are unavailable for this conversation. Check Codex on your computer.');
  if (permissions === undefined) expect(unavailable).toBeNull();
  else expect(unavailable).toBeTruthy();
  fireEvent.press(retry);
  expect(callbacks.onRetry).toHaveBeenCalledTimes(1);
  expect(callbacks.onSelectPermissions).not.toHaveBeenCalled();
});

it('waits for the first permission read without calling it unknown or offering a retry', () => {
  const callbacks = props({ permissionsOnly: true, permissions: undefined, loading: true });
  const view = render(<RuntimeSettingsSheet {...callbacks} />);
  expect(view.getByText('Applies to this conversation.')).toBeTruthy();
  expect(view.queryByText('Unknown · Applies to this conversation.')).toBeNull();
  expect(view.queryByTestId('runtime-settings-permissions-retry')).toBeNull();
  expect(view.queryByText('Permission changes are unavailable for this conversation. Check Codex on your computer.')).toBeNull();
  expect(view.getByTestId('runtime-settings-waiting').props.accessibilityLabel).toBe('Loading...');
  fireEvent.press(view.getByTestId('runtime-settings-permission-full-access'));
  expect(callbacks.onSelectPermissions).not.toHaveBeenCalled();
  view.rerender(<RuntimeSettingsSheet {...callbacks} loading={false} />);
  expect(view.getByText('Unknown · Applies to this conversation.')).toBeTruthy();
  expect(view.getByTestId('runtime-settings-permissions-retry').props.accessibilityState.disabled).toBe(false);
});

it.each(['busy', 'running'] as const)('keeps unknown permission retry disabled during %s and does not invent unavailability before a read', (state) => {
  const callbacks = props({ permissionsOnly: true, permissions: undefined, [state]: true });
  const view = render(<RuntimeSettingsSheet {...callbacks} />);
  expect(view.getByTestId('runtime-settings-permissions-retry').props.accessibilityState.disabled).toBe(true);
  expect(view.queryByText('Permission changes are unavailable for this conversation. Check Codex on your computer.')).toBeNull();
  fireEvent.press(view.getByTestId('runtime-settings-permissions-retry'));
  expect(callbacks.onRetry).not.toHaveBeenCalled();
  expect(callbacks.onSelectPermissions).not.toHaveBeenCalled();
});

it('preserves exactly one error retry when an initial permission read fails', () => {
  const callbacks = props({ permissionsOnly: true, permissions: undefined, error: 'Read failed' });
  const view = render(<RuntimeSettingsSheet {...callbacks} />);
  expect(view.getByText('Read failed')).toBeTruthy();
  expect(view.queryByTestId('runtime-settings-permissions-retry')).toBeNull();
  expect(view.getAllByText('Retry')).toHaveLength(1);
  expect(view.queryByText('Permission changes are unavailable for this conversation. Check Codex on your computer.')).toBeNull();
  fireEvent.press(view.getByText('Retry'));
  expect(callbacks.onRetry).toHaveBeenCalledTimes(1);
  expect(callbacks.onSelectPermissions).not.toHaveBeenCalled();
});

it('keeps the manual permission retry beside its summary with a canonical 44-point action', () => {
  const view = render(<RuntimeSettingsSheet {...props({ permissionsOnly: true, permissions: undefined })} />);
  const action = view.UNSAFE_getByType(Button);
  expect(action.props.variant).toBe('text');
  expect(action.props.size).toBe('md');
  expect(action.parent?.props.style).toEqual(expect.objectContaining({ flexDirection: 'row', alignItems: 'center' }));
  const retry = view.getByTestId('runtime-settings-permissions-retry');
  const actionStyle = Object.assign({}, ...retry.props.style({ pressed: false }).filter(Boolean));
  expect(actionStyle.minHeight).toBe(ControlSize.floatingButton);
  expect(actionStyle.minHeight).toBeGreaterThanOrEqual(44);
  expect(retry.findAll(node => typeof node.type === 'string' && String(node.type) === 'RefreshCw')).toHaveLength(1);
  const summary = view.getByText('Unknown · Applies to this conversation.');
  expect(Object.assign({}, ...summary.props.style)).toEqual(expect.objectContaining({ flex: 1, minWidth: 0 }));
  expect(action.props.textStyle.fontSize).toBe(FontSize.caption);
});

it.each(['custom', 'full-access'] as const)('replaces unknown presentation only after confirmed %s arrives', (mode) => {
  const callbacks = props({ permissionsOnly: true, permissions: undefined });
  const view = render(<RuntimeSettingsSheet {...callbacks} />);
  view.rerender(<RuntimeSettingsSheet {...callbacks} permissions={{ mode, available: true, scope: 'session' }} />);
  expect(view.queryByText('Unknown · Applies to this conversation.')).toBeNull();
  expect(view.queryByTestId('runtime-settings-permissions-retry')).toBeNull();
  expect(view.getByText(`${mode === 'custom' ? 'Computer settings' : 'Full access'} · Applies to this conversation.`)).toBeTruthy();
  expect(view.getByTestId('runtime-settings-permission-full-access').props.accessibilityState.selected).toBe(mode === 'full-access');
  expect(callbacks.onSelectPermissions).not.toHaveBeenCalled();
});

it('refreshes rows already on screen without a loading line, dimming or locking them', () => {
  const callbacks = props({ loading: true });
  const view = render(<RuntimeSettingsSheet {...callbacks} />);
  expect(view.queryByText('Loading...')).toBeNull();
  const waiting = view.getByTestId('runtime-settings-waiting');
  expect(waiting.props).toMatchObject({ accessibilityLabel: 'Loading...', immediate: false });
  const model = view.getByTestId('runtime-settings-model');
  expect(model.props.accessibilityState.disabled).toBe(false);
  expect(Object.assign({}, ...model.props.style({ pressed: false })).opacity).toBe(1);
  fireEvent.press(view.getByTestId('runtime-settings-speed'));
  fireEvent.press(view.getByTestId('runtime-settings-speed-fast'));
  expect(callbacks.onSelectFastMode).toHaveBeenCalledWith(true);
  view.rerender(<RuntimeSettingsSheet {...callbacks} loading={false} />);
  expect(view.queryByTestId('runtime-settings-waiting')).toBeNull();
});

it('spins in the radio of the row whose write is in flight instead of adding a line', () => {
  const callbacks = props({ fastMode: { enabled: false, available: true } });
  const view = render(<RuntimeSettingsSheet {...callbacks} />);
  fireEvent.press(view.getByTestId('runtime-settings-speed'));
  fireEvent.press(view.getByTestId('runtime-settings-speed-fast'));
  view.rerender(<RuntimeSettingsSheet {...callbacks} busy />);
  expect(view.queryByText('Applying settings…')).toBeNull();
  expect(view.getByTestId('runtime-settings-speed-fast-pending')).toBeTruthy();
  expect(view.getByTestId('runtime-settings-speed-fast').props.accessibilityState).toMatchObject({ busy: true, selected: false, disabled: true });
  expect(view.getByTestId('runtime-settings-speed-standard').props.accessibilityState).toMatchObject({ busy: false, disabled: true });
  expect(Object.assign({}, ...view.getByTestId('runtime-settings-speed-standard').props.style({ pressed: false })).opacity).toBe(1);
  expect(view.queryByTestId('runtime-settings-waiting')).toBeNull();
  view.rerender(<RuntimeSettingsSheet {...callbacks} fastMode={{ enabled: true, available: true }} />);
  expect(view.queryByTestId('runtime-settings-speed-fast-pending')).toBeNull();
  expect(view.getByTestId('runtime-settings-speed-fast').props.accessibilityState.selected).toBe(true);
});

it('shows a write that started elsewhere in the header, at once', () => {
  const view = render(<RuntimeSettingsSheet {...props({ busy: true })} />);
  expect(view.getByTestId('runtime-settings-waiting').props).toMatchObject({ accessibilityLabel: 'Applying settings…', immediate: true });
  expect(view.getByTestId('runtime-settings-model').props.accessibilityState.disabled).toBe(false);
});

it('stands in placeholder rows for a first catalog read instead of calling it empty', () => {
  const view = render(<RuntimeSettingsSheet {...props({ models: [], currentModel: undefined, loading: true })} />);
  fireEvent.press(view.getByTestId('runtime-settings-model'));
  expect(view.getByTestId('runtime-settings-model-loading')).toBeTruthy();
  expect(view.queryByTestId('runtime-settings-model-list')).toBeNull();
  view.rerender(<RuntimeSettingsSheet {...props({ models: [], currentModel: undefined })} />);
  expect(view.queryByTestId('runtime-settings-model-loading')).toBeNull();
  expect(view.getByTestId('runtime-settings-model-list').props.ListEmptyComponent).toBeTruthy();
});

it('keeps a confirmed unavailability notice through a refresh', () => {
  const unavailable = props({ permissionsOnly: true, permissions: { mode: 'workspace', available: false, scope: 'session' } });
  const notice = 'Permission changes are unavailable for this conversation. Check Codex on your computer.';
  const view = render(<RuntimeSettingsSheet {...unavailable} />);
  expect(view.getByText(notice)).toBeTruthy();
  view.rerender(<RuntimeSettingsSheet {...unavailable} loading />);
  expect(view.getByText(notice)).toBeTruthy();
  view.rerender(<RuntimeSettingsSheet {...unavailable} permissions={{ mode: 'workspace', available: true, scope: 'session' }} />);
  expect(view.queryByText(notice)).toBeNull();
});

it('reserves the Retry height in the permission summary so an unknown result keeps the sheet height', () => {
  const view = render(<RuntimeSettingsSheet {...props({ permissionsOnly: true })} />);
  expect(view.getByText('Computer settings · Applies to this conversation.')).toBeTruthy();
  const summary = view.getByTestId('runtime-settings-permission-summary');
  expect(summary.props.style).toEqual(expect.objectContaining({ minHeight: ControlSize.settingsRow }));
  expect(ControlSize.settingsRow - 2 * summary.props.style.paddingVertical).toBeGreaterThanOrEqual(ControlSize.floatingButton);
});
