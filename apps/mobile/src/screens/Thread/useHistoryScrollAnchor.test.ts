import { act, renderHook } from '@testing-library/react-native';
import { createRef } from 'react';
import { useHistoryScrollAnchor } from './useHistoryScrollAnchor';

type Row = { key: string; type: string };
const date = (key: string): Row => ({ key, type: 'date' });
const message = (key: string): Row => ({ key, type: 'message' });

function fixture(initial: Row[] = [date('date:25'), message('25'), message('26')]) {
  let rows = initial;
  let offset = 100;
  let first = 0;
  let header = 80;
  let positions: number[] = [0, 60, 220];
  const list = {
    getFirstVisibleIndex: () => first,
    getLayout: (index: number) => positions[index] === undefined ? undefined
      : { y: positions[index]!, height: rows[index]?.type === 'date' ? 60 : 160 },
    getFirstItemOffset: () => header,
    getAbsoluteLastScrollOffset: () => offset,
    scrollToOffset: jest.fn(({ offset: next }: { offset: number; animated: boolean }) => { offset = next; }),
  };
  const ref = createRef<typeof list | null>();
  ref.current = list;
  const hook = renderHook(({ scope, rows }: { scope: string; rows: Row[] }) => useHistoryScrollAnchor(scope, ref, rows),
    { initialProps: { scope: 'a', rows } });
  return { ...hook, list, ref,
    setOffset: (next: number) => { offset = next; },
    setFirst: (next: number) => { first = next; },
    setHeader: (next: number) => { header = next; },
    setRows: (next: Row[], layout: number[]) => { rows = next; positions = layout; hook.rerender({ scope: 'a', rows }); },
    getViewportY: (key: string) => positions[rows.findIndex(row => row.key === key)]! + header - offset,
    currentRows: () => rows,
  };
}

it('keeps message 25 at the same screen Y when prepend removes its conditional date row', () => {
  const f = fixture();
  const before = f.getViewportY('25');
  act(() => f.result.current.capture());
  expect(f.result.current.managed).toBe(true);
  f.setRows([date('date:09'), message('09'), message('24'), message('25'), message('26')], [0, 60, 2460, 2620, 2780]);
  act(() => f.result.current.restore());
  expect(f.getViewportY('25')).toBe(before);
  expect(f.list.scrollToOffset).toHaveBeenLastCalledWith({ offset: 2660, animated: false });
});

it('refines estimated older heights and accounts for the disappearing terminal header without drift', () => {
  const f = fixture();
  const before = f.getViewportY('25');
  act(() => f.result.current.capture());
  f.setRows([message('01'), message('25'), message('26')], [0, 1060, 1220]);
  act(() => f.result.current.restore());
  expect(f.getViewportY('25')).toBe(before);
  f.setRows(f.currentRows(), [0, 1460, 1620]);
  f.setHeader(36);
  act(() => f.result.current.restore());
  expect(f.getViewportY('25')).toBe(before);
  act(() => f.result.current.restore());
  expect(f.list.scrollToOffset).toHaveBeenCalledTimes(2);
});

it('uses the new drag position while the RPC is pending instead of returning to the request-start row', () => {
  const f = fixture();
  act(() => f.result.current.capture());
  f.setFirst(2);
  f.setOffset(240);
  act(() => f.result.current.beginDrag(true));
  f.setOffset(265);
  act(() => f.result.current.readerScrolled(265));
  const before = f.getViewportY('26');
  f.setRows([message('09'), message('25'), message('26')], [0, 2060, 2220]);
  act(() => f.result.current.restore());
  expect(f.getViewportY('26')).toBe(before);
});

it('does not recapture the compensation event as reader movement while a drag settles', () => {
  const f = fixture();
  const before = f.getViewportY('25');
  act(() => f.result.current.capture());
  f.setRows([message('09'), message('25'), message('26')], [0, 2060, 2220]);
  act(() => f.result.current.restore());
  f.setFirst(0); // Native viewability may lag behind the correction event.
  act(() => f.result.current.readerScrolled(2100));
  f.setRows(f.currentRows(), [0, 2460, 2620]);
  act(() => f.result.current.restore());
  expect(f.getViewportY('25')).toBe(before);
});

it('keeps one correction owner after returning to the end and resumes with a new reading drag', () => {
  const f = fixture();
  act(() => f.result.current.capture());
  act(() => f.result.current.release());
  expect(f.result.current.isActive()).toBe(false);
  expect(f.result.current.managed).toBe(true); // No stale FlashList delta may be reapplied.
  act(() => f.result.current.restore());
  expect(f.list.scrollToOffset).not.toHaveBeenCalled();
  act(() => f.result.current.beginDrag(false));
  expect(f.result.current.isActive()).toBe(true);
});

it('ignores an older in-flight compensation event before the newest acknowledgement and keeps refining the reader row', () => {
  const f = fixture();
  const before = f.getViewportY('25');
  f.list.scrollToOffset.mockImplementation(() => {}); // Native scroll commands acknowledge asynchronously.
  act(() => f.result.current.capture());
  f.setRows([message('09'), message('25'), message('26')], [0, 2060, 2220]);
  act(() => f.result.current.restore()); // 2100 is in flight.
  f.setRows(f.currentRows(), [0, 2460, 2620]);
  act(() => f.result.current.restore()); // 2500 is in flight before 2100's event.
  f.setFirst(0);
  f.setOffset(2100);
  act(() => { f.result.current.readerScrolled(2100); f.result.current.readerScrolled(2100); });
  act(() => f.result.current.restore());
  expect(f.list.scrollToOffset).toHaveBeenCalledTimes(2);
  expect(f.list.scrollToOffset).toHaveBeenLastCalledWith({ offset: 2500, animated: false });
  f.setOffset(2500);
  act(() => f.result.current.readerScrolled(2500));
  f.setRows(f.currentRows(), [0, 2660, 2820]);
  act(() => f.result.current.restore());
  expect(f.list.scrollToOffset).toHaveBeenLastCalledWith({ offset: 2700, animated: false });
  f.setOffset(2700);
  act(() => f.result.current.readerScrolled(2700, false));
  expect(f.getViewportY('25')).toBe(before);
});

it.each([false, true])('retries a prepend correction after native content grows beyond its old clamped maximum: settling=%s', settling => {
  const f = fixture();
  const before = f.getViewportY('25');
  let nativeMaxOffset = 1500;
  f.list.scrollToOffset.mockImplementation(({ offset }) => f.setOffset(Math.min(offset, nativeMaxOffset)));
  act(() => f.result.current.capture());
  f.setRows([message('09'), message('21'), message('25'), message('26')], [0, 1260, 2060, 2220]);
  act(() => f.result.current.restore({ nativeMaxOffset })); // Native child still has its old height.
  expect(f.list.scrollToOffset).toHaveBeenLastCalledWith({ offset: 2100, animated: false });
  f.setFirst(1);
  act(() => f.result.current.readerScrolled(1500, settling)); // A clamped command is not a reader gesture.
  expect(f.result.current.isCorrectionPending()).toBe(true);
  nativeMaxOffset = 3500;
  act(() => f.result.current.restore({ nativeMaxOffset, nativeGeometryCommitted: true }));
  expect(f.list.scrollToOffset).toHaveBeenCalledTimes(2);
  expect(f.getViewportY('25')).toBe(before);
});

it('keeps the new reader position when a fresh drag supersedes an old clamped correction', () => {
  const f = fixture();
  let nativeMaxOffset = 1500;
  f.list.scrollToOffset.mockImplementation(({ offset }) => f.setOffset(Math.min(offset, nativeMaxOffset)));
  act(() => f.result.current.capture(100, 2100));
  f.setRows([message('09'), message('21'), message('25'), message('26')], [0, 1260, 2060, 2220]);
  act(() => f.result.current.restore({ nativeMaxOffset }));
  f.setFirst(1);
  act(() => f.result.current.readerScrolled(1500, true, 2100));
  f.setOffset(1450);
  // This is the new native page's current reading position, after its child
  // geometry has become visible; the pending old correction cannot reclaim it.
  act(() => f.result.current.beginDrag(true, { offset: 1450, height: 4100 }));
  f.setOffset(1400);
  act(() => f.result.current.readerScrolled(1400, true, 4100));
  const readingY = f.getViewportY('21');
  nativeMaxOffset = 3500;
  act(() => f.result.current.restore({ nativeMaxOffset, nativeGeometryCommitted: true }));
  expect(f.list.scrollToOffset).toHaveBeenCalledTimes(1); // The new drag's native position already matches.
  expect(f.getViewportY('21')).toBe(readingY);
});

it('keeps a fresh finger displacement in the old native page while the new child has not committed', () => {
  const f = fixture();
  f.list.scrollToOffset.mockImplementation(() => {});
  act(() => f.result.current.capture(100, 2100));
  f.setRows([date('date:09'), message('09'), message('25'), message('26')], [0, 60, 2060, 2220]);
  act(() => f.result.current.restore({ nativeMaxOffset: 1500, nativeOffset: 100 }));
  f.setOffset(90);
  f.setFirst(0);
  act(() => f.result.current.beginDrag(true, { offset: 90, height: 2100 }));
  act(() => f.result.current.capture()); // The new gesture also reaches the automatic paging threshold.
  act(() => f.result.current.readerScrolled(80, true, 2100));
  act(() => f.result.current.restore({ nativeMaxOffset: 4300, nativeOffset: 80, nativeGeometryCommitted: true }));
  expect(f.list.scrollToOffset).toHaveBeenLastCalledWith({ offset: 2080, animated: false });
  f.setOffset(2080);
  expect(f.getViewportY('25')).toBe(60);
});

it('fences the old page release even when it arrives before the first new layout callback', () => {
  const f = fixture();
  f.list.scrollToOffset.mockImplementation(() => {});
  act(() => f.result.current.capture(0, 2100));
  f.setRows([date('date:09'), message('09'), message('25'), message('26')], [0, 60, 2060, 2220]);
  act(() => f.result.current.readerScrolled(0, true, 2100));
  act(() => f.result.current.restore({ nativeMaxOffset: 4300, nativeOffset: 0 }));
  expect(f.list.scrollToOffset).toHaveBeenLastCalledWith({ offset: 2000, animated: false });
});

it('does not reinterpret the new child initial zero offset before its compensation is acknowledged', () => {
  const f = fixture();
  f.list.scrollToOffset.mockImplementation(() => {});
  act(() => f.result.current.capture(0, 2100));
  f.setRows([date('date:09'), message('09'), message('25'), message('26')], [0, 60, 2060, 2220]);
  act(() => f.result.current.restore({ nativeMaxOffset: 1500, nativeOffset: 0 }));
  act(() => f.result.current.readerScrolled(0, true, 4900));
  act(() => f.result.current.restore({ nativeMaxOffset: 4300, nativeOffset: 0, nativeGeometryCommitted: true }));
  expect(f.list.scrollToOffset).toHaveBeenCalledTimes(2);
  expect(f.list.scrollToOffset).toHaveBeenLastCalledWith({ offset: 2000, animated: false });
});

it('preserves additional reader movement in the old page coordinate space while its prepend is committing', () => {
  const f = fixture();
  f.list.scrollToOffset.mockImplementation(() => {});
  act(() => f.result.current.capture(100, 2100));
  f.setRows([date('date:09'), message('09'), message('25'), message('26')], [0, 60, 2060, 2220]);
  act(() => f.result.current.restore({ nativeMaxOffset: 1500, nativeOffset: 100 }));
  f.setFirst(0);
  // The original finger moves another 10 points before the native child grows.
  act(() => f.result.current.readerScrolled(90, true, 2100));
  act(() => f.result.current.restore({ nativeMaxOffset: 4300, nativeOffset: 90, nativeGeometryCommitted: true }));
  expect(f.list.scrollToOffset).toHaveBeenLastCalledWith({ offset: 2090, animated: false });
  f.setOffset(2090);
  expect(f.getViewportY('25')).toBe(50);
});

it('keeps a late clamp acknowledgement after retrying the same target against the new native size', () => {
  const f = fixture();
  const before = f.getViewportY('25');
  f.list.scrollToOffset.mockImplementation(() => {});
  act(() => f.result.current.capture());
  f.setRows([message('09'), message('21'), message('25'), message('26')], [0, 1260, 2060, 2220]);
  act(() => f.result.current.restore({ nativeMaxOffset: 1500 }));
  f.setOffset(1500);
  act(() => f.result.current.restore({ nativeMaxOffset: 3500, nativeGeometryCommitted: true }));
  f.setFirst(1);
  act(() => { f.result.current.readerScrolled(1500); f.result.current.readerScrolled(1500); });
  act(() => f.result.current.restore());
  expect(f.list.scrollToOffset).toHaveBeenCalledTimes(2);
  expect(f.list.scrollToOffset).toHaveBeenLastCalledWith({ offset: 2100, animated: false });
  f.setOffset(2100);
  act(() => f.result.current.readerScrolled(2100));
  expect(f.result.current.isCorrectionPending()).toBe(false);
  f.setRows(f.currentRows(), [0, 1260, 2460, 2620]);
  act(() => f.result.current.restore({ nativeMaxOffset: 3900 }));
  expect(f.list.scrollToOffset).toHaveBeenLastCalledWith({ offset: 2500, animated: false });
  f.setOffset(2500);
  act(() => f.result.current.readerScrolled(2500, false));
  expect(f.getViewportY('25')).toBe(before);
});

it('keeps the old page reader row when its zero-offset end-drag arrives after the prepend layout', () => {
  const f = fixture();
  f.setOffset(0);
  const before = f.getViewportY('25');
  f.list.scrollToOffset.mockImplementation(() => {});
  act(() => f.result.current.capture(0, 2100));
  f.setRows([date('date:09'), message('09'), message('25'), message('26')], [0, 60, 2060, 2220]);
  act(() => f.result.current.restore({ nativeMaxOffset: 1500, nativeOffset: 0 }));
  // Native is still reporting the old page's geometry and viewability. This
  // is the end of the same drag, not a new reading intent at the new page head.
  f.setFirst(0);
  act(() => f.result.current.readerScrolled(0, true, 2100));
  act(() => f.result.current.restore({ nativeMaxOffset: 4300, nativeOffset: 0, nativeGeometryCommitted: true }));
  expect(f.list.scrollToOffset).toHaveBeenCalledTimes(2);
  expect(f.list.scrollToOffset).toHaveBeenLastCalledWith({ offset: 2000, animated: false });
  f.setOffset(2000);
  act(() => f.result.current.readerScrolled(2000, false, 4900));
  expect(f.getViewportY('25')).toBe(before);
  // A delayed old-page duplicate remains harmless even after the true ACK.
  act(() => f.result.current.readerScrolled(0, false, 2100));
  act(() => f.result.current.restore({ nativeOffset: 2000 }));
  expect(f.list.scrollToOffset).toHaveBeenCalledTimes(2);
});

it('uses the native offset rather than a header-shifted FlashList getter when restoring', () => {
  const f = fixture();
  act(() => f.result.current.capture(100, 900));
  f.setHeader(100);
  // FlashList stores an offset relative to its old header; updating the header
  // changes its absolute getter before the native view has actually moved.
  f.setOffset(120);
  act(() => f.result.current.restore({ nativeOffset: 100 }));
  expect(f.list.scrollToOffset).toHaveBeenLastCalledWith({ offset: 120, animated: false });
});

it('keeps reader movement authoritative when a new reply appends below the reading row', () => {
  const f = fixture();
  act(() => f.result.current.capture(100, 2100));
  f.setRows([...f.currentRows(), message('27')], [0, 60, 220, 400]);
  act(() => f.result.current.restore({ nativeOffset: 100 }));
  f.setOffset(90);
  act(() => f.result.current.readerScrolled(90, true, 2100));
  act(() => f.result.current.restore({ nativeOffset: 90 }));
  expect(f.list.scrollToOffset).not.toHaveBeenCalled();
  expect(f.getViewportY('25')).toBe(50);
});

it('derives a fresh native reading row from layouts when the list viewability getter is stale', () => {
  const f = fixture([message('09'), message('25'), message('26')]);
  f.setRows(f.currentRows(), [0, 2060, 2220]);
  f.setOffset(0);
  f.setFirst(0);
  act(() => f.result.current.capture(2100, 4900));
  f.setRows([message('01'), ...f.currentRows()], [0, 1800, 4060, 4220]);
  act(() => f.result.current.restore({ nativeOffset: 2100 }));
  expect(f.list.scrollToOffset).toHaveBeenLastCalledWith({ offset: 4100, animated: false });
});

it('fences anchors across scope and native list replacement', () => {
  const f = fixture();
  act(() => f.result.current.capture());
  f.rerender({ scope: 'b', rows: f.currentRows() });
  act(() => f.result.current.restore());
  expect(f.result.current.managed).toBe(false);
  f.rerender({ scope: 'a', rows: f.currentRows() });
  act(() => f.result.current.restore());
  expect(f.list.scrollToOffset).not.toHaveBeenCalled();
  act(() => f.result.current.capture());
  f.ref.current = { ...f.list, scrollToOffset: jest.fn() };
  act(() => f.result.current.restore());
  expect(f.ref.current.scrollToOffset).not.toHaveBeenCalled();
});

it('leaves an unmeasured list placement alone and releases a deleted anchor', () => {
  const f = fixture([]);
  act(() => f.result.current.capture());
  expect(f.result.current.managed).toBe(false);
  f.setRows([message('25')], [0]);
  act(() => f.result.current.capture());
  f.setRows([message('other')], [0]);
  act(() => f.result.current.restore());
  expect(f.result.current.isActive()).toBe(false);
  expect(f.list.scrollToOffset).not.toHaveBeenCalled();
});
