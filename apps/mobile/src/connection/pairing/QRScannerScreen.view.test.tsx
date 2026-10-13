import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { QRScannerScreen } from './QRScannerScreen';
import { BorderWidth, ControlSize, PresentationColor, Space } from '../../theme/tokens';

let mockLocalFrame = { x: 0, y: 0, width: 390, height: 844 };
let mockLocalInsets = { top: 59, bottom: 34, left: 0, right: 0 };
let mockRTL = false;
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaFrame: () => mockLocalFrame,
  useSafeAreaInsets: () => mockLocalInsets,
}));

jest.mock('react-native', () => {
  const ReactRuntime = require('react');
  const host = (name: string) => ({ children, ...props }: Record<string, unknown> & { children?: React.ReactNode }) => (
    ReactRuntime.createElement(name, props, children)
  );
  return {
    Alert: { alert: jest.fn() },
    Platform: { OS: 'ios', select: (values: Record<string, unknown>) => values.ios ?? values.default },
    I18nManager: { get isRTL() { return mockRTL; } },
    ScrollView: host('ScrollView'),
    Pressable: host('Pressable'),
    StyleSheet: { create: <T,>(styles: T) => styles, absoluteFill: {}, hairlineWidth: 1 },
    Text: host('Text'),
    View: host('View'),
  };
});
jest.mock('expo-camera', () => ({ CameraView: () => null }));
jest.mock('./ScannerReservedRegions', () => ({
  hasScannerReservedRegions: true,
  ScannerReservedRegions: (props: Record<string, unknown>) => require('react').createElement('ReservedRegions', { ...props, testID: 'qr-scanner-reserved-regions' }),
}));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

type Style = Record<string, unknown> | null | undefined | false | Style[];
const flatten = (style: Style): Record<string, unknown> => (
  Array.isArray(style) ? Object.assign({}, ...style.map(flatten)) : style || {}
);

describe('QRScannerScreen', () => {
  beforeEach(() => {
    mockLocalFrame = { x: 0, y: 0, width: 390, height: 844 };
    mockLocalInsets = { top: 59, bottom: 34, left: 0, right: 0 };
    mockRTL = false;
  });
  it('offers Cancel as a filled media capsule with a full touch target and no outline', () => {
    const onCancel = jest.fn();
    const view = render(<QRScannerScreen onScanned={jest.fn()} onCancel={onCancel} />);
    const cancel = view.getByTestId('qr-scanner-cancel');
    const style = flatten(cancel.props.style({ pressed: false }));

    expect(cancel.props.accessibilityRole).toBe('button');
    expect(view.getByText('Cancel')).toBeTruthy();
    expect(style).toMatchObject({
      minHeight: ControlSize.floatingButton,
      backgroundColor: PresentationColor.mediaControl,
    });
    expect(style.borderWidth ?? 0).toBe(0);
    fireEvent.press(cancel);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('offers photos beside Cancel as the same capsule and hands over only once', () => {
    const onChoosePhoto = jest.fn();
    const onCancel = jest.fn();
    const view = render(<QRScannerScreen onScanned={jest.fn()} onCancel={onCancel} onChoosePhoto={onChoosePhoto} />);
    const photos = view.getByTestId('qr-scanner-photos');
    const cancel = view.getByTestId('qr-scanner-cancel');

    expect(photos.props.accessibilityRole).toBe('button');
    expect(view.getByText('Choose from photos')).toBeTruthy();
    expect(flatten(photos.props.style({ pressed: false }))).toEqual(flatten(cancel.props.style({ pressed: false })));
    fireEvent.press(photos);
    fireEvent.press(photos);
    expect(onChoosePhoto).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('shows no photo action when the opener cannot read one', () => {
    const view = render(<QRScannerScreen onScanned={jest.fn()} onCancel={jest.fn()} />);
    expect(view.queryByTestId('qr-scanner-photos')).toBeNull();
    expect(view.getByTestId('qr-scanner-cancel')).toBeTruthy();
  });

  it.each([
    { width: 951, height: 669, top: 0, bottom: 34, left: 0, right: 84 },
    { width: 669, height: 951, top: 84, bottom: 34, left: 0, right: 0 },
  ])('reserves a nonzero control viewport before and after natural measurement at $width × $height', ({ width, height, ...insets }) => {
    mockLocalFrame = { x: 0, y: 0, width, height };
    mockLocalInsets = insets;
    const view = render(<QRScannerScreen onScanned={jest.fn()} onCancel={jest.fn()} onChoosePhoto={jest.fn()} />);
    const bottomStyle = () => flatten(view.getByTestId('qr-scanner-controls-region').props.style);
    const assertBounds = () => {
      const bottom = bottomStyle();
      const scan = flatten(view.getByTestId('qr-scanner-frame').props.style);
      expect(Number.isFinite(bottom.height)).toBe(true);
      expect(Number(bottom.height) - Number(bottom.paddingTop) - Number(bottom.paddingBottom)).toBeGreaterThanOrEqual(76);
      expect(insets.top + Number(bottom.paddingTop) + Number(scan.height) + Number(bottom.height)).toBeLessThanOrEqual(height);
    };
    assertBounds();
    const measurement = { nativeEvent: { layout: { width: width - insets.left - insets.right, height: 76 } } };
    fireEvent(view.getByTestId('qr-scanner-controls'), 'layout', measurement);
    assertBounds();
    const measured = bottomStyle();
    fireEvent(view.getByTestId('qr-scanner-controls'), 'layout', measurement);
    expect(bottomStyle()).toEqual(measured);
    const corners = view.getByTestId('qr-scanner-frame').findAll(node => (node.type as unknown) === 'View'
      && flatten(node.props.style).borderWidth === BorderWidth.emphasis);
    expect(corners).toHaveLength(4);
    for (const corner of corners) expect(flatten(corner.props.style).borderColor).toBe(PresentationColor.onMedia);
  });

  it.each([false, true])('positions the scan frame inside physical asymmetric edges in RTL=%s', (rtl) => {
    mockRTL = rtl;
    mockLocalFrame = { x: 0, y: 0, width: 951, height: 669 };
    mockLocalInsets = { top: 0, bottom: 21, left: 84, right: 12 };
    const view = render(<QRScannerScreen onScanned={jest.fn()} onCancel={jest.fn()} onChoosePhoto={jest.fn()} />);
    const left = Number(flatten(view.getByTestId('qr-scanner-left-mask').props.style).width);
    const right = Number(flatten(view.getByTestId('qr-scanner-right-mask').props.style).width);
    expect(left).toBe(84 + (951 - 84 - 12 - 250) / 2);
    expect(left + 250 + right).toBe(951);
    expect(flatten(view.getByTestId('qr-scanner-mask-row').props.style).direction).toBe('ltr');
    const bottom = flatten(view.getByTestId('qr-scanner-controls-region').props.style);
    expect(bottom).toMatchObject({ paddingStart: rtl ? 12 : 84, paddingEnd: rtl ? 84 : 12, paddingBottom: 21 });
    expect(flatten(view.getByTestId('qr-scanner-photos').props.style({ pressed: false })).maxWidth).toBe('100%');
  });

  it('keeps controls scrollable with bounded spacing when the scan frame has no room', () => {
    mockLocalFrame = { x: 0, y: 0, width: 250, height: 140 };
    const view = render(<QRScannerScreen onScanned={jest.fn()} onCancel={jest.fn()} onChoosePhoto={jest.fn()} />);
    fireEvent(view.getByTestId('qr-scanner-controls'), 'layout', { nativeEvent: { layout: { width: 250, height: 180 } } });
    expect(flatten(view.getByTestId('qr-scanner-frame').props.style)).toMatchObject({ width: 0, height: 0 });
    const scroll = view.getByTestId('qr-scanner-controls-scroll');
    expect(flatten(scroll.props.style)).toMatchObject({ flexShrink: 1, minHeight: 0 });
    expect(Number(flatten(view.getByTestId('qr-scanner-controls-region').props.style).paddingTop)).toBeLessThan(Space.xl);
    const bottom = flatten(view.getByTestId('qr-scanner-controls-region').props.style);
    const viewport = Number(bottom.height) - Number(bottom.paddingTop) - Number(bottom.paddingBottom);
    expect(viewport).toBe(44);
    expect(viewport).toBeLessThan(180);
    expect(view.getByTestId('qr-scanner-photos')).toBeTruthy();
    expect(flatten(view.getByTestId('qr-scanner-cancel').props.style({ pressed: false })).minHeight).toBe(44);
  });

  it.each([false, true])('moves the frame and controls together for region-only changes, then restores them in RTL=%s', (rtl) => {
    mockRTL = rtl;
    mockLocalFrame = { x: 0, y: 0, width: 951, height: 669 };
    mockLocalInsets = { top: 0, bottom: 34, left: 0, right: 84 };
    const view = render(<QRScannerScreen onScanned={jest.fn()} onCancel={jest.fn()} onChoosePhoto={jest.fn()} />);
    const updateRegions = (regions: Array<{ x: number; y: number; width: number; height: number }>) => fireEvent(
      view.getByTestId('qr-scanner-reserved-regions'), 'regionsChange', { nativeEvent: { width: 951, height: 669, regions } },
    );
    const left = () => Number(flatten(view.getByTestId('qr-scanner-left-mask').props.style).width);
    updateRegions([]);
    expect(left()).toBe(308.5);
    updateRegions([{ x: 455.5, y: 0, width: 40, height: 669 }, { x: 867, y: 0, width: 84, height: 120 }]);
    expect(left()).toBe(102.75);
    expect(left() + 250).toBeLessThan(455.5);
    const bottom = flatten(view.getByTestId('qr-scanner-controls-region').props.style);
    expect(bottom).toMatchObject({ paddingStart: rtl ? 495.5 : 0, paddingEnd: rtl ? 0 : 495.5, paddingBottom: 34 });
    fireEvent(view.getByTestId('qr-scanner-controls'), 'layout', { nativeEvent: { layout: { width: 455.5, height: 76 } } });
    expect(Number(bottom.height) - Number(bottom.paddingTop) - Number(bottom.paddingBottom)).toBeGreaterThanOrEqual(76);
    updateRegions([]);
    expect(left()).toBe(308.5);
  });
});
