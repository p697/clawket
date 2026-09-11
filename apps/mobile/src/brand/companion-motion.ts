/** One keyframe: wait `after` ms, then ease to `to` over `over` ms. */
export type CompanionStep = { to: number; over: number; after?: number };

/**
 * Curious choreography (owner-approved welcome loop). Tracks run in parallel and each sums to
 * `Motion.companionCuriosity` so the loop repeats seamlessly: the cat looks around, tilts its head,
 * flicks one ear at a time, then perks both ears and widens its eyes at something off-screen.
 */
export const CURIOUS_CHOREOGRAPHY: Record<'tilt' | 'gazeX' | 'gazeY' | 'blink' | 'earLeft' | 'earRight' | 'widen', CompanionStep[]> = {
  tilt: [
    { after: 400, to: 4, over: 320 },
    { after: 1800, to: -5, over: 360 },
    { after: 1400, to: -2, over: 240 },
    { after: 1000, to: 5, over: 320 },
    { after: 1300, to: 0, over: 400 },
    { to: 0, over: 2060 },
  ],
  gazeX: [
    { after: 400, to: 1, over: 280 },
    { after: 1900, to: -1, over: 320 },
    { after: 1500, to: -0.4, over: 200 },
    { after: 900, to: 0.6, over: 240 },
    { after: 1400, to: 0, over: 320 },
    { to: 0, over: 2140 },
  ],
  gazeY: [
    { after: 700, to: 0.3, over: 300 },
    { after: 1900, to: 0, over: 300 },
    { after: 2300, to: -0.8, over: 240 },
    { after: 1400, to: 0, over: 320 },
    { to: 0, over: 2140 },
  ],
  blink: [
    { after: 1500, to: 0.15, over: 100 },
    { to: 1, over: 140 },
    { after: 2100, to: 0.15, over: 100 },
    { to: 1, over: 140 },
    { after: 3300, to: 0.15, over: 90 },
    { to: 1, over: 120 },
    { after: 140, to: 0.15, over: 90 },
    { to: 1, over: 120 },
    { to: 1, over: 1660 },
  ],
  earLeft: [
    { after: 1100, to: -10, over: 130 },
    { to: 2, over: 170 },
    { to: 0, over: 140 },
    { after: 1700, to: -7, over: 110 },
    { to: 1.5, over: 150 },
    { to: 0, over: 120 },
    { after: 1880, to: -7, over: 220 },
    { after: 1500, to: 0, over: 400 },
    { to: 0, over: 1980 },
  ],
  earRight: [
    { after: 3000, to: 9, over: 120 },
    { to: -2, over: 160 },
    { to: 0, over: 120 },
    { after: 100, to: 7, over: 110 },
    { to: -1.5, over: 150 },
    { to: 0, over: 120 },
    { after: 1620, to: 7, over: 220 },
    { after: 1500, to: 0, over: 400 },
    { to: 0, over: 1980 },
  ],
  widen: [
    { after: 5500, to: 1, over: 220 },
    { after: 1500, to: 0, over: 400 },
    { to: 0, over: 1980 },
  ],
};

/** Total wall-clock length of a track, used to keep every curious track on the same loop. */
export function choreographyLength(steps: CompanionStep[]): number {
  return steps.reduce((total, step) => total + (step.after ?? 0) + step.over, 0);
}
