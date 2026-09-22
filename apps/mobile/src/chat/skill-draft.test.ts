import { readSkillDraft } from './skill-draft';
it('restores only complete leading invocation prefixes without changing their wire text', () => {
  for (const prefix of ['$arxiv\n\n', 'Use the installed skill "arxiv" for this request. Read its instructions with skill_view before proceeding.\n\n']) {
    expect(readSkillDraft(prefix + 'Read this')).toEqual({ name: 'arxiv', prefix });
    expect(readSkillDraft('Quote: ' + prefix)).toBeNull();
  }
  expect(readSkillDraft('$arxiv is a skill')).toBeNull();
  expect(readSkillDraft('$../../secret\n\n')).toBeNull();
});
