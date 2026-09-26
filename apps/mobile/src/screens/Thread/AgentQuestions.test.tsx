import React from 'react';
import { Keyboard } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { AgentQuestions } from './AgentQuestions';
import { createMockAdapter, type AgentQuestion } from '@clawket/agent-protocol';

jest.mock('react-native', () => {
  const R = require('react');
  const host = (name: string) => ({ children, ...props }: any) => R.createElement(name, props, children);
  return { Keyboard: { dismiss: jest.fn() }, View: host('View'), Text: host('Text'), TextInput: host('TextInput'), StyleSheet: { create: (value: unknown) => value } };
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
