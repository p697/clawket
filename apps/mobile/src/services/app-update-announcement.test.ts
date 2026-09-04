import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  getCurrentAppUpdateAnnouncement,
  getCurrentAppVersion,
  markCurrentAppUpdateAnnouncementShown,
  shouldShowCurrentAppUpdateAnnouncement,
} from './app-update-announcement';
import { APP_PACKAGE_VERSION } from '../constants/app-version';
import * as releaseUpdates from '../features/app-updates/releases';

jest.mock('expo-application', () => ({
  nativeApplicationVersion: require('../../package.json').version,
}));

describe('app update announcement service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns the current app version', () => {
    expect(getCurrentAppVersion()).toBe(APP_PACKAGE_VERSION);
  });

  it('returns the current version release note entry when one exists', () => {
    jest.spyOn(releaseUpdates, 'getAppUpdateRelease').mockReturnValueOnce({
      version: APP_PACKAGE_VERSION,
      entries: [{
        id: 'current-release',
        emoji: '🚀',
        title: 'Current release',
        action: { type: 'none' },
      }],
    });

    expect(getCurrentAppUpdateAnnouncement()).toMatchObject({
      entries: [expect.objectContaining({ id: 'current-release' })],
    });
  });

  it('returns the release announcement for a version that exists in the unified history', () => {
    expect(getCurrentAppUpdateAnnouncement('3.0.0')).not.toBeNull();
  });

  it('keeps only the Clawket 3.0 and 3.0 + Pro entries', () => {
    expect(releaseUpdates.getAppUpdateReleaseHistory()).toHaveLength(1);
    expect(getCurrentAppUpdateAnnouncement('3.0.0')?.entries.map((entry) => entry.id)).toEqual([
      'clawket-3-0',
      'clawket-3-0-pro',
    ]);
  });

  it('removes pre-3.0 release announcements from the history', () => {
    expect(getCurrentAppUpdateAnnouncement('2.1.0')).toBeNull();
    expect(getCurrentAppUpdateAnnouncement('1.9.0')).toBeNull();
  });

  it('returns null when the app version is not in the unified release history', () => {
    expect(getCurrentAppUpdateAnnouncement('9.9.9')).toBeNull();
  });

  it('returns null when the app version is empty', () => {
    expect(getCurrentAppUpdateAnnouncement('')).toBeNull();
  });

  it('auto-shows when the current app version has a matching unseen release note entry', async () => {
    jest.spyOn(releaseUpdates, 'getAppUpdateRelease').mockReturnValueOnce({
      version: APP_PACKAGE_VERSION,
      entries: [{
        id: 'current-release',
        emoji: '🚀',
        title: 'Current release',
        action: { type: 'none' },
      }],
    });
    jest.mocked(AsyncStorage.getItem).mockResolvedValueOnce(null);

    await expect(shouldShowCurrentAppUpdateAnnouncement(false)).resolves.toBe(true);
    expect(AsyncStorage.getItem).toHaveBeenCalled();
  });

  it('does not show the announcement again after it is marked as shown', async () => {
    jest.mocked(AsyncStorage.getItem).mockResolvedValueOnce('1');

    await expect(shouldShowCurrentAppUpdateAnnouncement(false)).resolves.toBe(false);
  });

  it('does not auto-show in debug mode', async () => {
    await expect(shouldShowCurrentAppUpdateAnnouncement(true)).resolves.toBe(false);
    expect(AsyncStorage.getItem).not.toHaveBeenCalled();
  });

  it('does not auto-show silent releases', async () => {
    jest.spyOn(releaseUpdates, 'getAppUpdateRelease').mockReturnValueOnce({
      version: APP_PACKAGE_VERSION,
      releasedAt: '2026-03-23',
      silent: true,
      entries: [
        {
          id: 'silent-entry',
          emoji: '🔕',
          title: 'Custom Chat Appearance',
          subtitle: 'Add a custom chat background and adjust bubble opacity in Chat Appearance.',
          action: {
            type: 'navigate_config',
            screen: 'ChatAppearance',
          },
        },
      ],
    });

    await expect(shouldShowCurrentAppUpdateAnnouncement(false)).resolves.toBe(false);
    expect(AsyncStorage.getItem).not.toHaveBeenCalled();
  });

  it('stores the shown flag for the current version', async () => {
    jest.spyOn(releaseUpdates, 'getAppUpdateRelease').mockReturnValueOnce({
      version: APP_PACKAGE_VERSION,
      entries: [{
        id: 'current-release',
        emoji: '🚀',
        title: 'Current release',
        action: { type: 'none' },
      }],
    });
    await markCurrentAppUpdateAnnouncementShown();

    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      `clawket.appUpdateAnnouncementSeen.v1:${APP_PACKAGE_VERSION}`,
      '1',
    );
  });
});
