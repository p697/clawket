export type AppUpdateAnnouncementAction =
  | {
      type: 'none';
    }
  | {
      type: 'navigate_tab';
      screen: 'Live';
    }
  | {
      type: 'open_url';
      url: string;
    }
  | {
      type: 'navigate_console';
      screen: 'Discover' | 'Cron' | 'SessionsBoard' | 'AgentSessionsBoard' | 'ModelList';
    }
  | {
      type: 'navigate_config';
      screen: 'ChatAppearance';
    }
  | {
      type: 'navigate_config_add_connection';
      tab?: 'quick' | 'manual';
      flow?: 'local' | 'youmind';
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
    version: '3.0.0',
    releasedAt: '2026-09-05',
    entries: [
      {
        id: 'clawket-3-0',
        emoji: '🚀',
        title: 'Clawket 3.0',
        subtitle: 'Every agent and session in one roster.',
        action: {
          type: 'none',
        },
      },
      {
        id: 'clawket-3-0-pro',
        emoji: '✨',
        title: 'Clawket 3.0 + Pro',
        subtitle: 'Unlimited connections, agents, management, logs, files, and search.',
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
