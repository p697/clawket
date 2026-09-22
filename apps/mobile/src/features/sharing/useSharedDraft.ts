import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { supportsAttachmentMimeType, type Capabilities } from '@clawket/agent-protocol';
import type { PendingImage } from '../../types/chat';
import { IncomingShareStore } from '../../services/incoming-share';
import { readFileAsBase64 } from '../../chat/chatControllerUtils';

export function useSharedDraft({ shareId, scope, ready, capabilities, input, images, submittedAt, acceptedAt, acceptedSubmission, setInput, setImages }: Readonly<{
  shareId?: string; scope: string; ready: boolean; capabilities: Capabilities;
  input: string; images: PendingImage[]; submittedAt?: number | null; acceptedAt?: number | null;
  acceptedSubmission?: { at: number; text: string; attachmentUris: string[] } | null;
  setInput: Dispatch<SetStateAction<string>>; setImages: Dispatch<SetStateAction<PendingImage[]>>;
}>): { failed: boolean; dismissError: () => void } {
  const [failed, setFailed] = useState(false);
  const adopted = useRef<{ id: string; scope: string; text: string; attachmentUris: string[]; submittedAt?: number | null } | null>(null);
  const latest = useRef({ input, images, submittedAt }); latest.current = { input, images, submittedAt };
  useEffect(() => {
    let active = true;
    if (!shareId || !ready || (adopted.current?.id === shareId && adopted.current.scope === scope)) return;
    setFailed(false);
    void (async () => {
      const share = (await IncomingShareStore.list()).find((item) => item.id === shareId);
      if (!share || !active) return;
      if (share.files.some((file) => !supportsAttachmentMimeType(capabilities, file.mimeType))) throw new Error('unsupported');
      const files: PendingImage[] = [];
      for (const file of share.files) {
        const base64 = await readFileAsBase64(file.uri);
        if (!base64) throw new Error('unreadable');
        files.push({ uri: file.uri, fileName: file.name, mimeType: file.mimeType, base64 });
      }
      if (!active) return;
      const fresh = files.filter((file) => !latest.current.images.some((existing) => existing.uri === file.uri));
      if (latest.current.images.length + fresh.length > 6) throw new Error('limit');
      adopted.current = { id: shareId, scope, text: share.text, attachmentUris: files.map((file) => file.uri), submittedAt: latest.current.submittedAt };
      if (share.text) setInput((current) => current.includes(share.text) ? current : [current, share.text].filter(Boolean).join('\n\n'));
      setImages((current) => [...current, ...fresh]);
    })().catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [shareId, scope, ready, capabilities, setInput, setImages]);
  useEffect(() => {
    const current = adopted.current;
    if (!current || current.scope !== scope || !submittedAt || submittedAt === current.submittedAt || acceptedAt !== submittedAt) return;
    if (acceptedSubmission?.at !== submittedAt || (current.text && !acceptedSubmission.text.includes(current.text))
      || current.attachmentUris.some((uri) => !acceptedSubmission.attachmentUris.includes(uri))) return;
    void IncomingShareStore.remove(current.id).then(() => {
      if (adopted.current === current) adopted.current = { ...current, submittedAt };
    }).catch(() => undefined);
  }, [scope, submittedAt, acceptedAt, acceptedSubmission]);
  return { failed, dismissError: () => setFailed(false) };
}
