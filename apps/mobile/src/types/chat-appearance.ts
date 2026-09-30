export type ChatBackgroundFillMode = 'cover' | 'contain';
export type ChatBubbleStyle = 'solid' | 'soft' | 'glass';
/**
 * What sits behind the conversation: the built-in accent-colored gradient with
 * Clawket doodles (the default), the user's own photo, or the plain canvas.
 */
export type ChatWallpaperKind = 'pattern' | 'photo' | 'plain';

export type ChatAppearanceSettings = {
  version: 1;
  background: {
    kind: ChatWallpaperKind;
    /** Mirrors `kind === 'photo'` with a saved image, so older builds keep reading the photo. */
    enabled: boolean;
    imagePath?: string;
    blur: number;
    dim: number;
    fillMode: ChatBackgroundFillMode;
  };
  bubbles: {
    style: ChatBubbleStyle;
    opacity: number;
  };
};
