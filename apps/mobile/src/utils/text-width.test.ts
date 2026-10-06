import { estimateTextWidth, splitGraphemes, truncateToEstimatedWidth } from './text-width';

describe('estimateTextWidth', () => {
  it('stays within 5% of SF Pro / PingFang SC semibold measured on 2026-10-06', () => {
    const measuredEm: ReadonlyArray<readonly [string, number]> = [
      ['Lucy的Mac mini', 7.73],
      ['修复 Claude 当前模型读取', 11.96],
      [' · ', 0.86],
    ];
    for (const [text, em] of measuredEm) {
      expect(Math.abs(estimateTextWidth(text, 1) - em) / em).toBeLessThan(0.05);
    }
  });

  it('counts full-width scripts as one em and scales with the font size', () => {
    expect(estimateTextWidth('的修', 15)).toBe(30);
    expect(estimateTextWidth('かナ한', 10)).toBe(30);
    expect(estimateTextWidth('Atlas', 30)).toBeCloseTo(estimateTextWidth('Atlas', 15) * 2);
    expect(estimateTextWidth('', 15)).toBe(0);
  });
});

describe('splitGraphemes', () => {
  it('keeps user-perceived characters whole', () => {
    expect(splitGraphemes('ab')).toEqual(['a', 'b']);
    expect(splitGraphemes('👨‍👩‍👧')).toHaveLength(1);
    expect(splitGraphemes('🇯🇵🇨🇳')).toEqual(['🇯🇵', '🇨🇳']);
    expect(splitGraphemes('é')).toHaveLength(1);
    expect(splitGraphemes('1️⃣👍🏽')).toHaveLength(2);
    expect(splitGraphemes('')).toEqual([]);
  });
});

describe('truncateToEstimatedWidth', () => {
  it('returns text that fits unchanged', () => {
    expect(truncateToEstimatedWidth('Molty', 80, 15)).toBe('Molty');
  });

  it('ends a shortened text with an ellipsis inside the width', () => {
    const shortened = truncateToEstimatedWidth('Lucy的Mac mini', 84, 15);
    expect(shortened).toBe('Lucy的M…');
    expect(estimateTextWidth(shortened, 15)).toBeLessThanOrEqual(84);
  });

  it('drops spaces and separators in front of the ellipsis', () => {
    expect(truncateToEstimatedWidth('Lucy的Mac mini', 101.4, 15)).toBe('Lucy的Mac…');
    expect(truncateToEstimatedWidth('Office · Mac mini', 75, 15)).toBe('Office…');
  });

  it('never splits a joined emoji and always keeps one character', () => {
    expect(truncateToEstimatedWidth('ab👨‍👩‍👧cdefgh', 52, 15)).toBe('ab👨‍👩‍👧…');
    expect(truncateToEstimatedWidth('ab👨‍👩‍👧cdefgh', 40, 15)).toBe('ab…');
    expect(truncateToEstimatedWidth('Lucy的Mac mini', 1, 15)).toBe('L…');
  });

  it('leaves an unusable width or size to the native ellipsis', () => {
    for (const width of [Number.NaN, 0, -5, Number.POSITIVE_INFINITY]) {
      expect(truncateToEstimatedWidth('Lucy的Mac mini', width, 15)).toBe('Lucy的Mac mini');
    }
    expect(truncateToEstimatedWidth('Lucy的Mac mini', 40, 0)).toBe('Lucy的Mac mini');
    expect(truncateToEstimatedWidth('Lucy的Mac mini', 40, Number.NaN)).toBe('Lucy的Mac mini');
  });
});
