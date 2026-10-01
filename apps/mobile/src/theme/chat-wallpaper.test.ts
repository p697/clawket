import {
  chatWallpaperDriftGradient,
  chatWallpaperDriftPosition,
  chatWallpaperDriftScrims,
  chatWallpaperDriftStops,
  chatWallpaperPalettes,
  CHAT_WALLPAPER_DRIFT_POSITIONS,
  sampleChatWallpaperDrift,
} from './chat-wallpaper';

const palette = chatWallpaperPalettes.iceBlue.light;
const PHONE = 844 / 390;

describe('wallpaper drift on send', () => {
  it('cycles through the prototype positions, one per send', () => {
    expect(CHAT_WALLPAPER_DRIFT_POSITIONS).toEqual([[0, 0], [0.45, 0.35], [1, 0.7], [0.6, 1]]);
    expect([0, 1, 2, 3, 4, 5].map(chatWallpaperDriftPosition)).toEqual([
      [0, 0], [0.45, 0.35], [1, 0.7], [0.6, 1], [0, 0], [0.45, 0.35],
    ]);
    expect(chatWallpaperDriftPosition(-1)).toEqual([0.6, 1]);
    expect(chatWallpaperDriftPosition(Number.NaN)).toEqual([0, 0]);
  });

  it('rests on the static wallpaper: its three colors from corner to corner', () => {
    for (const aspect of [PHONE, 1.3, 2.6]) {
      expect(sampleChatWallpaperDrift(palette, [0, 0], [0, 0], aspect)).toBe(palette.gradient[0]);
      expect(sampleChatWallpaperDrift(palette, [0, 0], [1, 1], aspect)).toBe(palette.gradient[2]);
    }
    const [first, middle, last] = chatWallpaperDriftStops(palette);
    expect(first).toEqual([palette.gradient[0], 0]);
    expect(middle![0]).toBe(palette.gradient[1]);
    expect(middle![1]).toBeCloseTo(0.15);
    expect(last).toEqual([palette.gradient[2], 1 / 3]);
    // The cycle ends on the color it starts from.
    expect(chatWallpaperDriftStops(palette).at(-1)).toEqual([palette.gradient[0], 1]);
  });

  it('describes the drifting layer as one CSS gradient', () => {
    expect(chatWallpaperDriftGradient(palette)).toBe(
      'linear-gradient(165deg, #DCE7FE 0.00%, #E8EEFD 15.00%, #F1E9FB 33.33%, #E8EEFD 55.00%, #E7E8FD 75.00%, #DCE7FE 100.00%)',
    );
  });

  it('lets the scrims fade from the colors behind them at every step', () => {
    const scrims = CHAT_WALLPAPER_DRIFT_POSITIONS.map((position) => chatWallpaperDriftScrims(palette, position, PHONE));
    for (const { top, bottom } of scrims) {
      expect(top).toMatch(/^#[0-9A-F]{6}$/);
      expect(bottom).toMatch(/^#[0-9A-F]{6}$/);
    }
    expect(new Set(scrims.map(({ top }) => top)).size).toBe(4);
    // At rest the scrims stay with the static wallpaper's ends.
    expect(scrims[0]!.top).toBe(sampleChatWallpaperDrift(palette, [0, 0], [0.5, 0.04], PHONE));
  });
});
