import React from 'react';
import { render } from '@testing-library/react-native';
import { Platform } from 'react-native';
import { builtInAccents } from '../../theme/accents';
import { buildTheme } from '../../theme/theme';
import { ControlSize, FontSize, LineHeight } from '../../theme/tokens';
import { FormTextInput } from './FormTextInput';

jest.mock('react-native', () => {
  const ReactRuntime = require('react');
  const primitive = (name: string) => ReactRuntime.forwardRef(
    ({ children, ...props }: Record<string, unknown>, ref: React.Ref<unknown>) => (
      ReactRuntime.createElement(name, { ...props, ref }, children)
    ),
  );
  return {
    Platform: { OS: 'ios' },
    StyleSheet: {
      create: <T,>(styles: T) => styles,
      flatten: (style: unknown) => style,
      hairlineWidth: 1,
    },
    TextInput: primitive('TextInput'),
    Text: primitive('Text'),
    View: primitive('View'),
  };
});

jest.mock('lucide-react-native', () => ({ CircleAlert: 'CircleAlert' }));

jest.mock('../../theme', () => ({
  useAppTheme: () => ({
    theme: buildTheme('light', 'light', builtInAccents.iceBlue),
  }),
}));

function flattenStyle(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (!Array.isArray(value)) return value as Record<string, unknown>;
  return Object.assign({}, ...value.map(flattenStyle));
}

describe('FormTextInput', () => {
  const originalPlatform = Platform.OS;
  let consoleErrorSpy: jest.SpyInstance;

  beforeAll(() => {
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation((message?: unknown) => {
      if (typeof message === 'string' && message.includes('react-test-renderer is deprecated')) return;
    });
  });

  afterAll(() => {
    Platform.OS = originalPlatform;
    consoleErrorSpy.mockRestore();
  });

  it('uses composition-safe value ownership and canonical field tokens', () => {
    Platform.OS = 'ios';
    const view = render(
      <FormTextInput testID="field" value="拼音" onChangeText={jest.fn()} />,
    );
    const input = view.getByTestId('field');

    expect(input.props.value).toBeUndefined();
    expect(input.props.defaultValue).toBe('拼音');
    expect(flattenStyle(input.props.style).lineHeight).toBeUndefined();
    expect(flattenStyle(input.props.style)).toMatchObject({
      minHeight: ControlSize.floatingButton,
      fontSize: FontSize.secondary,
    });
  });

  it('retains explicit leading for multiline fields', () => {
    const view = render(<FormTextInput testID="multiline" multiline value="First line\nSecond line" />);
    expect(flattenStyle(view.getByTestId('multiline').props.style).lineHeight).toBe(LineHeight.secondary);
  });
});

it('exposes the correction without replacing composition-safe input ownership', () => {
  const view = render(<FormTextInput testID="error-field" value="123" surface="quiet" invalid errorMessage="Enter six digits" />);
  expect(view.getByTestId('error-field').props.accessibilityHint).toBe('Enter six digits');
  expect(view.getByText('Enter six digits')).toBeTruthy();
});
