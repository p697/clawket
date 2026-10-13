import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { I18nManager, Pressable, Text } from 'react-native';
import { Radius } from '../../theme/tokens';
import { AdaptiveBottomSheetModal } from './AdaptiveBottomSheetModal';

let mockPlatform = 'ios';
let mockDimensions = { width: 1024, height: 1366, scale: 2, fontScale: 1 };
let mockInsets = { top: 24, right: 0, bottom: 20, left: 0 };

jest.mock('react-native', () => {
  const ReactRuntime = require('react');
  const primitive = (name: string) => ReactRuntime.forwardRef(
    ({ children, ...props }: { children?: React.ReactNode }, ref: React.Ref<unknown>) => (
      ReactRuntime.createElement(name, { ...props, ref }, children)
    ),
  );
  return {
    I18nManager: { isRTL: false },
    Platform: {
      OS: 'ios',
      isMacCatalyst: false,
      isPad: false,
      select: (options: Record<string, unknown>) => options.ios ?? options.default,
    },
    StyleSheet: {
      create: <T,>(styles: T) => styles,
      flatten: (style: unknown) => style,
      hairlineWidth: 1,
    },
    Text: primitive('Text'),
    Pressable: primitive('Pressable'),
    View: primitive('View'),
    useWindowDimensions: () => mockDimensions,
  };
});

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => mockInsets,
}));

jest.mock('../../utils/platform', () => ({ getRuntimePlatform: () => mockPlatform }));
jest.mock('./PresentationSafeAreaProvider', () => {
  const ReactRuntime = require('react');
  return { PresentationSafeAreaProvider: ({ children, ...props }: React.PropsWithChildren) => ReactRuntime.createElement('Presentation', { ...props, testID: 'presentation' }, children) };
});

jest.mock('@gorhom/bottom-sheet', () => {
  const ReactRuntime = require('react');
  return {
    BottomSheetModal: ReactRuntime.forwardRef(
      ({ children, ...props }: { children?: React.ReactNode; containerComponent?: React.ComponentType<React.PropsWithChildren> }, ref: React.Ref<unknown>) => (
        ReactRuntime.createElement(
          props.containerComponent ?? ReactRuntime.Fragment,
          null,
          ReactRuntime.createElement('BottomSheetModal', { ...props, ref, testID: 'native-bottom-sheet' }, children),
        )
      ),
    ),
  };
});

function flattenStyle(style: unknown): Record<string, unknown> {
  return (Array.isArray(style) ? style : [style]).reduce<Record<string, unknown>>(
    (result, value) => (
      value && typeof value === 'object' ? { ...result, ...value } : result
    ),
    {},
  );
}

describe('AdaptiveBottomSheetModal', () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    mockPlatform = 'ios';
    I18nManager.isRTL = false;
    mockDimensions = { width: 1024, height: 1366, scale: 2, fontScale: 1 };
    mockInsets = { top: 24, right: 0, bottom: 20, left: 0 };
  });

  beforeAll(() => {
    const originalConsoleError = console.error;
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation((message?: unknown, ...rest: unknown[]) => {
      if (typeof message === 'string' && message.includes('react-test-renderer is deprecated')) return;
      originalConsoleError(message, ...rest);
    });
  });

  afterAll(() => {
    consoleErrorSpy.mockRestore();
  });

  it('turns the wide iPhone presentation into a detached centered panel', () => {
    const result = render(
      <AdaptiveBottomSheetModal
        index={1}
        snapPoints={['58%', '92%']}
        enableDynamicSizing
        style={{ opacity: 0.9 }}
        backgroundStyle={{ backgroundColor: 'surface' }}
        containerStyle={{ opacity: 0.9, marginLeft: 7, marginRight: 9 }}
      >
        <></>
      </AdaptiveBottomSheetModal>,
    );
    const nativeSheet = result.getByTestId('native-bottom-sheet');

    expect(nativeSheet.props).toMatchObject({
      detached: true,
      enableDynamicSizing: false,
      index: 0,
      snapPoints: [720],
      topInset: 325,
      bottomInset: 321,
    });
    expect(flattenStyle(nativeSheet.props.containerStyle)).toMatchObject({
      opacity: 0.9,
      marginLeft: undefined,
      marginRight: undefined,
      marginStart: 192,
      marginEnd: 192,
    });
    expect(flattenStyle(nativeSheet.props.backgroundStyle)).toMatchObject({
      backgroundColor: 'surface',
      overflow: 'hidden',
      borderBottomLeftRadius: Radius.bottomSheet,
      borderBottomRightRadius: Radius.bottomSheet,
    });
    expect(flattenStyle(nativeSheet.props.style)).toMatchObject({
      opacity: 0.9,
      overflow: 'hidden',
      borderRadius: Radius.bottomSheet,
    });
  });

  it('preserves caller geometry when adaptation is disabled', () => {
    const result = render(
      <AdaptiveBottomSheetModal
        adaptive={false}
        index={1}
        snapPoints={['58%', '92%']}
        enableDynamicSizing={false}
        topInset={12}
        bottomInset={8}
        style={{ opacity: 0.8 }}
      >
        <></>
      </AdaptiveBottomSheetModal>,
    );
    expect(result.getByTestId('native-bottom-sheet').props).toMatchObject({
      detached: undefined,
      enableDynamicSizing: false,
      index: 1,
      snapPoints: ['58%', '92%'],
      topInset: 12,
      bottomInset: 8,
      style: { opacity: 0.8 },
    });
  });

  it('uses local presentation metrics over underlying pane geometry without replacing content', () => {
    mockDimensions = { ...mockDimensions, width: 390, height: 844 };
    const mounted = jest.fn();
    const unmounted = jest.fn();
    const onMetrics = jest.fn();
    function Content() {
      const [draft, setDraft] = React.useState('');
      React.useEffect(() => { mounted(); return unmounted; }, []);
      return <><Text testID="local-draft">{draft}</Text><Pressable testID="local-type" onPress={() => setDraft('中文草稿')} /></>;
    }
    const view = render(<AdaptiveBottomSheetModal preferredHeight={300} onPresentationMetrics={onMetrics}><Content /></AdaptiveBottomSheetModal>);
    const container = view.getByTestId('native-bottom-sheet').props.containerComponent;
    fireEvent.press(view.getByTestId('local-type'));
    const local = { frame: { x: 0, y: 0, width: 951, height: 669 }, insets: { top: 0, left: 0, right: 84, bottom: 34 } };
    fireEvent(view.getByTestId('presentation'), 'metrics', local);
    expect(view.getByTestId('native-bottom-sheet').props).toMatchObject({ snapPoints: [300], topInset: 167, bottomInset: 202, containerComponent: container });
    expect(onMetrics).toHaveBeenCalledWith(local);
    fireEvent(view.getByTestId('presentation'), 'metrics', { ...local, frame: { ...local.frame, width: 466, height: 678 } });
    expect(view.getByTestId('native-bottom-sheet').props.detached).toBeUndefined();
    expect(view.getByTestId('local-draft').props.children).toBe('中文草稿');
    expect(mounted).toHaveBeenCalledTimes(1);
    expect(unmounted).not.toHaveBeenCalled();
  });

  it.each(['android', 'macos'])('preserves the caller presentation on %s', platform => {
    mockPlatform = platform;
    const result = render(<AdaptiveBottomSheetModal index={1} snapPoints={['58%']}><></></AdaptiveBottomSheetModal>);
    expect(result.getByTestId('native-bottom-sheet').props).toMatchObject({ index: 1, snapPoints: ['58%'], detached: undefined });
  });

  it('uses available width for an inset-only change between centered and compact presentations', () => {
    mockDimensions = { ...mockDimensions, width: 650 };
    const result = render(<AdaptiveBottomSheetModal index={1} snapPoints={['58%']}><></></AdaptiveBottomSheetModal>);
    expect(result.getByTestId('native-bottom-sheet').props.detached).toBe(true);
    mockInsets = { ...mockInsets, left: 40, right: 20 };
    result.rerender(<AdaptiveBottomSheetModal index={1} snapPoints={['58%']}><></></AdaptiveBottomSheetModal>);
    expect(result.getByTestId('native-bottom-sheet').props).toMatchObject({ index: 1, snapPoints: ['58%'], detached: undefined });
  });

  it.each([false, true])('preserves physical insets and editing through edge and presentation changes (RTL=%s)', rtl => {
    I18nManager.isRTL = rtl;
    const mounted = jest.fn();
    const unmounted = jest.fn();
    const onDismiss = jest.fn();
    function Content() {
      const [draft, setDraft] = React.useState('');
      React.useEffect(() => { mounted(); return unmounted; }, []);
      return <><Text testID="draft">{draft}</Text><Pressable testID="type" onPress={() => setDraft('保留草稿')} /></>;
    }
    const sheet = () => <AdaptiveBottomSheetModal onDismiss={onDismiss} index={1} snapPoints={['58%', '92%']}><Content /></AdaptiveBottomSheetModal>;
    mockDimensions = { ...mockDimensions, width: 744, height: 960 };
    mockInsets = { top: 62, bottom: 34, left: 64, right: 24 };
    const result = render(sheet());
    fireEvent.press(result.getByTestId('type'));
    expect(flattenStyle(result.getByTestId('native-bottom-sheet').props.containerStyle)).toMatchObject({ marginStart: rtl ? 48 : 88, marginEnd: rtl ? 88 : 48 });

    mockInsets = { ...mockInsets, left: 24, right: 64 };
    result.rerender(sheet());
    expect(flattenStyle(result.getByTestId('native-bottom-sheet').props.containerStyle)).toMatchObject({ marginStart: rtl ? 88 : 48, marginEnd: rtl ? 48 : 88 });

    mockDimensions = { ...mockDimensions, width: 390 };
    result.rerender(sheet());
    expect(result.getByTestId('native-bottom-sheet').props).toMatchObject({ index: 1, snapPoints: ['58%', '92%'] });
    expect(flattenStyle(result.getByTestId('native-bottom-sheet').props.containerStyle)).toMatchObject({ marginStart: rtl ? 64 : 24, marginEnd: rtl ? 24 : 64 });
    mockInsets = { ...mockInsets, left: 84, right: 0 };
    result.rerender(sheet());
    expect(flattenStyle(result.getByTestId('native-bottom-sheet').props.containerStyle)).toMatchObject({ marginStart: rtl ? 0 : 84, marginEnd: rtl ? 84 : 0 });
    mockDimensions = { ...mockDimensions, width: 744 };
    result.rerender(sheet());
    expect(result.getByTestId('draft').props.children).toBe('保留草稿');
    expect(mounted).toHaveBeenCalledTimes(1);
    expect(unmounted).not.toHaveBeenCalled();
    expect(onDismiss).not.toHaveBeenCalled();
  });
});
