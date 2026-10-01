import { isBarcodeInsideScanFrame, type QrScanFrame } from './qr-scan-frame';
import type { BarcodeScanningResult } from 'expo-camera';

const frame: QrScanFrame = { x: 65, y: 245, width: 250, height: 250 };
const inside = {
  cornerPoints: [{ x: 90, y: 270 }, { x: 190, y: 270 }, { x: 190, y: 370 }, { x: 90, y: 370 }],
  bounds: { origin: { x: 90, y: 270 }, size: { width: 100, height: 100 } },
};

it.each(['iOS', 'Android'])('accepts the %s corner ordering in camera-view coordinates', platform => {
  const order = platform === 'iOS' ? [3, 2, 0, 1] : [0, 1, 2, 3];
  expect(isBarcodeInsideScanFrame({ ...inside, cornerPoints: order.map(i => inside.cornerPoints[i]) }, frame)).toBe(true);
});

it.each([
  { x: 5, y: 270 }, { x: 270, y: 270 }, { x: 90, y: 170 }, { x: 90, y: 470 },
])('rejects a QR that crosses a frame edge at %j', origin => {
  expect(isBarcodeInsideScanFrame({ cornerPoints: [], bounds: { ...inside.bounds, origin } }, frame)).toBe(false);
});

it('accepts a QR exactly contained by the frame edges', () => {
  expect(isBarcodeInsideScanFrame({ cornerPoints: [], bounds: { origin: { x: frame.x, y: frame.y }, size: frame } }, frame)).toBe(true);
});

it('prefers valid native corners over incomplete bounds', () => {
  expect(isBarcodeInsideScanFrame({ ...inside, bounds: { origin: { x: 0, y: 0 }, size: { width: 0, height: 0 } } }, frame)).toBe(true);
});

it('does not use in-frame bounds to override an out-of-frame corner', () => {
  expect(isBarcodeInsideScanFrame({ ...inside, cornerPoints: [{ x: 0, y: 270 }, ...inside.cornerPoints.slice(1)] }, frame)).toBe(false);
});

it.each([
  null,
  { ...frame, x: NaN }, { ...frame, y: Infinity }, { ...frame, width: 0 }, { ...frame, height: -1 },
  { x: Number.MAX_VALUE, y: 0, width: Number.MAX_VALUE, height: 1 },
])('rejects an unmeasured or invalid frame %j', invalid => {
  expect(isBarcodeInsideScanFrame(inside, invalid)).toBe(false);
});

it.each([
  { cornerPoints: [], bounds: undefined },
  { ...inside, cornerPoints: { x: 90, y: 270 } },
  { cornerPoints: [], bounds: { origin: { x: 90, y: 270 }, size: { width: 0, height: 100 } } },
  { cornerPoints: [], bounds: { origin: { x: NaN, y: 270 }, size: { width: 100, height: 100 } } },
  { ...inside, cornerPoints: inside.cornerPoints.slice(1) },
  { ...inside, cornerPoints: [null, ...inside.cornerPoints.slice(1)] },
  { ...inside, cornerPoints: inside.cornerPoints.map(p => ({ ...p, x: Infinity })) },
  { ...inside, cornerPoints: inside.cornerPoints.map(p => ({ ...p, x: 90 })) },
])('rejects missing or malformed native QR geometry %j', invalid => {
  expect(isBarcodeInsideScanFrame(invalid as unknown as BarcodeScanningResult, frame)).toBe(false);
});
