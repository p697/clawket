import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { StorageService } from '../../services/storage';
import { PromptPickerModal } from './PromptPickerModal';

jest.mock('react-native', () => {
  const ReactRuntime = require('react');
  const primitive = (name: string) => ({ children, ...props }: Record<string, unknown>) => (
    ReactRuntime.createElement(name, props, children)
  );
  const View = primitive('View');
  return {
    FlatList: ({ data, renderItem, ...props }: {
      data: unknown[];
      renderItem: (value: { item: unknown; index: number }) => React.ReactNode;
    }) => ReactRuntime.createElement(
      View,
      props,
      data.map((item, index) => renderItem({ item, index })),
    ),
    Keyboard: {
      addListener: () => ({ remove: jest.fn() }),
    },
    Platform: { OS: 'ios' },
    Pressable: primitive('Pressable'),
    StyleSheet: {
      create: <T,>(styles: T) => styles,
      flatten: (style: unknown) => style,
      hairlineWidth: 1,
    },
    Text: primitive('Text'),
    View,
  };
});

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: 'light' },
}));

jest.mock('lucide-react-native', () => {
  const ReactRuntime = require('react');
  const { View } = require('react-native');
  return {
    ChevronLeft: (props: Record<string, unknown>) => ReactRuntime.createElement(View, props),
    Pin: (props: Record<string, unknown>) => ReactRuntime.createElement(View, props),
    Plus: (props: Record<string, unknown>) => ReactRuntime.createElement(View, props),
  };
});

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('../../theme', () => ({
  useAppTheme: () => ({
    theme: {
      colors: {
        line: '#ddd',
        bad: '#d00',
        accent: '#15f',
        onAccent: '#fff',
        surface: '#fff',
        ink: '#111',
        inkSecondary: '#666',
        inkTertiary: '#999',
      },
    },
  }),
}));

jest.mock('../../services/storage', () => ({
  StorageService: {
    getUserPrompts: jest.fn(),
    isPromptPeekShown: jest.fn(),
    isUserPromptsSeeded: jest.fn(),
    markPromptPeekShown: jest.fn(),
    markUserPromptsSeeded: jest.fn(),
    setUserPrompts: jest.fn(),
  },
}));

jest.mock('../config/SwipeableGatewayRow', () => {
  const ReactRuntime = require('react');
  const { Pressable, View } = require('react-native');
  return {
    SwipeableGatewayRow: ({ children, onDelete }: {
      children: React.ReactNode;
      onDelete: () => void;
    }) => ReactRuntime.createElement(
      View,
      null,
      children,
      ReactRuntime.createElement(Pressable, { testID: 'prompt-row-delete', onPress: onDelete }),
    ),
  };
});

jest.mock('../ui', () => {
  const ReactRuntime = require('react');
  const { Pressable, Text, View } = require('react-native');
  return {
    Button: ({ label, onPress, testID }: {
      label: string;
      onPress?: () => void;
      testID?: string;
    }) => ReactRuntime.createElement(Pressable, { onPress, testID }, label),
    ConfirmationModal: ({
      message,
      onClose,
      onConfirm,
      testID,
      visible,
    }: {
      message: string;
      onClose: () => void;
      onConfirm: () => void;
      testID: string;
      visible: boolean;
    }) => visible ? ReactRuntime.createElement(
      View,
      { testID },
      ReactRuntime.createElement(Text, null, message),
      ReactRuntime.createElement(Pressable, { testID: `${testID}-cancel`, onPress: onClose }),
      ReactRuntime.createElement(Pressable, { testID: `${testID}-confirm`, onPress: onConfirm }),
    ) : null,
    FormTextInput: () => ReactRuntime.createElement(View),
    Sheet: ({ children, visible }: { children: React.ReactNode; visible: boolean }) => (
      visible ? ReactRuntime.createElement(View, null, children) : null
    ),
  };
});

describe('PromptPickerModal deletion confirmation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (StorageService.isUserPromptsSeeded as jest.Mock).mockResolvedValue(true);
    (StorageService.getUserPrompts as jest.Mock).mockResolvedValue([{
      id: 'prompt-1',
      text: 'Keep this prompt private',
      createdAt: 1,
      updatedAt: 1,
    }]);
    (StorageService.isPromptPeekShown as jest.Mock).mockResolvedValue(true);
    (StorageService.setUserPrompts as jest.Mock).mockResolvedValue(undefined);
  });

  it('does not delete until the centered confirmation is accepted', async () => {
    const view = render(
      <PromptPickerModal visible onClose={jest.fn()} onSelectPrompt={jest.fn()} />,
    );
    await waitFor(() => expect(view.getByText('Keep this prompt private')).toBeTruthy());

    fireEvent.press(view.getByTestId('prompt-row-delete'));
    expect(view.getByTestId('prompt-delete-confirmation')).toBeTruthy();
    expect(StorageService.setUserPrompts).not.toHaveBeenCalled();

    fireEvent.press(view.getByTestId('prompt-delete-confirmation-confirm'));
    await waitFor(() => expect(StorageService.setUserPrompts).toHaveBeenCalledWith([]));
    expect(view.queryByTestId('prompt-delete-confirmation')).toBeNull();
  });

  it('keeps the prompt when confirmation is cancelled', async () => {
    const view = render(
      <PromptPickerModal visible onClose={jest.fn()} onSelectPrompt={jest.fn()} />,
    );
    await waitFor(() => expect(view.getByText('Keep this prompt private')).toBeTruthy());
    fireEvent.press(view.getByTestId('prompt-row-delete'));
    fireEvent.press(view.getByTestId('prompt-delete-confirmation-cancel'));

    expect(StorageService.setUserPrompts).not.toHaveBeenCalled();
    expect(view.getByText('Keep this prompt private')).toBeTruthy();
  });
});
