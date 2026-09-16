import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  LAST_ANNOUNCED_VERSION_STORAGE_KEY,
  getAppUpdateAnnouncementPreview,
  getAppUpdateAnnouncementStorageKey,
  getCurrentAppVersion,
  markAppUpdateAnnouncementShown,
  primeAppUpdateAnnouncementBaseline,
  readLastAnnouncedAppVersion,
  resolveLaunchAppUpdateAnnouncement,
} from './app-update-announcement';
import { APP_PACKAGE_VERSION } from '../constants/app-version';
import { DEFAULT_APP_UPDATE_DEBUG_HINT } from '../features/app-updates/releases';

jest.mock('expo-application', () => ({
  nativeApplicationVersion: require('../../package.json').version,
}));

const mockedStorage = AsyncStorage as jest.Mocked<typeof AsyncStorage>;

function storage(values: Record<string, string | null>) {
  mockedStorage.getItem.mockImplementation(async (key: string) => values[key] ?? null);
  mockedStorage.setItem.mockImplementation(async () => undefined);
}

describe('app update announcement service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    storage({});
  });

  it('returns the current app version', () => {
    expect(getCurrentAppVersion()).toBe(APP_PACKAGE_VERSION);
  });

  it('announces 3.0.0 to a device upgraded from 2.x that has no baseline', async () => {
    storage({ [getAppUpdateAnnouncementStorageKey('2.1.1')]: '1' });
    const announcement = await resolveLaunchAppUpdateAnnouncement('3.0.0');
    expect(announcement?.currentVersion).toBe('3.0.0');
    expect(announcement?.releases.map((release) => release.version)).toEqual(['3.0.0']);
    expect(announcement?.debugHint).toBeNull();
  });

  it('stays quiet once the current version was announced under either scheme', async () => {
    storage({ [getAppUpdateAnnouncementStorageKey('3.0.0')]: '1' });
    await expect(resolveLaunchAppUpdateAnnouncement('3.0.0')).resolves.toBeNull();

    storage({ [LAST_ANNOUNCED_VERSION_STORAGE_KEY]: '3.0.0' });
    await expect(resolveLaunchAppUpdateAnnouncement('3.0.0')).resolves.toBeNull();
  });

  it('stays quiet for silent releases, versions without notes and an empty version', async () => {
    storage({ [LAST_ANNOUNCED_VERSION_STORAGE_KEY]: '2.1.0' });
    await expect(resolveLaunchAppUpdateAnnouncement('2.1.1')).resolves.toBeNull();
    await expect(resolveLaunchAppUpdateAnnouncement('')).resolves.toBeNull();
    storage({ [LAST_ANNOUNCED_VERSION_STORAGE_KEY]: '3.0.0' });
    await expect(resolveLaunchAppUpdateAnnouncement('9.9.9')).resolves.toBeNull();
  });

  it('still shows skipped notes on a later build that has none of its own', async () => {
    storage({ [LAST_ANNOUNCED_VERSION_STORAGE_KEY]: '2.1.0' });
    const announcement = await resolveLaunchAppUpdateAnnouncement('3.0.1');
    expect(announcement?.currentVersion).toBe('3.0.1');
    expect(announcement?.releases.map((release) => release.version)).toEqual(['3.0.0']);
  });

  it('merges every release skipped since the recorded baseline', async () => {
    storage({ [LAST_ANNOUNCED_VERSION_STORAGE_KEY]: '1.9.0' });
    const announcement = await resolveLaunchAppUpdateAnnouncement('2.1.0');
    expect(announcement?.releases.map((release) => release.version)).toEqual(['2.1.0', '1.10.0']);
  });

  it('records both the legacy per-version flag and the new baseline when shown', async () => {
    await markAppUpdateAnnouncementShown('3.0.0');
    expect(mockedStorage.setItem).toHaveBeenCalledWith(getAppUpdateAnnouncementStorageKey('3.0.0'), '1');
    expect(mockedStorage.setItem).toHaveBeenCalledWith(LAST_ANNOUNCED_VERSION_STORAGE_KEY, '3.0.0');
    await markAppUpdateAnnouncementShown('  ');
    expect(mockedStorage.setItem).toHaveBeenCalledTimes(2);
  });

  it('primes a fresh install once and never overwrites an existing baseline', async () => {
    await expect(primeAppUpdateAnnouncementBaseline('3.0.0')).resolves.toBe(true);
    expect(mockedStorage.setItem).toHaveBeenCalledWith(LAST_ANNOUNCED_VERSION_STORAGE_KEY, '3.0.0');

    storage({ [LAST_ANNOUNCED_VERSION_STORAGE_KEY]: '2.1.0' });
    mockedStorage.setItem.mockClear();
    await expect(primeAppUpdateAnnouncementBaseline('3.0.0')).resolves.toBe(false);
    expect(mockedStorage.setItem).not.toHaveBeenCalled();
    await expect(readLastAnnouncedAppVersion()).resolves.toBe('2.1.0');
  });

  it('survives storage failures without blocking launch', async () => {
    mockedStorage.getItem.mockRejectedValue(new Error('disk'));
    mockedStorage.setItem.mockRejectedValue(new Error('disk'));
    const announcement = await resolveLaunchAppUpdateAnnouncement('3.0.0');
    expect(announcement?.releases.map((release) => release.version)).toEqual(['3.0.0']);
    await expect(markAppUpdateAnnouncementShown('3.0.0')).resolves.toBeUndefined();
  });

  it('previews the current or newest release regardless of the cache', () => {
    storage({ [LAST_ANNOUNCED_VERSION_STORAGE_KEY]: '3.0.0' });
    expect(getAppUpdateAnnouncementPreview('3.0.0')).toMatchObject({
      currentVersion: '3.0.0',
      debugHint: DEFAULT_APP_UPDATE_DEBUG_HINT,
    });
    expect(getAppUpdateAnnouncementPreview('9.9.9')?.releases[0]?.version).toBe('3.0.0');
    expect(getAppUpdateAnnouncementPreview('1.9.0')?.releases[0]?.version).toBe('1.9.0');
  });
});
