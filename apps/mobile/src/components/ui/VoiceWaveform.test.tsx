import React from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import * as Reanimated from 'react-native-reanimated';
import type { SharedValue } from 'react-native-reanimated';
import { VoiceWaveform } from './VoiceWaveform';
import {
  EMPTY_VOICE_WAVEFORM_PATH, VOICE_WAVEFORM_HEIGHT, VOICE_WAVEFORM_REST_OPACITY,
  drawStillVoiceWaveform, resolveVoiceWaveformLayout,
} from './voiceWaveformModel';

jest.mock('react-native', () => {
  const ReactRuntime = require('react');
  const host = (name: string) => (props: Record<string, unknown>) => ReactRuntime.createElement(name, props);
  return { ...jest.requireActual('react-native'), View: host('View') };
});

type Props = Record<string, unknown>;
const ROW = 354;
const measured = { nativeEvent: { layout: { x: 0, y: 0, width: ROW, height: VOICE_WAVEFORM_HEIGHT } } };

/** Stable shared values and replayable animated props, so a test can tick frames like the UI thread. */
function harness() {
  jest.spyOn(Reanimated, 'useSharedValue').mockImplementation(((initial: unknown) => React.useRef({ value: initial }).current) as never);
  const factories: Array<() => Props> = [];
  jest.spyOn(Reanimated, 'useAnimatedProps').mockImplementation(((factory: () => Props) => {
    factories.push(factory);
    return factory();
  }) as never);
  const setActive = jest.fn();
  let onFrame: ((frame: { timeSincePreviousFrame: number | null }) => void) | undefined;
  jest.spyOn(Reanimated, 'useFrameCallback').mockImplementation(((callback: typeof onFrame) => {
    onFrame = callback;
    return { setActive, isActive: false, callbackId: 1 };
  }) as never);
  return {
    setActive,
    tick(frames: number, milliseconds = 1000 / 120) {
      for (let index = 0; index < frames; index += 1) onFrame?.({ timeSincePreviousFrame: index === 0 ? null : milliseconds });
    },
    /** The latest render's rest, lit and still props, recomputed from current shared values. */
    props: () => factories.slice(-3).map((factory) => factory()),
  };
}

afterEach(() => jest.restoreAllMocks());

it('waits for its width, then draws a vignette and two frame-driven paths', () => {
  const frames = harness();
  const level = { value: 0 } as SharedValue<number>;
  const view = render(<VoiceWaveform level={level} color="#111113" testID="wave" />);
  expect(view.UNSAFE_queryAllByType('Svg' as never)).toHaveLength(0);
  expect(frames.setActive).toHaveBeenLastCalledWith(false);

  fireEvent(view.getByTestId('wave', { includeHiddenElements: true }), 'layout', measured);
  const svg = view.UNSAFE_getByType('Svg' as never);
  expect(svg.props).toMatchObject({ width: ROW, height: VOICE_WAVEFORM_HEIGHT });
  const gradient = view.UNSAFE_getByType('LinearGradient' as never);
  const stops = view.UNSAFE_getAllByType('Stop' as never);
  expect(stops.length).toBeGreaterThan(4);
  expect(stops.every((stop) => stop.props.stopColor === '#111113')).toBe(true);
  const paths = view.UNSAFE_getAllByType('Path' as never);
  expect(paths.map((path) => path.props.testID)).toEqual(['wave-rest', 'wave-lit']);
  expect(paths.every((path) => path.props.fill === `url(#${gradient.props.id})`)).toBe(true);
  expect(frames.setActive).toHaveBeenLastCalledWith(true);

  // A second of quiet: every dot has unfolded, and the lit path carries at most the listening pulse.
  frames.tick(120);
  const [quietRest, quietLit] = frames.props();
  expect(String(quietRest.d).split('M')).toHaveLength(resolveVoiceWaveformLayout(ROW).count + 1);
  expect(quietRest.opacity).toBeCloseTo(VOICE_WAVEFORM_REST_OPACITY);
  expect(quietLit.opacity).toBeCloseTo(1);

  // Speech lights most of the row.
  level.value = 0.9;
  frames.tick(120);
  const [, speakingLit] = frames.props();
  expect(speakingLit.d).not.toBe(EMPTY_VOICE_WAVEFORM_PATH);
  expect(String(speakingLit.d).split('M').length).toBeGreaterThan(String(quietLit.d).split('M').length);
});

it('flattens and dims while slide-to-cancel is armed', () => {
  const frames = harness();
  const level = { value: 0.9 } as SharedValue<number>;
  const view = render(<VoiceWaveform level={level} color="#111113" testID="wave" />);
  fireEvent(view.getByTestId('wave', { includeHiddenElements: true }), 'layout', measured);
  frames.tick(90);
  view.rerender(<VoiceWaveform level={level} color="#111113" testID="wave" cancelling />);
  frames.tick(90);
  const [rest, lit] = frames.props();
  expect(lit.opacity).toBeCloseTo(0.5, 2);
  expect(rest.opacity).toBeCloseTo(VOICE_WAVEFORM_REST_OPACITY / 2, 2);
});

it('keeps the dots still under reduced motion and lets only opacity follow the voice', () => {
  const frames = harness();
  jest.spyOn(Reanimated, 'useReducedMotion').mockReturnValue(true);
  const level = { value: 0 } as SharedValue<number>;
  const view = render(<VoiceWaveform level={level} color="#111113" testID="wave" />);
  fireEvent(view.getByTestId('wave', { includeHiddenElements: true }), 'layout', measured);
  const paths = view.UNSAFE_getAllByType('Path' as never);
  expect(paths).toHaveLength(1);
  expect(paths[0].props.testID).toBe('wave-still');
  expect(paths[0].props.d).toBe(drawStillVoiceWaveform(resolveVoiceWaveformLayout(ROW)));
  expect(frames.setActive).not.toHaveBeenCalledWith(true);
  expect(frames.props().at(-1)!.opacity).toBeCloseTo(VOICE_WAVEFORM_REST_OPACITY);
  level.value = 1;
  expect(frames.props().at(-1)!.opacity).toBeGreaterThan(0.7);
});

it('pauses its frame callback in the background and resumes when active', () => {
  const frames = harness();
  let change: (state: AppStateStatus) => void = () => {};
  const remove = jest.fn();
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((_event: string, listener: typeof change) => {
    change = listener;
    return { remove };
  }) as never);
  const view = render(<VoiceWaveform color="#111113" testID="wave" />);
  fireEvent(view.getByTestId('wave', { includeHiddenElements: true }), 'layout', measured);
  expect(frames.setActive).toHaveBeenLastCalledWith(true);
  act(() => change('background'));
  expect(frames.setActive).toHaveBeenLastCalledWith(false);
  act(() => change('active'));
  expect(frames.setActive).toHaveBeenLastCalledWith(true);
  view.unmount();
  expect(remove).toHaveBeenCalled();
});
