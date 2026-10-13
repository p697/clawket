import { availableScannerRect } from './scanner-available-rect';

const safe = { x: 0, y: 0, width: 867, height: 635 };
it('uses the larger side of the measured Duo division without double-counting the system bar', () => {
  expect(availableScannerRect(safe, [
    { x: 455.5, y: 0, width: 40, height: 669 }, { x: 867, y: 0, width: 84, height: 120 },
  ])).toEqual({ ...safe, width: 455.5 });
});
it('keeps a horizontal division outside the entire scanner control region', () => {
  const portrait = { x: 0, y: 84, width: 669, height: 833 };
  expect(availableScannerRect(portrait, [{ x: 0, y: 455.5, width: 669, height: 40 }]))
    .toEqual({ x: 0, y: 495.5, width: 669, height: 421.5 });
});
it('can move past an internal occlusion and ignores non-overlapping or inactive-omitted regions', () => {
  expect(availableScannerRect(safe, [{ x: 0, y: 0, width: 58, height: 37 }])).toEqual({ ...safe, y: 37, height: 598 });
  expect(availableScannerRect(safe, [])).toEqual(safe);
  expect(availableScannerRect(safe, [{ x: 900, y: 0, width: 30, height: 120 }])).toEqual(safe);
});
it.each([NaN, Infinity, -1, 0])('ignores a malformed region size %s', width => {
  expect(availableScannerRect(safe, [{ x: 200, y: 0, width, height: 600 }])).toEqual(safe);
});
it('keeps zero available area finite if a region covers the complete small window', () => {
  const result = availableScannerRect({ x: 0, y: 0, width: 180, height: 80 }, [{ x: -10, y: -10, width: 250, height: 100 }]);
  expect(Object.values(result).every(Number.isFinite)).toBe(true);
  expect(result.width * result.height).toBe(0);
});
it('retains another side when a second region covers the first candidate, independent of query order', () => {
  const square = { x: 0, y: 0, width: 100, height: 100 };
  const regions = [{ x: 40, y: 0, width: 20, height: 100 }, { x: 0, y: 0, width: 40, height: 100 }];
  expect(availableScannerRect(square, regions)).toEqual({ x: 60, y: 0, width: 40, height: 100 });
  expect(availableScannerRect(square, [...regions].reverse())).toEqual(availableScannerRect(square, regions));
});
