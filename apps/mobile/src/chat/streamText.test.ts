import { liveTailBeforeFinal } from './streamText';

describe('liveTailBeforeFinal', () => {
  it('returns the paragraphs a live tail showed before a final that repeats only its last ones', () => {
    expect(liveTailBeforeFinal('Up for eight days.\n\nAll six commands completed.', 'All six commands completed.'))
      .toBe('Up for eight days.');
    expect(liveTailBeforeFinal('One.\n\nTwo.\n\nThree.\n\nFour.', 'Three.\n\nFour.')).toBe('One.\n\nTwo.');
    expect(liveTailBeforeFinal('  First.\n \n  Last.  ', 'Last.')).toBe('First.');
  });

  it.each([
    ['the final repeats the whole tail', 'First.\n\nLast.', 'First.\n\nLast.'],
    ['the final differs from the tail', 'First.\n\nLast.', 'Something else.'],
    ['the final ends inside a paragraph', 'We are all done.', 'all done.'],
    ['the final is one line after a single newline', 'First.\nLast.', 'Last.'],
    ['the final is empty', 'First.\n\nLast.', '   '],
    ['nothing streamed', '', 'Last.'],
  ])('keeps nothing when %s', (_case, live, final) => {
    expect(liveTailBeforeFinal(live, final)).toBeUndefined();
  });
});
