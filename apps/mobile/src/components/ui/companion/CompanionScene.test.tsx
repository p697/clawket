import React from 'react';
import { act, render } from '@testing-library/react-native';
import { CompanionScene } from './CompanionScene';
import { LoadingState, useLoadingHandoff } from '../LoadingState';
import { FontSize, FontWeight, Motion } from '../../../theme/tokens';

jest.mock('react-native', () => {
  const R = require('react');
  const host = (name: string) => ({ children, ...props }: Record<string, unknown> & { children?: React.ReactNode }) => R.createElement(name, props, children);
  return {
    Platform: { OS: 'ios', select: (options: Record<string, unknown>) => options.ios ?? options.default },
    AppState: { currentState: 'active', addEventListener: () => ({ remove: () => undefined }) },
    StyleSheet: { create: (value: unknown) => value, absoluteFill: {} },
    View: host('View'),
    Text: host('Text'),
    Pressable: host('Pressable'),
  };
});
jest.mock('react-native-svg', () => {
  const R = require('react');
  const host = (name: string) => ({ children, ...props }: Record<string, unknown> & { children?: React.ReactNode }) => R.createElement(name, props, children);
  return new Proxy({ __esModule: true }, {
    get: (target: Record<string, unknown>, name: string) => (name in target ? target[name] : host(name === 'default' ? 'Svg' : name)),
  });
});
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('../../../theme', () => ({
  useAppTheme: () => ({ theme: { scheme: 'light', colors: { ink: '#111113', canvas: '#ffffff', surface: '#f2f2f4', line: '#e4e4e8', inkSecondary: '#6b6b72' } } }),
}));
jest.mock('../Button', () => ({ Button: (props: Record<string, unknown>) => require('react').createElement('Button', props) }));
jest.mock('../../../services/haptics', () => ({
  triggerHeavyImpact: jest.fn(), triggerLightImpact: jest.fn(), triggerMediumImpact: jest.fn(), triggerSelectionHaptic: jest.fn(),
}));

const haptics = jest.requireMock('../../../services/haptics') as Record<string, jest.Mock>;

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  jest.spyOn(Math, 'random').mockReturnValue(0);
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

function pressable(view: ReturnType<typeof render>) {
  return view.getByTestId('scene');
}

it.each(['peek', 'fetch', 'yarn', 'pounce', 'listen'] as const)('draws the %s scene in one SVG stage', (scene) => {
  const view = render(<CompanionScene scene={scene} phase="wait" testID="scene" />);
  expect(view.UNSAFE_getAllByType('Svg' as unknown as React.ComponentType).length).toBeGreaterThan(0);
  // The Companion is always part of the stage: its face path comes from the shared geometry.
  expect(view.UNSAFE_getAllByType('Path' as unknown as React.ComponentType).length).toBeGreaterThan(3);
  view.unmount();
});

it('sets Peek\'s desk in the page\'s card color, defaulting to the canvas surface', () => {
  const desk = (view: ReturnType<typeof render>) => view.UNSAFE_getAllByType('Rect' as unknown as React.ComponentType)
    .find((rect) => rect.props.width === 164)?.props.fill;
  const plain = render(<CompanionScene scene="peek" phase="wait" testID="scene" />);
  expect(desk(plain)).toBe('#f2f2f4');
  plain.unmount();
  const loader = render(<LoadingState scene="peek" surface="#FFFFFF" />);
  expect(desk(loader)).toBe('#FFFFFF');
});

it('answers a tap with a press, a happy flavour and a light haptic, then rests', () => {
  const view = render(<CompanionScene scene="yarn" phase="wait" testID="scene" />);
  act(() => { pressable(view).props.onPress(); });
  // Math.random() = 0 picks the weighted favourite: a hop with hearts.
  expect(view.getByTestId('companion-mark-heart1')).toBeTruthy();
  expect(haptics.triggerLightImpact).toHaveBeenCalledTimes(1);
  act(() => { jest.advanceTimersByTime(1_400); });
  expect(view.queryByTestId('companion-mark-heart1')).toBeNull();
});

it('greets the tap that finds a hidden cat with surprise', () => {
  const view = render(<CompanionScene scene="peek" phase="wait" testID="scene" />);
  act(() => { pressable(view).props.onPress(); });
  expect(view.getByTestId('companion-mark-bang')).toBeTruthy();
});

it('warns, then swipes the glass on rapid taps, sulks and calms down', () => {
  jest.spyOn(Math, 'random').mockReturnValue(0.99);
  const view = render(<CompanionScene scene="yarn" phase="wait" testID="scene" />);
  for (let index = 0; index < 3; index += 1) act(() => { pressable(view).props.onPress(); });
  expect(view.getByTestId('companion-mark-vein')).toBeTruthy();
  expect(haptics.triggerMediumImpact).toHaveBeenCalled();
  // A random of 0.99 sets the patience limit to seven taps.
  for (let index = 0; index < 4; index += 1) act(() => { pressable(view).props.onPress(); });
  expect(view.getByTestId('companion-claw')).toBeTruthy();
  expect(haptics.triggerHeavyImpact).toHaveBeenCalledTimes(1);
  act(() => { jest.advanceTimersByTime(420); });
  expect(view.getByTestId('companion-mark-dots')).toBeTruthy();
  act(() => { jest.advanceTimersByTime(2_000); });
  expect(view.queryByTestId('companion-mark-dots')).toBeNull();
  expect(view.queryByTestId('companion-claw')).toBeNull();
});

it('purrs while petted and settles when released', () => {
  const view = render(<CompanionScene scene="listen" phase="wait" testID="scene" />);
  expect(pressable(view).props.delayLongPress).toBe(450);
  act(() => { pressable(view).props.onLongPress(); });
  expect(view.getByTestId('companion-mark-purr')).toBeTruthy();
  expect(view.getByTestId('companion-mark-heart1')).toBeTruthy();
  act(() => { jest.advanceTimersByTime(270); });
  expect(haptics.triggerSelectionHaptic).toHaveBeenCalledTimes(3);
  act(() => { pressable(view).props.onPressOut(); });
  expect(view.queryByTestId('companion-mark-purr')).toBeNull();
  act(() => { jest.advanceTimersByTime(500); });
  expect(haptics.triggerSelectionHaptic).toHaveBeenCalledTimes(3);
});

it('ignores taps during the success exit', () => {
  const view = render(<CompanionScene scene="pounce" phase="ready" testID="scene" />);
  expect(pressable(view).props.disabled).toBe(true);
  act(() => { pressable(view).props.onPress(); });
  expect(view.queryByTestId('companion-mark-heart1')).toBeNull();
  expect(haptics.triggerLightImpact).not.toHaveBeenCalled();
});

it('drops an angry cat\'s marks and claw the moment the wait succeeds', () => {
  jest.spyOn(Math, 'random').mockReturnValue(0.99);
  const view = render(<CompanionScene scene="yarn" phase="wait" testID="scene" />);
  for (let index = 0; index < 7; index += 1) act(() => { pressable(view).props.onPress(); });
  expect(view.getByTestId('companion-claw')).toBeTruthy();
  view.rerender(<CompanionScene scene="yarn" phase="ready" testID="scene" />);
  expect(view.queryByTestId('companion-claw')).toBeNull();
  expect(view.queryByTestId('companion-mark-vein')).toBeNull();
  // The sulk scheduled by the swipe never arrives: the cat is smiling on its way out.
  act(() => { jest.advanceTimersByTime(2_500); });
  expect(view.queryByTestId('companion-mark-dots')).toBeNull();
});

it('shows a pinned scene inside the loading state and a still cat under reduced motion', () => {
  const view = render(<LoadingState testID="loading" scene="fetch" message="Connecting" />);
  expect(view.getByTestId('loading-scene').props.accessible).toBe(false);
  expect(view.getByTestId('loading').props.accessibilityLabel).toBe('Connecting');
  view.unmount();
  const reanimated = jest.requireMock('react-native-reanimated') as { useReducedMotion: () => boolean };
  const spy = jest.spyOn(reanimated, 'useReducedMotion').mockReturnValue(true);
  const still = render(<LoadingState testID="loading" message="Connecting" />);
  expect(still.queryByTestId('loading-scene')).toBeNull();
  spy.mockRestore();
});

it('hides its label and stops being busy the moment the wait succeeds', () => {
  const view = render(<LoadingState testID="loading" scene="fetch" message="Loading history" />);
  expect(view.getByTestId('loading-message').props.style).not.toContainEqual({ opacity: 0 });
  expect(view.getByTestId('loading').props.accessibilityState).toEqual({ busy: true });
  view.rerender(<LoadingState testID="loading" scene="fetch" message="Loading history" phase="ready" />);
  expect(view.queryByTestId('loading-message')).toBeNull();
  const message = view.UNSAFE_getAllByType('Text' as unknown as React.ComponentType).find(node => node.props.testID === 'loading-message');
  const group = view.UNSAFE_getAllByType('View' as unknown as React.ComponentType).find(node => node.props.testID === 'loading');
  expect(message?.props.style).toContainEqual({ opacity: 0 });
  expect(group?.props.accessibilityState).toEqual({ busy: false });
  expect(group?.props.accessibilityLabel).toBeUndefined();
  expect(group?.props.importantForAccessibility).toBe('no-hide-descendants');
});

it('starts the slow-wait hint from zero when a new wait follows success', () => {
  const slowAction = { label: 'Retry', onPress: jest.fn() };
  const view = render(<LoadingState testID="loading" scene="fetch" message="Connecting" slowAction={slowAction} />);
  act(() => { jest.advanceTimersByTime(Motion.loadingSlowHint); });
  expect(view.getByTestId('loading-slow')).toBeTruthy();
  view.rerender(<LoadingState testID="loading" scene="fetch" message="Connecting" slowAction={slowAction} phase="ready" />);
  expect(view.queryByTestId('loading-slow')).toBeNull();
  view.rerender(<LoadingState testID="loading" scene="fetch" message="Connecting" slowAction={slowAction} phase="wait" />);
  expect(view.queryByTestId('loading-slow')).toBeNull();
  act(() => { jest.advanceTimersByTime(Motion.loadingSlowHint - 1); });
  expect(view.queryByTestId('loading-slow')).toBeNull();
  act(() => { jest.advanceTimersByTime(1); });
  expect(view.getByTestId('loading-slow')).toBeTruthy();
});

it('offers a headline label and an immediate action whose line survives the success exit', () => {
  const onPress = jest.fn();
  const action = { label: 'Reconnect', onPress };
  const view = render(<LoadingState testID="loading" scene="fetch" message="Connecting" headline action={action} />);
  expect(view.getByTestId('loading-message').props.style)
    .toContainEqual(expect.objectContaining({ fontSize: FontSize.title, fontWeight: FontWeight.semibold }));
  // There from the start, without a slow hint, and outside the progress group so it stays reachable.
  expect(view.queryByTestId('loading-slow')).toBeNull();
  expect(view.getByTestId('loading').props.children).not.toContainEqual(expect.objectContaining({ props: expect.objectContaining({ testID: 'loading-action' }) }));
  view.getByTestId('loading-action').props.onPress();
  expect(onPress).toHaveBeenCalledTimes(1);
  view.rerender(<LoadingState testID="loading" scene="fetch" message="Connecting" headline action={action} phase="ready" />);
  const exiting = view.getByTestId('loading-action');
  expect(exiting.props.disabled).toBe(true);
  // The nearest host element above the button is the slot that keeps the action's line.
  let slot = exiting.parent;
  while (slot && typeof slot.type !== 'string') slot = slot.parent;
  expect(slot?.props.style).toContainEqual({ opacity: 0 });
  expect(slot?.props.pointerEvents).toBe('none');
});

it('plays a fresh scene when a new wait follows a success exit', () => {
  const view = render(<LoadingState testID="loading" message="Connecting" />);
  const first = view.UNSAFE_getByType(CompanionScene).props.scene;
  view.rerender(<LoadingState testID="loading" message="Connecting" phase="ready" />);
  view.rerender(<LoadingState testID="loading" message="Connecting" phase="wait" />);
  expect(view.UNSAFE_getByType(CompanionScene).props.scene).not.toBe(first);
  expect(view.getByTestId('loading-message').props.style).not.toContainEqual({ opacity: 0 });
});

function Handoff({ loading, succeeded, onPhase }: Readonly<{ loading: boolean; succeeded: boolean; onPhase: (phase: string | null) => void }>) {
  onPhase(useLoadingHandoff(loading, succeeded));
  return null;
}

describe('useLoadingHandoff', () => {
  it('exits only after a visible wait that ended in success, and only for the fade', () => {
    const phases: Array<string | null> = [];
    const view = render(<Handoff loading succeeded={false} onPhase={(phase) => phases.push(phase)} />);
    expect(phases.at(-1)).toBe('wait');
    act(() => { jest.advanceTimersByTime(1_000); });
    view.rerender(<Handoff loading={false} succeeded onPhase={(phase) => phases.push(phase)} />);
    expect(phases.at(-1)).toBe('ready');
    // No null render between wait and ready: that would unmount the scene and redraw it.
    expect(phases).not.toContain(null);
    act(() => { jest.advanceTimersByTime(Motion.loadingExit - 1); });
    expect(phases.at(-1)).toBe('ready');
    act(() => { jest.advanceTimersByTime(1); });
    expect(phases.at(-1)).toBeNull();
    // The loader never outstays its own fade by more than a few frames.
    expect(Motion.loadingExit - Motion.duration.normal).toBeLessThanOrEqual(80);
  });

  it('hands over at once when the wait was too short to show the cat, or failed', () => {
    const quick: Array<string | null> = [];
    const view = render(<Handoff loading succeeded onPhase={(phase) => quick.push(phase)} />);
    act(() => { jest.advanceTimersByTime(100); });
    view.rerender(<Handoff loading={false} succeeded onPhase={(phase) => quick.push(phase)} />);
    expect(quick.at(-1)).toBeNull();

    const failed: Array<string | null> = [];
    const second = render(<Handoff loading succeeded={false} onPhase={(phase) => failed.push(phase)} />);
    act(() => { jest.advanceTimersByTime(2_000); });
    second.rerender(<Handoff loading={false} succeeded={false} onPhase={(phase) => failed.push(phase)} />);
    expect(failed.at(-1)).toBeNull();
  });
});
