import type { BarcodeScanningResult } from 'expo-camera';

export type QrScanFrame = Readonly<{ x: number; y: number; width: number; height: number }>;

function validRect(rect: QrScanFrame | null): rect is QrScanFrame {
  return rect != null && [rect.x, rect.y, rect.width, rect.height, rect.x + rect.width, rect.y + rect.height].every(Number.isFinite)
    && rect.width > 0 && rect.height > 0;
}

/** Expo reports barcode geometry in camera-view coordinates on both platforms. */
export function isBarcodeInsideScanFrame(
  result: Pick<BarcodeScanningResult, 'cornerPoints' | 'bounds'>,
  frame: QrScanFrame | null,
): boolean {
  if (!validRect(frame)) return false;
  let barcode: QrScanFrame;
  const corners = result.cornerPoints;
  if (corners != null && !Array.isArray(corners)) return false;
  if (Array.isArray(corners) && corners.length > 0) {
    if (corners.length !== 4 || corners.some(point => !point || !Number.isFinite(point.x) || !Number.isFinite(point.y))) return false;
    const xs = corners.map(point => point.x);
    const ys = corners.map(point => point.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    barcode = { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
  } else {
    const bounds = result.bounds;
    if (!bounds?.origin || !bounds.size) return false;
    barcode = { x: bounds.origin.x, y: bounds.origin.y, width: bounds.size.width, height: bounds.size.height };
  }
  return validRect(barcode) && barcode.x >= frame.x && barcode.y >= frame.y
    && barcode.x + barcode.width <= frame.x + frame.width
    && barcode.y + barcode.height <= frame.y + frame.height;
}
