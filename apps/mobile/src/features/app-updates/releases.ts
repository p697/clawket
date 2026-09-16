import { CLAWKET_GITHUB_REPO_URL } from '../../config/app-links';

/**
 * Entry actions are limited to what the What's New sheet can honor without
 * deep-linking into screens that moved in 3.0 (owner decision 2026-09-16):
 * an external link or the Pro paywall. The Release Notes history renders
 * every entry as plain text and ignores actions entirely.
 */
export type AppUpdateAnnouncementAction =
  | {
      type: 'none';
    }
  | {
      type: 'open_url';
      url: string;
    }
  | {
      type: 'open_paywall';
      feature: 'settingsMembershipPreview';
    };

/** Bounded Lucide vocabulary; emoji literals are not allowed as icons. */
export type AppUpdateAnnouncementIcon =
  | 'rocket'
  | 'sparkles'
  | 'layout'
  | 'layers'
  | 'search'
  | 'link'
  | 'palette'
  | 'brain'
  | 'feather'
  | 'puzzle'
  | 'wrench'
  | 'stethoscope'
  | 'shield'
  | 'star'
  | 'moon'
  | 'bot'
  | 'image'
  | 'clock'
  | 'list'
  | 'coins'
  | 'zap';

export type AppUpdateAnnouncementEntry = {
  id: string;
  icon: AppUpdateAnnouncementIcon;
  tag?: string;
  /** `chat` namespace key. */
  title: string;
  /** `chat` namespace key. */
  subtitle?: string;
  action: AppUpdateAnnouncementAction;
};

export type AppUpdateRelease = {
  version: string;
  /** ISO calendar date of the store release. */
  releasedAt?: string;
  /** Silent releases are listed in the history but never announced. */
  silent?: boolean;
  /** Optional hero copy for the What's New sheet (`chat` namespace keys). */
  title?: string;
  summary?: string;
  entries: AppUpdateAnnouncementEntry[];
};

/** What the sheet presents: one or more releases, newest first. */
export type AppUpdateAnnouncement = {
  currentVersion: string;
  releases: AppUpdateRelease[];
  debugHint: string | null;
};

export const DEFAULT_APP_UPDATE_DEBUG_HINT =
  'Debug mode is on, so this preview ignores the one-time cache.';

/** A user who skipped several releases sees at most this many in one sheet. */
export const MAX_ANNOUNCED_RELEASES = 3;

// Keep this array newest-first. The first entry is treated as the latest release.
// Dates are the actual store rollout days (verified against PostHog `Application Updated`).
export const APP_UPDATE_RELEASES: AppUpdateRelease[] = [
  {
    version: '3.0.0',
    releasedAt: '2026-09-05',
    title: 'Meet Clawket 3.0',
    summary: 'A brand-new experience, interface, and product.',
    entries: [
      {
        id: 'roster',
        icon: 'layout',
        title: 'All your Agents on one screen',
        subtitle: 'See who is busy and who has news at a glance.',
        action: { type: 'none' },
      },
      {
        id: 'session-panel',
        icon: 'layers',
        title: 'Session Panel',
        subtitle: 'Switch, pin and tidy up sessions in one place.',
        action: { type: 'none' },
      },
      {
        id: 'search',
        icon: 'search',
        title: 'Global search',
        subtitle: 'Search Agents, sessions and messages at once.',
        action: { type: 'none' },
      },
      {
        id: 'connections',
        icon: 'link',
        title: 'OpenClaw and Hermes side by side',
        subtitle: 'One command, a six-digit code, both on one phone.',
        action: { type: 'none' },
      },
      {
        id: 'design',
        icon: 'palette',
        title: 'A fresh look',
        subtitle: 'Cleaner, smoother, with live status on every avatar.',
        action: { type: 'none' },
      },
    ],
  },
  {
    version: '2.1.1',
    releasedAt: '2026-05-23',
    silent: true,
    entries: [
      {
        id: 'startup-connection-retry',
        icon: 'wrench',
        title: 'Connection stability fixes',
        subtitle: 'Connecting while OpenClaw is still starting up now retries automatically.',
        action: { type: 'none' },
      },
    ],
  },
  {
    version: '2.1.0',
    releasedAt: '2026-04-17',
    entries: [
      {
        id: 'youmind-connection',
        icon: 'brain',
        title: 'YouMind Connection',
        subtitle: 'You now can connect your YouMind account.',
        action: { type: 'none' },
      },
      {
        id: 'hermes-full-support',
        icon: 'feather',
        title: 'Hermes Connection',
        subtitle: 'Connect and manage Hermes and OpenClaw at the same time.',
        action: { type: 'none' },
      },
    ],
  },
  {
    version: '1.10.0',
    releasedAt: '2026-04-10',
    entries: [
      {
        id: 'discover-console-page',
        icon: 'puzzle',
        title: 'Discover',
        subtitle: 'Browse skills across ClawHub and skills.sh',
        action: { type: 'none' },
      },
      {
        id: 'bug-fixes-and-experience-improvements',
        icon: 'wrench',
        title: 'Bug fixes and experience improvements',
        action: { type: 'none' },
      },
    ],
  },
  {
    version: '1.9.0',
    releasedAt: '2026-04-07',
    entries: [
      {
        id: 'one-click-permission-repair',
        icon: 'wrench',
        title: 'One-click Permission Repair',
        subtitle: 'Jump straight to the new repair flow from OpenClaw Config Management.',
        action: { type: 'none' },
      },
    ],
  },
  {
    version: '1.8.0',
    releasedAt: '2026-04-02',
    entries: [
      {
        id: 'agent-sessions-board-refresh',
        icon: 'layout',
        title: 'All-new Agent & Session Board',
        subtitle: 'A calmer, smarter home for your recent agents and conversations.',
        action: { type: 'none' },
      },
      {
        id: 'custom-app-icon',
        icon: 'palette',
        title: 'Custom App Icon',
        subtitle: 'Change your app icon anytime from Settings.',
        action: { type: 'none' },
      },
    ],
  },
  {
    version: '1.7.0',
    releasedAt: '2026-03-29',
    entries: [
      {
        id: 'openclaw-diagnostics-auto-repair',
        icon: 'stethoscope',
        title: 'OpenClaw Diagnostics and Auto Repair',
        subtitle: 'View OpenClaw health status and run openclaw doctor --fix.',
        action: { type: 'none' },
      },
      {
        id: 'openclaw-permissions-management',
        icon: 'shield',
        title: 'OpenClaw Permissions',
        subtitle: 'Review and manage what OpenClaw is allowed to access.',
        action: { type: 'none' },
      },
      {
        id: 'openclaw-node-capabilities',
        icon: 'puzzle',
        title: 'Improved OpenClaw Node Capabilities',
        subtitle: 'Added support for capabilities like camera.snap and photos.latest.',
        action: { type: 'none' },
      },
    ],
  },
  {
    version: '1.6.0',
    releasedAt: '2026-03-26',
    entries: [
      {
        id: 'open-source-github',
        icon: 'star',
        title: 'Now Open Source!',
        subtitle: 'Tap to view our GitHub repository and leave a star~',
        action: { type: 'open_url', url: CLAWKET_GITHUB_REPO_URL },
      },
      {
        id: 'dark-mode-improvements',
        icon: 'moon',
        title: 'Dark Mode Improvements',
        subtitle: 'A better-looking, more refined dark mode.',
        action: { type: 'none' },
      },
      {
        id: 'known-issues-fixed',
        icon: 'wrench',
        title: 'Fixed Known Issues',
        action: { type: 'none' },
      },
    ],
  },
  {
    version: '1.5.0',
    releasedAt: '2026-03-23',
    entries: [
      {
        id: 'open-source-github',
        icon: 'star',
        title: 'Now Open Source!',
        subtitle: 'Tap to view our GitHub repository and leave a star~',
        action: { type: 'open_url', url: CLAWKET_GITHUB_REPO_URL },
      },
      {
        id: 'agent-create-edit-improvements',
        icon: 'bot',
        title: 'Better Agent editing',
        subtitle: 'Edit an Agent name, emoji, personality, and more.',
        action: { type: 'none' },
      },
      {
        id: 'stability-and-polish',
        icon: 'wrench',
        title: 'Fixes, stability, and UI polish',
        subtitle: 'Fixed many known issues, improved security and connection stability, and refined several UI interactions.',
        action: { type: 'none' },
      },
    ],
  },
  {
    version: '1.2.0',
    releasedAt: '2026-03-21',
    entries: [
      {
        id: 'chat-appearance',
        icon: 'image',
        tag: 'New',
        title: 'Custom Chat Appearance',
        subtitle: 'Add a custom chat background and adjust bubble opacity in Chat Appearance.',
        action: { type: 'none' },
      },
      {
        id: 'advanced-cron-job-creation',
        icon: 'clock',
        tag: 'New',
        title: 'Advanced Cron Job Creation',
        subtitle: 'Use the full advanced Cron Job builder from the template page.',
        action: { type: 'none' },
      },
    ],
  },
  {
    version: '1.1.0',
    releasedAt: '2026-03-19',
    entries: [
      {
        id: 'sessions-list',
        icon: 'list',
        tag: 'New',
        title: 'Sessions Board',
        subtitle: 'See all your Session activity at a glance',
        action: { type: 'none' },
      },
      {
        id: 'model-add-edit',
        icon: 'coins',
        tag: 'New',
        title: 'Add and Edit Models',
        subtitle: 'Create new models and update existing ones from the Models page',
        action: { type: 'none' },
      },
      {
        id: 'fast-mode-model-switch',
        icon: 'zap',
        tag: 'New',
        title: 'Switch Models in Fast Mode',
        subtitle: 'Use /fast to switch models in Fast Mode',
        action: { type: 'none' },
      },
    ],
  },
];

function normalizeVersion(version: string): string {
  return version.trim();
}

/**
 * Numeric dotted comparison (`1.10.0` > `1.9.0`); a missing segment counts as
 * zero and non-numeric segments compare as zero so malformed input never throws.
 */
export function compareAppVersions(left: string, right: string): number {
  const parse = (version: string) => normalizeVersion(version).split('.').map((segment) => {
    const value = Number.parseInt(segment, 10);
    return Number.isFinite(value) ? value : 0;
  });
  const a = parse(left);
  const b = parse(right);
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const delta = (a[index] ?? 0) - (b[index] ?? 0);
    if (delta !== 0) return delta < 0 ? -1 : 1;
  }
  return 0;
}

export function getAppUpdateReleaseHistory(): AppUpdateRelease[] {
  return APP_UPDATE_RELEASES;
}

export function getLatestAppUpdateRelease(): AppUpdateRelease | null {
  return APP_UPDATE_RELEASES[0] ?? null;
}

export function getAppUpdateRelease(version: string): AppUpdateRelease | null {
  const normalizedVersion = normalizeVersion(version);
  if (!normalizedVersion) return null;
  return APP_UPDATE_RELEASES.find((release) => normalizeVersion(release.version) === normalizedVersion) ?? null;
}

/**
 * Releases that still deserve an announcement on `currentVersion`: every
 * non-silent release newer than `lastAnnouncedVersion` up to and including the
 * current one, newest first, capped at `MAX_ANNOUNCED_RELEASES`. Without a
 * recorded last version (fresh 3.0 upgrade from 2.x) only the current release
 * qualifies, since the older notes describe a product that no longer looks the same.
 */
export function collectUnannouncedReleases(
  currentVersion: string,
  lastAnnouncedVersion: string | null,
  releases: ReadonlyArray<AppUpdateRelease> = APP_UPDATE_RELEASES,
): AppUpdateRelease[] {
  const current = normalizeVersion(currentVersion);
  if (!current) return [];
  const announceable = releases.filter((release) => (
    !release.silent
    && release.entries.length > 0
    && compareAppVersions(release.version, current) <= 0
  ));
  if (lastAnnouncedVersion === null) {
    return announceable.filter((release) => compareAppVersions(release.version, current) === 0);
  }
  return announceable
    .filter((release) => compareAppVersions(release.version, lastAnnouncedVersion) > 0)
    .sort((left, right) => compareAppVersions(right.version, left.version))
    .slice(0, MAX_ANNOUNCED_RELEASES);
}

export function toAppUpdateAnnouncement(
  currentVersion: string,
  releases: ReadonlyArray<AppUpdateRelease>,
  debugHint: string | null = null,
): AppUpdateAnnouncement | null {
  const presentable = releases.filter((release) => release.entries.length > 0);
  if (presentable.length === 0) return null;
  return {
    currentVersion: normalizeVersion(currentVersion),
    releases: [...presentable],
    debugHint,
  };
}
