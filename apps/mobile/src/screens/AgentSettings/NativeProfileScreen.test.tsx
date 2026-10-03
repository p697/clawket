import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import type { AgentProfileOperations } from '@clawket/agent-protocol';
import { NativeProfileScreen } from './NativeProfileScreen';
import { NativeQuotaCard } from './NativeQuotaCard';
jest.mock('react-native', () => {
  const ReactRuntime = require('react');
  const host = (name: string) => ReactRuntime.forwardRef(({ children, ...props }: any, ref: any) => ReactRuntime.createElement(name, { ...props, ref }, children));
  return { Platform: { OS: 'ios', select: (v: any) => v.ios ?? v.default }, StyleSheet: { create: (v: any) => v, hairlineWidth: 1 }, View: host('View'), Text: host('Text'), Pressable: host('Pressable'), ScrollView: host('ScrollView'), RefreshControl: host('RefreshControl'), TextInput: host('TextInput'), Switch: host('Switch'), ActivityIndicator: host('ActivityIndicator') };
});
jest.mock('lucide-react-native', () => new Proxy({}, { get: () => () => null }));
jest.mock('@react-navigation/native', () => ({ useIsFocused: () => mockFocused }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }) }));
jest.mock('../../theme', () => ({ useAppTheme: () => ({ theme: { colors: { canvasGrouped: 'white', surfaceFloating: 'white', ink: 'black', inkSecondary: 'gray' } } }) }));
jest.mock('@gorhom/bottom-sheet', () => ({ BottomSheetScrollView: ({ children }: any) => children }));
jest.mock('../../components/ui/Sheet', () => ({ Sheet: ({ visible, children }: any) => visible ? children : null }));
jest.mock('../../components/ui/ScreenHeader', () => ({ ScreenHeader: ({ title, rightContent }: any) => { const { Text, View } = require('react-native'); return <View><Text>{title}</Text>{rightContent}</View>; } }));
jest.mock('../../components/ui/FloatingButton', () => ({ FloatingButton: (props: any) => { const { Pressable, Text } = require('react-native'); return <Pressable {...props}><Text>{props.accessibilityLabel}</Text></Pressable>; } }));
jest.mock('../../components/ui/SearchInput', () => ({ SearchInput: (props: any) => { const { TextInput } = require('react-native'); return <TextInput {...props} />; } }));
jest.mock('../../components/ui/ThemedSwitch', () => ({ ThemedSwitch: (props: any) => { const { Switch } = require('react-native'); return <Switch {...props} />; } }));
jest.mock('../../components/ui/Button', () => ({ Button: (props: any) => { const { Pressable, Text } = require('react-native'); return <Pressable {...props}><Text>{props.label}</Text></Pressable>; } }));
jest.mock('./DocumentScreen', () => ({ DocumentScreen: () => null }));
const defaults = { model: 'one', thinking: 'high', version: 'v1', editable: true, models: [{ id: 'one', name: 'One', isDefault: true, levels: ['high', 'low'] }, { id: 'two', name: 'Two', isDefault: false, levels: ['low'] }] };
let profile: jest.Mocked<AgentProfileOperations>, navigation: any, mockFocused = true;
beforeEach(() => {
  mockFocused = true;
  profile = { projects: jest.fn(async () => [{ id: 'p', name: 'Project', available: true }, { id: 'q', name: 'Other project', available: true }]), defaults: jest.fn(async () => defaults), setDefaults: jest.fn(), usage: jest.fn(async () => ({ plan: 'pro', quotas: [{ id: 'codex', name: 'Codex', windows: [{ minutes: 300, usedPercent: 25, resetsAt: null }] }], lifetimeTokens: null, daily: [] })), skills: jest.fn(async () => ({ skills: [{ id: 's', name: 'example', scope: 'project', description: 'Description', enabled: false, editable: true }], errorCount: 1 })), setSkillEnabled: jest.fn(), instructions: jest.fn(), document: jest.fn(), saveDocument: jest.fn(), mcp: jest.fn(async () => [{ name: 'server', auth: 'required', toolsAvailable: true, tools: [] }]), plugins: jest.fn(async () => [{ id: 'plugin', name: 'Plugin', description: 'Installed', enabled: false }]) } as any;
  navigation = { navigate: jest.fn(), push: jest.fn(), goBack: jest.fn() };
});
const props = (section: any) => ({ adapter: { management: { profile }, createSession: jest.fn(async () => ({ key: 'new-chat' })) } as any, section, online: true, isPro: false, navigation, params: { connectionId: 'c', agentId: 'codex', section }, onOpenPaywall: jest.fn() });
it('keeps confirmed model defaults until the native write responds and resets incompatible reasoning', async () => {
  let confirm!: (value: any) => void; profile.setDefaults.mockImplementation(() => new Promise(resolve => { confirm = resolve; }));
  const screen = render(<NativeProfileScreen {...props('models')} />);
  await waitFor(() => expect(screen.getByTestId('native-default-model')).toBeTruthy());
  fireEvent.press(screen.getByTestId('native-default-model')); fireEvent.press(screen.getByTestId('native-model-choice-two'));
  expect(profile.setDefaults).toHaveBeenCalledWith({ model: 'two', thinking: null, version: 'v1' });
  expect(screen.getAllByText('One').length).toBeGreaterThan(0);
  await act(async () => confirm({ ...defaults, model: 'two', thinking: null, version: 'v2' }));
  expect(screen.getByTestId('native-model-choice-two').props.accessibilityState.selected).toBe(true);
});
it('shows quota prominently and keeps unavailable values unknown', async () => {
  const screen = render(<NativeQuotaCard profile={profile} online refreshing={false} onPress={jest.fn()} />);
  await waitFor(() => expect(screen.getByText('75%')).toBeTruthy());
  profile.usage.mockResolvedValue({ plan: null, quotas: [], lifetimeTokens: null, daily: [] });
  screen.rerender(<NativeQuotaCard profile={profile} online refreshing onPress={jest.fn()} />);
  await waitFor(() => expect(screen.getByText('profile.quotaUnavailable')).toBeTruthy()); expect(screen.getByText('—')).toBeTruthy();
});
it('preserves compatible reasoning when restoring the native default model', async () => {
  profile.setDefaults.mockResolvedValue({ ...defaults, model: null, version: 'v2' });
  const screen = render(<NativeProfileScreen {...props('models')} />);
  await waitFor(() => expect(screen.getByTestId('native-default-model')).toBeTruthy());
  fireEvent.press(screen.getByTestId('native-default-model'));
  fireEvent.press(screen.getByTestId('native-model-choice-default'));
  await waitFor(() => expect(profile.setDefaults).toHaveBeenCalledWith({ model: null, thinking: 'high', version: 'v1' }));
});
it('includes disabled skills, force refreshes by project and confirms toggles', async () => {
  const screen = render(<NativeProfileScreen {...props('skills')} />);
  await waitFor(() => expect(screen.getByTestId('native-skill-toggle-example')).toBeTruthy());
  expect(profile.skills).toHaveBeenCalledWith('p', true); expect(screen.getByTestId('native-skill-toggle-example').props.value).toBe(false);
  profile.setSkillEnabled.mockResolvedValue({ skills: [{ id: 's', name: 'example', scope: 'project', description: 'Description', enabled: true, editable: true }], errorCount: 0 });
  fireEvent(screen.getByTestId('native-skill-toggle-example'), 'valueChange', true);
  await waitFor(() => expect(screen.getByTestId('native-skill-toggle-example').props.value).toBe(true)); expect(profile.setSkillEnabled).toHaveBeenCalledWith('s', true);
  fireEvent.press(screen.getByTestId('native-skill-example')); fireEvent.press(screen.getByText('profile.useSkill'));
  await waitFor(() => expect(navigation.navigate).toHaveBeenCalledWith('Thread', expect.objectContaining({ sessionKey: 'new-chat', composerDraft: expect.objectContaining({ text: '$example ' }) })));
});
it('ignores a late skill response after changing project', async () => {
  let old!: (value: any) => void; profile.skills.mockImplementation(id => id === 'p' ? new Promise(resolve => { old = resolve; }) : Promise.resolve({ skills: [{ id: 'other', name: 'other', scope: 'project', description: '', enabled: true, editable: true }], errorCount: 0 }));
  const screen = render(<NativeProfileScreen {...props('skills')} />);
  await waitFor(() => expect(screen.getByText('Project')).toBeTruthy()); fireEvent.press(screen.getByText('Project')); fireEvent.press(screen.getByTestId('native-project-choice-q'));
  await waitFor(() => expect(screen.getByText('other')).toBeTruthy());
  await act(async () => old({ skills: [{ id: 'old', name: 'old', scope: 'project', description: '', enabled: false, editable: true }], errorCount: 0 })); expect(screen.queryByText('old')).toBeNull();
});
it('keeps a fresh skill read after returning from its document when an older toggle confirms', async () => {
  let confirm!: (value: any) => void;
  profile.setSkillEnabled.mockImplementation(() => new Promise(resolve => { confirm = resolve; }));
  const screenProps = props('skills');
  const screen = render(<NativeProfileScreen {...screenProps} />);
  await waitFor(() => expect(screen.getByTestId('native-skill-toggle-example')).toBeTruthy());
  fireEvent(screen.getByTestId('native-skill-toggle-example'), 'valueChange', true);
  fireEvent.press(screen.getByTestId('native-skill-example'));
  fireEvent.press(screen.getByText('SKILL.md'));
  expect(navigation.push).toHaveBeenCalledWith('AgentSettingsSection', expect.objectContaining({ profileDocument: { id: 's', name: 'SKILL.md' } }));
  mockFocused = false; screen.rerender(<NativeProfileScreen {...screenProps} />);
  profile.skills.mockResolvedValue({ skills: [{ id: 's', name: 'example', scope: 'project', description: 'New read', enabled: false, editable: true }], errorCount: 0 });
  mockFocused = true; screen.rerender(<NativeProfileScreen {...screenProps} />);
  await waitFor(() => expect(screen.getByText('New read')).toBeTruthy());
  await act(async () => confirm({ skills: [{ id: 's', name: 'example', scope: 'project', description: 'Old confirmation', enabled: true, editable: true }], errorCount: 0 }));
  expect(screen.getByTestId('native-skill-toggle-example').props.value).toBe(false);
  expect(screen.getByText('New read')).toBeTruthy();
  expect(profile.setSkillEnabled).toHaveBeenCalledTimes(1);
});
it('does not surface a previous focus generation write failure over a fresh skill read', async () => {
  let reject!: (error: Error) => void;
  profile.setSkillEnabled.mockImplementation(() => new Promise((_resolve, fail) => { reject = fail; }));
  const screenProps = props('skills');
  const screen = render(<NativeProfileScreen {...screenProps} />);
  await waitFor(() => expect(screen.getByTestId('native-skill-toggle-example')).toBeTruthy());
  fireEvent(screen.getByTestId('native-skill-toggle-example'), 'valueChange', true);
  mockFocused = false; screen.rerender(<NativeProfileScreen {...screenProps} />);
  mockFocused = true; screen.rerender(<NativeProfileScreen {...screenProps} />);
  await waitFor(() => expect(profile.skills).toHaveBeenCalledTimes(2));
  await act(async () => reject(new Error('Previous write failed')));
  expect(screen.queryByText('profile.loadError')).toBeNull();
  expect(profile.setSkillEnabled).toHaveBeenCalledTimes(1);
});
it('does not navigate after a previous focus generation skill chat creation completes', async () => {
  profile.skills.mockResolvedValue({ skills: [{ id: 's', name: 'example', scope: 'project', description: '', enabled: true, editable: true }], errorCount: 0 });
  let created!: (value: { key: string }) => void;
  const screenProps = props('skills');
  (screenProps.adapter.createSession as jest.Mock).mockImplementation(() => new Promise(resolve => { created = resolve; }));
  const screen = render(<NativeProfileScreen {...screenProps} />);
  await waitFor(() => expect(screen.getByTestId('native-skill-example')).toBeTruthy());
  fireEvent.press(screen.getByTestId('native-skill-example')); fireEvent.press(screen.getByText('profile.useSkill'));
  mockFocused = false; screen.rerender(<NativeProfileScreen {...screenProps} />);
  mockFocused = true; screen.rerender(<NativeProfileScreen {...screenProps} />);
  await waitFor(() => expect(profile.skills).toHaveBeenCalledTimes(2));
  await act(async () => created({ key: 'old-created-chat' }));
  expect(navigation.navigate).not.toHaveBeenCalled();
  expect(screenProps.adapter.createSession).toHaveBeenCalledTimes(1);
});
it('keeps MCP and plugins read-only and points management to the computer', async () => {
  const screen = render(<NativeProfileScreen {...props('tools')} />); await waitFor(() => expect(screen.getByText('server')).toBeTruthy()); expect(screen.getByText('profile.desktopManage')).toBeTruthy();
  screen.rerender(<NativeProfileScreen {...props('plugins')} />); await waitFor(() => expect(screen.getByText('Plugin')).toBeTruthy());
  expect(profile.setDefaults).not.toHaveBeenCalled(); expect(profile.setSkillEnabled).not.toHaveBeenCalled(); expect(profile.saveDocument).not.toHaveBeenCalled();
});

it('keeps custom provider defaults readable and directs changes to the computer', async () => {
  profile.defaults.mockResolvedValue({ ...defaults, model: 'custom', editable: false, models: [] });
  const screen = render(<NativeProfileScreen {...props('models')} />);
  await waitFor(() => expect(screen.getByText('custom')).toBeTruthy());
  expect(screen.getByText('profile.desktopManage')).toBeTruthy();
  expect(screen.getByTestId('native-default-model').props.accessibilityState.disabled).toBe(true);
  expect(profile.setDefaults).not.toHaveBeenCalled();
});
