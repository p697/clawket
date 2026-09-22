import { useCallback, useMemo, useState, useRef, useEffect } from 'react';
import * as ImagePicker from 'expo-image-picker';
import { PendingImage } from '../types/chat';

const DEFAULT_MAX_IMAGES = 6;

export function useChatImagePicker(maxImages = DEFAULT_MAX_IMAGES, scope = '') {
  const activeScope = useRef<string | null>(scope);
  activeScope.current = scope;
  useEffect(() => { activeScope.current = scope; return () => { activeScope.current = null; }; }, [scope]);
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);

  const pickImage = useCallback(async () => {
    if (pendingImages.length >= maxImages) return;

    const remaining = maxImages - pendingImages.length;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: remaining,
      quality: 0.8,
      base64: true,
      exif: false,
    });

    if (activeScope.current !== scope) return;
    if (!result.canceled && result.assets.length > 0) {
      const newImages = result.assets
        .filter((asset) => asset.base64)
        .map((asset) => ({
          uri: asset.uri,
          base64: asset.base64!,
          mimeType: asset.mimeType ?? 'image/jpeg',
          width: asset.width,
          height: asset.height,
        }));
      setPendingImages((prev) => [...prev, ...newImages].slice(0, maxImages));
    }
  }, [maxImages, pendingImages.length, scope]);

  /**
   * Attaches photos already on disk (the Add sheet's recent-photo picks) with
   * the same JPEG quality the system picker path uses, so HEIC originals
   * become the format the backends accept.
   */
  const attachLocalImages = useCallback(async (uris: readonly string[]) => {
    const remaining = maxImages - pendingImages.length;
    if (remaining <= 0 || uris.length === 0) return;
    const ImageManipulator = await import('expo-image-manipulator');
    const next: PendingImage[] = [];
    for (const uri of uris.slice(0, remaining)) {
      try {
        const result = await ImageManipulator.manipulateAsync(uri, [], {
          base64: true,
          compress: 0.8,
          format: ImageManipulator.SaveFormat.JPEG,
        });
        if (!result.base64) continue;
        next.push({
          uri: result.uri,
          base64: result.base64,
          mimeType: 'image/jpeg',
          width: result.width,
          height: result.height,
        });
      } catch {
        /* skip unreadable photo */
      }
    }
    if (next.length === 0 || activeScope.current !== scope) return;
    setPendingImages((prev) => [...prev, ...next].slice(0, maxImages));
  }, [maxImages, pendingImages.length, scope]);

  const clearPendingImages = useCallback(() => setPendingImages([]), []);

  const removePendingImage = useCallback((index: number) => {
    setPendingImages((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const canAddMoreImages = useMemo(() => pendingImages.length < maxImages, [maxImages, pendingImages.length, scope]);

  return {
    pendingImages,
    pickImage,
    attachLocalImages,
    clearPendingImages,
    removePendingImage,
    canAddMoreImages,
    maxImages,
    setPendingImages,
  };
}
