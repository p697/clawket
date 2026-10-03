import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react';

type Row = Readonly<{ key: string; type: string }>;
type List = {
  getFirstVisibleIndex: () => number;
  getLayout: (index: number) => { y: number; height?: number } | undefined;
  getFirstItemOffset: () => number;
  getAbsoluteLastScrollOffset: () => number;
  scrollToOffset: (options: { offset: number; animated: boolean }) => void;
};
type NativePosition = { offset: number; height: number };
type Anchor = {
  scope: string; list: List; key: string; viewportY: number; correction: number | null;
  rowIndex: number; nativeHeight: number | undefined; nativeOffset: number;
  retiredGeometry: Array<NativePosition>; geometryPending: boolean;
};
type Corrections = {
  scope: string;
  list: List;
  offsets: Array<{ offset: number; clampedOffset: number | undefined; seen: boolean }>;
};
type RestoreOptions = { nativeMaxOffset?: number; nativeOffset?: number; nativeGeometryCommitted?: boolean };

function retirePrependedGeometry(saved: Anchor, rows: ReadonlyArray<Row>) {
  const index = rows.findIndex(row => row.key === saved.key);
  if (index > saved.rowIndex && saved.nativeHeight !== undefined) {
    const existing = saved.retiredGeometry.find(value => Math.abs(value.height - saved.nativeHeight!) < 0.5);
    if (existing) existing.offset = saved.nativeOffset;
    else saved.retiredGeometry.push({ height: saved.nativeHeight, offset: saved.nativeOffset });
    if (saved.retiredGeometry.length > 32) saved.retiredGeometry.shift();
    saved.geometryPending = true;
  }
  saved.rowIndex = index;
  return index;
}

/** A conditional date separator is not a surviving row when an earlier page joins its minute. */
export function useHistoryScrollAnchor(scope: string, listRef: RefObject<List | null>, rows: ReadonlyArray<Row>) {
  const latest = useRef({ scope, rows });
  latest.current = { scope, rows };
  const anchor = useRef<Anchor | null>(null);
  const corrections = useRef<Corrections | null>(null);
  const nativePosition = useRef<(NativePosition & { scope: string; list: List }) | null>(null);
  const managedScope = useRef<string | null>(null);
  const [managed, setManaged] = useState<string | null>(null);
  const isActive = useCallback(() => anchor.current?.scope === latest.current.scope
    && anchor.current.list === listRef.current, [listRef]);
  const isCorrectionPending = useCallback(() => isActive()
    && (anchor.current?.correction != null || anchor.current?.geometryPending === true), [isActive]);
  const release = useCallback(() => {
    anchor.current = null;
    corrections.current = null;
    nativePosition.current = null;
  }, []);
  useLayoutEffect(() => {
    if (anchor.current?.scope !== scope) anchor.current = null;
    if (corrections.current?.scope !== scope) corrections.current = null;
    if (nativePosition.current?.scope !== scope) nativePosition.current = null;
    if (managedScope.current !== scope) {
      managedScope.current = null;
      setManaged(null);
    }
  }, [scope]);
  const capture = useCallback((offset?: number, nativeHeight?: number, freshDrag = false) => {
    const list = listRef.current;
    if (!list) return;
    try {
      const current = latest.current;
      const previous = isActive() ? anchor.current : null;
      if (previous?.geometryPending) {
        if (!freshDrag && offset === undefined) return;
        const old = freshDrag && nativeHeight !== undefined
          ? previous.retiredGeometry.find(value => Math.abs(value.height - nativeHeight) < 0.5) : undefined;
        if (old && offset !== undefined) {
          // A new finger can take over before the native child has the new
          // rows. Follow its displacement in that child's coordinate space.
          previous.viewportY += old.offset - offset;
          old.offset = offset;
          return;
        }
      }
      const observed = nativePosition.current?.scope === current.scope && nativePosition.current.list === list
        ? nativePosition.current : null;
      const scrollOffset = offset ?? observed?.offset ?? list.getAbsoluteLastScrollOffset();
      const height = nativeHeight ?? observed?.height;
      const header = list.getFirstItemOffset();
      let start = Math.max(0, list.getFirstVisibleIndex());
      if (offset !== undefined || observed) {
        // The manager's viewability/absolute-offset getters can still belong to
        // a previous native event or header measurement. Locate the row using
        // the actual native offset and the current chronological layouts.
        let low = 0;
        let high = current.rows.length - 1;
        start = -1;
        while (low <= high) {
          const middle = Math.floor((low + high) / 2);
          const placed = list.getLayout(middle);
          if (!placed || !Number.isFinite(placed.y)) return;
          if (placed.y + header + (placed.height ?? 0) > scrollOffset) { start = middle; high = middle - 1; }
          else low = middle + 1;
        }
        if (start < 0) return;
      }
      // Date rows may disappear; messages, tool receipts and run rows keep their identities.
      const index = current.rows.findIndex((row, index) => index >= start && row.type !== 'date');
      const layout = index >= 0 ? list.getLayout(index) : undefined;
      const viewportY = layout ? layout.y + header - scrollOffset : NaN;
      if (!Number.isFinite(viewportY)) return;
      anchor.current = { scope: current.scope, list, key: current.rows[index]!.key, viewportY, correction: null,
        rowIndex: index, nativeHeight: height, nativeOffset: scrollOffset,
        retiredGeometry: previous?.retiredGeometry ?? [], geometryPending: false };
      if (height !== undefined) nativePosition.current = { scope: current.scope, list, offset: scrollOffset, height };
      // Keep one correction owner for this list instance. Re-enabling FlashList
      // would apply its stale pre-page layout delta a second time.
      if (managedScope.current !== current.scope) {
        managedScope.current = current.scope;
        setManaged(current.scope);
      }
    } catch {
      // An unplaced/retired list cannot supply an anchor; its normal placement remains authoritative.
    }
  }, [isActive, listRef]);
  const restore = useCallback(({ nativeMaxOffset, nativeOffset, nativeGeometryCommitted = false }: RestoreOptions = {}) => {
    const saved = anchor.current;
    const current = latest.current;
    if (!saved || saved.scope !== current.scope || saved.list !== listRef.current) return;
    const index = retirePrependedGeometry(saved, current.rows);
    if (index < 0) {
      release();
      return;
    }
    try {
      const layout = saved.list.getLayout(index);
      if (!layout) return;
      const offset = Math.max(0, layout.y + saved.list.getFirstItemOffset() - saved.viewportY);
      if (!Number.isFinite(offset)) return;
      if (Math.abs(offset - (nativeOffset ?? saved.list.getAbsoluteLastScrollOffset())) < 0.5) {
        if (nativeGeometryCommitted && nativeOffset !== undefined) {
          saved.geometryPending = false;
          saved.correction = null;
          saved.nativeOffset = nativeOffset;
        }
        return;
      }
      if (!nativeGeometryCommitted && saved.correction !== null && Math.abs(offset - saved.correction) < 0.5) return;
      saved.correction = offset;
      if (corrections.current?.scope !== current.scope || corrections.current.list !== saved.list) {
        corrections.current = { scope: current.scope, list: saved.list, offsets: [] };
      }
      const pending = corrections.current.offsets;
      // JS layout can precede the native child size. Android then clamps this
      // command to the old maximum and does not retry it when the child grows.
      const clampedOffset = nativeMaxOffset !== undefined && Number.isFinite(nativeMaxOffset)
        && nativeMaxOffset >= 0 && offset > nativeMaxOffset + 0.5 ? nativeMaxOffset : undefined;
      const existing = pending.find(value => Math.abs(value.offset - offset) < 0.5
        && value.clampedOffset === clampedOffset);
      if (existing) existing.seen = false;
      else pending.push({ offset, clampedOffset, seen: false });
      if (pending.length > 32) pending.splice(0, pending.length - 32);
      saved.list.scrollToOffset({ offset, animated: false });
    } catch {
      release();
    }
  }, [listRef, release]);
  const readerScrolled = useCallback((offset: number, reading = true, nativeHeight?: number) => {
    const saved = isActive() ? anchor.current : null;
    // The old native event may arrive before FlashList's first commit callback.
    if (saved) retirePrependedGeometry(saved, latest.current.rows);
    const pending = corrections.current;
    const acknowledged = pending?.scope === latest.current.scope && pending.list === listRef.current
      ? pending.offsets.filter(value => Math.abs(offset - value.offset) < 0.5
        || (value.clampedOffset !== undefined && Math.abs(offset - value.clampedOffset) < 0.5)) : [];
    // Several estimated-height corrections may be in flight. An older native
    // event, clamp or end-drag duplicate must not replace the reader anchor.
    if (acknowledged.length) {
      acknowledged.forEach(correction => { correction.seen = true; });
      if (saved?.correction !== null && saved?.correction !== undefined && Math.abs(offset - saved.correction) < 0.5) {
        saved.correction = null;
        saved.geometryPending = false;
        saved.nativeOffset = offset;
        saved.nativeHeight = nativeHeight ?? saved.nativeHeight;
        if (nativeHeight !== undefined) nativePosition.current = { scope: saved.scope, list: saved.list, offset, height: nativeHeight };
      }
      return true;
    }
    const oldGeometry = nativeHeight === undefined ? undefined
      : saved?.retiredGeometry.find(value => Math.abs(value.height - nativeHeight) < 0.5);
    if (oldGeometry) {
      // Keep this gesture's old coordinate space until the native child has
      // acknowledged the surviving row; later old-frame duplicates are inert.
      if (reading && saved?.geometryPending) {
        saved.viewportY += oldGeometry.offset - offset;
        oldGeometry.offset = offset;
      }
      return true;
    }
    // A grown native child can first report its uncorrected old offset. The
    // original gesture cannot turn that transient page head into a new anchor.
    // A fresh drag with that new geometry explicitly takes over in capture().
    if (saved?.geometryPending) return true;
    const list = listRef.current;
    if (list && nativeHeight !== undefined) nativePosition.current = { scope: latest.current.scope, list, offset, height: nativeHeight };
    if (reading && saved) capture(offset, nativeHeight);
    return false;
  }, [capture, isActive, listRef]);
  const beginDrag = useCallback((pagePending: boolean, position?: NativePosition) => {
    if (isActive() && anchor.current) retirePrependedGeometry(anchor.current, latest.current.rows);
    if (corrections.current) corrections.current.offsets = corrections.current.offsets.filter(value => !value.seen);
    if (managedScope.current === latest.current.scope || (pagePending && isActive())) capture(position?.offset, position?.height, true);
    else release();
  }, [capture, isActive, release]);
  return { managed: managed === scope, capture, restore, readerScrolled, beginDrag, release, isActive, isCorrectionPending };
}
