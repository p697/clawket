import { Motion } from '../../theme/tokens';
import { SLASH_SUGGESTION_TIMING_CONFIG } from './SlashSuggestions';

jest.mock('react-native', () => ({
  Animated: {
    Value: class {},
    View: 'AnimatedView',
    timing: jest.fn(),
  },
  Easing: {
    cubic: (value: number) => value ** 3,
    out: (easing: (value: number) => number) => (
      (value: number) => 1 - easing(1 - value)
    ),
  },
  FlatList: 'FlatList',
  Pressable: 'Pressable',
  StyleSheet: {
    create: (styles: unknown) => styles,
    hairlineWidth: 1,
  },
  Text: 'Text',
  View: 'View',
}));

describe('SlashSuggestions motion', () => {
  it('uses the canonical fast ease-out timing for enter and exit', () => {
    expect(SLASH_SUGGESTION_TIMING_CONFIG.duration).toBe(Motion.duration.fast);
    expect(SLASH_SUGGESTION_TIMING_CONFIG.useNativeDriver).toBe(true);
    expect(SLASH_SUGGESTION_TIMING_CONFIG.easing(0)).toBe(0);
    expect(SLASH_SUGGESTION_TIMING_CONFIG.easing(0.5)).toBeGreaterThan(0.5);
    expect(SLASH_SUGGESTION_TIMING_CONFIG.easing(1)).toBe(1);
  });
});
