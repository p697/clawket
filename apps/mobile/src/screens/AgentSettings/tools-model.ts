import type {
  ToolCatalog,
  ToolCatalogEntry,
  ToolCatalogGroup,
  ToolPolicy,
} from '@clawket/agent-protocol';

export type ToolPolicyDiff = Readonly<{
  enabled: number;
  disabled: number;
  totalChanged: number;
}>;

export function extractAgentToolPolicy(
  config: Record<string, unknown> | null | undefined,
  agentId: string,
): ToolPolicy {
  const agents = asRecord(config?.agents);
  const list = Array.isArray(agents?.list) ? agents.list : [];
  const agent = list
    .map(asRecord)
    .find((candidate) => candidate?.id === agentId || candidate?.key === agentId);
  const tools = asRecord(agent?.tools);
  return {
    agentId,
    ...(typeof tools?.profile === 'string' && tools.profile.trim()
      ? { profile: tools.profile.trim() }
      : {}),
    ...stringListField(tools, 'allow'),
    ...stringListField(tools, 'alsoAllow'),
    ...stringListField(tools, 'deny'),
  };
}

export function filterToolCatalog(
  catalog: ToolCatalog,
  query: string,
): ToolCatalogGroup[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return catalog.groups;
  return catalog.groups.flatMap((group) => {
    const groupMatches = searchable(group.label).includes(needle)
      || searchable(group.id).includes(needle)
      || searchable(group.pluginId).includes(needle);
    const tools = groupMatches
      ? group.tools
      : group.tools.filter((tool) => [
          tool.id,
          tool.label,
          tool.description,
          tool.pluginId,
        ].some((value) => searchable(value).includes(needle)));
    return tools.length ? [{ ...group, tools }] : [];
  });
}

export function isExplicitToolAllowList(policy: ToolPolicy): boolean {
  return normalizedList(policy.allow).length > 0;
}

export function isToolEnabledForPolicy(
  tool: ToolCatalogEntry,
  policy: ToolPolicy,
): boolean {
  if (matchesToolList(tool.id, policy.deny)) return false;
  if (isExplicitToolAllowList(policy)) return matchesToolList(tool.id, policy.allow);
  if (matchesToolList(tool.id, policy.alsoAllow)) return true;
  return isToolInProfile(tool, policy.profile ?? 'full');
}

export function toggleToolInPolicy(
  tool: ToolCatalogEntry,
  enabled: boolean,
  policy: ToolPolicy,
): ToolPolicy {
  if (isExplicitToolAllowList(policy)) return policy;
  const alsoAllow = new Set(normalizedList(policy.alsoAllow));
  const deny = new Set(normalizedList(policy.deny));
  const id = normalizeToolId(tool.id);
  const baseEnabled = isToolInProfile(tool, policy.profile ?? 'full');

  if (enabled) {
    deny.delete(id);
    if (baseEnabled) alsoAllow.delete(id);
    else alsoAllow.add(id);
  } else {
    alsoAllow.delete(id);
    deny.add(id);
  }

  return {
    ...policy,
    alsoAllow: [...alsoAllow],
    deny: [...deny],
  };
}

export function selectToolProfile(
  policy: ToolPolicy,
  profile: string,
): ToolPolicy {
  if (isExplicitToolAllowList(policy)) return policy;
  return {
    agentId: policy.agentId,
    profile,
    alsoAllow: [],
    deny: [],
  };
}

export function computeToolPolicyDiff(
  catalog: ToolCatalog,
  before: ToolPolicy,
  after: ToolPolicy,
): ToolPolicyDiff {
  let enabled = 0;
  let disabled = 0;
  for (const tool of uniqueTools(catalog)) {
    const wasEnabled = isToolEnabledForPolicy(tool, before);
    const nextEnabled = isToolEnabledForPolicy(tool, after);
    if (!wasEnabled && nextEnabled) enabled += 1;
    if (wasEnabled && !nextEnabled) disabled += 1;
  }
  return { enabled, disabled, totalChanged: enabled + disabled };
}

export function countEnabledTools(catalog: ToolCatalog, policy: ToolPolicy): number {
  return uniqueTools(catalog).filter((tool) => isToolEnabledForPolicy(tool, policy)).length;
}

export function countCatalogTools(catalog: ToolCatalog): number {
  return uniqueTools(catalog).length;
}

export function sameToolPolicy(a: ToolPolicy, b: ToolPolicy): boolean {
  return a.agentId === b.agentId
    && (a.profile ?? 'full') === (b.profile ?? 'full')
    && sameStringList(a.allow, b.allow)
    && sameStringList(a.alsoAllow, b.alsoAllow)
    && sameStringList(a.deny, b.deny);
}

export function activeToolProfile(
  catalog: ToolCatalog,
  policy: ToolPolicy,
): string | null {
  if (isExplicitToolAllowList(policy)
    || normalizedList(policy.alsoAllow).length
    || normalizedList(policy.deny).length) return null;
  const profile = policy.profile ?? 'full';
  return catalog.profiles.some((candidate) => candidate.id === profile)
    ? profile
    : null;
}

function isToolInProfile(tool: ToolCatalogEntry, profile: string): boolean {
  if (!profile || profile === 'full') return true;
  return tool.defaultProfiles.some((candidate) => candidate === profile);
}

function matchesToolList(toolId: string, list: string[] | undefined): boolean {
  const id = normalizeToolId(toolId);
  return normalizedList(list).some((candidate) => (
    candidate === '*'
    || candidate === id
    || (id === 'apply_patch' && candidate === 'exec')
  ));
}

function uniqueTools(catalog: ToolCatalog): ToolCatalogEntry[] {
  const tools = new Map<string, ToolCatalogEntry>();
  for (const group of catalog.groups) {
    for (const tool of group.tools) {
      const id = normalizeToolId(tool.id);
      if (!tools.has(id)) tools.set(id, tool);
    }
  }
  return [...tools.values()];
}

function stringListField<Key extends 'allow' | 'alsoAllow' | 'deny'>(
  record: Record<string, unknown> | null,
  key: Key,
): Partial<Pick<ToolPolicy, Key>> {
  if (!Array.isArray(record?.[key])) return {};
  return { [key]: normalizedList(record[key] as unknown[]) } as Pick<ToolPolicy, Key>;
}

function normalizedList(list: readonly unknown[] | undefined): string[] {
  if (!Array.isArray(list)) return [];
  return [...new Set(list
    .filter((value): value is string => typeof value === 'string')
    .map(normalizeToolId)
    .filter(Boolean))];
}

function sameStringList(a: string[] | undefined, b: string[] | undefined): boolean {
  return normalizedList(a).sort().join('\u0000') === normalizedList(b).sort().join('\u0000');
}

function normalizeToolId(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function searchable(value: string | undefined): string {
  return value?.toLocaleLowerCase() ?? '';
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
