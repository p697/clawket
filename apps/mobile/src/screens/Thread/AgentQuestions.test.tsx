jest.mock('lucide-react-native', () => ({ Circle: () => null, CircleCheck: () => null, Square: () => null, SquareCheck: () => null, ChevronRight: () => null, MessageCircleQuestion: () => null }));
import React from 'react';
import { Keyboard } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
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
  await waitFor(() => expect(view.getByText('Agent needs your input')).toBeTruthy());
  expect(respond).not.toHaveBeenCalled(); fireEvent.press(view.getByText('Respond'));
  expect(Keyboard.dismiss).toHaveBeenCalled();
  fireEvent.changeText(view.getByTestId('agent-question-input'), '  exact draft\n');
  fireEvent.press(view.getByText('Send'));
  await waitFor(() => expect(view.getByText('Could not update this request. Try again.')).toBeTruthy());
  expect(view.getByTestId('agent-question-input').props.value).toBe('  exact draft\n');
  fireEvent.press(view.getByText('Send'));
  await waitFor(() => expect(view.queryByText('Agent needs your input')).toBeNull());
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
