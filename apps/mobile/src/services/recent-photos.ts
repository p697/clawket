import { Platform } from 'react-native';
import * as MediaLibrary from 'expo-media-library';

export type RecentPhoto = Readonly<{
  id: string;
  /** Local `file://` URI that React Native `Image` can render and the attachment pipeline can read. */
  uri: string;
  width: number;
  height: number;
}>;

export type RecentPhotoAccess = 'unavailable' | 'undetermined' | 'denied' | 'granted';

/** Newest photos shown in the Add sheet strip. */
export const RECENT_PHOTO_STRIP_COUNT = 12;
/** Assets resolved before the strip first paints; the rest stream in behind it. */
export const RECENT_PHOTO_FIRST_BATCH = 4;
const RESOLVE_CONCURRENCY = 6;

/**
 * Android ships through Google Play, whose photo policy reserves broad media
 * access for gallery-class apps; it keeps the system Photo Picker instead.
 */
export function resolveRecentPhotoSupport(platform: string): boolean {
  return platform === 'ios';
}

export const recentPhotosSupported = resolveRecentPhotoSupport(Platform.OS);

export type PhotoPermissionSnapshot = Readonly<{
  status: string;
  granted: boolean;
  accessPrivileges?: MediaLibrary.PermissionResponse['accessPrivileges'];
}>;

export function normalizePhotoPermission(permission: PhotoPermissionSnapshot): RecentPhotoAccess {
  if (permission.granted || permission.status === 'granted') {
    // iOS "limited" access still returns granted with the user's chosen subset.
    return permission.accessPrivileges === 'none' ? 'denied' : 'granted';
  }
  return permission.status === 'denied' ? 'denied' : 'undetermined';
}

export async function getRecentPhotoAccess(): Promise<RecentPhotoAccess> {
  if (!recentPhotosSupported) return 'unavailable';
  try {
    return normalizePhotoPermission(await MediaLibrary.getPermissionsAsync());
  } catch {
    return 'unavailable';
  }
}

export async function requestRecentPhotoAccess(): Promise<RecentPhotoAccess> {
  if (!recentPhotosSupported) return 'unavailable';
  try {
    return normalizePhotoPermission(await MediaLibrary.requestPermissionsAsync());
  } catch {
    return 'unavailable';
  }
}

export function isRenderableLocalUri(uri: string | null | undefined): uri is string {
  return typeof uri === 'string' && (uri.startsWith('file://') || uri.startsWith('content://'));
}

async function resolvePhoto(asset: MediaLibrary.Asset): Promise<RecentPhoto | null> {
  if (asset.mediaType !== 'photo') return null;
  if (isRenderableLocalUri(asset.uri)) {
    return { id: asset.id, uri: asset.uri, width: asset.width, height: asset.height };
  }
  try {
    // iOS returns `ph://` identifiers; only a local file can be rendered and
    // attached. iCloud-only originals are skipped rather than downloaded here.
    const info = await MediaLibrary.getAssetInfoAsync(asset, { shouldDownloadFromNetwork: false });
    if (!isRenderableLocalUri(info.localUri)) return null;
    return { id: asset.id, uri: info.localUri, width: asset.width, height: asset.height };
  } catch {
    return null;
  }
}

async function resolvePhotos(assets: readonly MediaLibrary.Asset[]): Promise<RecentPhoto[]> {
  const resolved: RecentPhoto[] = [];
  for (let index = 0; index < assets.length; index += RESOLVE_CONCURRENCY) {
    const chunk = assets.slice(index, index + RESOLVE_CONCURRENCY);
    const photos = await Promise.all(chunk.map(resolvePhoto));
    for (const photo of photos) {
      if (photo) resolved.push(photo);
    }
  }
  return resolved;
}

export type LoadRecentPhotosOptions = Readonly<{
  limit: number;
  /** Receives the first resolved batch so the strip can paint before the rest resolve. */
  onFirstBatch?: (photos: readonly RecentPhoto[]) => void;
  /** Aborts resolution when a newer request supersedes this one. */
  isCancelled?: () => boolean;
}>;

/** Newest photos first; unrenderable or cloud-only assets are omitted. */
export async function loadRecentPhotos({
  limit,
  onFirstBatch,
  isCancelled = () => false,
}: LoadRecentPhotosOptions): Promise<RecentPhoto[]> {
  if (!recentPhotosSupported || limit <= 0) return [];
  const page = await MediaLibrary.getAssetsAsync({
    first: limit,
    mediaType: MediaLibrary.MediaType.photo,
    sortBy: [[MediaLibrary.SortBy.creationTime, false]],
  });
  if (isCancelled()) return [];
  const assets = page.assets.filter((asset) => asset.mediaType === 'photo');
  const firstBatch = await resolvePhotos(assets.slice(0, RECENT_PHOTO_FIRST_BATCH));
  if (isCancelled()) return [];
  onFirstBatch?.(firstBatch);
  const rest = await resolvePhotos(assets.slice(RECENT_PHOTO_FIRST_BATCH));
  if (isCancelled()) return [];
  return [...firstBatch, ...rest];
}
