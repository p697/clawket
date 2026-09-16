import type {
  DiscoverSkillItem,
  SkillStatusEntry,
  SkillsOperations,
} from '@clawket/agent-protocol';
import {
  buildSkillInstallPrompt,
  canRemoveSkill,
  canToggleSkill,
  filterInstalledSkills,
  groupDiscoveredSkills,
  skillAvailability,
  skillRequirementIssues,
} from './skills-model';

function skill(patch: Partial<SkillStatusEntry> = {}): SkillStatusEntry {
  return {
    name: 'Builder',
    description: 'Builds things',
    source: 'managed',
    bundled: false,
    filePath: '/skills/builder/SKILL.md',
    baseDir: '/skills/builder',
    skillKey: 'builder',
    always: false,
    disabled: false,
    blockedByAllowlist: false,
    eligible: true,
    deletable: true,
    requirements: {},
    missing: {},
    configChecks: [],
    install: [],
    ...patch,
  };
}

function discovered(patch: Partial<DiscoverSkillItem> = {}): DiscoverSkillItem {
  return {
    id: 'clawhub:builder',
    source: 'clawhub',
    slug: 'builder',
    title: 'Builder',
    summary: 'Builds things',
    author: 'ClawHub',
    detailUrl: 'https://example.com/builder',
    installs: 3,
    ...patch,
  };
}

const operations = {
  update: jest.fn(),
  remove: jest.fn(),
} as SkillsOperations;

describe('Agent skills model', () => {
  it('derives status and filters installed skills', () => {
    const unavailable = skill({ name: 'Broken', skillKey: 'broken', eligible: false });
    const disabled = skill({ name: 'Dormant', skillKey: 'dormant', disabled: true });
    expect(skillAvailability(skill())).toBe('Active');
    expect(skillAvailability(unavailable)).toBe('Unavailable');
    expect(skillAvailability(disabled)).toBe('Disabled');
    expect(filterInstalledSkills([unavailable, disabled, skill()], 'dormant'))
      .toEqual([disabled]);
    expect(filterInstalledSkills([unavailable, disabled, skill()], ''))
      .toEqual([unavailable, skill(), disabled]);
  });

  it('keeps alphabetical order when switches change and searches descriptions and sources', () => {
    const items = [skill({ name: 'Zed', skillKey: 'zed' }), skill({ name: 'Alpha', skillKey: 'alpha' })];
    expect(filterInstalledSkills(items, '').map((item) => item.skillKey)).toEqual(['alpha', 'zed']);
    expect(filterInstalledSkills(items.map((item) => ({ ...item, disabled: !item.disabled })), '').map((item) => item.skillKey)).toEqual(['alpha', 'zed']);
    expect(filterInstalledSkills(items, 'builds')).toHaveLength(2);
    expect(filterInstalledSkills(items, 'managed')).toHaveLength(2);
  });

  it('reports concrete requirements without treating a disabled switch as a missing requirement', () => {
    expect(skillRequirementIssues(skill({ disabled: true, eligible: false }))).toEqual([]);
    expect(skillRequirementIssues(skill({ eligible: false }))).toEqual([{ kind: 'unavailable', requirements: '' }]);
    expect(skillRequirementIssues(skill({
      eligible: false, blockedByAllowlist: true,
      missing: { bins: [' memo ', 'memo'], env: ['IMAGE_KEY'], anyBins: ['uv', 'python'], config: ['image.provider'], os: ['darwin'] },
      configChecks: [{ path: 'image.provider', label: 'Provider', satisfied: false }],
    }))).toEqual([
      { kind: 'blocked', requirements: '' },
      { kind: 'missing', requirements: 'memo, IMAGE_KEY, image.provider' },
      { kind: 'any', requirements: 'uv, python' },
      { kind: 'os', requirements: 'darwin' },
    ]);
  });

  it('groups discovery results by source and sorts popular entries first', () => {
    const groups = groupDiscoveredSkills([
      discovered({ id: 'skills:one', source: 'skills_sh', installs: 1 }),
      discovered({ id: 'clawhub:small', installs: 2 }),
      discovered({ id: 'clawhub:large', title: 'Large', installs: 10 }),
    ]);
    expect(groups.map((group) => group.source)).toEqual(['clawhub', 'skills_sh']);
    expect(groups[0]?.items.map((item) => item.id)).toEqual(['clawhub:large', 'clawhub:small']);
  });

  it('gates mutation controls with capabilities, operations, and row metadata', () => {
    expect(canToggleSkill(skill(), { skills: true }, operations)).toBe(true);
    expect(canToggleSkill(skill({ always: true }), { skills: true }, operations)).toBe(false);
    expect(canToggleSkill(skill(), { skills: false }, operations)).toBe(false);
    expect(canRemoveSkill(skill(), { skillInstall: true }, operations)).toBe(true);
    expect(canRemoveSkill(skill({ deletable: false }), { skillInstall: true }, operations)).toBe(false);
    expect(canRemoveSkill(skill(), { skillInstall: false }, operations)).toBe(false);
  });

  it('uses the source install command and falls back to the title', () => {
    expect(buildSkillInstallPrompt(discovered({ installCommand: 'Install builder' })))
      .toBe('Install builder');
    expect(buildSkillInstallPrompt(discovered({ installCommand: '  ' }))).toBe('Builder');
  });
});
