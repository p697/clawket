import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Written to the app sandbox on every launch. iOS Keychain items survive
 * deleting the app bundle while AsyncStorage does not, so a Keychain-backed
 * registry would otherwise boot a reinstalled app straight into its old
 * connections (owner report 2026-09-19). Sandbox state is the only evidence
 * of whether this bundle has run before.
 */
export const INSTALL_MARKER_STORAGE_KEY = 'clawket.installMarker.v1';

const APP_STORAGE_KEY_PREFIX = 'clawket.';
/** Pre-prefix keys still written by shipped builds; any of them proves prior use. */
const LEGACY_APP_STORAGE_KEYS: ReadonlySet<string> = new Set(['agent_avatars']);

/**
 * `fresh`: the bundle never ran here — any surviving Keychain state is stale.
 * `upgraded`: a build that predates the marker left sandbox data behind.
 * `existing`: the marker is present (or storage could not be read).
 */
export type InstallState = 'fresh' | 'upgraded' | 'existing';

export interface InstallMarkerStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  getAllKeys(): Promise<ReadonlyArray<string>>;
}

export function isAppStorageKey(key: string): boolean {
  return key.startsWith(APP_STORAGE_KEY_PREFIX) || LEGACY_APP_STORAGE_KEYS.has(key);
}

export function classifyInstallState(
  marker: string | null,
  storageKeys: ReadonlyArray<string>,
): InstallState {
  if (marker !== null && marker.trim().length > 0) return 'existing';
  const hasAppData = storageKeys.some((key) => (
    key !== INSTALL_MARKER_STORAGE_KEY && isAppStorageKey(key)
  ));
  return hasAppData ? 'upgraded' : 'fresh';
}

/** Fails closed: an unreadable sandbox is treated as an existing install and never reset. */
export async function resolveInstallState(
  storage: InstallMarkerStorage = AsyncStorage,
): Promise<InstallState> {
  try {
    const marker = await storage.getItem(INSTALL_MARKER_STORAGE_KEY);
    if (marker !== null && marker.trim().length > 0) return 'existing';
    const keys = await storage.getAllKeys();
    if (!Array.isArray(keys)) return 'existing';
    return classifyInstallState(marker, keys);
  } catch {
    return 'existing';
  }
}

export async function markInstalled(
  storage: InstallMarkerStorage = AsyncStorage,
  now: () => number = Date.now,
): Promise<void> {
  try {
    await storage.setItem(INSTALL_MARKER_STORAGE_KEY, String(now()));
  } catch {
    // A failed marker write costs one more classification on the next launch.
  }
}

export type EnsureInstallStateOptions = Readonly<{
  /** Forgets Keychain state that outlived the previous bundle. Runs once per install. */
  resetForFreshInstall: () => Promise<void>;
  storage?: InstallMarkerStorage;
  now?: () => number;
}>;

/**
 * Settles the install marker before any preference or connection read. A
 * failed reset never blocks launch; the marker is still written so the app
 * does not retry the reset on every start.
 */
export async function ensureInstallState(
  options: EnsureInstallStateOptions,
): Promise<InstallState> {
  const storage = options.storage ?? AsyncStorage;
  const state = await resolveInstallState(storage);
  if (state === 'existing') return state;
  if (state === 'fresh') {
    try {
      await options.resetForFreshInstall();
    } catch {
      // Launch continues with whatever survived; the reset is best effort.
    }
  }
  await markInstalled(storage, options.now);
  return state;
}
