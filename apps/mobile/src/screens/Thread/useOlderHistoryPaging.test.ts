import { act, renderHook } from '@testing-library/react-native';
import { useOlderHistoryPaging } from './useOlderHistoryPaging';

function deferred() {
  let resolve!: () => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
type Options = Parameters<typeof useOlderHistoryPaging>[0];
const options = (overrides: Partial<Options> = {}): Options => ({
  scope: 'connection:agent:session', loading: false, blocked: false, failed: false,
  load: jest.fn(), retry: jest.fn(), onReadEarlier: jest.fn(), ...overrides,
});

it('makes a slow automatic page visible at once and coalesces repeated pulls and taps', async () => {
  const page = deferred();
  const props = options({ load: jest.fn(() => page.promise) });
  const { result } = renderHook(() => useOlderHistoryPaging(props));
  act(() => { result.current.beginDrag(); result.current.automatic(); result.current.manual(); result.current.beginDrag(); result.current.automatic(); });
  expect(result.current.loading).toBe(true);
  expect(props.load).toHaveBeenCalledTimes(1);
  expect(props.onReadEarlier).toHaveBeenCalledTimes(1);
  // FlashList reaching the top is automatic; the view decides whether that is reading earlier.
  expect(props.onReadEarlier).toHaveBeenLastCalledWith(false);
  await act(async () => { page.resolve(); await page.promise; });
  expect(result.current.loading).toBe(false);
  await act(async () => { result.current.manual(); });
  expect(props.load).toHaveBeenCalledTimes(2);
  expect(props.onReadEarlier).toHaveBeenLastCalledWith(true);
});

it('keeps one visible pull during a head refresh and runs the latest cursor callback when it ends', async () => {
  const page = deferred();
  const first = options({ blocked: true });
  const next = jest.fn(() => page.promise);
  const { result, rerender } = renderHook((props: Options) => useOlderHistoryPaging(props), { initialProps: first });
  act(() => { result.current.manual(); result.current.beginDrag(); result.current.automatic(); });
  expect(result.current.loading).toBe(true);
  expect(first.load).not.toHaveBeenCalled();
  rerender({ ...first, blocked: false, load: next });
  expect(next).toHaveBeenCalledTimes(1);
  expect(result.current.loading).toBe(true);
  await act(async () => { page.resolve(); await page.promise; });
  expect(result.current.loading).toBe(false);
});

it('ends a queued pull when a head refresh reaches the beginning even if retry is still exposed', () => {
  const props = options({ blocked: true });
  const { result, rerender } = renderHook((props: Options) => useOlderHistoryPaging(props), { initialProps: props });
  act(() => { result.current.manual(); });
  rerender({ ...props, blocked: false, load: undefined });
  expect(result.current.loading).toBe(false);
  expect(props.retry).not.toHaveBeenCalled();
});

it('does not automatically replay a failed page and lets a manual retry carry its own busy state', async () => {
  const page = deferred();
  const props = options({ failed: true, retry: jest.fn(() => page.promise) });
  const { result } = renderHook(() => useOlderHistoryPaging(props));
  act(() => { result.current.beginDrag(); result.current.automatic(); });
  expect(props.load).not.toHaveBeenCalled();
  act(() => { result.current.manual(); result.current.manual(); });
  expect(props.retry).toHaveBeenCalledTimes(1);
  expect(result.current.loading).toBe(true);
  await act(async () => { page.resolve(); await page.promise; });
  expect(result.current.loading).toBe(false);
});

it('settles a rejected request and offers manual retry without an unhandled rejection or auto loop', async () => {
  const page = deferred();
  const load = jest.fn().mockImplementationOnce(() => page.promise).mockResolvedValue(undefined);
  const props = options({ load });
  const { result } = renderHook(() => useOlderHistoryPaging(props));
  act(() => { result.current.manual(); });
  await act(async () => { page.reject(new Error('read failed')); await page.promise.catch(() => {}); });
  expect(result.current.loading).toBe(false);
  expect(result.current.failed).toBe(true);
  act(() => { result.current.beginDrag(); result.current.automatic(); });
  expect(load).toHaveBeenCalledTimes(1);
  await act(async () => { result.current.manual(); });
  expect(load).toHaveBeenCalledTimes(2);
  expect(result.current.failed).toBe(false);
});

it('discards queued automatic work when history reports a failure', () => {
  const props = options({ blocked: true });
  const { result, rerender } = renderHook((props: Options) => useOlderHistoryPaging(props), { initialProps: props });
  act(() => { result.current.beginDrag(); result.current.automatic(); });
  rerender({ ...props, blocked: false, failed: true });
  expect(result.current.loading).toBe(false);
  expect(props.load).not.toHaveBeenCalled();
  expect(props.retry).not.toHaveBeenCalled();
});

it('fences old completion and failure across conversation switches', async () => {
  const oldPage = deferred();
  const newPage = deferred();
  const props = options({ load: jest.fn(() => oldPage.promise) });
  const next = { ...props, scope: 'other-connection:agent:session', load: jest.fn(() => newPage.promise) };
  const { result, rerender } = renderHook((props: Options) => useOlderHistoryPaging(props), { initialProps: props });
  act(() => { result.current.manual(); });
  rerender(next);
  expect(result.current.loading).toBe(false);
  act(() => { result.current.manual(); });
  await act(async () => { oldPage.reject(new Error('retired')); await oldPage.promise.catch(() => {}); });
  expect(result.current.loading).toBe(true);
  expect(result.current.failed).toBe(false);
  await act(async () => { newPage.resolve(); await newPage.promise; });
  expect(result.current.loading).toBe(false);
  rerender(props);
  expect(result.current.loading).toBe(false);
  expect(result.current.failed).toBe(false);
});

it('drops an old queued gesture instead of paging a different conversation', () => {
  const props = options({ blocked: true });
  const { result, rerender } = renderHook((props: Options) => useOlderHistoryPaging(props), { initialProps: props });
  act(() => { result.current.manual(); });
  rerender({ ...props, scope: 'different', blocked: false });
  expect(result.current.loading).toBe(false);
  expect(props.load).not.toHaveBeenCalled();
});

it('does not create a visible request at the beginning of history or overlap an external page', () => {
  const props = options({ load: undefined });
  const { result, rerender } = renderHook((props: Options) => useOlderHistoryPaging(props), { initialProps: props });
  act(() => { result.current.manual(); });
  expect(result.current.loading).toBe(false);
  expect(props.onReadEarlier).not.toHaveBeenCalled();
  const load = jest.fn();
  rerender({ ...props, load, loading: true });
  act(() => { result.current.manual(); });
  expect(load).not.toHaveBeenCalled();
  expect(result.current.loading).toBe(true);
});

it('safely ignores a late read after the view unmounts', async () => {
  const page = deferred();
  const props = options({ load: jest.fn(() => page.promise) });
  const { result, unmount } = renderHook(() => useOlderHistoryPaging(props));
  act(() => { result.current.manual(); });
  unmount();
  await act(async () => { page.resolve(); await page.promise; });
  expect(props.load).toHaveBeenCalledTimes(1);
});

it('uses native refreshing only for a pull, including a pull made during automatic loading', async () => {
  const page = deferred();
  const props = options({ load: jest.fn(() => page.promise) });
  const { result } = renderHook(() => useOlderHistoryPaging(props));
  act(() => { result.current.beginDrag(); result.current.automatic(); });
  expect(result.current.loading).toBe(true);
  expect(result.current.pulling).toBe(false);
  act(() => { result.current.pull(); });
  expect(result.current.pulling).toBe(true);
  expect(props.load).toHaveBeenCalledTimes(1);
  await act(async () => { page.resolve(); await page.promise; });
  expect(result.current.pulling).toBe(false);
  await act(async () => { result.current.manual(); });
  expect(result.current.pulling).toBe(false);
});

it('ignores mount and post-page layout callbacks until another fresh user drag', async () => {
  const page = deferred();
  const props = options({ load: jest.fn().mockImplementationOnce(() => page.promise).mockResolvedValue(undefined) });
  const { result } = renderHook(() => useOlderHistoryPaging(props));
  act(() => { result.current.automatic(); });
  expect(props.load).not.toHaveBeenCalled();
  act(() => { result.current.beginDrag(); result.current.automatic(); });
  expect(props.load).toHaveBeenCalledTimes(1);
  // A second gesture made while this page is pending cannot queue a follow-on page.
  act(() => { result.current.beginDrag(); result.current.automatic(); });
  await act(async () => { page.resolve(); await page.promise; });
  act(() => { result.current.automatic(); result.current.automatic(); });
  expect(props.load).toHaveBeenCalledTimes(1);
  await act(async () => { result.current.beginDrag(); result.current.automatic(); });
  expect(props.load).toHaveBeenCalledTimes(2);
});

it('does not carry an armed gesture across conversation replacement or a manual page', () => {
  const props = options();
  const { result, rerender } = renderHook((props: Options) => useOlderHistoryPaging(props), { initialProps: props });
  act(() => { result.current.beginDrag(); });
  rerender({ ...props, scope: 'different' });
  act(() => { result.current.automatic(); });
  rerender(props);
  act(() => { result.current.automatic(); });
  expect(props.load).not.toHaveBeenCalled();
  act(() => { result.current.beginDrag(); result.current.manual(); result.current.automatic(); });
  expect(props.load).toHaveBeenCalledTimes(1);
});
