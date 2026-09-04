import { PendingImage } from '../types/chat';
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
        .map((image) => image.mimeType.trim().toLowerCase())
        .filter(Boolean),
    ),
  ).sort();

  return formats.length > 0 ? formats.join(',') : null;
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
