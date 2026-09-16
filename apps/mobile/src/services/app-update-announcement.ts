import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Application from 'expo-application';
import { APP_PACKAGE_VERSION } from '../constants/app-version';
import {
  DEFAULT_APP_UPDATE_DEBUG_HINT,
  collectUnannouncedReleases,
  getAppUpdateRelease,
  getLatestAppUpdateRelease,
  toAppUpdateAnnouncement,
  type AppUpdateAnnouncement,
} from '../features/app-updates/releases';

/** Per-version flag written by 2.x; still honored and still written for old builds. */
const SEEN_STORAGE_PREFIX = 'clawket.appUpdateAnnouncementSeen.v1';
/** Newest version that was announced on this device; drives skipped-version merging. */
export const LAST_ANNOUNCED_VERSION_STORAGE_KEY = 'clawket.appUpdateAnnouncementLastVersion.v1';

export function getCurrentAppVersion(): string {
  return Application.nativeApplicationVersion?.trim()
    || APP_PACKAGE_VERSION
    || '0.0.0';
}

export function getAppUpdateAnnouncementStorageKey(version: string): string {
  return `${SEEN_STORAGE_PREFIX}:${version.trim()}`;
}

async function readItem(key: string): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(key);
  } catch {
    return null;
  }
}

async function writeItem(key: string, value: string): Promise<void> {
  try {
    await AsyncStorage.setItem(key, value);
  } catch {
    // Storage failures only cost one extra announcement; never block launch.
  }
}

export async function readLastAnnouncedAppVersion(): Promise<string | null> {
  const value = await readItem(LAST_ANNOUNCED_VERSION_STORAGE_KEY);
  const normalized = value?.trim() ?? '';
  return normalized ? normalized : null;
}

/**
 * The announcement due on this launch, or null. Merges every non-silent
 * release the device skipped since the last announced version; a device
 * without that record (an upgrade from 2.x) sees the current release only.
 */
export async function resolveLaunchAppUpdateAnnouncement(
  currentVersion = getCurrentAppVersion(),
): Promise<AppUpdateAnnouncement | null> {
  const version = currentVersion.trim();
  if (!version) return null;
  const lastAnnounced = await readLastAnnouncedAppVersion();
  const candidates = collectUnannouncedReleases(version, lastAnnounced);
  if (candidates.length === 0) return null;
  const seenFlags = await Promise.all(
    candidates.map((release) => readItem(getAppUpdateAnnouncementStorageKey(release.version))),
  );
  const unseen = candidates.filter((_, index) => seenFlags[index] !== '1');
  return toAppUpdateAnnouncement(version, unseen);
}

/** Records that the current version (and everything older) has been announced. */
export async function markAppUpdateAnnouncementShown(
  currentVersion = getCurrentAppVersion(),
): Promise<void> {
  const version = currentVersion.trim();
  if (!version) return;
  await writeItem(getAppUpdateAnnouncementStorageKey(version), '1');
  await writeItem(LAST_ANNOUNCED_VERSION_STORAGE_KEY, version);
}

/**
 * A fresh install has nothing to catch up on: the first version it ever runs
 * becomes the baseline so the sheet only ever describes an actual update.
 * Returns true when the baseline was written.
 */
export async function primeAppUpdateAnnouncementBaseline(
  currentVersion = getCurrentAppVersion(),
): Promise<boolean> {
  const version = currentVersion.trim();
  if (!version) return false;
  if (await readLastAnnouncedAppVersion() !== null) return false;
  await writeItem(LAST_ANNOUNCED_VERSION_STORAGE_KEY, version);
  return true;
}

/** Developer preview: the current release (or the newest one) regardless of the one-time cache. */
export function getAppUpdateAnnouncementPreview(
  currentVersion = getCurrentAppVersion(),
): AppUpdateAnnouncement | null {
  const version = currentVersion.trim();
  const release = getAppUpdateRelease(version) ?? getLatestAppUpdateRelease();
  if (!release) return null;
  return toAppUpdateAnnouncement(version || release.version, [release], DEFAULT_APP_UPDATE_DEBUG_HINT);
}
