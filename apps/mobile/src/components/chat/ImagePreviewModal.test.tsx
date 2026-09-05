import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { saveImageUriToPhotoLibrary } from '../../services/photo-library';
import { ImagePreviewModal } from './ImagePreviewModal';

let triggerLongPress: (() => void) | null = null;

jest.mock('react-native', () => {
  const ReactRuntime = require('react');
  const primitive = (name: string) => ({ children, ...props }: Record<string, unknown>) => (
    ReactRuntime.createElement(name, props, children)
  );
  return {
    Alert: { alert: jest.fn() },
    Modal: primitive('Modal'),
    Pressable: primitive('Pressable'),
    StyleSheet: {
      create: <T,>(styles: T) => styles,
      flatten: (style: unknown) => style,
    },
    Text: primitive('Text'),
    View: primitive('View'),
  };
});

jest.mock('@likashefqet/react-native-image-zoom', () => {
  const ReactRuntime = require('react');
  const { View } = require('react-native');
  return { ImageZoom: (props: Record<string, unknown>) => ReactRuntime.createElement(View, props) };
});

jest.mock('react-native-gesture-handler', () => {
  const ReactRuntime = require('react');
  const { View } = require('react-native');
  const chain = (captureStart = false) => {
    const value: Record<string, (...args: any[]) => unknown> = {};
    for (const method of [
      'maxPointers',
      'onTouchesDown',
      'onUpdate',
      'onEnd',
      'onFinalize',
      'minDuration',
      'maxDistance',
    ]) {
      value[method] = () => value;
    }
    value.onStart = (callback: () => void) => {
      if (captureStart) triggerLongPress = callback;
      return value;
    };
    return value;
  };
  return {
    Gesture: {
      LongPress: () => chain(true),
      Pan: () => chain(),
      Simultaneous: () => ({}),
    },
    GestureDetector: ({ children }: { children: React.ReactNode }) => (
      ReactRuntime.createElement(View, null, children)
    ),
    gestureHandlerRootHOC: (component: React.ComponentType<unknown>) => component,
  };
});

jest.mock('react-native-reanimated', () => {
  const ReactRuntime = require('react');
  const { View } = require('react-native');
  const mutable = (value: unknown) => ({ value });
  return {
    __esModule: true,
    default: { View: (props: Record<string, unknown>) => ReactRuntime.createElement(View, props) },
    Easing: {
      cubic: 'cubic',
      quad: 'quad',
      out: (value: unknown) => value,
    },
    interpolate: (_value: unknown, _input: unknown, output: unknown[]) => output.at(-1),
    makeMutable: mutable,
    runOnJS: (callback: (...args: unknown[]) => unknown) => callback,
    useAnimatedStyle: (factory: () => unknown) => factory(),
    useSharedValue: mutable,
    withSpring: (value: unknown) => value,
    withTiming: (value: unknown, _config: unknown, callback?: (finished: boolean) => void) => {
      callback?.(true);
      return value;
    },
  };
});

jest.mock('lucide-react-native', () => {
  const ReactRuntime = require('react');
  const { View } = require('react-native');
  return {
    Download: (props: Record<string, unknown>) => ReactRuntime.createElement(View, props),
    X: (props: Record<string, unknown>) => ReactRuntime.createElement(View, props),
  };
});

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('../../theme', () => ({
  useAppTheme: () => ({
    theme: {
      colors: {
        inkSecondary: '#777',
      },
    },
  }),
}));

jest.mock('../../services/photo-library', () => ({
  saveImageUriToPhotoLibrary: jest.fn(),
}));

jest.mock('../ui', () => {
  const ReactRuntime = require('react');
  const { Pressable, View } = require('react-native');
  return {
    FloatingButton: (props: Record<string, unknown>) => ReactRuntime.createElement(Pressable, props),
    SettingsGroup: ({ children }: { children: React.ReactNode }) => (
      ReactRuntime.createElement(View, null, children)
    ),
    SettingsRow: ({ onPress, testID }: { onPress: () => void; testID: string }) => (
      ReactRuntime.createElement(Pressable, { onPress, testID })
    ),
    Sheet: ({ children, testID, visible }: {
      children: React.ReactNode;
      testID: string;
      visible: boolean;
    }) => visible ? ReactRuntime.createElement(View, { testID }, children) : null,
  };
});

describe('ImagePreviewModal image actions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    triggerLongPress = null;
    (saveImageUriToPhotoLibrary as jest.Mock).mockResolvedValue('saved');
  });

  it('opens an app-owned Sheet on long press and saves the selected image', async () => {
    const view = render(
      <ImagePreviewModal
        visible
        uris={['file://first.jpg', 'file://second.jpg']}
        index={1}
        screenWidth={390}
        screenHeight={844}
        insetsTop={24}
        insetsBottom={16}
        onClose={jest.fn()}
        onIndexChange={jest.fn()}
      />,
    );

    expect(triggerLongPress).toBeTruthy();
    act(() => triggerLongPress?.());
    expect(view.getByTestId('image-options-sheet')).toBeTruthy();
    expect(Alert.alert).not.toHaveBeenCalled();

    fireEvent.press(view.getByTestId('image-options-save'));
    await waitFor(() => expect(saveImageUriToPhotoLibrary).toHaveBeenCalledWith(
      'file://second.jpg',
      'chat-image',
    ));
    expect(view.queryByTestId('image-options-sheet')).toBeNull();
  });
});
