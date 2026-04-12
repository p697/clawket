import { CLAWKET_GITHUB_REPO_URL } from '../../config/app-links';

export type AppUpdateAnnouncementAction =
  | {
      type: 'none';
    }
  | {
      type: 'navigate_tab';
      screen: 'Office';
    }
  | {
      type: 'open_url';
      url: string;
    }
  | {
      type: 'navigate_console';
      screen: 'Discover' | 'CronWizard' | 'SessionsBoard' | 'AgentSessionsBoard' | 'ModelList' | 'Nodes';
    }
  | {
      type: 'navigate_config';
      screen: 'ChatAppearance' | 'OpenClawConfig' | 'OpenClawPermissionRepair';
    };

export type AppUpdateAnnouncementEntry = {
  id: string;
  emoji: string;
  tag?: string;
  title: string;
  subtitle?: string;
  action: AppUpdateAnnouncementAction;
};

export type AppUpdateAnnouncement = {
  debugHint: string;
  entries: AppUpdateAnnouncementEntry[];
};

export type AppUpdateRelease = {
  version: string;
  releasedAt?: string;
  silent?: boolean;
  entries: AppUpdateAnnouncementEntry[];
};

export const DEFAULT_APP_UPDATE_DEBUG_HINT =
  'Debug mode is on, so this preview ignores the one-time cache.';

// Keep this array newest-first. The first entry is treated as the latest release.
export const APP_UPDATE_RELEASES: AppUpdateRelease[] = [
  {
    version: '2.0.0',
    releasedAt: '2026-04-12',
    entries: [
      {
        id: 'hermes-full-support',
        emoji: '⚡',
        title: 'Hermes Full Support',
        subtitle: 'Connect and manage Hermes and OpenClaw at the same time.',
        action: {
          type: 'none',
        },
      },
    ],
  },
  {
    version: '1.10.0',
    releasedAt: '2026-04-10',
    entries: [
      {
        id: 'discover-console-page',
        emoji: '🧩',
        title: 'Discover',
        subtitle: 'Browse skills across ClawHub and skills.sh',
        action: {
          type: 'navigate_console',
          screen: 'Discover',
        },
      },
      {
        id: 'bug-fixes-and-experience-improvements',
        emoji: '🛠️',
        title: 'Bug fixes and experience improvements',
        action: {
          type: 'none',
        },
      },
    ],
  },
  {
    version: '1.9.0',
    releasedAt: '2026-04-07',
    entries: [
      {
        id: 'one-click-permission-repair',
        emoji: '🔧',
        title: 'One-click Permission Repair',
        subtitle: 'Jump straight to the new repair flow from OpenClaw Config Management.',
        action: {
          type: 'navigate_config',
          screen: 'OpenClawPermissionRepair',
        },
      },
    ],
  },
  {
    version: '1.8.0',
    releasedAt: '2026-04-02',
    entries: [
      {
        id: 'agent-sessions-board-refresh',
        emoji: '🪟',
        title: 'All-new Agent & Session Board',
        subtitle: 'A calmer, smarter home for your recent agents and conversations.',
        action: {
          type: 'navigate_console',
          screen: 'AgentSessionsBoard',
        },
      },
      {
        id: 'custom-app-icon',
        emoji: '🎨',
        title: 'Custom App Icon',
        subtitle: 'Change your app icon anytime from Settings.',
        action: {
          type: 'none',
        },
      },
    ],
  },
  {
    version: '1.7.0',
    releasedAt: '2026-03-29',
    entries: [
      {
        id: 'openclaw-diagnostics-auto-repair',
        emoji: '🩺',
        title: 'OpenClaw Diagnostics and Auto Repair',
        subtitle: 'View OpenClaw health status and run openclaw doctor --fix.',
        action: {
          type: 'navigate_config',
          screen: 'OpenClawConfig',
        },
      },
      {
        id: 'openclaw-permissions-management',
        emoji: '🔐',
        title: 'OpenClaw Permissions',
        subtitle: 'Review and manage what OpenClaw is allowed to access.',
        action: {
          type: 'navigate_config',
          screen: 'OpenClawConfig',
        },
      },
      {
        id: 'openclaw-node-capabilities',
        emoji: '🧩',
        title: 'Improved OpenClaw Node Capabilities',
        subtitle: 'Added support for capabilities like camera.snap and photos.latest.',
        action: {
          type: 'navigate_console',
          screen: 'Nodes',
        },
      },
    ],
  },
  {
    version: '1.6.0',
    releasedAt: '2026-03-26',
    entries: [
      {
        id: 'open-source-github',
        emoji: '⭐',
        title: 'Now Open Source!',
        subtitle: 'Tap to view our GitHub repository and leave a star~',
        action: {
          type: 'open_url',
          url: CLAWKET_GITHUB_REPO_URL,
        },
      },
      {
        id: 'dark-mode-improvements',
        emoji: '🌙',
        title: 'Dark Mode Improvements',
        subtitle: 'A better-looking, more refined dark mode.',
        action: {
          type: 'none',
        },
      },
      {
        id: 'known-issues-fixed',
        emoji: '🛠️',
        title: 'Fixed Known Issues',
        action: {
          type: 'none',
        },
      },
    ],
  },
  {
    version: '1.5.0',
    releasedAt: '2026-03-23',
    entries: [
      {
        id: 'open-source-github',
        emoji: '⭐',
        title: 'Now Open Source!',
        subtitle: 'Tap to view our GitHub repository and leave a star~',
        action: {
          type: 'open_url',
          url: CLAWKET_GITHUB_REPO_URL,
        },
      },
      {
        id: 'agent-create-edit-improvements',
        emoji: '🤖',
        title: 'Better Agent editing',
        subtitle: 'Edit an Agent name, emoji, personality, and more.',
        action: {
          type: 'none',
        },
      },
      {
        id: 'stability-and-polish',
        emoji: '🛠️',
        title: 'Fixes, stability, and UI polish',
        subtitle: 'Fixed many known issues, improved security and connection stability, and refined several UI interactions.',
        action: {
          type: 'none',
        },
      },
    ],
  },
  {
    version: '1.2.0',
    releasedAt: '2026-03-21',
    entries: [
      {
        id: 'chat-appearance',
        emoji: '🖼️',
        tag: 'New',
        title: 'Custom Chat Appearance',
        subtitle: 'Add a custom chat background and adjust bubble opacity in Chat Appearance.',
        action: {
          type: 'navigate_config',
          screen: 'ChatAppearance',
        },
      },
      {
        id: 'advanced-cron-job-creation',
        emoji: '⏰',
        tag: 'New',
        title: 'Advanced Cron Job Creation',
        subtitle: 'Use the full advanced Cron Job builder from the template page.',
        action: {
          type: 'navigate_console',
          screen: 'CronWizard',
        },
      },
    ],
  },
  {
    version: '1.1.0',
    releasedAt: '2026-03-19',
    entries: [
      {
        id: 'sessions-list',
        emoji: '📋',
        tag: 'New',
        title: 'Sessions Board',
        subtitle: 'See all your Session activity at a glance',
        action: {
          type: 'navigate_console',
          screen: 'SessionsBoard',
        },
      },
      {
        id: 'model-add-edit',
        emoji: '💰',
        tag: 'New',
        title: 'Add and Edit Models',
        subtitle: 'Create new models and update existing ones from the Models page',
        action: {
          type: 'navigate_console',
          screen: 'ModelList',
        },
      },
      {
        id: 'fast-mode-model-switch',
        emoji: '⚡',
        tag: 'New',
        title: 'Switch Models in Fast Mode',
        subtitle: 'Use /fast to switch models in Fast Mode',
        action: {
          type: 'none',
        },
      },
    ],
  },
];

function normalizeVersion(version: string): string {
  return version.trim();
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

export function toAppUpdateAnnouncement(release: AppUpdateRelease | null): AppUpdateAnnouncement | null {
  if (!release || release.entries.length === 0) return null;
  return {
    debugHint: DEFAULT_APP_UPDATE_DEBUG_HINT,
    entries: release.entries,
  };
}
