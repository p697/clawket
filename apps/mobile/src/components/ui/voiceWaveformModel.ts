import { Motion, Space } from '../../theme/tokens';

/**
 * Physics and geometry of the dictation waveform (owner-requested redesign,
 * 2026-09-26).
 *
 * The microphone reports one normalized level about 20 times a second
 * (`speechLevel.ts`). On the UI thread a slightly under-damped spring follows
 * it in fixed 120 Hz steps and records its position in a short history. Every
 * bar reads that history at a delay proportional to its distance from the
 * centre, so a syllable leaves the centre as a pulse and travels outward,
 * losing height under a bell envelope and fading under an edge vignette. A slow
 * per-bar grain keeps sustained speech from looking mechanical. Silence rests
 * as dim dots; while the room stays quiet, a soft pulse leaves the centre once
 * per `Motion.voiceRipple` so the row still reads as listening.
 *
 * The row is drawn as two SVG paths: dim resting dots, and lit capsules whose
 * width follows how lit a bar is, so quiet and outer bars taper instead of
 * switching on. Every function here is a worklet and also runs as plain
 * JavaScript in tests.
 */

/** Row height; the loudest bar spans it. */
export const VOICE_WAVEFORM_HEIGHT = Space.xxl;
/** Resting dots stay quiet; the lit path draws at full opacity. */
export const VOICE_WAVEFORM_REST_OPACITY = 0.26;
/** A path that draws nothing; an empty `d` is not portable across SVG hosts. */
export const EMPTY_VOICE_WAVEFORM_PATH = 'M0 0';

// Drawing geometry in points: thin capsules on a 6-point pitch.
const BAR_WIDTH = 2.5;
const BAR_GAP = 3.5;
const BAR_PITCH = BAR_WIDTH + BAR_GAP;
const MAX_BARS = 51;
/** Share of the row the bars may cover; the vignette dissolves both ends. */
const ROW_SPAN = 0.9;
/** Fixed simulation step, independent of a 60 or 120 Hz display. */
const STEP_SECONDS = 1 / 120;
/** Longest frame folded into one update, so a stalled frame never fast-forwards. */
const MAX_FRAME_SECONDS = 0.1;
/** Spring positions kept for the outward travel (about one second). */
const HISTORY_LENGTH = 128;
/** Slightly under-damped so syllables land with a little life. */
const SPRING_HZ = 3.6;
const SPRING_DAMPING = 0.74;
/** Outward travel: one bar every 30 ms, softened by a 50 ms window. */
const TRAVEL_SECONDS_PER_BAR = 0.03;
const TRAVEL_WINDOW_SECONDS = 0.05;
/** Loudness to height: a gentle gain, a slightly expanding curve and a bell envelope. */
const GAIN = 0.95;
const CURVE = 0.85;
const ENVELOPE_FLOOR = 0.12;
const ENVELOPE_POWER = 1.5;
/** Depth of the per-bar grain; 0 would make every bar identical. */
const GRAIN = 0.42;
/** A bar is fully lit from about 40 % of its growth. */
const LIT_GAIN = 2.4;
/** The vignette covers the outer 36 % of each half and never quite reaches zero. */
const VIGNETTE = 0.36;
const VIGNETTE_FLOOR = 0.08;
const VIGNETTE_SAMPLES = [1, 0.94, 0.88, 0.82, 0.76, 0.7, 1 - VIGNETTE] as const;
/** Listening pulse while the room is quiet: a short, half-lit swell travelling outward. */
const PULSE_SECONDS = Motion.voiceRipple / 1000;
const PULSE_HEIGHT = 0.07;
const PULSE_LIGHT = 0.6;
const PULSE_WIDTH_BARS = 1.8;
/** Loudness envelope that hands the row from the pulse to the voice and back. */
const PRESENCE_ATTACK_SECONDS = 0.07;
const PRESENCE_RELEASE_SECONDS = 0.55;
/** Entrance: the dots unfold from the centre outward. */
const APPEAR_STAGGER_SECONDS = 0.012;
const APPEAR_SECONDS = Motion.duration.slow / 1000;
/** Slide-to-cancel flattens and dims the row. */
const CANCEL_SECONDS = Motion.duration.fast / 1000;
const CANCEL_FLATTEN = 0.62;
const CANCEL_DIM = 0.5;
/** Reduced motion keeps the dots still and lets only their opacity answer the voice. */
const STILL_MAX_OPACITY = 0.8;
/** Anything thinner draws nothing. */
const MIN_VISIBLE = 0.05;

/** After this the resting dots equal `drawStillVoiceWaveform` and need no per-frame drawing. */
export const VOICE_WAVEFORM_ENTRANCE_SECONDS = ((MAX_BARS - 1) / 2) * APPEAR_STAGGER_SECONDS + APPEAR_SECONDS;

const SPRING_OMEGA = 2 * Math.PI * SPRING_HZ;
const CANCEL_RATE = 1 - Math.exp(-STEP_SECONDS / CANCEL_SECONDS);
const ATTACK_RATE = 1 - Math.exp(-STEP_SECONDS / PRESENCE_ATTACK_SECONDS);
const RELEASE_RATE = 1 - Math.exp(-STEP_SECONDS / PRESENCE_RELEASE_SECONDS);

export type VoiceWaveformLayout = Readonly<{
  /** Row width in points. */
  width: number;
  /** Odd bar count; 0 while the row is too narrow (or not yet measured) to draw. */
  count: number;
  /** Index of the centre bar. */
  half: number;
  /** Centre x of the first bar. */
  left: number;
}>;

export type VoiceWaveformSimulation = {
  /** Seconds simulated since the row opened. */
  time: number;
  /** Frame time not yet simulated; always less than one step. */
  pending: number;
  position: number;
  velocity: number;
  /** Slow loudness envelope; the listening pulse shows only while it is low. */
  presence: number;
  /** 0–1 slide-to-cancel progress. */
  cancel: number;
  head: number;
  /** Spring positions, one per step, newest at `head`. */
  history: number[];
};

export type VoiceWaveformBar = Readonly<{
  /** Centre x in points. */
  x: number;
  /** Lit capsule height in points. */
  height: number;
  /** Resting dot diameter in points (grows in during the entrance). */
  dot: number;
  /** Lit capsule width in points; 0 while the bar is dark. */
  lit: number;
}>;

export type VoiceWaveformFrame = Readonly<{
  rest: string;
  lit: string;
  restOpacity: number;
  litOpacity: number;
}>;

export type VoiceWaveformVignette = Readonly<{
  x1: number;
  x2: number;
  stops: ReadonlyArray<Readonly<{ offset: number; opacity: number }>>;
}>;

function clamp01(value: number): number {
  'worklet';
  // NaN fails both comparisons and resolves to 0.
  return value > 0 ? (value < 1 ? value : 1) : 0;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  'worklet';
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/** Stable 0–1 value per bar, so each bar keeps its own grain across frames. */
function barNoise(index: number, salt: number): number {
  'worklet';
  const value = Math.sin(index * 127.1 + salt * 311.7) * 43758.5453;
  return value - Math.floor(value);
}

function format(value: number): string {
  'worklet';
  return String(Math.round(value * 100) / 100);
}

/** A vertical capsule centred on (x, middle); a height equal to the width draws a dot. */
function capsule(x: number, middle: number, width: number, height: number): string {
  'worklet';
  const radius = format(width / 2);
  const reach = Math.max(0, height - width) / 2;
  return `M${format(x - width / 2)} ${format(middle - reach)}a${radius} ${radius} 0 0 1 ${format(width)} 0`
    + `V${format(middle + reach)}a${radius} ${radius} 0 0 1 ${format(-width)} 0Z`;
}

/** Odd bar count on a 6-point pitch, centred in the row. */
export function resolveVoiceWaveformLayout(width: number): VoiceWaveformLayout {
  'worklet';
  const safeWidth = Number.isFinite(width) && width > 0 ? width : 0;
  let count = Math.min(MAX_BARS, Math.floor((safeWidth * ROW_SPAN + BAR_GAP) / BAR_PITCH));
  if (count % 2 === 0) count -= 1;
  if (count < 1) return { width: safeWidth, count: 0, half: 0, left: 0 };
  return {
    width: safeWidth,
    count,
    half: (count - 1) / 2,
    left: (safeWidth - (count * BAR_PITCH - BAR_GAP) + BAR_WIDTH) / 2,
  };
}

export function createVoiceWaveformSimulation(): VoiceWaveformSimulation {
  'worklet';
  const history: number[] = [];
  for (let index = 0; index < HISTORY_LENGTH; index += 1) history.push(0);
  return { time: 0, pending: 0, position: 0, velocity: 0, presence: 0, cancel: 0, head: 0, history };
}

/** Folds one display frame into fixed simulation steps; mutates `simulation`. */
export function advanceVoiceWaveform(
  simulation: VoiceWaveformSimulation,
  level: number,
  cancelling: boolean,
  elapsedSeconds: number,
): void {
  'worklet';
  const input = clamp01(level);
  const elapsed = Number.isFinite(elapsedSeconds) ? Math.min(MAX_FRAME_SECONDS, Math.max(0, elapsedSeconds)) : 0;
  simulation.pending += elapsed;
  while (simulation.pending >= STEP_SECONDS) {
    simulation.pending -= STEP_SECONDS;
    simulation.time += STEP_SECONDS;
    simulation.cancel += ((cancelling ? 1 : 0) - simulation.cancel) * CANCEL_RATE;
    const target = input * (1 - CANCEL_FLATTEN * simulation.cancel);
    simulation.velocity += (SPRING_OMEGA * SPRING_OMEGA * (target - simulation.position)
      - 2 * SPRING_DAMPING * SPRING_OMEGA * simulation.velocity) * STEP_SECONDS;
    simulation.position += simulation.velocity * STEP_SECONDS;
    simulation.presence += (input - simulation.presence) * (input > simulation.presence ? ATTACK_RATE : RELEASE_RATE);
    simulation.head = (simulation.head + 1) % HISTORY_LENGTH;
    simulation.history[simulation.head] = simulation.position > 0 ? simulation.position : 0;
  }
}

function sampleHistory(simulation: VoiceWaveformSimulation, secondsAgo: number): number {
  'worklet';
  const steps = Math.min(HISTORY_LENGTH - 2, Math.max(0, secondsAgo / STEP_SECONDS));
  const whole = Math.floor(steps);
  const newer = simulation.history[(simulation.head - whole + HISTORY_LENGTH) % HISTORY_LENGTH];
  const older = simulation.history[(simulation.head - whole - 1 + HISTORY_LENGTH) % HISTORY_LENGTH];
  return newer + (older - newer) * (steps - whole);
}

/** The delayed level, softened by a short window so the travelling front stays round. */
function sampleTravel(simulation: VoiceWaveformSimulation, secondsAgo: number): number {
  'worklet';
  const window = Math.min(TRAVEL_WINDOW_SECONDS, secondsAgo);
  if (window <= 0) return sampleHistory(simulation, 0);
  return 0.25 * sampleHistory(simulation, secondsAgo - window)
    + 0.5 * sampleHistory(simulation, secondsAgo)
    + 0.25 * sampleHistory(simulation, secondsAgo + window);
}

export function measureVoiceWaveformBar(
  simulation: VoiceWaveformSimulation,
  layout: VoiceWaveformLayout,
  index: number,
): VoiceWaveformBar {
  'worklet';
  const distance = Math.abs(index - layout.half);
  const reach = distance / (layout.half + 0.5);
  const envelope = ENVELOPE_FLOOR + (1 - ENVELOPE_FLOOR) * Math.pow(Math.cos(reach * Math.PI / 2), ENVELOPE_POWER);
  const time = simulation.time;
  const grain = 0.62 * Math.sin(time * (5.1 + 3.3 * barNoise(index, 1)) + 6.28 * barNoise(index, 2))
    + 0.38 * Math.sin(time * (8.3 + 4.1 * barNoise(index, 3)) + 6.28 * barNoise(index, 4));
  const texture = 1 - GRAIN + GRAIN * (0.5 + 0.5 * grain);
  const voice = Math.pow(clamp01(sampleTravel(simulation, distance * TRAVEL_SECONDS_PER_BAR) * envelope * texture * GAIN), CURVE);

  const quiet = 1 - smoothstep(0.03, 0.2, simulation.presence);
  let pulse = 0;
  if (quiet > 0) {
    const phase = (time % PULSE_SECONDS) / PULSE_SECONDS;
    const offset = (distance - phase * (layout.half + 4)) / PULSE_WIDTH_BARS;
    pulse = quiet * Math.exp(-offset * offset) * Math.pow(1 - phase, 1.4);
  }

  const appear = clamp01((time - distance * APPEAR_STAGGER_SECONDS) / APPEAR_SECONDS);
  const pop = 1 - (1 - appear) * (1 - appear) * (1 - appear);
  const growth = clamp01(voice + PULSE_HEIGHT * pulse);
  const lit = clamp01(voice * LIT_GAIN + pulse * PULSE_LIGHT);
  return {
    x: layout.left + index * BAR_PITCH,
    height: (BAR_WIDTH + (VOICE_WAVEFORM_HEIGHT - BAR_WIDTH) * growth) * pop,
    dot: BAR_WIDTH * pop,
    lit: BAR_WIDTH * lit * pop,
  };
}

/**
 * Both paths for the current simulation. Pass `dots: false` once the entrance
 * has finished: the resting dots are then the still row, and `rest` is empty.
 */
export function drawVoiceWaveform(
  simulation: VoiceWaveformSimulation,
  layout: VoiceWaveformLayout,
  dots = true,
): VoiceWaveformFrame {
  'worklet';
  const middle = VOICE_WAVEFORM_HEIGHT / 2;
  let rest = '';
  let lit = '';
  for (let index = 0; index < layout.count; index += 1) {
    const bar = measureVoiceWaveformBar(simulation, layout, index);
    if (dots && bar.dot >= MIN_VISIBLE) rest += capsule(bar.x, middle, bar.dot, bar.dot);
    if (bar.lit >= MIN_VISIBLE) lit += capsule(bar.x, middle, bar.lit, Math.max(bar.lit, bar.height));
  }
  const dim = 1 - CANCEL_DIM * simulation.cancel;
  return {
    rest: rest || EMPTY_VOICE_WAVEFORM_PATH,
    lit: lit || EMPTY_VOICE_WAVEFORM_PATH,
    restOpacity: VOICE_WAVEFORM_REST_OPACITY * dim,
    litOpacity: dim,
  };
}

/** Every dot at rest: the reduced-motion row. */
export function drawStillVoiceWaveform(layout: VoiceWaveformLayout): string {
  'worklet';
  const middle = VOICE_WAVEFORM_HEIGHT / 2;
  let rest = '';
  for (let index = 0; index < layout.count; index += 1) {
    rest += capsule(layout.left + index * BAR_PITCH, middle, BAR_WIDTH, BAR_WIDTH);
  }
  return rest || EMPTY_VOICE_WAVEFORM_PATH;
}

/** Reduced motion: the still dots brighten with the voice and dim while cancelling. */
export function resolveStillVoiceWaveformOpacity(level: number, cancelling: boolean): number {
  'worklet';
  const opacity = VOICE_WAVEFORM_REST_OPACITY + (STILL_MAX_OPACITY - VOICE_WAVEFORM_REST_OPACITY) * clamp01(level);
  return cancelling ? opacity * (1 - CANCEL_DIM) : opacity;
}

/** Horizontal gradient that dissolves both ends; shared by both paths. */
export function resolveVoiceWaveformVignette(layout: VoiceWaveformLayout): VoiceWaveformVignette {
  const centre = layout.left + layout.half * BAR_PITCH;
  const radius = (layout.half + 0.5) * BAR_PITCH;
  const opacityAt = (reach: number) => VIGNETTE_FLOOR + (1 - VIGNETTE_FLOOR) * (1 - smoothstep(1 - VIGNETTE, 1.02, reach));
  const leading = VIGNETTE_SAMPLES.map((reach) => ({ offset: (1 - reach) / 2, opacity: opacityAt(reach) }));
  const trailing = [...VIGNETTE_SAMPLES].reverse().map((reach) => ({ offset: (1 + reach) / 2, opacity: opacityAt(reach) }));
  return { x1: centre - radius, x2: centre + radius, stops: [...leading, ...trailing] };
}
