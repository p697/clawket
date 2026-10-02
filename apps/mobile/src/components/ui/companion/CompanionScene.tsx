import React, { useEffect, useId, useMemo, useState } from 'react';
import { AppState, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle, Ellipse, G, Path } from 'react-native-svg';
import Animated, { useAnimatedProps, useSharedValue } from 'react-native-reanimated';
import { sampleTimed } from '../../../brand/companion-keyframes';
import { STAGE, type CompanionSceneKey } from '../../../brand/companion-scenes';
import { CLAW, TEMPER_TIMING } from '../../../brand/companion-temper';
import { useAppTheme } from '../../../theme';
import { affine, REST, timedLayer, useLoopClock, type PlayValues, type SceneClock } from './motion';
import { SCENES, type SceneColors } from './scenes';
import { useCompanionPlay } from './useCompanionPlay';

const AnimatedG = Animated.createAnimatedComponent(G<{ matrix?: number[]; opacity?: number }>);
const AnimatedPath = Animated.createAnimatedComponent(Path);

/** `ready`: the wait succeeded; taps stop and the cat smiles while its loader fades out. */
export type CompanionScenePhase = 'wait' | 'ready';
/** Sheets show the scene at 60 %, which puts the Companion near the old 48-point compact size. */
export const COMPACT_SCENE_SCALE = 0.6;

function useAppActive(): boolean {
  const [active, setActive] = useState(AppState?.currentState !== 'background' && AppState?.currentState !== 'inactive');
  useEffect(() => {
    const listener = AppState?.addEventListener('change', (state) => setActive(state === 'active'));
    return () => listener?.remove();
  }, []);
  return active;
}

/**
 * One loading scene: the stage, its Companion and the cat's temper. Decorative:
 * hidden from assistive technology; the owning `LoadingState` carries the accessible busy label.
 */
export function CompanionScene({ scene, phase, compact = false, surface, testID }: Readonly<{
  scene: CompanionSceneKey;
  phase: CompanionScenePhase;
  compact?: boolean;
  /** The page's card color, for stage furniture such as Peek's desk; see `LoadingState`. */
  surface?: string;
  testID?: string;
}>): React.JSX.Element {
  const { theme } = useAppTheme();
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const active = useAppActive();
  const definition = SCENES[scene];
  const waiting = phase === 'wait';
  const [restart, setRestart] = useState(0);
  // The scene keeps moving through the brief success exit (a woken cat stays out), so it dissolves
  // rather than freezing; unmounting right after stops every clock.
  const loop = useLoopClock(definition.loop, active, restart);
  const wake = useSharedValue(-1);
  const clock = useMemo<SceneClock>(() => ({ loop, wake }), [loop, wake]);
  const play = useCompanionPlay({
    enabled: waiting && active,
    celebrating: phase === 'ready',
    running: active,
    canHide: definition.canHide,
    clock,
    onWakeEnd: () => setRestart((count) => count + 1),
  });
  const colors = useMemo<SceneColors>(() => ({
    ink: theme.colors.ink,
    canvas: theme.colors.canvas,
    surface: surface ?? theme.colors.surface,
    line: theme.colors.line,
    // An ink hole merges with the ink cat in light mode; in dark mode a hole reads as an outlined opening.
    hole: theme.scheme === 'dark' ? theme.colors.canvas : theme.colors.ink,
    holeRim: theme.scheme === 'dark' ? theme.colors.line : undefined,
  }), [surface, theme]);
  const shake = useAnimatedProps(() => {
    const layer = timedLayer(CLAW.shake, play.values.claw.value, REST);
    return { matrix: affine(layer.x, layer.y, 1, 1, 0, 0, 0) };
  });
  const scale = compact ? COMPACT_SCENE_SCALE : 1;
  const width = STAGE.width * scale;
  const height = definition.height * scale;
  const Stage = definition.Stage;
  return (
    <Pressable
      testID={testID}
      accessible={false}
      disabled={!waiting}
      delayLongPress={TEMPER_TIMING.petAfter}
      onPress={play.poke}
      onLongPress={play.pet}
      onPressOut={play.release}
      style={{ width, height }}
    >
      <Svg width={width} height={height} viewBox={`0 0 ${STAGE.width} ${definition.height}`}>
        <AnimatedG animatedProps={shake}>
          <Stage clock={clock} play={play.values} marks={{ reaction: play.reaction, mood: play.mood }} colors={colors} id={id} />
        </AnimatedG>
      </Svg>
      {play.swipe ? <ClawOverlay key={play.swipe} play={play.values} scale={scale} width={width} height={height} ink={theme.colors.ink} /> : null}
    </Pressable>
  );
}

// The swipe crosses the glass around the stage: geometry is the prototype's, relative to the stage centre.
const OVERLAY = { width: 800, height: 900 } as const;
const SCRATCHES = [
  'M123 -105 C67 -27 -5 63 -91 181',
  'M151 -75 C95 3 23 93 -63 211',
  'M179 -45 C123 33 51 123 -35 241',
] as const;
const SCRATCH_LENGTH = 460;

function Scratch({ play, index, d, ink }: Readonly<{ play: PlayValues; index: number; d: string; ink: string }>): React.JSX.Element {
  const props = useAnimatedProps(() => ({
    strokeDashoffset: SCRATCH_LENGTH * sampleTimed(CLAW.scratches[index], 'dash', play.claw.value, 1),
  }));
  return <AnimatedPath animatedProps={props} d={d} stroke={ink} strokeWidth={7} strokeLinecap="round" strokeDasharray={[SCRATCH_LENGTH, SCRATCH_LENGTH]} fill="none" />;
}

function ClawOverlay({ play, scale, width, height, ink }: Readonly<{ play: PlayValues; scale: number; width: number; height: number; ink: string }>): React.JSX.Element {
  const fade = useAnimatedProps(() => ({ opacity: sampleTimed(CLAW.fade, 'o', play.claw.value, 0) }));
  const paw = useAnimatedProps(() => {
    const layer = timedLayer(CLAW.paw, play.claw.value, REST);
    return { matrix: affine(layer.x, layer.y, 1, 1, 0, 0, 0) };
  });
  const overlayWidth = OVERLAY.width * scale;
  const overlayHeight = OVERLAY.height * scale;
  return (
    <View testID="companion-claw" pointerEvents="none" style={[styles.overlay, { left: (width - overlayWidth) / 2, top: (height - overlayHeight) / 2, width: overlayWidth, height: overlayHeight }]}>
      <Svg width={overlayWidth} height={overlayHeight} viewBox={`${-OVERLAY.width / 2} ${-OVERLAY.height / 2} ${OVERLAY.width} ${OVERLAY.height}`}>
        <AnimatedG animatedProps={fade}>
          {SCRATCHES.map((d, index) => <Scratch key={index} play={play} index={index} d={d} ink={ink} />)}
          <AnimatedG animatedProps={paw}>
            <G transform="rotate(-32)">
              <Ellipse cx={0} cy={0} rx={50} ry={42} fill={ink} />
              <Circle cx={-36} cy={-40} r={14} fill={ink} />
              <Circle cx={-12} cy={-54} r={14} fill={ink} />
              <Circle cx={14} cy={-54} r={14} fill={ink} />
              <Circle cx={38} cy={-40} r={14} fill={ink} />
            </G>
          </AnimatedG>
        </AnimatedG>
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { position: 'absolute' },
});
