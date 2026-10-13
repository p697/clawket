import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert, I18nManager } from 'react-native';
import { Space } from '../../theme/tokens';
import { saveImageUriToPhotoLibrary } from '../../services/photo-library';
import { copyImageToClipboard } from '../../services/image-clipboard';
import { ImagePreviewModal } from './ImagePreviewModal';

let mockMetrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 24, bottom: 16, left: 0, right: 0 } };
let mockPublishMetrics = true;
let mockDeferTiming = false;
const mockTimingCompletions: Array<(finished: boolean) => void> = [];
let mockPanHandlers: Record<string, (...args: any[]) => void> = {};

jest.mock('../ui/PresentationSafeAreaProvider', () => ({
  PresentationSafeAreaProvider: ({ children, onMetrics }: React.PropsWithChildren<{ onMetrics: (metrics: unknown) => void }>) => {
    require('react').useLayoutEffect(() => { if (mockPublishMetrics) onMetrics(mockMetrics); }, [onMetrics, mockMetrics, mockPublishMetrics]);
    return children;
  },
}));

let triggerLongPress: (() => void) | null = null;

jest.mock('react-native', () => {
  const ReactRuntime = require('react');
  const primitive = (name: string) => ({ children, ...props }: Record<string, unknown>) => (
    ReactRuntime.createElement(name, props, children)
  );
  return {
    I18nManager: { isRTL: false },
    Platform: { OS: 'ios', select: (options: Record<string, unknown>) => options.ios ?? options.default },
    Alert: { alert: jest.fn() },
    StatusBar: { pushStackEntry: jest.fn((props: unknown) => ({ props })), popStackEntry: jest.fn() },
    Modal: primitive('Modal'),
    ActivityIndicator: primitive('ActivityIndicator'),
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
      value[method] = (callback: (...args: any[]) => void) => {
        if (!captureStart && method.startsWith('on')) mockPanHandlers[method] = callback;
        return value;
      };
    }
    value.onStart = (callback: () => void) => {
      if (captureStart) triggerLongPress = callback;
      else mockPanHandlers.onStart = callback;
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
    useAnimatedStyle: (factory: () => Record<string, unknown>) => new Proxy({}, { get: (_target, property: string) => factory()[property] }),
    cancelAnimation: jest.fn(),
    useSharedValue: (value: unknown) => ReactRuntime.useRef(mutable(value)).current,
    withSpring: (value: unknown) => value,
    withTiming: jest.fn((value: unknown, _config: unknown, callback?: (finished: boolean) => void) => {
      if (callback && mockDeferTiming) mockTimingCompletions.push(callback);
      else callback?.(true);
      return value;
    }),
  };
});

jest.mock('lucide-react-native', () => {
  const ReactRuntime = require('react');
  const { View } = require('react-native');
  return {
    Copy: (props: Record<string, unknown>) => ReactRuntime.createElement(View, props),
    Check: (props: Record<string, unknown>) => ReactRuntime.createElement(View, props),
    ZoomIn: (props: Record<string, unknown>) => ReactRuntime.createElement(View, props),
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

jest.mock('../../services/image-clipboard', () => ({ copyImageToClipboard: jest.fn() }));

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

beforeEach(() => {
  jest.clearAllMocks();
  triggerLongPress = null;
  mockMetrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 24, bottom: 16, left: 0, right: 0 } };
  mockPublishMetrics = true;
  mockDeferTiming = false;
  mockTimingCompletions.length = 0;
  mockPanHandlers = {};
  I18nManager.isRTL = false;
  (saveImageUriToPhotoLibrary as jest.Mock).mockResolvedValue('saved');
});

describe('ImagePreviewModal image actions', () => {


  it('opens an app-owned Sheet on long press and saves the selected image', async () => {
    const view = render(
      <ImagePreviewModal
        visible
        uris={['file://first.jpg', 'file://second.jpg']}
        index={1}
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

  it('gives the Android viewer light status bar icons before presenting its black window', () => {
    const { Platform, StatusBar } = require('react-native') as {
      Platform: { OS: string };
      StatusBar: { pushStackEntry: jest.Mock; popStackEntry: jest.Mock };
    };
    const frames: FrameRequestCallback[] = [];
    const originalRequest = global.requestAnimationFrame;
    const originalCancel = global.cancelAnimationFrame;
    global.requestAnimationFrame = ((callback: FrameRequestCallback) => frames.push(callback)) as typeof requestAnimationFrame;
    global.cancelAnimationFrame = jest.fn();
    Platform.OS = 'android';
    const props = {
      uris: ['file://first.jpg'], index: 0,
      onClose: jest.fn(), onIndexChange: jest.fn(),
    };
    try {
      const view = render(<ImagePreviewModal visible {...props} />);
      expect(StatusBar.pushStackEntry).toHaveBeenCalledWith({ barStyle: 'light-content', animated: false });
      expect(view.queryByTestId('image-preview-close')).toBeNull();
      act(() => { frames.splice(0).forEach((callback) => callback(0)); });
      expect(view.getByTestId('image-preview-close')).toBeTruthy();
      view.rerender(<ImagePreviewModal visible={false} {...props} />);
      expect(StatusBar.popStackEntry).toHaveBeenCalledWith(StatusBar.pushStackEntry.mock.results[0]?.value);
    } finally {
      Platform.OS = 'ios';
      global.requestAnimationFrame = originalRequest;
      global.cancelAnimationFrame = originalCancel;
    }
  });
});

const viewerProps = { uris: ['file://first.jpg', 'file://second.jpg'], index: 1, onClose: jest.fn(), onIndexChange: jest.fn() };
it('exposes copy and album save in the viewer and acts on the selected image', async () => {
  (copyImageToClipboard as jest.Mock).mockResolvedValue(undefined);
  const view = render(<ImagePreviewModal visible {...viewerProps} />);
  fireEvent.press(view.getByTestId('image-preview-copy'));
  await waitFor(() => expect(copyImageToClipboard).toHaveBeenCalledWith('file://second.jpg'));
  await waitFor(() => expect(view.getByText('Copied')).toBeTruthy());
  fireEvent.press(view.getByTestId('image-preview-save'));
  await waitFor(() => expect(view.getByText('Saved to Photos!')).toBeTruthy());
  expect(view.getByTestId('image-preview-zoom')).toBeTruthy();
});
it('blocks duplicate actions and ignores feedback after closing', async () => {
  jest.clearAllMocks();
  let finish!: () => void;
  (copyImageToClipboard as jest.Mock).mockReturnValueOnce(new Promise<void>(resolve => { finish = resolve; }));
  const view = render(<ImagePreviewModal visible {...viewerProps} />);
  fireEvent.press(view.getByTestId('image-preview-copy'));
  fireEvent.press(view.getByTestId('image-preview-copy'));
  expect(copyImageToClipboard).toHaveBeenCalledTimes(1);
  view.rerender(<ImagePreviewModal visible={false} {...viewerProps} />);
  await act(async () => finish());
  view.rerender(<ImagePreviewModal visible {...viewerProps} />);
  expect(view.queryByText('Copied')).toBeNull();
});

it.each([false, true])('keeps the selected zoom view and safe chrome across resize (RTL=%s)', (rtl) => {
  I18nManager.isRTL = rtl;
  const { ImageZoom } = require('@likashefqet/react-native-image-zoom');
  const { withTiming } = require('react-native-reanimated');
  const view = render(<ImagePreviewModal visible {...viewerProps} />);
  const selected = view.UNSAFE_getAllByType(ImageZoom)[1];
  selected.props.scale.value = 2.2;
  for (const [width, left, right] of [[720, 48, 0], [720, 0, 48], [390, 0, 0]]) {
    mockMetrics = { frame: { x: 0, y: 0, width, height: 700 }, insets: { top: 0, bottom: 24, left, right } };
    view.rerender(<ImagePreviewModal visible {...viewerProps} />);
    expect(view.UNSAFE_getAllByType(ImageZoom)[1]).toBe(selected);
    expect(selected.props.style.width).toBe(width);
    expect(selected.props.scale.value).toBe(2.2);
    const chrome = view.getByTestId('image-preview-chrome').props.style[1];
    expect(chrome.start).toBe((rtl ? right : left) + Space.lg);
    expect(chrome.end).toBe((rtl ? left : right) + Space.lg);
    expect(view.getByTestId('image-preview-viewport').props.style[0].direction).toBe('ltr');
    const pages = view.getByTestId('image-preview-pages').props.style;
    expect(pages[2].transform[0].translateX).toBe(-width);
  }
  expect(withTiming.mock.calls.filter(([value]: [number]) => value === 1)).toHaveLength(1);
  expect(viewerProps.onIndexChange).not.toHaveBeenCalled();
  expect(viewerProps.onClose).not.toHaveBeenCalled();
  act(() => triggerLongPress?.());
  expect(view.getByTestId('image-options-sheet')).toBeTruthy();
});

it('preserves an in-flight save across local geometry changes', async () => {
  let finish!: (value: string) => void;
  (saveImageUriToPhotoLibrary as jest.Mock).mockReturnValueOnce(new Promise<string>(resolve => { finish = resolve; }));
  const view = render(<ImagePreviewModal visible {...viewerProps} />);
  fireEvent.press(view.getByTestId('image-preview-save'));
  mockMetrics = { frame: { x: 0, y: 0, width: 720, height: 600 }, insets: { top: 0, bottom: 24, left: 48, right: 0 } };
  view.rerender(<ImagePreviewModal visible {...viewerProps} />);
  expect(view.getByTestId('image-preview-save').props.accessibilityState.busy).toBe(true);
  fireEvent.press(view.getByTestId('image-preview-save'));
  expect(saveImageUriToPhotoLibrary).toHaveBeenCalledTimes(1);
  await act(async () => { finish('saved'); });
  expect(view.getByText('Saved to Photos!')).toBeTruthy();
});

it('ignores old drag tail events after A-B-A resize and accepts a fresh gesture', () => {
  const view = render(<ImagePreviewModal visible {...viewerProps} />);
  const oldHandlers = { ...mockPanHandlers };
  act(() => {
    oldHandlers.onStart();
    oldHandlers.onUpdate({ translationX: 200, translationY: 0 });
  });
  const initial = mockMetrics;
  mockMetrics = { ...initial, frame: { ...initial.frame, width: 720 } };
  view.rerender(<ImagePreviewModal visible {...viewerProps} />);
  mockMetrics = initial;
  view.rerender(<ImagePreviewModal visible {...viewerProps} />);
  const end = { translationX: 200, translationY: 0, velocityX: 1200, velocityY: 0 };
  act(() => {
    oldHandlers.onUpdate(end);
    oldHandlers.onEnd(end);
    oldHandlers.onFinalize();
    mockPanHandlers.onEnd(end);
    mockPanHandlers.onFinalize();
  });
  expect(viewerProps.onIndexChange).not.toHaveBeenCalled();
  expect(viewerProps.onClose).not.toHaveBeenCalled();
  act(() => {
    mockPanHandlers.onStart();
    mockPanHandlers.onUpdate(end);
    mockPanHandlers.onEnd(end);
  });
  expect(viewerProps.onIndexChange).toHaveBeenCalledWith(0);
});

it('finishes one close without restarting the entrance when its window changes', () => {
  mockDeferTiming = true;
  const { withTiming } = require('react-native-reanimated');
  const view = render(<ImagePreviewModal visible {...viewerProps} />);
  fireEvent.press(view.getByTestId('image-preview-close'));
  mockMetrics = { ...mockMetrics, frame: { ...mockMetrics.frame, width: 720 } };
  view.rerender(<ImagePreviewModal visible {...viewerProps} />);
  expect(withTiming.mock.calls.filter(([value]: [number]) => value === 1)).toHaveLength(1);
  expect(mockTimingCompletions).toHaveLength(1);
  act(() => { mockTimingCompletions[0](true); mockTimingCompletions[0](true); });
  expect(viewerProps.onClose).toHaveBeenCalledTimes(1);
});

it('honors a system close before the first local measurement arrives', () => {
  mockPublishMetrics = false;
  const { withTiming } = require('react-native-reanimated');
  const view = render(<ImagePreviewModal visible {...viewerProps} />);
  expect(view.queryByTestId('image-preview-close')).toBeNull();
  fireEvent(view.getByTestId('image-preview-modal'), 'requestClose');
  expect(viewerProps.onClose).toHaveBeenCalledTimes(1);
  mockPublishMetrics = true;
  view.rerender(<ImagePreviewModal visible {...viewerProps} />);
  expect(withTiming.mock.calls.filter(([value]: [number]) => value === 1)).toHaveLength(0);
  expect(viewerProps.onClose).toHaveBeenCalledTimes(1);
});


it('waits for fresh metrics when reopening at another image and saves that selection', async () => {
  const { withTiming } = require('react-native-reanimated');
  const view = render(<ImagePreviewModal visible {...viewerProps} />);
  fireEvent.press(view.getByTestId('image-preview-close'));
  view.rerender(<ImagePreviewModal visible={false} {...viewerProps} />);
  mockPublishMetrics = false;
  view.rerender(<ImagePreviewModal visible {...viewerProps} index={0} />);
  expect(view.queryByTestId('image-preview-pages')).toBeNull();
  expect(withTiming.mock.calls.filter(([value]: [number]) => value === 1)).toHaveLength(1);
  mockMetrics = { frame: { x: 0, y: 0, width: 720, height: 600 }, insets: { top: 0, bottom: 24, left: 48, right: 0 } };
  mockPublishMetrics = true;
  view.rerender(<ImagePreviewModal visible {...viewerProps} index={0} />);
  expect(view.getByTestId('image-preview-pages').props.style[2].transform[0].translateX).toBe(-0);
  expect(withTiming.mock.calls.filter(([value]: [number]) => value === 1)).toHaveLength(2);
  fireEvent.press(view.getByTestId('image-preview-save'));
  await waitFor(() => expect(view.getByText('Saved to Photos!')).toBeTruthy());
  expect(saveImageUriToPhotoLibrary).toHaveBeenCalledWith('file://first.jpg', 'chat-image');
  expect(viewerProps.onClose).toHaveBeenCalledTimes(1);
});
