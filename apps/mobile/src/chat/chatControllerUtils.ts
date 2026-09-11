import {
  isImageAttachmentMimeType,
  normalizeAttachmentMimeType,
  type PromptAttachment,
} from '@clawket/agent-protocol';
import type { PendingImage, UiFileAttachment, UiMessage } from '../types/chat';
import {
  isSilentReplyPrefixText,
  isSilentReplyText,
  sanitizeDisplayText,
} from '../utils/chat-message';

type InitialChatPreview = {
  agentName?: string;
  agentAvatarUri?: string;
  agentEmoji?: string;
} | null | undefined;

export function readFileAsBase64(uri: string): Promise<string> {
  return fetch(uri)
    .then((response) => response.blob())
    .then((blob) => new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        const base64 = result.includes(',') ? result.split(',')[1] : result;
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    }));
}

export function summarizeAttachmentFormats(images: PendingImage[]): string | null {
  const formats = Array.from(
    new Set(
      images
        .map((image) => normalizeAttachmentMimeType(image.mimeType, ''))
        .filter(Boolean),
    ),
  ).sort();

  return formats.length > 0 ? formats.join(',') : null;
}

/**
 * Builds the backend-neutral prompt payload. MIME decides whether an attachment
 * is an image; native paste APIs also give images a file name, so using the
 * presence of that name would incorrectly downgrade pasted images to files.
 */
export function buildPromptAttachments(
  images: readonly PendingImage[],
): PromptAttachment[] | undefined {
  if (images.length === 0) return undefined;

  return images.map((image) => {
    const mimeType = normalizeAttachmentMimeType(image.mimeType);
    const isImage = isImageAttachmentMimeType(mimeType);
    const name = image.fileName?.trim();
    return {
      type: isImage ? 'image' : 'file',
      mimeType,
      content: image.base64,
      ...(!isImage && name ? { name } : {}),
    };
  });
}

export type AttachmentOnlyFallbackKey =
  | 'Look at this image'
  | 'Look at these images'
  | 'Review this file'
  | 'Review these files'
  | 'Review these attachments';

/** Selects localized copy for a prompt containing attachments but no typed text. */
export function resolveAttachmentOnlyFallbackKey(
  attachments: readonly PendingImage[],
): AttachmentOnlyFallbackKey | null {
  const imageCount = attachments.filter((attachment) => (
    isImageAttachmentMimeType(attachment.mimeType)
  )).length;
  const fileCount = attachments.length - imageCount;
  if (imageCount > 0 && fileCount > 0) return 'Review these attachments';
  if (imageCount > 0) return imageCount === 1 ? 'Look at this image' : 'Look at these images';
  if (fileCount > 0) return fileCount === 1 ? 'Review this file' : 'Review these files';
  return null;
}

/** Drops file payload bytes while retaining metadata needed by the timeline. */
export function buildUiFileAttachments(
  attachments: readonly PendingImage[],
): UiFileAttachment[] | undefined {
  const files = attachments
    .filter((attachment) => !isImageAttachmentMimeType(attachment.mimeType))
    .map((attachment) => {
      const fileName = attachment.fileName?.trim();
      const uri = attachment.uri.trim();
      return {
        mimeType: normalizeAttachmentMimeType(attachment.mimeType),
        ...(fileName ? { fileName } : {}),
        ...(uri ? { uri } : {}),
      };
    });
  return files.length > 0 ? files : undefined;
}

/** Local user bubble shared by optimistic sends and the pre-send queue. */
export function buildUserUiMessage(params: {
  id: string;
  text: string;
  images: readonly PendingImage[];
  timestampMs?: number;
  idempotencyKey?: string;
  delivery?: UiMessage['delivery'];
}): UiMessage {
  const realImages = params.images.filter((image) => isImageAttachmentMimeType(image.mimeType));
  const files = params.images.filter((image) => !isImageAttachmentMimeType(image.mimeType));
  return {
    id: params.id,
    role: 'user',
    text: params.text,
    ...(params.idempotencyKey ? { idempotencyKey: params.idempotencyKey } : {}),
    ...(params.timestampMs !== undefined ? { timestampMs: params.timestampMs } : {}),
    ...(params.delivery ? { delivery: params.delivery } : {}),
    imageUris: realImages.length > 0 ? realImages.map((image) => image.uri) : undefined,
    imageMetas: realImages.length > 0
      ? realImages.map((image) => ({ uri: image.uri, width: image.width ?? 0, height: image.height ?? 0 }))
      : undefined,
    fileAttachments: buildUiFileAttachments(files),
  };
}

export function extractSlashCommand(text: string): string | null {
  const match = text.trim().match(/^\/([a-z0-9-]+)/i);
  return match?.[1]?.toLowerCase() ?? null;
}

export function sanitizeVisibleStreamText(
  text: string | null | undefined,
): string | null {
  if (!text) return null;
  const sanitized = sanitizeDisplayText(text);
  if (!sanitized) return null;
  if (isSilentReplyText(sanitized) || isSilentReplyPrefixText(sanitized)) {
    return null;
  }
  return sanitized;
}

export function buildInitialAgentIdentity(preview: InitialChatPreview): {
  displayName: string;
  avatarUri: string | null;
  emoji: string | null;
} {
  return {
    displayName: preview?.agentName?.trim() || 'Assistant',
    avatarUri: preview?.agentAvatarUri?.trim() || null,
    emoji: preview?.agentEmoji?.trim() || null,
  };
}
