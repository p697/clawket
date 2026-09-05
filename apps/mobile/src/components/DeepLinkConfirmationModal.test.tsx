import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { DeepLinkConfirmationModal } from './DeepLinkConfirmationModal';

jest.mock('react-native', () => {
  const ReactRuntime = require('react');
  const primitive = (name: string) => ({ children, ...props }: Record<string, unknown>) => (
    ReactRuntime.createElement(name, props, children)
  );
  return {
    Pressable: primitive('Pressable'),
    StyleSheet: { flatten: (style: unknown) => style },
    Text: primitive('Text'),
    View: primitive('View'),
  };
});

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, string>) => Object.entries(values ?? {}).reduce(
      (copy, [name, value]) => copy.replace(`{{${name}}}`, value),
      key,
    ),
  }),
}));

jest.mock('./ui', () => {
  const ReactRuntime = require('react');
  const { Pressable, Text, View } = require('react-native');
  return {
    ConfirmationModal: ({
      cancelLabel,
      confirmLabel,
      destructive,
      message,
      onClose,
      onConfirm,
      testID,
      title,
    }: Record<string, unknown>) => ReactRuntime.createElement(
      View,
      { testID, destructive },
      ReactRuntime.createElement(Text, null, title),
      ReactRuntime.createElement(Text, null, message),
      ReactRuntime.createElement(Pressable, { testID: `${testID}-cancel`, onPress: onClose }, cancelLabel),
      ReactRuntime.createElement(Pressable, { testID: `${testID}-confirm`, onPress: onConfirm }, confirmLabel),
    ),
  };
});

describe('DeepLinkConfirmationModal', () => {
  it('renders a localized app-owned confirmation and executes only after confirmation', () => {
    const onClose = jest.fn();
    const onConfirm = jest.fn();
    const view = render(
      <DeepLinkConfirmationModal
        request={{
          action: { type: 'agent', message: 'Review this' },
          onConfirm,
        }}
        onClose={onClose}
      />,
    );

    expect(view.getByText('Send "Review this" to this agent?')).toBeTruthy();
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.press(view.getByTestId('deep-link-confirmation-confirm'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onClose.mock.invocationCallOrder[0]).toBeLessThan(onConfirm.mock.invocationCallOrder[0]);
  });

  it('marks connection changes destructive and allows cancellation without executing', () => {
    const onClose = jest.fn();
    const onConfirm = jest.fn();
    const view = render(
      <DeepLinkConfirmationModal
        request={{
          action: { type: 'connect', url: 'https://example.com' },
          onConfirm,
        }}
        onClose={onClose}
      />,
    );

    expect(view.getByText('Connect to https://example.com?')).toBeTruthy();
    expect(view.getByTestId('deep-link-confirmation').props.destructive).toBe(true);
    fireEvent.press(view.getByTestId('deep-link-confirmation-cancel'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
