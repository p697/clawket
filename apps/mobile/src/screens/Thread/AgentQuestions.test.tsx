jest.mock('lucide-react-native', () => ({ Circle: () => null, CircleCheck: () => null, Square: () => null, SquareCheck: () => null, ChevronRight: () => null, MessageCircleQuestion: () => null }));
import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Keyboard } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { loadQuestionDraft } from './question-drafts';
import { AgentQuestions } from './AgentQuestions';
import { createMockAdapter, type AgentQuestion } from '@clawket/agent-protocol';

jest.mock('react-native', () => {
  const R = require('react');
  const host = (name: string) => ({ children, ...props }: any) => R.createElement(name, props, children);
  return { Platform: { OS: 'ios' }, Keyboard: { dismiss: jest.fn() }, View: host('View'), Pressable: host('Pressable'), Text: host('Text'), TextInput: host('TextInput'), StyleSheet: { create: (value: unknown) => value } };
});
jest.mock('../../components/ui/Sheet', () => ({ Sheet: ({ visible, children, footer, ...props }: any) => visible ? <>{children}{footer}</> : null }));
jest.mock('../../components/ui/Banner', () => ({ Banner: ({ message, actionLabel, onAction }: any) => { const { Text } = require('react-native'); return <><Text>{message}</Text><Text onPress={onAction}>{actionLabel}</Text></>; } }));
jest.mock('../../components/ui/Button', () => ({ Button: ({ label, onPress, disabled }: any) => { const { Text } = require('react-native'); return <Text onPress={disabled ? undefined : onPress}>{label}</Text>; } }));
jest.mock('../../components/ui/FormTextInput', () => ({ FormTextInput: (props: any) => { const { TextInput } = require('react-native'); return <TextInput {...props} />; } }));
jest.mock('../../components/ui', () => ({ SettingsGroup: ({ children }: any) => <>{children}</>, SettingsRow: ({ title, onPress }: any) => { const { Text } = require('react-native'); return <Text onPress={onPress}>{title}</Text>; } }));
jest.mock('@gorhom/bottom-sheet', () => ({ BottomSheetScrollView: ({ children }: any) => <>{children}</> }));
jest.mock('../../theme', () => ({ useAppTheme: () => ({ theme: { colors: { ink: 'black' } } }) }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
// The pending question rides in the work dock (design C); its own rendering is covered by WorkDock.test.tsx.
jest.mock('../../components/chat/WorkDock', () => ({ WorkDock: ({ onAttend, detail, testID }: any) => { const { Text, View } = require('react-native'); return <View><Text testID={testID} onPress={onAttend}>Respond</Text>{detail ? <Text>{detail}</Text> : null}</View>; } }));
jest.mock('../../components/chat/ChatPresentation', () => ({ useChatSurfaces: () => ({ wallpaper: 'plain' }) }));

beforeEach(() => {
  const values = new Map<string, string>();
  (AsyncStorage.getItem as jest.Mock).mockImplementation(async key => values.get(key) ?? null);
  (AsyncStorage.setItem as jest.Mock).mockImplementation(async (key, value) => { values.set(key, value); });
  (AsyncStorage.removeItem as jest.Mock).mockImplementation(async key => { values.delete(key); });
});

function setup(question: AgentQuestion) {
  const adapter = createMockAdapter({ connection: { id: 'c', backendKind: 'pi', transportKind: 'local', label: 'Pi', createdAt: 1, isFreeSlot: true } });
  const respond = jest.fn(async () => {});
  adapter.questions = { list: jest.fn(async () => [question]), respond };
  Object.defineProperty(adapter, 'state', { value: 'ready' });
  return { adapter, respond };
}
it('restores a question, preserves a failed draft and only resolves an explicit answer', async () => {
  const { adapter, respond } = setup({ id: 'q', kind: 'input', title: 'Name', expiresAtMs: null });
  respond.mockRejectedValueOnce(new Error('offline'));
  const view = render(<AgentQuestions adapter={adapter} sessionKey="s" />);
  await waitFor(() => expect(view.getByText('Respond')).toBeTruthy());
  expect(respond).not.toHaveBeenCalled(); fireEvent.press(view.getByText('Respond'));
  expect(Keyboard.dismiss).toHaveBeenCalled();
  fireEvent.changeText(view.getByTestId('agent-question-input'), '  exact draft\n');
  fireEvent.press(view.getByText('Send'));
  await waitFor(() => expect(view.getByText('Could not update this request. Try again.')).toBeTruthy());
  expect(view.getByTestId('agent-question-input').props.value).toBe('  exact draft\n');
  fireEvent.press(view.getByText('Send'));
  await waitFor(() => expect(view.queryByText('Respond')).toBeNull());
  expect(respond).toHaveBeenLastCalledWith('s', 'q', { value: '  exact draft\n' });
});
it('cancels without granting confirmation and ignores a late snapshot from another session', async () => {
  const { adapter, respond } = setup({ id: 'q', kind: 'confirm', title: 'Proceed?', expiresAtMs: null });
  const view = render(<AgentQuestions adapter={adapter} sessionKey="s" />);
  await waitFor(() => expect(view.getByText('Respond')).toBeTruthy()); fireEvent.press(view.getByText('Respond')); fireEvent.press(view.getByText('Cancel'));
  await waitFor(() => expect(respond).toHaveBeenCalledWith('s', 'q', { cancelled: true }));
  let resolve!: (value: AgentQuestion[]) => void;
  adapter.questions!.list = jest.fn(() => new Promise(done => { resolve = done; }));
  view.rerender(<AgentQuestions adapter={adapter} sessionKey="other" />);
  view.unmount(); await act(async () => resolve([{ id: 'late', kind: 'confirm', title: 'Late', expiresAtMs: null }]));
  expect(respond).toHaveBeenCalledTimes(1);
});

jest.mock('../../components/ui/SettingsGroup', () => ({ SettingsGroup: ({ children }: any) => <>{children}</>, SettingsRow: ({ title, onPress }: any) => { const { Text } = require('react-native'); return <Text onPress={onPress}>{title}</Text>; } }));

it('keeps a structured question pending after stop acknowledgement until native resolution', async () => {
  const { adapter, respond } = setup({ id: 'stop-form', kind: 'form', title: 'Plan?', fields: [{ id: 'decision', title: 'Choose', options: [], allowCustom: true }], expiresAtMs: null });
  const view = render(<AgentQuestions adapter={adapter} sessionKey="s" />);
  await waitFor(() => expect(view.getByText('Respond')).toBeTruthy()); fireEvent.press(view.getByText('Respond'));
  fireEvent.press(view.getByText('Stop task'));
  await waitFor(() => expect(respond).toHaveBeenCalledWith('s', 'stop-form', { cancelled: true }));
  expect(view.getByText('Respond')).toBeTruthy();
});

it('aggregates all native question IDs and retains custom answers through a failed submission', async () => {
  const { adapter, respond } = setup({ id: 'multi-form', kind: 'form', title: 'Plan?', fields: [
    { id: 'format', title: 'Format?', options: [{ label: 'Compact', description: 'Brief explanation' }], allowCustom: true },
    { id: 'language', title: 'Language?', options: [], allowCustom: true },
  ], expiresAtMs: null });
  const view = render(<AgentQuestions adapter={adapter} sessionKey="s" />);
  await waitFor(() => expect(view.getByText('Respond')).toBeTruthy()); fireEvent.press(view.getByText('Respond'));
  fireEvent.press(view.getByText('Compact')); fireEvent.press(view.getByText('Next'));
  fireEvent.changeText(view.getByTestId('codex-question-answer'), 'Chinese with English terms');
  respond.mockRejectedValueOnce(new Error('offline'));
  fireEvent.press(view.getByText('Send'));
  await waitFor(() => expect(view.getByText('Could not update this request. Try again.')).toBeTruthy());
  expect(view.getByTestId('codex-question-answer').props.value).toBe('Chinese with English terms');
  fireEvent.press(view.getByText('Send'));
  await waitFor(() => expect(respond).toHaveBeenCalledTimes(2));
  expect(respond).toHaveBeenLastCalledWith('s', 'multi-form', { answers: { format: ['Compact'], language: ['Chinese with English terms'] } });
});

it('exposes mutually exclusive radio choices and opens custom input only on demand', async () => {
  const { adapter } = setup({ id: 'radio-form', kind: 'form', title: 'Choose?', fields: [{ id: 'choice', title: 'Choose?', options: [{ label: 'One' }, { label: 'Two' }], allowCustom: true }], expiresAtMs: null });
  const view = render(<AgentQuestions adapter={adapter} sessionKey="s" />);
  await waitFor(() => expect(view.getByText('Respond')).toBeTruthy()); fireEvent.press(view.getByText('Respond'));
  expect(view.queryByTestId('codex-question-answer')).toBeNull();
  expect(view.getByTestId('codex-question-option-0').props.accessibilityState.checked).toBe(false);
  fireEvent.press(view.getByText('One'));
  expect(view.getByTestId('codex-question-option-0').props.accessibilityState.checked).toBe(true);
  fireEvent.press(view.getByText('Two'));
  expect(view.getByTestId('codex-question-option-0').props.accessibilityState.checked).toBe(false);
  expect(view.getByTestId('codex-question-option-1').props.accessibilityState.checked).toBe(true);
  fireEvent.press(view.getByTestId('codex-question-custom'));
  expect(view.getByTestId('codex-question-answer').props.value).toBe('');
  expect(view.getByTestId('codex-question-option-1').props.accessibilityState.checked).toBe(false);
});

it('lets Claude multi-select questions toggle independent checkboxes and submit all selections', async () => {
  const { adapter, respond } = setup({ id: 'claude-multi', kind: 'form', title: 'Tests?', fields: [{ id: 'tests', title: 'Which tests?', multiSelect: true, options: [{ label: 'Unit' }, { label: 'Integration' }], allowCustom: true }], expiresAtMs: null });
  const view = render(<AgentQuestions adapter={adapter} sessionKey="s" />);
  await waitFor(() => expect(view.getByText('Respond')).toBeTruthy()); fireEvent.press(view.getByText('Respond'));
  expect(view.getByTestId('codex-question-option-0').props.accessibilityRole).toBe('checkbox');
  act(() => {
    view.getByTestId('codex-question-option-0').props.onPress();
    view.getByTestId('codex-question-option-1').props.onPress();
  });
  expect(view.getByTestId('codex-question-option-0').props.accessibilityState.checked).toBe(true);
  expect(view.getByTestId('codex-question-option-1').props.accessibilityState.checked).toBe(true);
  fireEvent.press(view.getByText('Unit'));
  expect(view.getByTestId('codex-question-option-0').props.accessibilityState.checked).toBe(false);
  fireEvent.press(view.getByText('Unit')); fireEvent.press(view.getByText('Send'));
  await waitFor(() => expect(respond).toHaveBeenCalledWith('s', 'claude-multi', { answers: { tests: ['Integration', 'Unit'] } }));
});


it('requires explicit submission for a Pi choice, retains failed selection and supports changing the selected option', async () => {
  const { adapter, respond } = setup({ id: 'pi-select', kind: 'select', title: 'Choose a color', options: ['Blue', 'Green'], expiresAtMs: null });
  const view = render(<AgentQuestions adapter={adapter} sessionKey="s" />);
  await waitFor(() => expect(view.getByTestId('agent-question-pending')).toBeTruthy());
  fireEvent.press(view.getByTestId('agent-question-pending'));
  fireEvent.press(view.getByText('Send'));
  expect(respond).not.toHaveBeenCalled();
  fireEvent.press(view.getByTestId('agent-question-option-0'));
  expect(view.getByTestId('agent-question-option-0').props.accessibilityState.checked).toBe(true);
  expect(respond).not.toHaveBeenCalled();
  fireEvent.press(view.getByTestId('agent-question-option-1'));
  expect(view.getByTestId('agent-question-option-0').props.accessibilityState.checked).toBe(false);
  respond.mockRejectedValueOnce(new Error('offline'));
  fireEvent.press(view.getByText('Send'));
  await waitFor(() => expect(view.getByText('Could not update this request. Try again.')).toBeTruthy());
  expect(view.getByTestId('agent-question-option-1').props.accessibilityState.checked).toBe(true);
  fireEvent.press(view.getByText('Send'));
  await waitFor(() => expect(respond).toHaveBeenCalledTimes(2));
  expect(respond).toHaveBeenLastCalledWith('s', 'pi-select', { value: 'Green' });
});


it.each(['input', 'editor', 'select'] as const)('restores a pending Pi %s draft after remount without submitting it', async (kind) => {
  const id = `pi-restored-${kind}`;
  const { adapter, respond } = setup({ id, kind, title: 'Retain draft', options: ['Blue', 'Green'], prefill: kind === 'editor' ? 'Original' : undefined, expiresAtMs: null });
  const first = render(<AgentQuestions adapter={adapter} sessionKey="s" />);
  await waitFor(() => expect(first.getByText('Respond')).toBeTruthy());
  fireEvent.press(first.getByTestId('agent-question-pending'));
  if (kind === 'select') fireEvent.press(first.getByTestId('agent-question-option-1'));
  else fireEvent.changeText(first.getByTestId('agent-question-input'), '  saved exact draft  ');
  const expected = kind === 'select' ? 'Green' : '  saved exact draft  ';
  await act(async () => { expect(await loadQuestionDraft(`c:s:${id}`)).toEqual({ value: [expected] }); });
  first.unmount();
  const second = render(<AgentQuestions adapter={adapter} sessionKey="s" />);
  await waitFor(() => expect(second.getByText('Respond')).toBeTruthy());
  fireEvent.press(second.getByTestId('agent-question-pending'));
  await waitFor(() => {
    if (kind === 'select') expect(second.getByTestId('agent-question-option-1').props.accessibilityState.checked).toBe(true);
    else expect(second.getByTestId('agent-question-input').props.value).toBe(expected);
  });
  expect(respond).not.toHaveBeenCalled();
  fireEvent.press(second.getByText('Cancel'));
  await waitFor(() => expect(respond).toHaveBeenCalledWith('s', id, { cancelled: true }));
  await act(async () => { expect(await loadQuestionDraft(`c:s:${id}`)).toBeUndefined(); });
});
