import { countDraftLines } from './composerDraftLines';

describe('countDraftLines', () => {
  it('counts laid-out lines as reported, with an empty draft as one line', () => {
    expect(countDraftLines([])).toBe(1);
    expect(countDraftLines([{ text: ' ' }])).toBe(1);
    expect(countDraftLines([{ text: 'a wrapped ' }, { text: 'draft' }])).toBe(2);
    expect(countDraftLines([{}, {}, {}])).toBe(3);
  });

  it('adds the empty caret line iOS omits after a trailing line break', () => {
    expect(countDraftLines([{ text: 'hello\n' }])).toBe(2);
    expect(countDraftLines([{ text: '\n' }])).toBe(2);
    expect(countDraftLines([{ text: 'hello\n' }, { text: '\n' }])).toBe(3);
    expect(countDraftLines([{ text: 'hello\n' }, { text: 'world' }])).toBe(2);
  });

  it('does not double-count the trailing line Android already reports', () => {
    expect(countDraftLines([{ text: 'hello\n' }, { text: '' }])).toBe(2);
    expect(countDraftLines([{ text: 'hello\n' }, { text: '\n' }, { text: '' }])).toBe(3);
  });
});
