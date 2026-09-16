import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { Sheet } from './Sheet';
import { Space } from '../../theme/tokens';

jest.mock('react-native', () => {
  const ReactRuntime = require('react');
  const host = (name: string) => ({ children, ...props }: Record<string, unknown>) => (
    ReactRuntime.createElement(name, props, children)
  );
  return {
    StyleSheet: { create: <T,>(styles: T) => styles, flatten: (style: unknown) => style, hairlineWidth: 1 },
    Text: host('Text'),
    View: host('View'),
    useWindowDimensions: () => ({ width: 390, height: 844, scale: 3, fontScale: 1 }),
  };
});

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 59, bottom: 34, left: 0, right: 0 }),
}));

// Mirrors gorhom's contract: the container renders `footerComponent` with the
// animated position, and `BottomSheetFooter` is the absolutely pinned wrapper.
jest.mock('@gorhom/bottom-sheet', () => {
  const ReactRuntime = require('react');
  const { View } = require('react-native');
  return {
    BottomSheetFooter: ({ children, style }: { children: React.ReactNode; style: unknown }) => (
      ReactRuntime.createElement(View, { testID: 'gorhom-footer', style }, children)
    ),
    BottomSheetFooterContainer: ({ footerComponent: FooterComponent }: { footerComponent: React.ComponentType<{ animatedFooterPosition: { value: number } }> }) => (
      ReactRuntime.createElement(FooterComponent, { animatedFooterPosition: { value: 0 } })
    ),
    BottomSheetView: ({ children, ...props }: { children: React.ReactNode }) => ReactRuntime.createElement(View, props, children),
  };
});

jest.mock('./AdaptiveBottomSheetModal', () => {
  const ReactRuntime = require('react');
  const { View } = require('react-native');
  return {
    AdaptiveBottomSheetModal: ReactRuntime.forwardRef(function AdaptiveBottomSheetModal(
      { children }: { children: React.ReactNode },
      ref: React.Ref<{ present: () => void; dismiss: () => void }>,
    ) {
      ReactRuntime.useImperativeHandle(ref, () => ({ present: jest.fn(), dismiss: jest.fn() }));
      return ReactRuntime.createElement(View, { testID: 'modal' }, children);
    }),
  };
});

jest.mock('./SheetBackdrop', () => ({ SheetBackdrop: () => null }));
jest.mock('./SheetHeader', () => {
  const ReactRuntime = require('react');
  const { View } = require('react-native');
  return {
    SheetDragHandle: () => null,
    SheetHeader: () => ReactRuntime.createElement(View, { testID: 'header' }),
    useSheetBackgroundStyle: () => ({}),
  };
});
jest.mock('./ThemedFullWindowOverlay', () => ({ ThemedFullWindowOverlay: ({ children }: { children: React.ReactNode }) => children }));
jest.mock('../../utils/platform', () => ({ isIPad: false }));
jest.mock('../../utils/ipad-layout', () => ({ getIpadModalSheetMetrics: () => ({ height: 0 }) }));
jest.mock('../../theme', () => ({
  useAppTheme: () => ({ theme: { colors: { canvas: '#ffffff' } } }),
}));

const flatten = (style: unknown): Record<string, unknown> => Object.assign(
  {},
  ...([style].flat(Infinity) as unknown[]).filter((entry): entry is Record<string, unknown> => Boolean(entry)),
);

function renderSheet(footer?: React.ReactNode) {
  const { Text } = require('react-native');
  return render(
    <Sheet
      visible
      onClose={jest.fn()}
      closeAccessibilityLabel="Close"
      title="Add"
      snapPoints={['62%', '92%']}
      footer={footer}
      testID="sheet"
    >
      <Text testID="body-content">body</Text>
    </Sheet>,
  );
}

describe('Sheet footer', () => {
  it('pins the footer beside the body and reserves its measured height above the safe area', () => {
    const { Text } = require('react-native');
    const view = renderSheet(<Text testID="cta">Attach 2 photos</Text>);

    // Queries skip elements VoiceOver would ignore, so finding the footer also
    // proves it sits inside the `accessibilityViewIsModal` view, beside the body.
    const footer = view.getByTestId('sheet-footer');
    expect(footer.findByProps({ testID: 'cta' })).toBeTruthy();
    expect(view.getByTestId('sheet-body').findAllByProps({ testID: 'sheet-footer' })).toHaveLength(0);
    expect(flatten(view.getByTestId('gorhom-footer').props.style)).toMatchObject({
      paddingHorizontal: Space.lg,
      paddingTop: Space.sm,
      paddingBottom: 34,
      backgroundColor: '#ffffff',
    });

    expect(flatten(view.getByTestId('sheet-body').props.style).paddingBottom).toBe(Space.sm);
    fireEvent(footer, 'layout', { nativeEvent: { layout: { height: 48 } } });
    expect(flatten(view.getByTestId('sheet-body').props.style).paddingBottom).toBe(48 + Space.sm);
  });

  it('renders no footer chrome and reserves nothing without a footer', () => {
    const view = renderSheet();
    expect(view.queryByTestId('sheet-footer')).toBeNull();
    expect(view.queryByTestId('gorhom-footer')).toBeNull();
    expect(flatten(view.getByTestId('sheet-body').props.style).paddingBottom).toBeUndefined();
  });
});
