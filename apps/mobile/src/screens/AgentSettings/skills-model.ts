import type {
  Capabilities,
  DiscoverSkillItem,
  SkillStatusEntry,
  SkillsOperations,
} from '@clawket/agent-protocol';

export type SkillAvailability = 'Active' | 'Disabled' | 'Unavailable';

export function skillAvailability(skill: SkillStatusEntry): SkillAvailability {
  if (skill.disabled) return 'Disabled';
  return skill.eligible ? 'Active' : 'Unavailable';
}

export function filterInstalledSkills(
  skills: ReadonlyArray<SkillStatusEntry>,
  query: string,
): ReadonlyArray<SkillStatusEntry> {
  const needle = query.trim().toLowerCase();
  return [...skills]
    .filter((skill) => !needle || [
      skill.name,
      skill.description,
      skill.skillKey,
      skill.source,
    ].some((value) => value.toLowerCase().includes(needle)))
    .sort((left, right) => (
      availabilityRank(skillAvailability(left)) - availabilityRank(skillAvailability(right))
      || left.name.localeCompare(right.name)
    ));
}

export function groupDiscoveredSkills(
  items: ReadonlyArray<DiscoverSkillItem>,
): ReadonlyArray<Readonly<{
  source: DiscoverSkillItem['source'];
  items: ReadonlyArray<DiscoverSkillItem>;
}>> {
  const groups = new Map<DiscoverSkillItem['source'], DiscoverSkillItem[]>();
  for (const item of items) {
    const group = groups.get(item.source) ?? [];
    group.push(item);
    groups.set(item.source, group);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([source, sourceItems]) => ({
      source,
      items: sourceItems.sort((left, right) => (
        (right.installs ?? 0) - (left.installs ?? 0)
        || left.title.localeCompare(right.title)
      )),
    }));
}

export function canToggleSkill(
  skill: SkillStatusEntry,
  capabilities: Pick<Capabilities, 'skills'>,
  operations: SkillsOperations | undefined,
): boolean {
  return capabilities.skills && !skill.always && Boolean(operations?.update);
}

export function canRemoveSkill(
  skill: SkillStatusEntry,
  capabilities: Pick<Capabilities, 'skillInstall'>,
  operations: SkillsOperations | undefined,
): boolean {
  return capabilities.skillInstall
    && skill.deletable === true
    && Boolean(operations?.remove);
}

export function buildSkillInstallPrompt(item: DiscoverSkillItem): string {
  return item.installCommand?.trim() || item.title.trim();
}

function availabilityRank(status: SkillAvailability): number {
  if (status === 'Active') return 0;
  if (status === 'Disabled') return 1;
  return 2;
}
