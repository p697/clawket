import * as Clipboard from 'expo-clipboard';
import { File } from 'expo-file-system';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';

/** Copy actual pixels, including local, inline and remote images, never a private file URL. */
export async function copyImageToClipboard(uri: string): Promise<void> {
  const image = await manipulateAsync(uri, [], { format: SaveFormat.PNG, base64: true });
  try {
    if (!image.base64) throw new Error('unavailable');
    await Clipboard.setImageAsync(image.base64);
  } finally {
    if (image.uri !== uri) {
      try { new File(image.uri).delete(); } catch { /* Temporary cache may already be gone. */ }
    }
  }
}
