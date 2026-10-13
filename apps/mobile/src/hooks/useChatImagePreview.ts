import { useCallback, useState } from 'react';

export function useChatImagePreview() {
  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewUris, setPreviewUris] = useState<string[]>([]);
  const [previewIndex, setPreviewIndex] = useState(0);

  const closePreview = useCallback(() => {
    setPreviewVisible(false);
    setPreviewIndex(0);
    setPreviewUris([]);
  }, []);

  const openPreview = useCallback((uris: string[], index: number) => {
    if (!uris.length) return;

    setPreviewUris(uris);
    setPreviewIndex(Math.max(0, Math.min(index, uris.length - 1)));
    setPreviewVisible(true);
  }, []);

  return {
    previewVisible,
    previewUris,
    previewIndex,
    setPreviewIndex,
    openPreview,
    closePreview,
  };
}
