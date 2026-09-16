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
    // A switch must not move the row out from under the user's finger.
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function skillRequirementIssues(skill: SkillStatusEntry): ReadonlyArray<{
  kind: 'blocked' | 'missing' | 'any' | 'os' | 'unavailable';
  requirements: string;
}> {
  const unique = (values: string[]) => [...new Set(values.map((value) => value.trim()).filter(Boolean))];
  const missing = unique([
    ...(skill.missing.bins ?? []),
    ...(skill.missing.env ?? []),
    ...(skill.missing.config ?? []),
    ...skill.configChecks.filter((check) => !check.satisfied).map((check) => check.path),
  ]);
  const issues: Array<{ kind: 'blocked' | 'missing' | 'any' | 'os' | 'unavailable'; requirements: string }> = [];
  if (skill.blockedByAllowlist) issues.push({ kind: 'blocked', requirements: '' });
  if (missing.length) issues.push({ kind: 'missing', requirements: missing.join(', ') });
  const any = unique(skill.missing.anyBins ?? []);
  if (any.length) issues.push({ kind: 'any', requirements: any.join(', ') });
  const os = unique(skill.missing.os ?? []);
  if (os.length) issues.push({ kind: 'os', requirements: os.join(', ') });
  if (!issues.length && !skill.disabled && !skill.eligible) {
    issues.push({ kind: 'unavailable', requirements: '' });
  }
  return issues;
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
