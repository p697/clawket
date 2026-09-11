import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { OneTimePasswordInput } from './OneTimePasswordInput';

jest.mock('react-native', () => {
  const ReactRuntime = require('react');
  const host = (name: string) => ({ children, ...props }: { children?: React.ReactNode }) => ReactRuntime.createElement(name, props, children);
  return { View: host('View'), Text: host('Text'), Pressable: host('Pressable'), TextInput: host('TextInput'), Platform: { OS: 'ios' }, StyleSheet: { create: (styles: unknown) => styles, flatten: (styles: unknown) => styles, hairlineWidth: 0.5 } };
});

jest.mock('../../theme', () => ({ useAppTheme: () => ({ theme: { colors: { ink: '#111113', surface: '#F2F2F4', line: '#E6E6EA', bad: '#D64545' } } }) }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
const mockNormalize = jest.fn();
jest.mock('../ui/CompositionSafeTextInput', () => {
  const ReactRuntime = require('react');
  const { TextInput } = require('react-native');
  return { CompositionSafeTextInput: ReactRuntime.forwardRef((props: object, ref: unknown) => {
    ReactRuntime.useImperativeHandle(ref, () => ({ focus: jest.fn(), setNativeProps: mockNormalize }));
    return ReactRuntime.createElement(TextInput, props);
  }) };
});

it('uses one autofill field, sanitizes paste, completes once, and allows correction', () => {
  const change = jest.fn();
  const complete = jest.fn();
  const view = render(<OneTimePasswordInput value="" onChangeText={change} onComplete={complete} />);
  const input = view.getByTestId('youmind-otp-input');
  expect(input.props.textContentType).toBe('oneTimeCode');
  expect(view.getAllByTestId(/^otp-cell-/)).toHaveLength(6);
  fireEvent.changeText(input, '12a 3456');
  expect(change).toHaveBeenLastCalledWith('123456');
  expect(mockNormalize).toHaveBeenLastCalledWith({ text: '123456', selection: { start: 6, end: 6 } });
  expect(complete).toHaveBeenCalledWith('123456');
  fireEvent.changeText(input, '1234567');
  expect(mockNormalize).toHaveBeenCalledTimes(2);
  expect(complete).toHaveBeenCalledTimes(1);
  view.rerender(<OneTimePasswordInput value="123456" onChangeText={change} onComplete={complete} />);
  fireEvent.changeText(input, '12345');
  fireEvent.changeText(input, '123456');
  expect(complete).toHaveBeenCalledTimes(2);
  view.rerender(<OneTimePasswordInput value="123456" onChangeText={change} onComplete={complete} editable={false} />);
  fireEvent.changeText(input, '654321');
  expect(complete).toHaveBeenCalledTimes(2);
});
