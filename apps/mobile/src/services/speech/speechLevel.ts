/**
 * Turns the PCM microphone RMS into a readable 0–1 dictation meter.
 *
 * The PCM capture computes `min(rms × 5.5, 1)` about 20 times per second. Raw
 * RMS is linear and small: ordinary speech lands around 0.05–0.4 and barely
 * moves a linear meter. Loudness is perceived logarithmically, and rooms and
 * microphones differ, so the meter works in decibels relative to an adaptive
 * noise floor and recent peak, then follows the result with a fast-attack,
 * slower-release envelope so syllables read as distinct pulses.
 */

export type SpeechLevelState = Readonly<{
  /** Quietest recent level in dB; `null` until the first sample. */
  floorDb: number | null;
  /** Loudest recent level in dB, decaying back toward the floor. */
  peakDb: number;
  /** Smoothed 0–1 output. */
  envelope: number;
}>;

/** Silence in the normalized microphone scale; keeps `log10` finite. */
const LEVEL_EPSILON = 1e-4;
/** Per-sample fraction the floor climbs toward a louder room (about 20 Hz sampling). */
const NOISE_FLOOR_RISE = 0.01;
/** A noisy room must never swallow ordinary speech. */
const NOISE_FLOOR_MAX_DB = -24;
/** Per-sample peak decay, about 3 dB per second at 20 Hz. */
const PEAK_DECAY_DB = 0.15;
/** Softest and loudest dynamic ranges the meter normalizes across. */
const MIN_RANGE_DB = 12;
const MAX_RANGE_DB = 45;
/** Ignore the wobble of background noise just above the floor. */
const GATE_DB = 3;
/** Envelope coefficients: nearly instant attack, ~175 ms release at 20 Hz. */
const ATTACK = 0.7;
const RELEASE = 0.25;

export function createSpeechLevelState(): SpeechLevelState {
  return { floorDb: null, peakDb: Number.NEGATIVE_INFINITY, envelope: 0 };
}

export function toDecibels(level: number): number {
  return 20 * Math.log10(Math.max(level, LEVEL_EPSILON));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Feeds one microphone sample and returns the next state plus the meter value.
 * Pure and time-free: the native cadence is fixed, so coefficients are per sample.
 */
export function processSpeechLevel(
  state: SpeechLevelState,
  rawLevel: number,
): { state: SpeechLevelState; level: number } {
  const sample = Number.isFinite(rawLevel) ? clamp(rawLevel, 0, 1) : 0;
  const db = toDecibels(sample);

  // Follow quieter moments immediately; drift up slowly so pauses keep resetting the floor.
  const previousFloor = state.floorDb ?? db;
  const floorDb = Math.min(
    db < previousFloor ? db : previousFloor + (db - previousFloor) * NOISE_FLOOR_RISE,
    NOISE_FLOOR_MAX_DB,
  );

  // Track the loudest recent speech so soft and loud speakers both fill the meter.
  const minimumPeak = floorDb + MIN_RANGE_DB;
  const decayedPeak = Math.max(state.peakDb - PEAK_DECAY_DB, minimumPeak);
  const peakDb = Math.min(Math.max(decayedPeak, db, minimumPeak), floorDb + MAX_RANGE_DB);

  const range = peakDb - floorDb - GATE_DB;
  const target = clamp((db - floorDb - GATE_DB) / range, 0, 1);
  const envelope = state.envelope + (target - state.envelope) * (target > state.envelope ? ATTACK : RELEASE);

  return {
    state: { floorDb, peakDb, envelope },
    level: envelope,
  };
}
