import {
  CLAWHUB_SKILLS_URL,
  buildClawHubInstallPrompt,
  clawHubSkillHandle,
  parseClawHubSkillUrl,
  resolveClawHubNavigation,
} from './skill-discover-model';

describe('skill-discover-model', () => {
  it('opens on the ClawHub skills catalog', () => {
    expect(CLAWHUB_SKILLS_URL).toBe('https://clawhub.ai/skills');
  });

  it('recognizes the skill detail page and nothing else', () => {
    expect(parseClawHubSkillUrl('https://clawhub.ai/spclaudehome/skills/skill-vetter')).toEqual({
      owner: 'spclaudehome',
      slug: 'skill-vetter',
      url: 'https://clawhub.ai/spclaudehome/skills/skill-vetter',
    });
    expect(parseClawHubSkillUrl('https://www.clawhub.ai/owner/skills/tool/?tab=files#readme')?.slug).toBe('tool');
    expect(parseClawHubSkillUrl('https://clawhub.ai/owner/skills/my%20skill')?.url).toBe('https://clawhub.ai/owner/skills/my%20skill');
    for (const url of [
      'https://clawhub.ai/skills',
      'https://clawhub.ai/skills?tab=trending',
      'https://clawhub.ai/skills/publish',
      'https://clawhub.ai/owner',
      'https://clawhub.ai/owner/plugins/tool',
      'https://clawhub.ai/owner/skills/tool/versions',
      'https://example.com/owner/skills/tool',
      'https://clawhub.ai/owner/skills/%E0%A4%A',
      'not a url',
    ]) {
      expect(parseClawHubSkillUrl(url)).toBeNull();
    }
  });

  it('keeps ClawHub in the page and hands everything else to the system', () => {
    expect(resolveClawHubNavigation('https://clawhub.ai/skills?tab=new')).toBe('allow');
    expect(resolveClawHubNavigation('HTTPS://WWW.CLAWHUB.AI/official')).toBe('allow');
    expect(resolveClawHubNavigation('about:blank')).toBe('allow');
    expect(resolveClawHubNavigation('blob:https://clawhub.ai/1234')).toBe('allow');
    expect(resolveClawHubNavigation('https://docs.openclaw.ai/skills')).toBe('external');
    expect(resolveClawHubNavigation('https://github.com/owner/repo')).toBe('external');
    expect(resolveClawHubNavigation('mailto:hi@example.com')).toBe('external');
    expect(resolveClawHubNavigation('tel:+1000')).toBe('external');
    expect(resolveClawHubNavigation('javascript:alert(1)')).toBe('block');
    expect(resolveClawHubNavigation('intent://scan/#Intent;end')).toBe('block');
    expect(resolveClawHubNavigation('')).toBe('block');
  });

  it('builds a backend-specific install request from the page', () => {
    const skill = parseClawHubSkillUrl('https://clawhub.ai/spclaudehome/skills/skill-vetter')!;
    expect(clawHubSkillHandle(skill)).toBe('@spclaudehome/skill-vetter');
    expect(buildClawHubInstallPrompt('openclaw', skill)).toBe([
      'Install this ClawHub skill for me.',
      '',
      'Skill: @spclaudehome/skill-vetter',
      'Page: https://clawhub.ai/spclaudehome/skills/skill-vetter',
      'Command: openclaw skills install @spclaudehome/skill-vetter',
      '',
      'Run the install, then tell me whether it succeeded.',
    ].join('\n'));
    expect(buildClawHubInstallPrompt('hermes', skill)).toContain('Command: hermes skills install skill-vetter');
    expect(buildClawHubInstallPrompt('hermes', skill)).not.toContain('openclaw');
    expect(buildClawHubInstallPrompt('youmind', skill)).not.toContain('Command:');
  });
});
