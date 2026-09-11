import { keyboardTransitionFraction, resolveKeyboardRevealDelta } from './useKeyboardRevealScroll';

describe('keyboard reveal scroll math', () => {
  const windowHeight = 874;
  // Field + Connect anchor measured at rest: bottom edge 593 points down the window, scroll offset 0.
  const anchor = { bottom: 593, offset: 0 };

  it('scrolls only the shortfall needed to clear the keyboard by the requested margin', () => {
    expect(resolveKeyboardRevealDelta({ anchor, offset: 0, clearance: 16, windowHeight, keyboardHeight: 340 }))
      .toBe(593 + 16 - (874 - 340));
  });

  it('does not scroll when the anchor already sits above the keyboard or the keyboard is hiding', () => {
    expect(resolveKeyboardRevealDelta({ anchor, offset: 0, clearance: 16, windowHeight, keyboardHeight: 200 })).toBe(0);
    expect(resolveKeyboardRevealDelta({ anchor, offset: 0, clearance: 16, windowHeight, keyboardHeight: 0 })).toBe(0);
    expect(resolveKeyboardRevealDelta({ anchor: null, offset: 0, clearance: 16, windowHeight, keyboardHeight: 340 })).toBe(0);
  });

  it('adds only the increment when a third-party keyboard grows after the first reveal', () => {
    const first = resolveKeyboardRevealDelta({ anchor, offset: 0, clearance: 16, windowHeight, keyboardHeight: 340 });
    // The view has already scrolled by `first`; the live offset re-derives the anchor's on-screen position.
    const second = resolveKeyboardRevealDelta({ anchor, offset: first, clearance: 16, windowHeight, keyboardHeight: 390 });
    expect(second).toBe(50);
    expect(first + second).toBe(593 + 16 - (874 - 390));
  });

  it('respects an anchor measured after the user had already scrolled', () => {
    const scrolledAnchor = { bottom: 593, offset: 100 };
    expect(resolveKeyboardRevealDelta({ anchor: scrolledAnchor, offset: 100, clearance: 16, windowHeight, keyboardHeight: 340 }))
      .toBe(593 + 16 - (874 - 340));
    // Scrolling 60 more points before the keyboard shows leaves 60 fewer to travel.
    expect(resolveKeyboardRevealDelta({ anchor: scrolledAnchor, offset: 160, clearance: 16, windowHeight, keyboardHeight: 340 }))
      .toBe(533 + 16 - (874 - 340));
    // Scrolling back up past the measurement point adds the difference instead.
    expect(resolveKeyboardRevealDelta({ anchor: scrolledAnchor, offset: 40, clearance: 16, windowHeight, keyboardHeight: 340 }))
      .toBe(653 + 16 - (874 - 340));
  });

  it('maps keyboard height progress to a clamped 0–1 fraction for both growth and shrink transitions', () => {
    expect(keyboardTransitionFraction(0, 340, 0)).toBe(0);
    expect(keyboardTransitionFraction(0, 340, 170)).toBe(0.5);
    expect(keyboardTransitionFraction(0, 340, 340)).toBe(1);
    expect(keyboardTransitionFraction(0, 340, 400)).toBe(1);
    expect(keyboardTransitionFraction(340, 390, 365)).toBe(0.5);
    expect(keyboardTransitionFraction(390, 340, 365)).toBe(0.5);
    expect(keyboardTransitionFraction(340, 340, 340)).toBe(1);
  });
});
