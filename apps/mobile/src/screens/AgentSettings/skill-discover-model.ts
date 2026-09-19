import type { BackendKind } from '@clawket/agent-protocol';

/** ClawHub's own web catalog, opened inside the Discover page. */
export const CLAWHUB_ORIGIN = 'https://clawhub.ai';
export const CLAWHUB_SKILLS_URL = `${CLAWHUB_ORIGIN}/skills`;

export type ClawHubSkillRef = Readonly<{
  owner: string;
  slug: string;
  /** Canonical detail page: `https://clawhub.ai/{owner}/skills/{slug}`. */
  url: string;
}>;

// Hand-rolled so the decision is identical under Node's WHATWG URL and React
// Native's regex URL shim, which does not parse non-http schemes the same way.
const SCHEME_RE = /^([a-z][a-z0-9+.-]*):/i;
const HTTP_URL_RE = /^https?:\/\/(?:[^@/?#]*@)?([^/?#:]+)(?::\d+)?(\/[^?#]*)?/i;
const CLAWHUB_HOST_RE = /^(?:www\.)?clawhub\.ai$/i;
// The 2026-09 detail page shape. `/skills/publish` and `/{owner}` have too few
// segments to match; plugin pages (`/{owner}/plugins/{slug}`) are not skills.
const SKILL_PATH_RE = /^\/([^/]+)\/skills\/([^/]+)\/?$/;

function parseHttpUrl(url: string): Readonly<{ host: string; pathname: string }> | null {
  const match = HTTP_URL_RE.exec(url.trim());
  if (!match) return null;
  return { host: match[1], pathname: match[2] || '/' };
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment).trim();
  } catch {
    return '';
  }
}

/** The skill a ClawHub page is about, or `null` for catalog, plugin and off-site pages. */
export function parseClawHubSkillUrl(url: string): ClawHubSkillRef | null {
  const parsed = parseHttpUrl(url);
  if (!parsed || !CLAWHUB_HOST_RE.test(parsed.host)) return null;
  const match = SKILL_PATH_RE.exec(parsed.pathname);
  if (!match) return null;
  const owner = decodeSegment(match[1]);
  const slug = decodeSegment(match[2]);
  if (!owner || !slug) return null;
  return { owner, slug, url: `${CLAWHUB_ORIGIN}/${encodeURIComponent(owner)}/skills/${encodeURIComponent(slug)}` };
}

export type ClawHubNavigation = 'allow' | 'external' | 'block';

/**
 * Keeps the in-app page on ClawHub: other websites and handoff schemes open in
 * the system browser instead of trapping the user inside the page, and scheme
 * URLs the system cannot handle are dropped.
 */
export function resolveClawHubNavigation(url: string): ClawHubNavigation {
  const scheme = SCHEME_RE.exec(url.trim())?.[1]?.toLowerCase();
  switch (scheme) {
    case 'about':
    case 'blob':
    case 'data':
      return 'allow';
    case 'https':
    case 'http': {
      const parsed = parseHttpUrl(url);
      return parsed && CLAWHUB_HOST_RE.test(parsed.host) ? 'allow' : 'external';
    }
    case 'mailto':
    case 'tel':
    case 'sms':
      return 'external';
    default:
      return 'block';
  }
}

export function clawHubSkillHandle(skill: Pick<ClawHubSkillRef, 'owner' | 'slug'>): string {
  return `@${skill.owner}/${skill.slug}`;
}

/**
 * The chat message that asks the Agent to install a ClawHub skill. Each backend
 * gets its own CLI: OpenClaw installs by handle, Hermes resolves the slug through
 * its ClawHub hub source; other backends get the page and no command.
 */
export function buildClawHubInstallPrompt(backend: BackendKind, skill: ClawHubSkillRef): string {
  const handle = clawHubSkillHandle(skill);
  const command = backend === 'openclaw'
    ? `openclaw skills install ${handle}`
    : backend === 'hermes'
      ? `hermes skills install ${skill.slug}`
      : null;
  return [
    'Install this ClawHub skill for me.',
    '',
    `Skill: ${handle}`,
    `Page: ${skill.url}`,
    command ? `Command: ${command}` : null,
    '',
    'Run the install, then tell me whether it succeeded.',
  ].filter((line) => line !== null).join('\n');
}
