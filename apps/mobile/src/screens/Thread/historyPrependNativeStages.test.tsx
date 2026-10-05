import React from 'react';
import { act, cleanup, render } from '@testing-library/react-native';
import type { FlashListProps, FlashListRef } from '@shopify/flash-list';
import { CAPABILITY_MATRIX } from '@clawket/agent-protocol';
import type { UiMessage } from '../../types/chat';
import type { ThreadTimelineRow } from './model';
import type { ViewportQaInput, ViewportQaObserver } from './chatViewportQa';
import { ThreadView, type ThreadCopy, type ThreadViewProps } from './ThreadView';

// Characterization of a permitted host ordering, not a phone paint model.
// ThreadView, its anchor and the installed RecyclerView/manager/layout/tracker
// are real. Only host measurement, mounted-child state, commands and native
// event delivery are controlled. A Shadow size report does not apply a mount.
type Cell = { key: string; top: number; height: number };
type Command = { target: number; animated: boolean };
type Position = { offset: number; height: number };
type ScrollEvent = { nativeEvent: { contentOffset: { x: number; y: number };
  contentSize: { width: number; height: number }; layoutMeasurement: { width: number; height: number } } };
type ScrollHostProps = { onScroll?: (event: ScrollEvent) => void;
  onScrollBeginDrag?: (event: ScrollEvent) => void; onMomentumScrollEnd?: (event: ScrollEvent) => void;
  onContentSizeChange?: (width: number, height: number) => void;
  onLayout?: (event: { nativeEvent: { layout: { x: number; y: number; width: number; height: number } } }) => void };
type Snapshot = { stage: string; native: Position; mountedKeys: string[]; projectedKeys: string[];
  sdkOffset: number; sdkFirstKey: string | null; commandTargets: number[]; observations: ViewportQaInput[] };

const mockNative = { offset: 40, height: 3240, viewport: 400 };
const mockShadowCells = new Map<symbol, Cell>();
let mockMountedCells: Cell[] = [];
let mockScrollProps: ScrollHostProps | null = null;
let mockListProps: FlashListProps<ThreadTimelineRow> | null = null;
let mockList: FlashListRef<ThreadTimelineRow> | null = null;
const mockCommands: Command[] = [];
const mockObservations: ViewportQaInput[] = [];
const mockCommits: Snapshot[] = [];
const mockObserve: ViewportQaObserver = (value) => { mockObservations.push({ ...value }); return null; };

function mockIntersect(cells: Cell[], offset: number): string[] {
  return cells.filter(cell => cell.top < offset + mockNative.viewport && cell.top + cell.height > offset)
    .sort((a, b) => a.top - b.top).map(cell => cell.key);
}
function mockSnapshot(stage: string): Snapshot {
  const visible = mockList?.computeVisibleIndices();
  return { stage, native: { offset: mockNative.offset, height: mockNative.height },
    mountedKeys: mockIntersect(mockMountedCells, mockNative.offset),
    projectedKeys: mockIntersect([...mockShadowCells.values()], mockNative.offset),
    sdkOffset: mockList?.getAbsoluteLastScrollOffset() ?? -1,
    sdkFirstKey: visible ? mockListProps?.data?.[visible.startIndex]?.key ?? null : null,
    commandTargets: mockCommands.map(command => command.target),
    observations: mockObservations.map(value => ({ ...value })) };
}
function mockScrollTo({ y = 0, animated = false }: { y?: number; animated?: boolean }) {
  mockCommands.push({ target: y, animated });
}
function mockCell(children: React.ReactNode): { key: string; height: number } | null {
  // These are the real renderItem's elements, before unrelated message leaves
  // render. No row/layout or engaged-index calculation is recreated here.
  for (const element of React.Children.toArray(children)) {
    if (!React.isValidElement<{ message?: UiMessage; testID?: string; children?: React.ReactNode }>(element)) continue;
    if (element.props.message) return { key: `message:${element.props.message.renderKey ?? element.props.message.id}`, height: 100 };
    if (element.props.testID?.startsWith('thread-date:')) return { key: element.props.testID.slice(7), height: 40 };
    const nested = mockCell(element.props.children);
    if (nested) return nested;
  }
  return null;
}

jest.mock('react-native', () => {
  const Runtime = require('react');
  const original = jest.requireActual('react-native');
  const primitive = (name: string) => Runtime.forwardRef(({ children, index, style, ...props }: any, ref: any) => {
    const identity = Runtime.useRef(Symbol());
    const flat = Object.assign({}, ...[style].flat(Infinity).filter(Boolean));
    const cell = index === undefined ? null : mockCell(children);
    Runtime.useImperativeHandle(ref, () => ({
      measureLayout: (_relative: unknown, done: (...values: number[]) => void) =>
        done(0, 0, 393, cell?.height ?? flat.height ?? mockNative.viewport),
      scrollTo: mockScrollTo,
      scrollToEnd: ({ animated = false }: { animated?: boolean } = {}) =>
        mockScrollTo({ y: Math.max(0, mockNative.height - mockNative.viewport), animated }),
      measureInWindow: (done: (...values: number[]) => void) => done(0, 0, 393, mockNative.viewport),
      focus: () => undefined, blur: () => undefined, clear: () => undefined,
    }), [cell?.height, style]);
    Runtime.useLayoutEffect(() => {
      if (cell) mockShadowCells.set(identity.current, { ...cell, top: flat.top });
      return () => { mockShadowCells.delete(identity.current); };
    }, [cell?.key, cell?.height, flat.top]);
    Runtime.useLayoutEffect(() => {
      if (name === 'ScrollView') mockScrollProps = props;
    });
    return Runtime.createElement(name, { ...props, index,
      style: typeof style === 'function' ? style({ pressed: false }) : style }, children);
  });
  const View = primitive('View'), ScrollView = primitive('ScrollView');
  const NativeAnimated = require('../../../__mocks__/native-animated').Animated;
  return { ...original, View, ScrollView, Text: primitive('Text'), TextInput: primitive('TextInput'),
    Pressable: primitive('Pressable'), Image: primitive('Image'), Switch: primitive('Switch'),
    RefreshControl: primitive('RefreshControl'), ActivityIndicator: primitive('ActivityIndicator'),
    KeyboardAvoidingView: primitive('KeyboardAvoidingView'),
    Modal: ({ visible, children, ...props }: any) => visible ? Runtime.createElement('Modal', props, children) : null,
    DynamicColorIOS: (value: unknown) => value,
    useWindowDimensions: () => ({ width: 393, height: 852, scale: 1, fontScale: 1 }),
    BackHandler: { addEventListener: () => ({ remove: () => undefined }) },
    PanResponder: { create: (value: unknown) => ({ panHandlers: { __config: value } }) },
    Platform: { OS: 'android', select: (values: any) => values.android ?? values.default,
      constants: { reactNativeVersion: { major: 0, minor: 86, patch: 3 } } },
    PixelRatio: { getPixelSizeForLayoutSize: (value: number) => value, roundToNearestPixel: (value: number) => value },
    StyleSheet: { create: (value: unknown) => value, hairlineWidth: 1,
      absoluteFill: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
      flatten: (value: unknown) => Object.assign({}, ...[value].flat(Infinity).filter(Boolean)) },
    Animated: { ...NativeAnimated, View, ScrollView, createAnimatedComponent: (value: unknown) => value,
      event: (_mapping: unknown, options: any) => options.listener },
  };
});
jest.mock('@shopify/flash-list/src/native/config/PlatformHelper', () =>
  jest.requireActual('@shopify/flash-list/src/native/config/PlatformHelper.android'));
jest.mock('@shopify/flash-list', () => {
  const Runtime = require('react');
  const { RecyclerView } = require('@shopify/flash-list/src/recyclerview/RecyclerView');
  return { FlashList: Runtime.forwardRef((props: FlashListProps<ThreadTimelineRow>, ref: any) => {
    const inner = Runtime.useRef(null);
    Runtime.useImperativeHandle(ref, () => inner.current);
    Runtime.useLayoutEffect(() => { mockList = inner.current; mockListProps = props; });
    const commit = () => {
      mockList = inner.current; mockListProps = props;
      props.onCommitLayoutEffect?.();
      mockCommits.push(mockSnapshot('sdk_commit'));
    };
    return Runtime.createElement(RecyclerView, { ...props, ref: inner, onCommitLayoutEffect: commit });
  }) };
});
jest.mock('./useChatGeometryQa', () => ({ useChatGeometryQa: () => ({ enabled: false,
  observe: mockObserve, cell: () => undefined }) }));
const mockUiFollow = { bind: () => false, glide: () => undefined, snap: () => undefined, stop: () => undefined,
  qaGeometry: { enable: () => undefined, sample: () => undefined, bindingRevision: () => 0 } };
jest.mock('./useUiThreadFollow', () => ({ useUiThreadFollow: () => mockUiFollow }));
jest.mock('../../components/chat/AndroidChatKeyboardAvoider', () => ({
  AndroidChatKeyboardAvoider: ({ children, ...props }: any) => React.createElement(require('react-native').View, props, children),
}));
// Do not involve editor/provider/native Markdown execution in a list stage test.
jest.mock('../../components/ui/Composer', () => ({ Composer: React.forwardRef((_props: any, ref: any) => {
  React.useImperativeHandle(ref, () => ({ focus: () => undefined, blur: () => undefined, clear: () => undefined }));
  return React.createElement(require('react-native').View, { testID: 'stage-composer-leaf' });
}) }));
jest.mock('../../components/ui/Sheet', () => ({ Sheet: ({ visible, children, ...props }: any) =>
  visible ? React.createElement(require('react-native').View, props, children) : null }));
jest.mock('../../components/chat/SlashSuggestions', () => ({ SlashSuggestions: () => null }));
jest.mock('../../components/chat/ToolDetailModal', () => ({ ToolDetailModal: () => null }));
jest.mock('./components/ThreadMessageActionsOverlay', () => ({ ThreadMessageActionsOverlay: () => null }));
jest.mock('react-native-enriched-markdown', () => ({
  EnrichedMarkdownText: ({ markdown, ...props }: any) => React.createElement(require('react-native').Text, props, markdown),
}));
jest.mock('lucide-react-native', () => new Proxy({}, {
  get: (_target, key) => (props: any) => React.createElement(String(key), props),
}));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('../../theme', () => ({ useAppTheme: () => ({ theme:
  require('../../theme/theme').buildTheme('light', 'light', require('../../theme/accents').builtInAccents.iceBlue) }) }));
jest.mock('expo-file-system', () => ({ Paths: { cache: 'file:///cache' }, FileMode: { WriteOnly: 1 },
  Directory: jest.fn(), File: jest.fn() }));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn().mockResolvedValue(false), shareAsync: jest.fn() }));

const copy: ThreadCopy = {
  back: 'Back', settings: 'Settings', openSessions: 'Sessions', add: 'Add', voice: 'Voice', stopVoice: 'Stop voice',
  listening: 'Listening', send: 'Send', stop: 'Stop', reconnect: 'Reconnect', offline: 'Offline', thinking: 'Thinking',
  loadingHistory: 'History', locked: 'Locked', viewPro: 'Pro', retry: 'Retry', file: 'File', tool: 'Tool',
  toolRunning: 'Running', toolCompleted: 'Completed', toolFailed: 'Failed', approvalTitle: 'Approval',
  approvalError: 'Approval failed', pairApprovalDetail: 'Pair', device: 'Device', node: 'Node', allow: 'Allow', reject: 'Reject',
  allowed: 'Allowed', denied: 'Denied', expired: 'Expired', logs: 'Logs', placeholder: 'Message',
  formatEmpty: name => name, formatAttachments: count => String(count),
  formatPhotoPosition: (index, count) => `${index}/${count}`, formatRunDetail: status => status,
};
function messages(first: number): UiMessage[] {
  // One minute/day: prepend replaces the date separator while content keys survive.
  return Array.from({ length: 41 - first }, (_, i) => first + i).reverse().flatMap(turn => [
    { id: `assistant:${turn}`, role: 'assistant' as const, text: `synthetic assistant ${turn}`, timestampMs: 1_700_000_000_000 + turn * 100 + 1 },
    { id: `user:${turn}`, role: 'user' as const, text: `synthetic user ${turn}`, timestampMs: 1_700_000_000_000 + turn * 100 },
  ]);
}
function props(first = 25): ThreadViewProps {
  return { agentId: 'stage-agent', agentName: 'Stage Agent', sessionKey: 'stage-owned', historyScope: 'stage-owned',
    capabilities: { ...CAPABILITY_MATRIX.codex }, state: { kind: 'ready' }, messages: messages(first),
    input: '', isRunning: false, canSend: true, copy, onBack: jest.fn(), onOpenSettings: jest.fn(),
    onChangeInput: jest.fn(), onSend: jest.fn() };
}
function event(position: Position = mockNative): ScrollEvent {
  return { nativeEvent: { contentOffset: { x: 0, y: position.offset }, contentSize: { width: 393, height: position.height },
    layoutMeasurement: { width: 393, height: mockNative.viewport } } };
}
function nativeScroll(position: Position = mockNative) {
  if (!mockScrollProps?.onScroll) throw new Error('missing real SDK scroll handler');
  mockScrollProps.onScroll(event(position));
}
function shadowSize(height: number) {
  if (!mockScrollProps?.onContentSizeChange) throw new Error('missing real Thread content-size callback');
  mockScrollProps.onContentSizeChange(393, height);
}
function mountChild(height: number) {
  mockNative.height = height;
  mockMountedCells = [...mockShadowCells.values()].map(cell => ({ ...cell }));
  // Applying host child layout does not synthesize a size/scroll event.
}
function applyCommand(): Position {
  const command = mockCommands.shift();
  if (!command) throw new Error('missing actual consumer command');
  mockNative.offset = Math.max(0, Math.min(command.target, mockNative.height - mockNative.viewport));
  return { offset: mockNative.offset, height: mockNative.height };
}
function offsetCommands() { return mockObservations.filter(value => value.kind === 'offset_command'); }
function acknowledgements() { return mockObservations.filter(value => ['offset_ack', 'clamp_ack', 'older_ack'].includes(value.kind)); }
function mark(stage: string) { const value = mockSnapshot(stage); mockCommits.push(value); return value; }

const oldRaf = global.requestAnimationFrame, oldCancelRaf = global.cancelAnimationFrame;
beforeEach(() => {
  jest.useFakeTimers();
  global.requestAnimationFrame = callback => setTimeout(() => callback(Date.now()), 16) as unknown as number;
  global.cancelAnimationFrame = id => clearTimeout(id);
  Object.assign(mockNative, { offset: 40, height: 3240, viewport: 400 });
  mockShadowCells.clear(); mockMountedCells = []; mockScrollProps = null; mockList = null; mockListProps = null;
  mockCommands.length = mockObservations.length = mockCommits.length = 0;
});
afterEach(() => {
  cleanup(); jest.clearAllTimers(); jest.useRealTimers();
  global.requestAnimationFrame = oldRaf; global.cancelAnimationFrame = oldCancelRaf;
});
function startReader() {
  // Only settle the installed SDK's initial 100 ms ignore window and the real
  // Thread entry reveal. This clock does not stand in for any native mount.
  act(() => jest.advanceTimersByTime(400));
  act(() => {
    mockScrollProps!.onLayout!({ nativeEvent: { layout: { x: 0, y: 0, width: 393, height: 400 } } });
    shadowSize(3240);
    nativeScroll();
  });
  mockCommands.length = 0;
  act(() => {
    mockScrollProps!.onScrollBeginDrag!(event());
    mockScrollProps!.onMomentumScrollEnd!(event());
  });
  mountChild(3240);
  expect(mockListProps?.maintainVisibleContentPosition).toEqual({ disabled: true });
  expect(mark('baseline').mountedKeys).toContain('message:user:25');
  mockCommands.length = mockObservations.length = mockCommits.length = 0;
}

it('separates early Shadow size, old-child command clamp, child mount and later real SDK event', () => {
  const initial = props();
  const view = render(<ThreadView {...initial} />);
  startReader();
  view.rerender(<ThreadView {...props(9)} />);
  const rowCommits = [...mockCommits];
  expect(rowCommits.length).toBeGreaterThan(0);
  expect(rowCommits.some(value => value.projectedKeys.includes('message:user:9'))).toBe(true);
  expect(mockCommands).toHaveLength(0);

  // 1: The public size callback reports new Shadow geometry while the actual
  // modeled child/cell tree is still old. The real consumer elects its command.
  act(() => shadowSize(6440));
  const shadow = mark('shadow_size');
  expect(shadow.native).toEqual({ offset: 40, height: 3240 });
  expect(shadow.mountedKeys).toContain('message:user:25');
  expect(shadow.commandTargets).toEqual([3240]);
  expect(offsetCommands().at(-1)).toMatchObject({ targetOffset: 3240, maxOffset: 6040 });

  // 2: Applying that actual command before child mount clamps to the old max.
  const oldClamp = applyCommand();
  expect(oldClamp).toEqual({ offset: 2840, height: 3240 });
  act(() => nativeScroll(oldClamp));
  mark('old_child_clamp');
  expect(acknowledgements()).toHaveLength(1);
  expect(mockObservations).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: 'clamp_ack', targetOffset: 3240, geometryPending: true }),
  ]));

  // 3: Child mounting alone changes neither absolute offset nor JS event data.
  const observationCount = mockObservations.length;
  mountChild(6440);
  const mounted = mark('child_mount');
  expect(mounted.native).toEqual({ offset: 2840, height: 6440 });
  expect(mockObservations).toHaveLength(observationCount);
  expect(mockCommands).toHaveLength(0);

  // 4: A genuine later event traverses the SDK. It is not the target ACK.
  // Thread's scroll callback does not restore directly, but SDK window work
  // may cause its real commit callback to retry; retain that actual outcome.
  // Never supply a size event or call restore merely to make this test pass.
  const beforeLater = mockObservations.length;
  act(() => nativeScroll());
  const later = mark('later_native_scroll');
  expect(later.sdkOffset).toBe(2840);
  expect(later.mountedKeys).not.toContain('message:user:25');
  // The same observed clamp remains in the ledger after the child grows;
  // repeating it acknowledges that clamp, never the still-pending target.
  expect(acknowledgements()).toHaveLength(2);
  expect(mockObservations.slice(beforeLater)).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: 'clamp_ack', contentHeight: 6440, targetOffset: 3240, geometryPending: true }),
  ]));
  expect(mockCommands.every(command => command.target === 3240)).toBe(true);
  if (mockCommands.length) {
    expect(mockObservations.slice(beforeLater).some(value => value.kind === 'layout_begin')).toBe(true);
  }
  expect(initial.onSend).not.toHaveBeenCalled();
});

it('restores the surviving content row when child mount really precedes the size-triggered command', () => {
  const view = render(<ThreadView {...props()} />);
  startReader();
  view.rerender(<ThreadView {...props(9)} />);
  mountChild(6440);
  act(() => shadowSize(6440));
  expect(mockCommands.map(command => command.target)).toEqual([3240]);
  const applied = applyCommand();
  expect(applied).toEqual({ offset: 3240, height: 6440 });
  expect(mark('command_applied_before_ack').mountedKeys).toContain('message:user:25');
  expect(acknowledgements()).toHaveLength(0);
  act(() => nativeScroll(applied));
  expect(mark('actual_target_ack').sdkFirstKey).toBe('message:user:25');
  expect(acknowledgements().at(-1)).toMatchObject({ kind: 'offset_ack', targetOffset: 3240, geometryPending: true });
  expect(mockListProps?.drawDistance).toBe(250);
});

it('can retry with a separate real size callback after an early command was clamped', () => {
  const view = render(<ThreadView {...props()} />);
  startReader();
  view.rerender(<ThreadView {...props(9)} />);
  act(() => shadowSize(6440));
  const oldClamp = applyCommand();
  act(() => nativeScroll(oldClamp));
  mountChild(6440);
  expect(mockCommands).toHaveLength(0);
  // This is an explicit *additional input*, not an automatic mount effect.
  act(() => shadowSize(6440));
  expect(mockCommands.map(command => command.target)).toEqual([3240]);
  const applied = applyCommand();
  act(() => nativeScroll(applied));
  expect(mark('conditional_size_retry_ack').sdkFirstKey).toBe('message:user:25');
  expect(offsetCommands()).toHaveLength(2);
  expect(acknowledgements().at(-1)?.kind).toBe('offset_ack');
});

it('lets a fresh old-child reader displacement retire the old target before late command feedback', () => {
  const view = render(<ThreadView {...props()} />);
  startReader();
  view.rerender(<ThreadView {...props(9)} />);
  act(() => shadowSize(6440));
  const delayed = mockCommands.shift();
  expect(delayed?.target).toBe(3240);
  // The old command has not applied. A new finger in the old child's actual
  // geometry is distinct from both the queued target and SDK's new layouts.
  act(() => mockScrollProps!.onScrollBeginDrag!(event()));
  mockNative.offset = 140;
  act(() => {
    nativeScroll();
    mockScrollProps!.onMomentumScrollEnd!(event());
  });
  mountChild(6440);
  act(() => shadowSize(6440));
  expect(mockCommands.map(command => command.target)).toEqual([3340]);
  // The delayed old command really applies to the newly mounted child before
  // the latest command. Keep its *observed applied position* buffered, rather
  // than manufacture feedback for a command that never reached the host.
  if (!delayed) throw new Error('missing delayed native command');
  mockCommands.unshift(delayed);
  const bufferedOldPosition = applyCommand();
  expect(bufferedOldPosition).toEqual({ offset: 3240, height: 6440 });
  const applied = applyCommand();
  expect(applied).toEqual({ offset: 3340, height: 6440 });
  act(() => nativeScroll(applied));
  expect(acknowledgements().at(-1)).toMatchObject({ kind: 'offset_ack', targetOffset: 3340 });
  // An already buffered old command event does not move the native host and
  // is not a fresh reader input. The real ledger retains the old correlation.
  act(() => nativeScroll(bufferedOldPosition));
  expect(acknowledgements()).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: 'older_ack', targetOffset: 3240 }),
  ]));
  expect(mockNative.offset).toBe(3340);
  // An SDK commit may correct stale SDK feedback. Any such real command must
  // keep the fresh reader's target, not resurrect the initial 3240 anchor.
  expect(mockCommands.every(command => command.target === 3340)).toBe(true);
});

it('keeps the reader anchor when an early command clamps while the original drag is still reading', () => {
  const initial = props();
  const view = render(<ThreadView {...initial} />);
  startReader();
  // Retain real Thread reader intent; do not settle this drag before the
  // Shadow report and actual command feedback traverse the installed SDK.
  act(() => mockScrollProps!.onScrollBeginDrag!(event()));
  view.rerender(<ThreadView {...props(9)} />);
  act(() => shadowSize(6440));
  expect(mockCommands.map(command => command.target)).toEqual([3240]);
  expect(offsetCommands().at(-1)).toMatchObject({ targetOffset: 3240, maxOffset: 6040 });

  const oldClamp = applyCommand();
  expect(oldClamp).toEqual({ offset: 2840, height: 3240 });
  act(() => nativeScroll(oldClamp));
  expect(acknowledgements().at(-1)).toMatchObject({ kind: 'clamp_ack', targetOffset: 3240, geometryPending: true });
  expect(mockListProps?.drawDistance).toBeGreaterThan(250);
  // Duplicate feedback must use the observed clamp correlation even though
  // the first callback marked it seen. It still cannot complete the target.
  act(() => nativeScroll(oldClamp));
  expect(acknowledgements()).toHaveLength(2);
  expect(acknowledgements().every(value => value.kind === 'clamp_ack' && value.targetOffset === 3240)).toBe(true);
  expect(mockObservations.filter(value => value.kind === 'old_geometry')).toHaveLength(0);
  expect(mockCommands).toHaveLength(0);

  mountChild(6440);
  // Only this separate size input permits the original target to be retried.
  act(() => shadowSize(6440));
  expect(mockCommands.map(command => command.target)).toEqual([3240]);
  const applied = applyCommand();
  act(() => nativeScroll(applied));
  expect(mark('original_reader_target_ack').sdkFirstKey).toBe('message:user:25');
  expect(acknowledgements().at(-1)).toMatchObject({ kind: 'offset_ack', targetOffset: 3240 });
  expect(mockListProps?.drawDistance).toBe(250);
  expect(initial.onSend).not.toHaveBeenCalled();
});
