import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import * as MediaLibrary from 'expo-media-library/legacy';
import { requestPhotoLibraryWritePermission } from './photo-library-permissions';

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
  if (!await requestPhotoLibraryWritePermission()) {
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
  if (!await requestPhotoLibraryWritePermission()) {
    return 'permission_denied';
  }

  const extension = inferImageExtension(uri);
  const destination = new FileSystem.File(
    FileSystem.Paths.cache,
    `${filenameBase}-${Date.now()}.${extension}`,
  );

  let materializedUri: string | undefined;
  try {
    if (uri.startsWith('data:')) {
      materializedUri = (await manipulateAsync(uri, [], { format: SaveFormat.JPEG })).uri;
      await new FileSystem.File(materializedUri).copy(destination);
    } else if (uri.startsWith('file://')) {
      await new FileSystem.File(uri).copy(destination);
    } else {
      await FileSystem.File.downloadFileAsync(uri, destination);
    }
    await MediaLibrary.saveToLibraryAsync(destination.uri);
    return 'saved';
  } finally {
    try { destination.delete(); } catch { /* Cache may already be gone. */ }
    if (materializedUri && materializedUri !== uri) {
      try { new FileSystem.File(materializedUri).delete(); } catch { /* Cache may already be gone. */ }
    }
  }
}
