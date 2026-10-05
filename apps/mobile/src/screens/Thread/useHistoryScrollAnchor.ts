import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { ViewportQaInput, ViewportQaObserver, ViewportQaObservation } from './chatViewportQa';

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
  windowPreparations: number;
};
type Corrections = {
  scope: string;
  list: List;
  offsets: Array<{ offset: number; clampedOffset: number | undefined; seen: boolean; commandObservation: ViewportQaObservation | null }>;
};
type RestoreOptions = { nativeMaxOffset?: number; nativeOffset?: number; nativeGeometryCommitted?: boolean;
  nativeHeight?: number; viewport?: number; windowCommitEpoch?: number };
type WindowPlan = { scope: string; list: List; key: string; epoch: number; distance: number; committed: boolean };
const WINDOW_ROW_BUDGET = 96;
const WINDOW_VIEWPORT_BUDGET = 16;

function boundedWindowDistance(list: List, rows: ReadonlyArray<Row>, minimum: number, viewport: number) {
  // Velocity projection is private and can shift the SDK window past either
  // edge. Its edge redistribution covers all layouts when 2 * drawDistance
  // reaches the whole span. Only use that proof for a bounded number of rows
  // and pixels; counting merely the new page misses old compact rows.
  if (rows.length > WINDOW_ROW_BUDGET) return null;
  const last = list.getLayout(rows.length - 1);
  if (!last || !Number.isFinite(last.y) || last.height === undefined || !Number.isFinite(last.height)) return null;
  const distance = Math.ceil(Math.max(minimum, (last.y + last.height + list.getFirstItemOffset()) / 2));
  return distance <= viewport * WINDOW_VIEWPORT_BUDGET ? distance : null;
}

function retirePrependedGeometry(saved: Anchor, rows: ReadonlyArray<Row>) {
  const index = rows.findIndex(row => row.key === saved.key);
  if (index > saved.rowIndex && saved.nativeHeight !== undefined) {
    const existing = saved.retiredGeometry.find(value => Math.abs(value.height - saved.nativeHeight!) < 0.5);
    if (existing) existing.offset = saved.nativeOffset;
    else saved.retiredGeometry.push({ height: saved.nativeHeight, offset: saved.nativeOffset });
    if (saved.retiredGeometry.length > 32) saved.retiredGeometry.shift();
    saved.geometryPending = true;
    saved.windowPreparations = 0;
  }
  saved.rowIndex = index;
  return index;
}

/** A conditional date separator is not a surviving row when an earlier page joins its minute. */
export function useHistoryScrollAnchor(scope: string, listRef: RefObject<List | null>, rows: ReadonlyArray<Row>, baselineDrawDistance = 250,
  observe?: ViewportQaObserver) {
  const observer = useRef(observe); observer.current = observe;
  const emit = useCallback((value: ViewportQaInput, command?: ViewportQaObservation | null) => {
    try { return observer.current?.(value, command) ?? null; } catch { return null; }
  }, []);
  const latest = useRef({ scope, rows });
  latest.current = { scope, rows };
  const anchor = useRef<Anchor | null>(null);
  const corrections = useRef<Corrections | null>(null);
  const nativePosition = useRef<(NativePosition & { scope: string; list: List }) | null>(null);
  const managedScope = useRef<string | null>(null);
  const [managed, setManaged] = useState<string | null>(null);
  const windowPlan = useRef<WindowPlan | null>(null);
  const windowEpoch = useRef(0);
  const [preparedWindow, setPreparedWindow] = useState<WindowPlan | null>(null);
  const retireWindow = useCallback(() => {
    if (!windowPlan.current) return;
    windowPlan.current = null;
    windowEpoch.current += 1;
    setPreparedWindow(null);
  }, []);
  const isActive = useCallback(() => anchor.current?.scope === latest.current.scope
    && anchor.current.list === listRef.current, [listRef]);
  const isCorrectionPending = useCallback(() => isActive()
    && (anchor.current?.correction != null || anchor.current?.geometryPending === true), [isActive]);
  const release = useCallback(() => {
    anchor.current = null;
    corrections.current = null;
    nativePosition.current = null;
    retireWindow();
  }, [retireWindow]);
  useLayoutEffect(() => {
    if (anchor.current?.scope !== scope) anchor.current = null;
    if (corrections.current?.scope !== scope) corrections.current = null;
    if (nativePosition.current?.scope !== scope) nativePosition.current = null;
    if (windowPlan.current?.scope !== scope) retireWindow();
    if (managedScope.current !== scope) {
      managedScope.current = null;
      setManaged(null);
    }
  }, [retireWindow, scope]);
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
        retiredGeometry: previous?.retiredGeometry ?? [], geometryPending: false, windowPreparations: 0 };
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
  const restore = useCallback(({ nativeMaxOffset, nativeOffset, nativeGeometryCommitted = false,
    nativeHeight, viewport, windowCommitEpoch }: RestoreOptions = {}) => {
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
          retireWindow();
        }
        return;
      }
      if (viewport !== undefined && viewport > 0 && nativeHeight !== undefined) {
        // Prepare both the old window and target before moving native. This
        // public prop can be retired synchronously by a fresh finger/scope.
        const distance = boundedWindowDistance(saved.list, current.rows, baselineDrawDistance, viewport);
        const oldChild = saved.retiredGeometry.some(value => Math.abs(value.height - nativeHeight) < 0.5);
        if (saved.geometryPending || windowPlan.current) {
          const previousPlan = windowPlan.current;
          const needsPreparation = !previousPlan || previousPlan.scope !== current.scope || previousPlan.list !== saved.list
            || previousPlan.key !== saved.key || (distance !== null && previousPlan.distance < distance);
          const bounded = distance !== null && (!needsPreparation || saved.windowPreparations < 4);
          if (bounded && distance !== null) {
            let plan = windowPlan.current;
            if (!plan || plan.scope !== current.scope || plan.list !== saved.list || plan.key !== saved.key
              || plan.distance < distance) {
              plan = { scope: current.scope, list: saved.list, key: saved.key,
                epoch: ++windowEpoch.current, distance, committed: false };
              saved.windowPreparations += 1;
              windowPlan.current = plan;
              setPreparedWindow(plan);
              emit({ kind: 'geometry_pending', targetOffset: offset, anchorIndex: index, anchorY: layout.y,
                contentHeight: nativeHeight, viewportHeight: viewport, geometryPending: saved.geometryPending,
                windowEpoch: plan.epoch, drawDistance: distance, maxOffset: nativeMaxOffset });
              return;
            }
            if (windowCommitEpoch === plan.epoch) plan.committed = true;
            if (!plan.committed) return;
          } else {
            // Oversized gaps retain the anchor without unbounded native views.
            // They still wait for the new child; no uncancellable index scroll.
            retireWindow();
          }
          const last = saved.list.getLayout(current.rows.length - 1);
          const placedBottom = last && last.height !== undefined
            ? last.y + last.height + saved.list.getFirstItemOffset() : Infinity;
          // A newly measured page may shrink old estimates by the same amount
          // it prepends. An explicit size report covering every placed row is
          // sufficient reachability even when its total equals the old child.
          // Neither this nor a React commit is a native paint acknowledgement.
          if ((oldChild && !(nativeGeometryCommitted && nativeHeight >= placedBottom - 0.5))
            || (nativeMaxOffset !== undefined && offset > nativeMaxOffset + 0.5)) {
            emit({ kind: 'geometry_pending', targetOffset: offset, anchorIndex: index, anchorY: layout.y,
              contentHeight: nativeHeight, viewportHeight: viewport, geometryPending: saved.geometryPending,
              maxOffset: nativeMaxOffset, windowEpoch: windowPlan.current?.epoch, drawDistance: distance });
            return;
          }
        }
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
      const commandObservation = emit({ kind: 'offset_command', targetOffset: offset, anchorIndex: index, anchorY: layout.y,
        offset: nativeOffset, contentHeight: nativeHeight, viewportHeight: viewport, maxOffset: nativeMaxOffset,
        geometryPending: saved.geometryPending, windowEpoch: windowPlan.current?.epoch });
      if (existing) { existing.seen = false; existing.commandObservation = commandObservation; }
      else pending.push({ offset, clampedOffset, seen: false, commandObservation });
      if (pending.length > 32) pending.splice(0, pending.length - 32);
      saved.list.scrollToOffset({ offset, animated: false });
    } catch {
      release();
    }
  }, [baselineDrawDistance, emit, listRef, release, retireWindow]);
  const readerScrolled = useCallback((offset: number, reading = true, nativeHeight?: number, nativeViewport?: number) => {
    const saved = isActive() ? anchor.current : null;
    // The old native event may arrive before FlashList's first commit callback.
    if (saved) retirePrependedGeometry(saved, latest.current.rows);
    const pending = corrections.current;
    const oldGeometry = nativeHeight === undefined ? undefined
      : saved?.retiredGeometry.find(value => Math.abs(value.height - nativeHeight) < 0.5);
    // Shadow sizing can precede child mount. Bind an unseen command's clamp
    // to this event's actual geometry, keeping repeat feedback in the ledger.
    // The same value alone cannot distinguish a finger reaching the old end.
    if (saved?.geometryPending && oldGeometry && pending?.scope === latest.current.scope && pending.list === listRef.current
      && nativeHeight !== undefined && Number.isFinite(nativeHeight) && nativeHeight >= 0
      && nativeViewport !== undefined && Number.isFinite(nativeViewport) && nativeViewport > 0) {
      const actualMax = Math.max(0, nativeHeight - nativeViewport);
      if (Math.abs(offset - actualMax) < 0.5) {
        for (const correction of pending.offsets) {
          if (!correction.seen && correction.clampedOffset === undefined && correction.offset > actualMax + 0.5) {
            correction.clampedOffset = actualMax;
          }
        }
      }
    }
    const acknowledged = pending?.scope === latest.current.scope && pending.list === listRef.current
      ? pending.offsets.filter(value => Math.abs(offset - value.offset) < 0.5
        || (value.clampedOffset !== undefined && Math.abs(offset - value.clampedOffset) < 0.5)) : [];
    // Several estimated-height corrections may be in flight. An older native
    // event, clamp or end-drag duplicate must not replace the reader anchor.
    if (acknowledged.length) {
      acknowledged.forEach(correction => emit({ kind: Math.abs(offset - correction.offset) >= 0.5 ? 'clamp_ack'
        : saved?.correction === correction.offset ? 'offset_ack' : 'older_ack', offset, contentHeight: nativeHeight,
        targetOffset: correction.offset, geometryPending: saved?.geometryPending }, correction.commandObservation));
      acknowledged.forEach(correction => { correction.seen = true; });
      if (saved?.correction !== null && saved?.correction !== undefined && Math.abs(offset - saved.correction) < 0.5) {
        saved.correction = null;
        saved.geometryPending = false;
        saved.nativeOffset = offset;
        saved.nativeHeight = nativeHeight ?? saved.nativeHeight;
        retireWindow();
        if (nativeHeight !== undefined) nativePosition.current = { scope: saved.scope, list: saved.list, offset, height: nativeHeight };
      }
      return true;
    }
    if (oldGeometry) {
      emit({ kind: 'old_geometry', offset, contentHeight: nativeHeight, geometryPending: saved?.geometryPending });
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
    if (saved?.geometryPending) {
      emit({ kind: 'geometry_pending', offset, contentHeight: nativeHeight, geometryPending: true });
      return true;
    }
    const list = listRef.current;
    if (list && nativeHeight !== undefined) nativePosition.current = { scope: latest.current.scope, list, offset, height: nativeHeight };
    // A first drag may precede placed rows. Its next native event can still
    // elect the reader; waiting for a second drag leaves two scroll owners.
    if (reading) capture(offset, nativeHeight);
    return false;
  }, [capture, emit, isActive, listRef, retireWindow]);
  const beginDrag = useCallback((_pagePending: boolean, position?: NativePosition) => {
    retireWindow();
    const saved = isActive() ? anchor.current : null;
    if (saved) {
      retirePrependedGeometry(saved, latest.current.rows);
      // A settled prepend can retain its old total height. A fresh finger
      // owns that height even if row placement must wait for its next event.
      // Pending old-child displacement and in-flight commands stay fenced.
      if (!saved.geometryPending && position && Number.isFinite(position.height)) {
        saved.retiredGeometry = saved.retiredGeometry.filter(value => Math.abs(value.height - position.height) >= 0.5);
      }
    }
    if (corrections.current) corrections.current.offsets = corrections.current.offsets.filter(value => !value.seen);
    // Ordinary reading needs the same owner as paging. Only a valid captured
    // row disables SDK compensation; bottom settlement still releases it.
    capture(position?.offset, position?.height, true);
  }, [capture, isActive, retireWindow]);
  const activeWindow = preparedWindow?.scope === scope && preparedWindow.list === listRef.current
    && preparedWindow === windowPlan.current ? preparedWindow : null;
  return { managed: managed === scope, capture, restore, readerScrolled, beginDrag, release, isActive, isCorrectionPending,
    drawDistance: activeWindow?.distance ?? baselineDrawDistance, windowCommitEpoch: activeWindow?.epoch };
}
