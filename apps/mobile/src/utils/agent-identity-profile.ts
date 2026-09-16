export type AgentIdentityProfile = {
  name: string;
  emoji: string;
  creature: string;
  vibe: string;
  theme: string;
  avatar: string;
};

export const EMPTY_AGENT_IDENTITY_PROFILE: AgentIdentityProfile = {
  name: '',
  emoji: '',
  creature: '',
  vibe: '',
  theme: '',
  avatar: '',
};

const IDENTITY_PLACEHOLDER_VALUES = new Set([
  'pick something you like',
  'ai? robot? familiar? ghost in the machine? something weirder?',
  'how do you come across? sharp? warm? chaotic? calm?',
  'your signature - pick one that feels right',
  'workspace-relative path, http(s) url, or data uri',
]);

function normalizeIdentityValue(value: string): string {
  let normalized = value.trim();
  normalized = normalized.replace(/^[*_]+|[*_]+$/g, '').trim();
  if (normalized.startsWith('(') && normalized.endsWith(')')) {
    normalized = normalized.slice(1, -1).trim();
  }
  normalized = normalized.replace(/[\u2013\u2014]/g, '-');
  normalized = normalized.replace(/\s+/g, ' ').toLowerCase();
  return normalized;
}

function isIdentityPlaceholder(value: string): boolean {
  return IDENTITY_PLACEHOLDER_VALUES.has(normalizeIdentityValue(value));
}

function formatIdentityValue(value: string, placeholder: string): string {
  const trimmed = value.trim();
  return trimmed ? trimmed : placeholder;
}

export function parseAgentIdentityProfile(content: string): AgentIdentityProfile {
  const profile: AgentIdentityProfile = { ...EMPTY_AGENT_IDENTITY_PROFILE };
  const lines = content.split(/\r?\n/);

  for (const line of lines) {
    const cleaned = line.trim().replace(/^\s*-\s*/, '');
    const colonIndex = cleaned.indexOf(':');
    if (colonIndex === -1) continue;

    const label = cleaned.slice(0, colonIndex).replace(/[*_]/g, '').trim().toLowerCase();
    const value = cleaned.slice(colonIndex + 1).replace(/^[*_]+|[*_]+$/g, '').trim();
    if (!value || isIdentityPlaceholder(value)) continue;

    if (label === 'name') profile.name = value;
    if (label === 'emoji') profile.emoji = value;
    if (label === 'creature') profile.creature = value;
    if (label === 'vibe') profile.vibe = value;
    if (label === 'theme') profile.theme = value;
    if (label === 'avatar') profile.avatar = value;
  }

  return profile;
}

export function generateAgentIdentityMarkdown(profile: AgentIdentityProfile): string {
  const themeBlock = profile.theme.trim()
    ? [`- **Theme:** ${profile.theme.trim()}`]
    : [];

  return [
    '# IDENTITY.md - Who Am I?',
    '',
    '_Fill this in during your first conversation. Make it yours._',
    '',
    `- **Name:** ${formatIdentityValue(profile.name, '_(pick something you like)_')}`,
    ...themeBlock,
    `- **Creature:** ${formatIdentityValue(profile.creature, '_(AI? robot? familiar? ghost in the machine? something weirder?)_')}`,
    `- **Vibe:** ${formatIdentityValue(profile.vibe, '_(how do you come across? sharp? warm? chaotic? calm?)_')}`,
    `- **Emoji:** ${formatIdentityValue(profile.emoji, '_(your signature - pick one that feels right)_')}`,
    `- **Avatar:** ${formatIdentityValue(profile.avatar, '_(workspace-relative path, http(s) URL, or data URI)_')}`,
    '',
    '---',
    '',
    "This isn't just metadata. It's the start of figuring out who you are.",
    '',
    'Notes:',
    '',
    '- Save this file at the workspace root as `IDENTITY.md`.',
    '- For avatars, use a workspace-relative path like `avatars/openclaw.png`.',
    '',
  ].join('\n');
}

const IDENTITY_LINE_LABELS: ReadonlyArray<readonly [keyof AgentIdentityProfile, string]> = [
  ['name', 'Name'],
  ['theme', 'Theme'],
  ['creature', 'Creature'],
  ['vibe', 'Vibe'],
  ['emoji', 'Emoji'],
  ['avatar', 'Avatar'],
];
const IDENTITY_LABEL_SET = new Set(IDENTITY_LINE_LABELS.map(([, label]) => label.toLowerCase()));

function identityLineLabel(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('-')) return null;
  const cleaned = trimmed.replace(/^\s*-\s*/, '');
  const colonIndex = cleaned.indexOf(':');
  if (colonIndex === -1) return null;
  return cleaned.slice(0, colonIndex).replace(/[*_`]/g, '').trim().toLowerCase();
}

function identityInsertIndex(lines: string[]): number {
  // Keep new fields grouped with the existing identity list; otherwise place
  // them right after the title block so surrounding prose stays intact.
  let lastIdentityIndex = -1;
  lines.forEach((line, index) => {
    const label = identityLineLabel(line);
    if (label && IDENTITY_LABEL_SET.has(label)) lastIdentityIndex = index;
  });
  if (lastIdentityIndex >= 0) return lastIdentityIndex + 1;
  const headingIndex = lines.findIndex((line) => line.trim().startsWith('#'));
  if (headingIndex === -1) return 0;
  let insertIndex = headingIndex + 1;
  while (insertIndex < lines.length && lines[insertIndex]?.trim() === '') insertIndex += 1;
  return insertIndex;
}

/**
 * Replace the given identity lines inside existing IDENTITY.md content and
 * preserve everything else. Omitted fields are left untouched, an empty value
 * removes the line, and duplicate labels collapse into the first occurrence.
 */
export function mergeAgentIdentityMarkdown(
  content: string,
  fields: Partial<Pick<AgentIdentityProfile, 'name' | 'emoji' | 'creature' | 'vibe' | 'theme' | 'avatar'>>,
): string {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  for (const [field, label] of IDENTITY_LINE_LABELS) {
    const raw = fields[field];
    if (raw === undefined) continue;
    const value = raw.trim();
    const matches = lines.reduce<number[]>((indexes, line, index) => {
      if (identityLineLabel(line) === label.toLowerCase()) indexes.push(index);
      return indexes;
    }, []);
    if (!value) {
      for (const match of matches.reverse()) lines.splice(match, 1);
      continue;
    }
    const nextLine = `- **${label}:** ${value}`;
    const [first, ...duplicates] = matches;
    if (first !== undefined) {
      lines[first] = nextLine;
      for (const duplicate of duplicates.reverse()) lines.splice(duplicate, 1);
      continue;
    }
    lines.splice(identityInsertIndex(lines), 0, nextLine);
  }
  return lines.join('\n').replace(/\n*$/, '\n');
}
