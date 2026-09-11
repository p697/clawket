import type { PastedFile } from '@mattermost/react-native-paste-input';
import {
  normalizeAttachmentMimeType,
  supportsAttachmentMimeType,
  type AttachmentCapabilities,
} from '@clawket/agent-protocol';
import type { PendingImage } from '../types/chat';
import { readFileAsBase64 } from './chatControllerUtils';

// Keep paste aligned with the existing image/file hard limit. Base64 expansion
// plus the request envelope remains below the negotiated 8 MiB frame ceiling.
export const PASTED_ATTACHMENT_MAX_RAW_BYTES = 5 * 1024 * 1024;
export const PASTED_ATTACHMENT_MAX_MIB =
  PASTED_ATTACHMENT_MAX_RAW_BYTES / (1024 * 1024);

export type PastedAttachmentRejection = 'limit' | 'failed' | 'too_large' | 'unsupported';

export type PreparePastedAttachmentsResult = {
  accepted: PendingImage[];
  rejection: PastedAttachmentRejection | null;
};

type Params = {
  files: readonly PastedFile[];
  pendingCount: number;
  maxAttachments: number;
  capabilities: AttachmentCapabilities | null | undefined;
};

/** Converts native paste files into the same pending records used by pickers. */
export async function preparePastedAttachments({
  files,
  pendingCount,
  maxAttachments,
  capabilities,
}: Params): Promise<PreparePastedAttachmentsResult> {
  const remainingSlots = Math.max(0, maxAttachments - pendingCount);
  if (remainingSlots === 0 && files.length > 0) {
    return { accepted: [], rejection: 'limit' };
  }

  const accepted: PendingImage[] = [];
  let rejection: PastedAttachmentRejection | null = null;

  for (const file of files) {
    if (accepted.length >= remainingSlots) {
      rejection ??= 'limit';
      break;
    }

    const mimeType = normalizeAttachmentMimeType(file.type);
    if (!supportsAttachmentMimeType(capabilities, mimeType)) {
      rejection ??= 'unsupported';
      continue;
    }

    if (
      Number.isFinite(file.fileSize)
      && file.fileSize > PASTED_ATTACHMENT_MAX_RAW_BYTES
    ) {
      rejection ??= 'too_large';
      continue;
    }

    const uri = file.uri.trim();
    if (!uri) {
      rejection ??= 'failed';
      continue;
    }

    try {
      const base64 = await readFileAsBase64(uri);
      if (!base64) {
        rejection ??= 'failed';
        continue;
      }
      accepted.push({
        uri,
        base64,
        mimeType,
        fileName: file.fileName.trim() || undefined,
      });
    } catch {
      // Preserve readable files in a mixed paste while still reporting that
      // the paste was only partially successful.
      rejection ??= 'failed';
    }
  }

  return { accepted, rejection };
}
