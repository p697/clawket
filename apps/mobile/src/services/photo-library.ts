import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library/legacy';

export type SaveBundledImageToPhotoLibraryResult = 'saved' | 'permission_denied';
export type SaveImageUriToPhotoLibraryResult = 'saved' | 'permission_denied';

function inferImageExtension(uri: string): string {
  const normalized = uri.split('?')[0]?.split('#')[0] ?? uri;
  const match = normalized.match(/\.([a-zA-Z0-9]+)$/);
  const extension = match?.[1]?.toLowerCase();
  if (!extension) return 'jpg';
  if (extension === 'jpeg') return 'jpg';
  return extension;
}

export async function saveBundledImageToPhotoLibrary(
  moduleId: number,
  filenameBase: string,
): Promise<SaveBundledImageToPhotoLibraryResult> {
  const permission = await MediaLibrary.requestPermissionsAsync();
  if (!permission.granted) {
    return 'permission_denied';
  }

  const [asset] = await Asset.loadAsync(moduleId);
  const localUri = asset?.localUri;
  if (!localUri) {
    throw new Error('Bundled asset did not resolve to a local file URI.');
  }

  const extension = asset.type || 'jpg';
  const destination = new FileSystem.File(
    FileSystem.Paths.cache,
    `${filenameBase}-${Date.now()}.${extension}`,
  );

  await new FileSystem.File(localUri).copy(destination);
  await MediaLibrary.saveToLibraryAsync(destination.uri);
  return 'saved';
}

export async function saveImageUriToPhotoLibrary(
  uri: string,
  filenameBase: string,
): Promise<SaveImageUriToPhotoLibraryResult> {
  const permission = await MediaLibrary.requestPermissionsAsync();
  if (!permission.granted) {
    return 'permission_denied';
  }

  const extension = inferImageExtension(uri);
  const destination = new FileSystem.File(
    FileSystem.Paths.cache,
    `${filenameBase}-${Date.now()}.${extension}`,
  );

  if (uri.startsWith('file://')) {
    await new FileSystem.File(uri).copy(destination);
  } else {
    await FileSystem.File.downloadFileAsync(uri, destination);
  }

  await MediaLibrary.saveToLibraryAsync(destination.uri);
  return 'saved';
}
