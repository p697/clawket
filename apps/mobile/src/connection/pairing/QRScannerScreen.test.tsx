import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { Alert, StyleSheet, View } from 'react-native';
import { CameraView, type BarcodeScanningResult } from 'expo-camera';
import { QRScannerScreen } from './QRScannerScreen';

const mockMeasureLayout = jest.fn();

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
    Pressable: primitive('Pressable'),
    StyleSheet: {
      create: <T,>(styles: T) => styles,
      absoluteFill: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
      flatten: (style: unknown) => Array.isArray(style) ? Object.assign({}, ...style) : style,
    },
  };
});
jest.mock('expo-camera', () => ({ CameraView: 'CameraView' }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('../../theme', () => ({ useAppTheme: () => ({ theme: { colors: { accent: '#123456' } } }) }));

const productionCodex = JSON.stringify({ v: 2, k: 'cp', b: 'codex', s: 'https://clawket-codex-registry.clawket.workers.dev', g: 'synthetic', a: 'synthetic' });
const previewOpenClaw = JSON.stringify({ v: 2, k: 'cp', s: 'https://clawket-registry-preview.clawket.workers.dev', g: 'synthetic', a: 'synthetic' });
const frame = { x: 65, y: 245, width: 250, height: 250 };

function barcode(data: string, x = 90, y = 270): BarcodeScanningResult {
  return {
    type: 'qr', data,
    cornerPoints: [{ x, y }, { x: x + 100, y }, { x: x + 100, y: y + 100 }, { x, y: y + 100 }],
    bounds: { origin: { x, y }, size: { width: 100, height: 100 } },
  };
}

function measure(view: ReturnType<typeof render>) {
  const area = view.UNSAFE_getAllByType(View).find(node => {
    const style = StyleSheet.flatten(node.props.style);
    return style?.width === 250 && style?.height === 250;
  })!;
  // The original screen has no layout handler; keep the regression focused on
  // accepting an off-frame QR, rather than failing on a newly added test ID.
  act(() => area.props.onLayout?.({ nativeEvent: { layout: frame } }));
}

function emit(view: ReturnType<typeof render>, result: BarcodeScanningResult) {
  act(() => view.UNSAFE_getByType(CameraView).props.onBarcodeScanned?.(result));
}

beforeEach(() => {
  jest.clearAllMocks();
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
  mockMeasureLayout.mockImplementation((_parent, success) => success(245, 65, 250, 250));
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
  mockMeasureLayout.mockImplementation((_parent, success) => success(245, 65, 250, 250));
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

it('ignores buffered native results after the scanner unmounts', () => {
  const onScanned = jest.fn();
  const view = render(<QRScannerScreen onScanned={onScanned} onCancel={jest.fn()} />);
  measure(view);
  const callback = view.UNSAFE_getByType(CameraView).props.onBarcodeScanned;
  view.unmount();
  act(() => callback(barcode(productionCodex)));
  expect(onScanned).not.toHaveBeenCalled();
});
