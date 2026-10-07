import { Platform } from 'react-native';

/** Android 13+ can save app-created media without storage permission.
 * Older Android retains Expo's bounded legacy write permission; iOS asks only to add photos.
 */
export async function requestPhotoLibraryWritePermission(): Promise<boolean> {
  if (Platform.OS === 'android' && Number(Platform.Version) >= 33) return true;
  const MediaLibrary = require('expo-media-library/legacy') as typeof import('expo-media-library/legacy');
  const permission = await MediaLibrary.requestPermissionsAsync(true, ['photo']);
  return permission.granted;
}
