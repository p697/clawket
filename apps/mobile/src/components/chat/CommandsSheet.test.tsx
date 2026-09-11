import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { CommandsSheet } from './CommandsSheet';
import type { SlashCommand } from '../../data/slash-commands';

jest.mock('react-native', () => {
  const ReactRuntime = require('react');
  const host = (name: string) => ({ children, ...props }: Record<string, unknown>) => (
    ReactRuntime.createElement(name, props, children)
  );
  return {
    Pressable: host('Pressable'),
    StyleSheet: { create: <T,>(styles: T) => styles, flatten: (style: unknown) => style, hairlineWidth: 1 },
    Text: host('Text'),
    View: host('View'),
  };
});

jest.mock('@gorhom/bottom-sheet', () => {
  const ReactRuntime = require('react');
  const { View } = require('react-native');
  return {
    BottomSheetFlatList: ({ data, renderItem, keyExtractor }: {
      data: unknown[];
      renderItem: (info: { item: unknown }) => React.ReactNode;
      keyExtractor: (item: unknown) => string;
    }) => ReactRuntime.createElement(
      View,
      null,
      data.map((item) => ReactRuntime.createElement(React.Fragment, { key: keyExtractor(item) }, renderItem({ item }))),
    ),
  };
});

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => Object.entries(options ?? {}).reduce(
      (value, [name, replacement]) => value.replace(`{{${name}}}`, String(replacement)),
      key,
    ),
  }),
}));

jest.mock('../../services/haptics', () => ({ triggerSelectionHaptic: jest.fn() }));

jest.mock('../ui/Sheet', () => {
  const ReactRuntime = require('react');
  const { View } = require('react-native');
  return {
    Sheet: ({ children, testID, visible, onAfterClose }: {
      children: React.ReactNode;
      testID?: string;
      visible: boolean;
      onAfterClose?: () => void;
    }) => visible ? ReactRuntime.createElement(View, { testID, onAfterClose }, children) : null,
  };
});

jest.mock('../ui/ConfirmationModal', () => {
  const ReactRuntime = require('react');
  const { Pressable, Text, View } = require('react-native');
  return {
    ConfirmationModal: ({ visible, testID, title, message, onClose, onConfirm }: {
      visible: boolean;
      testID?: string;
      title: string;
      message: string;
      onClose: () => void;
      onConfirm: () => void;
    }) => visible ? ReactRuntime.createElement(
      View,
      { testID },
      ReactRuntime.createElement(Text, { testID: `${testID}-title` }, title),
      ReactRuntime.createElement(Text, { testID: `${testID}-message` }, message),
      ReactRuntime.createElement(Pressable, { testID: `${testID}-cancel`, onPress: onClose }),
      ReactRuntime.createElement(Pressable, { testID: `${testID}-confirm`, onPress: onConfirm }),
    ) : null,
  };
});

jest.mock('../ui/SettingsGroup', () => {
  const ReactRuntime = require('react');
  const { Pressable, Text, View } = require('react-native');
  return {
    SettingsDivider: () => ReactRuntime.createElement(View),
    SettingsRow: ({ onPress, testID, title, value }: {
      onPress?: () => void;
      testID?: string;
      title: string;
      value?: string;
    }) => ReactRuntime.createElement(
      Pressable,
      { onPress, testID },
      ReactRuntime.createElement(Text, { testID: `${testID}-title` }, title),
      ReactRuntime.createElement(Text, { testID: `${testID}-value` }, value),
    ),
  };
});

const COMMANDS: SlashCommand[] = [
  { key: 'status', command: '/status', description: 'Show session status', action: 'send' },
  { key: 'reset', command: '/reset', description: 'Reset current session', action: 'send' },
];

describe('CommandsSheet', () => {
  it('lists commands with translated descriptions and runs a plain command after dismissal', () => {
    const onClose = jest.fn();
    const onSelect = jest.fn();
    const view = render(<CommandsSheet visible commands={COMMANDS} onClose={onClose} onSelect={onSelect} />);

    expect(view.getByTestId('commands-sheet-status-title').props.children).toBe('Show session status');
    expect(view.getByTestId('commands-sheet-status-value').props.children).toBe('/status');

    fireEvent.press(view.getByTestId('commands-sheet-status'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.press(view.getByTestId('commands-sheet-reset'));
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent(view.getByTestId('commands-sheet'), 'afterClose');
    expect(onSelect).toHaveBeenCalledWith(COMMANDS[0]);
    expect(view.queryByTestId('commands-sheet-confirm')).toBeNull();
  });

  it('confirms destructive commands after the sheet closes and can be cancelled', () => {
    const onClose = jest.fn();
    const onSelect = jest.fn();
    const view = render(<CommandsSheet visible commands={COMMANDS} onClose={onClose} onSelect={onSelect} />);

    fireEvent.press(view.getByTestId('commands-sheet-reset'));
    fireEvent(view.getByTestId('commands-sheet'), 'afterClose');
    expect(onSelect).not.toHaveBeenCalled();
    expect(view.getByTestId('commands-sheet-confirm-title').props.children).toBe('Reset current session');
    expect(view.getByTestId('commands-sheet-confirm-message').props.children).toBe('Send /reset to the Agent?');

    fireEvent.press(view.getByTestId('commands-sheet-confirm-cancel'));
    expect(view.queryByTestId('commands-sheet-confirm')).toBeNull();
    expect(onSelect).not.toHaveBeenCalled();

    fireEvent.press(view.getByTestId('commands-sheet-reset'));
    fireEvent(view.getByTestId('commands-sheet'), 'afterClose');
    fireEvent.press(view.getByTestId('commands-sheet-confirm-confirm'));
    expect(onSelect).toHaveBeenCalledWith(COMMANDS[1]);
    expect(view.queryByTestId('commands-sheet-confirm')).toBeNull();
  });

  it('closes without running anything when dismissed by the user', () => {
    const onClose = jest.fn();
    const onSelect = jest.fn();
    const view = render(<CommandsSheet visible commands={COMMANDS} onClose={onClose} onSelect={onSelect} />);
    fireEvent(view.getByTestId('commands-sheet'), 'afterClose');
    expect(onSelect).not.toHaveBeenCalled();
    view.rerender(<CommandsSheet visible={false} commands={COMMANDS} onClose={onClose} onSelect={onSelect} />);
    expect(view.queryByTestId('commands-sheet')).toBeNull();
  });
});
