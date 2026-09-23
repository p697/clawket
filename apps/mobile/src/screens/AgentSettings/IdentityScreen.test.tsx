import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { CAPABILITY_MATRIX, type AgentAdapter, type AgentDescriptor } from '@clawket/agent-protocol';
import { IdentityScreen } from './IdentityScreen';

const mockPreventRemove = jest.fn();
jest.mock('@react-navigation/native', () => ({ usePreventRemove: (...args: unknown[]) => mockPreventRemove(...args) }));
jest.mock('react-native', () => {
  const ReactRuntime = require('react');
  const host = (name: string) => ReactRuntime.forwardRef(({ children, style, ...props }: Record<string, unknown>, ref: unknown) =>
    ReactRuntime.createElement(name, { ...props, ref, style: typeof style === 'function' ? style({ pressed: false }) : style }, children));
  return {
    Platform: { OS: 'ios', select: (options: Record<string, unknown>) => options.ios ?? options.default },
    Pressable: host('Pressable'), View: host('View'), Text: host('Text'), TextInput: host('TextInput'), ScrollView: host('ScrollView'), ActivityIndicator: host('ActivityIndicator'),
    Modal: ({ visible, children }: { visible: boolean; children: React.ReactNode }) => visible ? children : null,
    StyleSheet: { create: <T,>(styles: T) => styles, flatten: (style: unknown) => style, hairlineWidth: 1 },
  };
});
jest.mock('lucide-react-native', () => new Proxy({}, {
  get: (_target, key) => key === '__esModule' ? true : (props: unknown) => require('react').createElement('Icon', props),
}));
jest.mock('react-i18next', () => ({ useTranslation: () => ({
  t: (key: string, values?: Record<string, unknown>) => key.replace(/{{(.*?)}}/g, (_, name) => String(values?.[name] ?? name)),
  i18n: { resolvedLanguage: 'en' },
}) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 44, bottom: 34, left: 0, right: 0 }) }));
jest.mock('../../theme', () => ({ useAppTheme: () => ({ theme: require('../../theme/theme').buildInterfaceTheme('light', 'light', require('../../theme/accents').builtInAccents.iceBlue) }) }));
jest.mock('../../components/ui/ScreenHeader', () => ({ ScreenHeader: ({ title, onBack, rightContent }: Record<string, unknown>) => {
  const R = require('react');
  return R.createElement('View', null, R.createElement('Text', { testID: 'identity-title' }, title), R.createElement('Pressable', { testID: 'identity-back', onPress: onBack }), rightContent);
} }));
jest.mock('../../components/ui/AgentAvatar', () => ({ AgentAvatar: (props: unknown) => require('react').createElement('Avatar', props) }));
jest.mock('../../components/ui/FormTextInput', () => ({ FormTextInput: (props: unknown) => require('react').createElement('TextInput', props) }));
jest.mock('../../components/ui/FloatingButton', () => ({ FloatingButton: (props: unknown) => require('react').createElement('Pressable', props) }));
jest.mock('../../components/ui/Skeleton', () => ({ Skeleton: (props: unknown) => require('react').createElement('View', props) }));
jest.mock('../../components/ui/Sheet', () => ({ Sheet: ({ visible, children, footer, ...props }: Record<string, unknown>) => visible ? require('react').createElement('View', props, children, footer) : null }));

const agent: AgentDescriptor = { connectionId: 'studio', agentId: 'main', name: 'Main', emoji: '🦉', isMain: true, mainSessionKey: 'agent:main:main' };
const writer: AgentDescriptor = { ...agent, agentId: 'writer', name: 'Writer', isMain: false, mainSessionKey: 'agent:writer:main' };

function setup(input: Readonly<{
  backend?: 'openclaw' | 'hermes';
  get?: jest.Mock;
  set?: jest.Mock;
  update?: jest.Mock;
  remove?: jest.Mock;
  create?: jest.Mock;
}> = {}) {
  const get = input.get ?? jest.fn(async (name: string) => ({
    name, path: `/${name}`, missing: false, content: '- **Name:** Main\n- **Emoji:** 🦉\n- **Vibe:** Calm',
  }));
  const set = input.set ?? jest.fn(async () => ({ ok: true }));
  const update = input.update ?? jest.fn(async (id: string) => ({ ok: true, agentId: id }));
  const remove = input.remove ?? jest.fn(async (id: string) => ({ ok: true, agentId: id }));
  const create = input.create ?? jest.fn(async ({ name }: { name: string }) => ({
    ok: true, agentId: name.toLowerCase(), name, workspace: `/workspace-${name.toLowerCase()}`,
  }));
  const list = jest.fn(async () => ({
    defaultId: 'main', mainKey: 'main', agents: [{ id: 'main', name: 'Main', identity: { emoji: '🦉' } }],
  }));
  const adapter = {
    connection: { backendKind: input.backend ?? 'openclaw' },
    capabilities: { ...CAPABILITY_MATRIX[input.backend ?? 'openclaw'] },
    management: { agents: { list, update, remove, create, files: { get, set } } },
  } as unknown as AgentAdapter;
  const navigation = { goBack: jest.fn(), dispatch: jest.fn() } as unknown as React.ComponentProps<typeof IdentityScreen>['navigation'];
  return { adapter, navigation, get, set, update, remove, create };
}

describe('IdentityScreen', () => {
  beforeEach(() => mockPreventRemove.mockClear());

  it('edits name, emoji and vibe inline and saves through the Agent record and IDENTITY.md', async () => {
    const data = setup();
    const onChanged = jest.fn();
    const view = render(<IdentityScreen {...data} agent={agent} online isPro onOpenPaywall={jest.fn()} onChanged={onChanged} />);
    expect(view.getByTestId('agent-identity-loading')).toBeTruthy();
    await waitFor(() => expect(view.getByTestId('agent-identity-profile-name')).toBeTruthy());
    // Persona, memory and user documents are not identity rows any more.
    expect(view.queryByTestId('agent-identity-persona')).toBeNull();
    expect(view.queryByTestId('agent-identity-memory')).toBeNull();
    expect(view.queryByTestId('agent-identity-user')).toBeNull();
    expect(data.get).toHaveBeenCalledTimes(1);
    expect(data.get).toHaveBeenCalledWith('IDENTITY.md', 'main');
    expect(view.getByTestId('agent-identity-save').props.disabled).toBe(true);

    fireEvent.changeText(view.getByTestId('agent-identity-profile-name'), 'Writer');
    fireEvent.changeText(view.getByTestId('agent-identity-profile-emoji'), '✍️');
    expect(view.getByTestId('agent-identity-avatar').props.emoji).toBe('✍️');
    expect(view.getByTestId('agent-identity-save').props.disabled).toBe(false);
    fireEvent.press(view.getByTestId('agent-identity-save'));

    await waitFor(() => expect(data.update).toHaveBeenCalledWith('main', { name: 'Writer', emoji: '✍️' }));
    expect(data.set).toHaveBeenCalledWith('IDENTITY.md', expect.stringContaining('- **Emoji:** ✍️'), 'main');
    expect(data.set).toHaveBeenCalledWith('IDENTITY.md', expect.stringContaining('- **Vibe:** Calm'), 'main');
    // The avatar is not an editable row on the phone.
    expect(view.queryByTestId('agent-identity-profile-avatar')).toBeNull();
    expect(view.getByTestId('agent-identity-profile-vibe').props.multiline).toBe(true);
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(view.getByTestId('agent-identity-save').props.disabled).toBe(true);
    expect(data.navigation.goBack).not.toHaveBeenCalled();
  });

  it('keeps a dirty draft when the roster rebuilds the descriptor and reloads only on a scope change', async () => {
    const data = setup();
    const view = render(<IdentityScreen {...data} agent={agent} online isPro onOpenPaywall={jest.fn()} />);
    await waitFor(() => expect(view.getByTestId('agent-identity-profile-name')).toBeTruthy());
    fireEvent.changeText(view.getByTestId('agent-identity-profile-name'), 'Draft');
    view.rerender(<IdentityScreen {...data} agent={{ ...agent }} online isPro onOpenPaywall={jest.fn()} />);
    expect(view.getByTestId('agent-identity-profile-name').props.value).toBe('Draft');
    expect(data.get).toHaveBeenCalledTimes(1);

    view.rerender(<IdentityScreen {...data} agent={writer} online isPro onOpenPaywall={jest.fn()} />);
    await waitFor(() => expect(data.get).toHaveBeenCalledWith('IDENTITY.md', 'writer'));
    await waitFor(() => expect(view.getByTestId('agent-identity-profile-name').props.value).toBe('Main'));
  });

  it('validates the name, keeps a rejected draft and shows the error in place', async () => {
    const data = setup({ update: jest.fn(async () => ({ ok: false, agentId: 'main' })) });
    const view = render(<IdentityScreen {...data} agent={agent} online isPro onOpenPaywall={jest.fn()} />);
    await waitFor(() => expect(view.getByTestId('agent-identity-profile-name')).toBeTruthy());
    fireEvent.changeText(view.getByTestId('agent-identity-profile-name'), '   ');
    fireEvent.press(view.getByTestId('agent-identity-save'));
    expect(view.getByText('Please enter a name.')).toBeTruthy();
    expect(data.update).not.toHaveBeenCalled();

    fireEvent.changeText(view.getByTestId('agent-identity-profile-name'), 'Writer');
    fireEvent.press(view.getByTestId('agent-identity-save'));
    await waitFor(() => expect(view.getByText('Save failed')).toBeTruthy());
    expect(view.getByTestId('agent-identity-profile-name').props.value).toBe('Writer');
    expect(view.getByTestId('agent-identity-save').props.disabled).toBe(false);
  });

  it('confirms dirty back navigation and keeps the draft when canceled', async () => {
    const data = setup();
    const view = render(<IdentityScreen {...data} agent={agent} online isPro onOpenPaywall={jest.fn()} />);
    await waitFor(() => expect(view.getByTestId('agent-identity-profile-name')).toBeTruthy());
    fireEvent.press(view.getByTestId('identity-back'));
    expect(data.navigation.goBack).toHaveBeenCalledTimes(1);

    fireEvent.changeText(view.getByTestId('agent-identity-profile-vibe'), 'Bold');
    fireEvent.press(view.getByTestId('identity-back'));
    expect(view.getByTestId('agent-identity-discard')).toBeTruthy();
    fireEvent.press(view.getByTestId('agent-identity-discard-cancel'));
    expect(view.getByTestId('agent-identity-profile-vibe').props.value).toBe('Bold');
    expect(data.navigation.goBack).toHaveBeenCalledTimes(1);

    const [blocked, callback] = mockPreventRemove.mock.calls.at(-1)!;
    expect(blocked).toBe(true);
    act(() => callback({ data: { action: { type: 'POP' } } }));
    fireEvent.press(view.getByTestId('agent-identity-discard-confirm'));
    await waitFor(() => expect(data.navigation.dispatch).toHaveBeenCalledWith({ type: 'POP' }));
  });

  it('gates creation through Pro, creates through the adapter and leaves only after the write', async () => {
    const data = setup();
    const onOpenPaywall = jest.fn();
    const onCreated = jest.fn();
    const onChanged = jest.fn();
    // The roster `+` sheet is the only creation entry; it lands here with the route action.
    const view = render(<IdentityScreen {...data} agent={agent} online isPro={false} openCreateOnMount onOpenPaywall={onOpenPaywall} onChanged={onChanged} onCreated={onCreated} />);
    await waitFor(() => expect(onOpenPaywall).toHaveBeenCalledWith('agents', expect.any(Function)));
    expect(view.queryByTestId('agent-identity-create')).toBeNull();
    expect(view.queryByTestId('agent-identity-create-sheet')).toBeNull();
    act(() => (onOpenPaywall.mock.calls[0]?.[1] as () => void)());
    expect(view.getByTestId('agent-identity-create-sheet')).toBeTruthy();

    fireEvent.changeText(view.getByTestId('agent-identity-create-name'), 'main');
    fireEvent.press(view.getByTestId('agent-identity-create-action'));
    expect(view.getByText('"main" is reserved and cannot be used as an agent name.')).toBeTruthy();
    expect(data.create).not.toHaveBeenCalled();

    fireEvent.changeText(view.getByTestId('agent-identity-create-name'), 'Researcher');
    fireEvent.changeText(view.getByTestId('agent-identity-create-emoji'), '🔬');
    fireEvent.press(view.getByTestId('agent-identity-create-action'));
    await waitFor(() => expect(data.create).toHaveBeenCalledWith({ name: 'Researcher', emoji: '🔬' }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('researcher'));
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(view.queryByTestId('agent-identity-create-sheet')).toBeNull();
    // Route removal stays unblocked once the creation settled.
    expect(mockPreventRemove.mock.calls.at(-1)?.[0]).toBe(false);
  });

  it('opens the create sheet from the route action once', async () => {
    const data = setup();
    const view = render(<IdentityScreen {...data} agent={agent} online isPro openCreateOnMount onOpenPaywall={jest.fn()} />);
    await waitFor(() => expect(view.getByTestId('agent-identity-create-sheet')).toBeTruthy());
    fireEvent.press(view.getByTestId('agent-identity-create-cancel'));
    expect(view.queryByTestId('agent-identity-create-sheet')).toBeNull();
    view.rerender(<IdentityScreen {...data} agent={agent} online isPro openCreateOnMount onOpenPaywall={jest.fn()} />);
    expect(view.queryByTestId('agent-identity-create-sheet')).toBeNull();
  });

  it('shows load errors with retry, disables offline edits and confirms removal before leaving', async () => {
    const failing = setup({ get: jest.fn(async () => { throw new Error('Identity unavailable'); }) });
    failing.adapter.management!.agents!.list = undefined;
    const errorView = render(<IdentityScreen {...failing} agent={agent} online isPro onOpenPaywall={jest.fn()} />);
    await waitFor(() => expect(errorView.getByTestId('agent-identity-load-error')).toBeTruthy());
    expect(errorView.getByText('Identity unavailable')).toBeTruthy();
    errorView.unmount();

    const data = setup();
    const onRemoved = jest.fn();
    const view = render(<IdentityScreen {...data} agent={writer} online={false} isPro onOpenPaywall={jest.fn()} onRemoved={onRemoved} />);
    await waitFor(() => expect(view.getByTestId('agent-identity-profile-name')).toBeTruthy());
    expect(view.getByTestId('agent-identity-profile-name').props.editable).toBe(false);
    expect(view.getByTestId('agent-identity-delete').props.disabled).toBe(true);

    view.rerender(<IdentityScreen {...data} agent={writer} online isPro onOpenPaywall={jest.fn()} onRemoved={onRemoved} />);
    expect(view.getByTestId('agent-identity-profile-name').props.editable).toBe(true);
    fireEvent.press(view.getByTestId('agent-identity-delete'));
    fireEvent.press(view.getByTestId('agent-identity-delete-confirm-confirm'));
    await waitFor(() => expect(data.remove).toHaveBeenCalledWith('writer', true));
    await waitFor(() => expect(onRemoved).toHaveBeenCalledTimes(1));
    expect(mockPreventRemove.mock.calls.at(-1)?.[0]).toBe(false);
  });

  it('never offers the main Agent for deletion and keeps Hermes read-only without file rows', async () => {
    const data = setup({ backend: 'hermes' });
    const view = render(<IdentityScreen {...data} agent={agent} online isPro onOpenPaywall={jest.fn()} />);
    await waitFor(() => expect(view.getByTestId('agent-identity-profile-name')).toBeTruthy());
    expect(view.getByText('Read only')).toBeTruthy();
    expect(view.queryByTestId('agent-identity-save')).toBeNull();
    expect(view.queryByTestId('agent-identity-create')).toBeNull();
    expect(view.queryByTestId('agent-identity-delete')).toBeNull();
    expect(view.getByTestId('agent-identity-profile-name').props.editable).toBe(false);
    expect(data.get).toHaveBeenCalledWith('IDENTITY.md', 'main');
  });
});
