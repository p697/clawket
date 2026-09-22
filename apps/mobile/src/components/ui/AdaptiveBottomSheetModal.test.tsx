import React from 'react';
import { render } from '@testing-library/react-native';
import { Radius } from '../../theme/tokens';
import { AdaptiveBottomSheetModal } from './AdaptiveBottomSheetModal';

jest.mock('react-native', () => {
  const ReactRuntime = require('react');
  const primitive = (name: string) => ReactRuntime.forwardRef(
    ({ children, ...props }: { children?: React.ReactNode }, ref: React.Ref<unknown>) => (
      ReactRuntime.createElement(name, { ...props, ref }, children)
    ),
  );
  return {
    Platform: {
      OS: 'ios',
      isMacCatalyst: false,
      isPad: true,
      select: (options: Record<string, unknown>) => options.ios ?? options.default,
    },
    StyleSheet: {
      create: <T,>(styles: T) => styles,
      flatten: (style: unknown) => style,
      hairlineWidth: 1,
    },
    Text: primitive('Text'),
    View: primitive('View'),
    useWindowDimensions: () => ({ width: 1024, height: 1366, scale: 2, fontScale: 1 }),
  };
});

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 24, right: 0, bottom: 20, left: 0 }),
}));

jest.mock('../../utils/platform', () => ({ isIPad: true }));

jest.mock('@gorhom/bottom-sheet', () => {
  const ReactRuntime = require('react');
  return {
    BottomSheetModal: ReactRuntime.forwardRef(
      ({ children, ...props }: { children?: React.ReactNode }, ref: React.Ref<unknown>) => (
        ReactRuntime.createElement(
          'BottomSheetModal',
          { ...props, ref, testID: 'native-bottom-sheet' },
          children,
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

  it('turns the iPad presentation into a detached centered panel', () => {
    const result = render(
      <AdaptiveBottomSheetModal
        index={1}
        snapPoints={['58%', '92%']}
        enableDynamicSizing
        style={{ opacity: 0.9 }}
        backgroundStyle={{ backgroundColor: 'surface' }}
        containerStyle={{ opacity: 0.9 }}
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
      topInset: 323,
      bottomInset: 323,
    });
    expect(flattenStyle(nativeSheet.props.containerStyle)).toMatchObject({
      opacity: 0.9,
      marginHorizontal: 192,
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

  it('preserves caller geometry when iPad adaptation is disabled', () => {
    const result = render(
      <AdaptiveBottomSheetModal
        adaptiveIpad={false}
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
});
