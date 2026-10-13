import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { Alert, StyleSheet, View } from 'react-native';
import { CameraView, type BarcodeScanningResult } from 'expo-camera';
import { QRScannerScreen } from './QRScannerScreen';

const mockMeasureLayout = jest.fn();

let mockLocalFrame = { x: 0, y: 0, width: 390, height: 844 };
let mockLocalInsets = { top: 59, bottom: 34, left: 0, right: 0 };
let mockRTL = false;
let mockHasRegions = false;
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaFrame: () => mockLocalFrame,
  useSafeAreaInsets: () => mockLocalInsets,
}));

jest.mock('react-native', () => {
  const ReactRuntime = require('react');
  const primitive = (name: string) => ({ children, ...props }: Record<string, unknown>) => (
    ReactRuntime.createElement(name, props, children)
  );
  return {
    ...jest.requireActual('../../../__mocks__/react-native'),
    View: ReactRuntime.forwardRef(({ children, ...props }: Record<string, unknown>, ref: unknown) => {
      ReactRuntime.useImperativeHandle(ref, () => ({ measureLayout: mockMeasureLayout }));
      return ReactRuntime.createElement('View', props, children);
    }),
    Text: primitive('Text'),
    I18nManager: { get isRTL() { return mockRTL; } },
    ScrollView: primitive('ScrollView'),
    Pressable: primitive('Pressable'),
    StyleSheet: {
      create: <T,>(styles: T) => styles,
      absoluteFill: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
      flatten: (style: unknown) => Array.isArray(style) ? Object.assign({}, ...style) : style,
    },
  };
});
jest.mock('expo-camera', () => ({ CameraView: 'CameraView' }));
jest.mock('./ScannerReservedRegions', () => ({
  get hasScannerReservedRegions() { return mockHasRegions; },
  ScannerReservedRegions: (props: Record<string, unknown>) => require('react').createElement('ReservedRegions', { ...props, testID: 'qr-scanner-reserved-regions' }),
}));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('../../theme', () => ({ useAppTheme: () => ({ theme: { colors: { accent: '#123456' } } }) }));

const productionCodex = JSON.stringify({ v: 2, k: 'cp', b: 'codex', s: 'https://clawket-codex-registry.clawket.workers.dev', g: 'synthetic', a: 'synthetic' });
const previewOpenClaw = JSON.stringify({ v: 2, k: 'cp', s: 'https://clawket-registry-preview.clawket.workers.dev', g: 'synthetic', a: 'synthetic' });
const frame = { x: 70, y: 309.5, width: 250, height: 250 };

function barcode(data: string, x = 90, y = 330): BarcodeScanningResult {
  return {
    type: 'qr', data,
    cornerPoints: [{ x, y }, { x: x + 100, y }, { x: x + 100, y: y + 100 }, { x, y: y + 100 }],
    bounds: { origin: { x, y }, size: { width: 100, height: 100 } },
  };
}

function measure(view: ReturnType<typeof render>) {
  const area = view.getByTestId('qr-scanner-frame');
  act(() => area.props.onLayout?.({ nativeEvent: { layout: frame } }));
}

function emit(view: ReturnType<typeof render>, result: BarcodeScanningResult) {
  act(() => view.UNSAFE_getByType(CameraView).props.onBarcodeScanned?.(result));
}

beforeEach(() => {
  jest.clearAllMocks();
  mockLocalFrame = { x: 0, y: 0, width: 390, height: 844 };
  mockLocalInsets = { top: 59, bottom: 34, left: 0, right: 0 };
  mockRTL = false;
  mockHasRegions = false;
  mockMeasureLayout.mockImplementation((_parent, success) => success(frame.x, frame.y, frame.width, frame.height));
});

it('ignores a Preview QR outside the frame and delivers the centred Production Codex QR', () => {
  const onScanned = jest.fn();
  const view = render(<QRScannerScreen onScanned={onScanned} onCancel={jest.fn()} />);
  measure(view);
  emit(view, barcode(previewOpenClaw, 5, 30));
  expect(onScanned).not.toHaveBeenCalled();
  emit(view, barcode(productionCodex));
  expect(onScanned).toHaveBeenCalledTimes(1);
  expect(onScanned.mock.calls[0][0]).toMatchObject({ backendKind: 'codex', relay: { serverUrl: 'https://clawket-codex-registry.clawket.workers.dev' } });
});

it('does not suppress the same QR when it moves from outside into the frame', () => {
  const onScanned = jest.fn();
  const view = render(<QRScannerScreen onScanned={onScanned} onCancel={jest.fn()} />);
  measure(view);
  emit(view, barcode(productionCodex, 5, 30));
  expect(onScanned).not.toHaveBeenCalled();
  emit(view, barcode(productionCodex));
  expect(onScanned).toHaveBeenCalledTimes(1);
});

it('waits for a measured frame before accepting camera events', () => {
  mockMeasureLayout.mockImplementationOnce(() => {});
  const onScanned = jest.fn();
  const view = render(<QRScannerScreen onScanned={onScanned} onCancel={jest.fn()} />);
  emit(view, barcode(productionCodex));
  expect(onScanned).not.toHaveBeenCalled();
  measure(view);
  emit(view, barcode(productionCodex));
  expect(onScanned).toHaveBeenCalledTimes(1);
});

it('ignores invalid QR data outside the frame without showing an alert', () => {
  const view = render(<QRScannerScreen onScanned={jest.fn()} onCancel={jest.fn()} />);
  measure(view);
  emit(view, barcode('not a pairing code', 5, 30));
  expect(Alert.alert).not.toHaveBeenCalled();
});

it('retains the invalid QR retry inside the frame', () => {
  const onScanned = jest.fn();
  const view = render(<QRScannerScreen onScanned={onScanned} onCancel={jest.fn()} />);
  measure(view);
  emit(view, barcode('not a pairing code'));
  expect(Alert.alert).toHaveBeenCalledTimes(1);
  emit(view, barcode('another invalid code'));
  emit(view, barcode(productionCodex));
  expect(Alert.alert).toHaveBeenCalledTimes(1);
  expect(onScanned).not.toHaveBeenCalled();
  const retry = (Alert.alert as jest.Mock).mock.calls[0][2][0].onPress;
  act(retry);
  emit(view, barcode(productionCodex));
  expect(onScanned).toHaveBeenCalledTimes(1);
});

it('does not resume a cancelled scanner from a delayed invalid-QR retry', () => {
  const onScanned = jest.fn();
  const view = render(<QRScannerScreen onScanned={onScanned} onCancel={jest.fn()} />);
  measure(view);
  emit(view, barcode('not a pairing code'));
  const retry = (Alert.alert as jest.Mock).mock.calls[0][2][0].onPress;
  fireEvent.press(view.getByTestId('qr-scanner-cancel'));
  measure(view);
  act(retry);
  emit(view, barcode(productionCodex));
  expect(onScanned).not.toHaveBeenCalled();
});

it('accepts a bounded result when native corner points are unavailable', () => {
  const onScanned = jest.fn();
  const view = render(<QRScannerScreen onScanned={onScanned} onCancel={jest.fn()} />);
  measure(view);
  emit(view, { ...barcode(productionCodex), cornerPoints: [] });
  expect(onScanned).toHaveBeenCalledTimes(1);
});

it('uses the displayed-frame coordinates after a new layout', () => {
  const onScanned = jest.fn();
  const view = render(<QRScannerScreen onScanned={onScanned} onCancel={jest.fn()} />);
  measure(view);
  mockLocalFrame = { x: 0, y: 0, width: 740, height: 380 };
  mockLocalInsets = { top: 0, bottom: 0, left: 0, right: 0 };
  mockMeasureLayout.mockImplementation((_parent, success) => success(245, 65, 250, 250));
  view.rerender(<QRScannerScreen onScanned={onScanned} onCancel={jest.fn()} />);
  measure(view);
  emit(view, barcode(productionCodex));
  expect(onScanned).not.toHaveBeenCalled();
  emit(view, barcode(productionCodex, 270, 90));
  expect(onScanned).toHaveBeenCalledTimes(1);
});

it('ignores a late measurement from an older layout', () => {
  const onScanned = jest.fn();
  const view = render(<QRScannerScreen onScanned={onScanned} onCancel={jest.fn()} />);
  let staleMeasurement!: (...values: number[]) => void;
  mockMeasureLayout.mockImplementationOnce((_parent, success) => { staleMeasurement = success; });
  measure(view);
  mockLocalFrame = { x: 0, y: 0, width: 740, height: 380 };
  mockLocalInsets = { top: 0, bottom: 0, left: 0, right: 0 };
  mockMeasureLayout.mockImplementation((_parent, success) => success(245, 65, 250, 250));
  view.rerender(<QRScannerScreen onScanned={onScanned} onCancel={jest.fn()} />);
  measure(view);
  act(() => staleMeasurement(65, 245, 250, 250));
  emit(view, barcode(productionCodex));
  expect(onScanned).not.toHaveBeenCalled();
  emit(view, barcode(productionCodex, 270, 90));
  expect(onScanned).toHaveBeenCalledTimes(1);
});

it('delivers only one QR from a synchronous native event burst', () => {
  const onScanned = jest.fn();
  const view = render(<QRScannerScreen onScanned={onScanned} onCancel={jest.fn()} />);
  measure(view);
  const callback = view.UNSAFE_getByType(CameraView).props.onBarcodeScanned;
  act(() => { callback(barcode(productionCodex)); callback(barcode(previewOpenClaw)); });
  expect(onScanned).toHaveBeenCalledTimes(1);
});

it('ignores buffered native results after cancel', () => {
  const onScanned = jest.fn();
  const onCancel = jest.fn();
  const view = render(<QRScannerScreen onScanned={onScanned} onCancel={onCancel} />);
  measure(view);
  const callback = view.UNSAFE_getByType(CameraView).props.onBarcodeScanned;
  fireEvent.press(view.getByTestId('qr-scanner-cancel'));
  act(() => callback(barcode(productionCodex)));
  expect(onCancel).toHaveBeenCalledTimes(1);
  expect(onScanned).not.toHaveBeenCalled();
});

it('ignores buffered native results after choosing a photo', () => {
  const onScanned = jest.fn();
  const onChoosePhoto = jest.fn();
  const view = render(<QRScannerScreen onScanned={onScanned} onCancel={jest.fn()} onChoosePhoto={onChoosePhoto} />);
  measure(view);
  const callback = view.UNSAFE_getByType(CameraView).props.onBarcodeScanned;
  fireEvent.press(view.getByTestId('qr-scanner-photos'));
  act(() => callback(barcode(productionCodex)));
  expect(onChoosePhoto).toHaveBeenCalledTimes(1);
  expect(onScanned).not.toHaveBeenCalled();
});

it('does not open the library once a QR has been delivered', () => {
  const onScanned = jest.fn();
  const onChoosePhoto = jest.fn();
  const view = render(<QRScannerScreen onScanned={onScanned} onCancel={jest.fn()} onChoosePhoto={onChoosePhoto} />);
  measure(view);
  emit(view, barcode(productionCodex));
  fireEvent.press(view.getByTestId('qr-scanner-photos'));
  expect(onScanned).toHaveBeenCalledTimes(1);
  expect(onChoosePhoto).not.toHaveBeenCalled();
});

it('lets photos replace an open invalid-QR retry without resuming the camera', () => {
  const onScanned = jest.fn();
  const onChoosePhoto = jest.fn();
  const view = render(<QRScannerScreen onScanned={onScanned} onCancel={jest.fn()} onChoosePhoto={onChoosePhoto} />);
  measure(view);
  emit(view, barcode('not a pairing code'));
  const retry = (Alert.alert as jest.Mock).mock.calls[0][2][0].onPress;
  fireEvent.press(view.getByTestId('qr-scanner-photos'));
  act(retry);
  emit(view, barcode(productionCodex));
  expect(onChoosePhoto).toHaveBeenCalledTimes(1);
  expect(onScanned).not.toHaveBeenCalled();
});

it('ignores buffered native results after the scanner unmounts', () => {
  const onScanned = jest.fn();
  const view = render(<QRScannerScreen onScanned={onScanned} onCancel={jest.fn()} />);
  measure(view);
  const callback = view.UNSAFE_getByType(CameraView).props.onBarcodeScanned;
  view.unmount();
  act(() => callback(barcode(productionCodex)));
  expect(onScanned).not.toHaveBeenCalled();
});

it('remeasures inset-only changes without replacing the camera or accepting an old measurement', () => {
  const onScanned = jest.fn();
  const props = { onScanned, onCancel: jest.fn() };
  const view = render(<QRScannerScreen {...props} />);
  const camera = view.UNSAFE_getByType(CameraView);
  let stale!: (...values: number[]) => void;
  mockMeasureLayout.mockImplementationOnce((_parent, success) => { stale = success; });
  measure(view);
  let current!: (...values: number[]) => void;
  mockMeasureLayout.mockImplementationOnce((_parent, success) => { current = success; });
  mockLocalInsets = { ...mockLocalInsets, left: 24 };
  view.rerender(<QRScannerScreen {...props} />);
  expect(view.UNSAFE_getByType(CameraView)).toBe(camera);
  expect(current).toBeDefined();
  act(() => stale(frame.x, frame.y, 250, 250));
  emit(view, barcode(productionCodex));
  expect(onScanned).not.toHaveBeenCalled();
  act(() => current(82, 309.5, 250, 250));
  emit(view, barcode(productionCodex, 130, 330));
  expect(onScanned).toHaveBeenCalledTimes(1);
});

it('shrinks the frame for local width and retires scanning when controls occupy a short window', () => {
  const onScanned = jest.fn();
  const props = { onScanned, onCancel: jest.fn(), onChoosePhoto: jest.fn() };
  mockLocalFrame = { x: 0, y: 0, width: 250, height: 400 };
  const view = render(<QRScannerScreen {...props} />);
  const size = StyleSheet.flatten(view.getByTestId('qr-scanner-frame').props.style).width;
  expect(size).toBeLessThan(250);
  fireEvent(view.getByTestId('qr-scanner-controls'), 'layout', { nativeEvent: { layout: { width: 250, height: 220 } } });
  mockLocalFrame = { ...mockLocalFrame, height: 180 };
  view.rerender(<QRScannerScreen {...props} />);
  expect(StyleSheet.flatten(view.getByTestId('qr-scanner-frame').props.style)).toMatchObject({ width: 0, height: 0, overflow: 'hidden' });
  emit(view, barcode(productionCodex));
  expect(onScanned).not.toHaveBeenCalled();
  fireEvent.press(view.getByTestId('qr-scanner-photos'));
  expect(props.onChoosePhoto).toHaveBeenCalledTimes(1);
});

it('accepts a QR in the newly measured narrow frame, never the old full-size frame', () => {
  mockLocalFrame = { x: 0, y: 0, width: 250, height: 400 };
  const onScanned = jest.fn();
  const view = render(<QRScannerScreen onScanned={onScanned} onCancel={jest.fn()} />);
  const size = Number(StyleSheet.flatten(view.getByTestId('qr-scanner-frame').props.style).width);
  expect(size).toBeLessThan(250);
  emit(view, barcode(productionCodex));
  expect(onScanned).not.toHaveBeenCalled();
  mockMeasureLayout.mockImplementation((_parent, success) => success(24, 111.5, size, size));
  measure(view);
  emit(view, barcode(productionCodex, 50, 130));
  emit(view, barcode(productionCodex, 50, 130));
  expect(onScanned).toHaveBeenCalledTimes(1);
});

it('rejects old same-size positions and delayed region generations while preserving the camera', () => {
  mockHasRegions = true;
  mockLocalFrame = { x: 0, y: 0, width: 951, height: 669 };
  mockLocalInsets = { top: 0, bottom: 34, left: 0, right: 84 };
  const onScanned = jest.fn();
  mockMeasureLayout.mockImplementation((_parent, success) => success(308.5, 192.5, 250, 250));
  const view = render(<QRScannerScreen onScanned={onScanned} onCancel={jest.fn()} />);
  const camera = view.UNSAFE_getByType(CameraView);
  const updateRegions = (regions: Array<{ x: number; y: number; width: number; height: number }>) => fireEvent(
    view.getByTestId('qr-scanner-reserved-regions'), 'regionsChange', { nativeEvent: { width: 951, height: 669, regions } },
  );
  // No region snapshot yet: the measured frame alone is insufficient.
  emit(view, barcode(productionCodex, 330, 210));
  expect(onScanned).not.toHaveBeenCalled();
  updateRegions([]);
  let stale!: (...values: number[]) => void;
  mockMeasureLayout.mockImplementationOnce((_parent, success) => { stale = success; });
  measure(view);
  updateRegions([{ x: 455.5, y: 0, width: 40, height: 669 }]);
  // A new-generation measurement still sees the old native position.
  emit(view, barcode(productionCodex, 330, 210));
  expect(onScanned).not.toHaveBeenCalled();
  updateRegions([]);
  mockMeasureLayout.mockImplementation((_parent, success) => success(102.75, 192.5, 250, 250));
  updateRegions([{ x: 455.5, y: 0, width: 40, height: 669 }]);
  act(() => stale(308.5, 192.5, 250, 250));
  expect(view.UNSAFE_getByType(CameraView)).toBe(camera);
  emit(view, barcode(productionCodex, 130, 210));
  emit(view, barcode(productionCodex, 130, 210));
  expect(onScanned).toHaveBeenCalledTimes(1);
});
