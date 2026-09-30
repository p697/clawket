import type { ChatMessage, SessionUpdate } from '@clawket/agent-protocol';
import { createHash } from 'node:crypto';
import { SessionFileStore, SESSION_FILE_CHUNK, mapSessionFileReferences } from './session-files.js';

/** Transcript references authorize a bounded read under a backend-verified project, never a client path. */
export class DeliveredArtifacts {
  private readonly files = new SessionFileStore(true);
  private readonly images = new Map<string, { key: string; data: Buffer; mimeType: string; name: string; expires: number }>();
  private timer?: ReturnType<typeof setTimeout>;
  private readonly pages = new Map<string, { key: string; cursor: unknown }>();
  epoch = 0;
  private refreshing = false;
  clear(): void { this.epoch++; this.files.clear(); this.images.clear(); this.pages.clear(); clearTimeout(this.timer); }
  forget(key: string): void {
    this.epoch++;
    this.files.forget(key);
    for (const [id, image] of this.images) if (image.key === key) this.images.delete(id);
    for (const [id, page] of this.pages) if (page.key === key) this.pages.delete(id);
  }
  async resolve(key: unknown, id: unknown, refresh: (cursor?: unknown) => Promise<unknown>) {
    if (typeof key !== 'string' || !key || key.length > 1024 || typeof id !== 'string' || !/^(?:file|image)_[a-f0-9]{64}$/.test(id)) throw new Error('Attachment unavailable.');
    try { return this.open(key, id); } catch { /* Cold cache/expired handles may re-authorize through native history once. */ }
    if (this.refreshing) throw new Error('Attachment busy. Retry shortly.');
    this.refreshing = true;
    const epoch = this.epoch;
    try {
      const page = this.pages.get(id);
      await refresh(page?.key === key ? page.cursor : undefined);
      if (epoch !== this.epoch) throw new Error('Attachment session changed.');
      return this.open(key, id);
    } finally { this.refreshing = false; }
  }
  private prune(): void {
    for (const [id, image] of this.images) if (image.expires <= Date.now()) this.images.delete(id);
    clearTimeout(this.timer);
    if (this.images.size) this.timer = setTimeout(() => this.prune(), Math.max(1, Math.min(...[...this.images.values()].map(i => i.expires)) - Date.now())).unref();
  }
  open(key: unknown, id: unknown) {
    this.prune();
    if (typeof key !== 'string' || typeof id !== 'string' || !/^(?:file|image)_[a-f0-9]{64}$/.test(id)) throw new Error('Attachment unavailable.');
    const image = this.images.get(id);
    if (image && image.key === key) return { id, name: image.name, size: image.data.length, mimeType: image.mimeType };
    return this.files.open(key, id);
  }
  read(key: unknown, id: unknown, offset: unknown) {
    if (typeof key !== 'string' || typeof id !== 'string' || typeof offset !== 'number') throw new Error('Attachment unavailable.');
    this.prune();
    const image = this.images.get(id);
    if (image && image.key === key) {
      if (!Number.isSafeInteger(offset) || offset < 0 || offset > image.data.length || offset % SESSION_FILE_CHUNK) throw new Error('Invalid attachment offset.');
      const data = image.data.subarray(offset, offset + SESSION_FILE_CHUNK);
      return { offset, total: image.data.length, data: data.toString('base64'), done: offset + data.length === image.data.length };
    }
    return this.files.read(key, id, offset);
  }
  project(key: string, messages: ChatMessage[], roots: readonly string[], epoch = this.epoch, cursor?: unknown): ChatMessage[] {
    if (epoch !== this.epoch) throw new Error('Attachment session changed.');
    return messages.map(message => {
      if (message.role !== 'assistant') return message;
      const files = this.files.list(key, [{ role: 'assistant', content: message.text }], roots).slice(0, 16);
      this.prune();
      const attachments = (message.attachments ?? []).slice(0, 16).map(attachment => {
        const { content, mimeType } = attachment;
        if (!content) return attachment;
        if (attachment.type !== 'image' || !/^image\/(png|jpeg|webp|gif)$/.test(mimeType)
          || content.length > 4 * Math.ceil(5 * 1024 * 1024 / 3) || (content.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(content))) return { ...attachment, content: undefined };
        const id = 'image_' + createHash('sha256').update(key).update('\0').update(mimeType).update('\0').update(content).digest('hex');
        const name = `image.${mimeType.split('/')[1]}`;
        if (!this.images.has(id) && this.images.size < 128 && [...this.images.values()].reduce((sum, image) => sum + image.data.length, 0) + content.length * 0.75 <= 20 * 1024 * 1024) {
          this.images.set(id, { key, data: Buffer.from(content, 'base64'), mimeType, name, expires: Date.now() + 120_000 });
          this.prune();
        }
        return { type: 'image' as const, mimeType, name, artifactId: id };
      });
      for (const file of files) if (!attachments.some(a => a.artifactId === file.id)) attachments.push({
        type: /^image\/(png|jpeg|webp|gif)$/.test(file.mimeType) ? 'image' : 'file', mimeType: file.mimeType, name: file.name, artifactId: file.id,
      });
      const ids = new Set(files.map(file => file.id));
      const text = files.length ? mapSessionFileReferences(message.text, (reference, markup) => {
        if (markup.startsWith('`')) return undefined;
        const delivered = this.files.list(key, [{ role: 'assistant', content: `[file](<${reference}>)` }], roots);
        return delivered.some(file => ids.has(file.id)) ? '' : undefined;
      }).replace(/\n{3,}/g, '\n\n').trim() : message.text;
      for (const attachment of attachments) if (attachment.artifactId) {
        this.pages.delete(attachment.artifactId);
        if (this.pages.size >= 256) this.pages.delete(this.pages.keys().next().value!);
        this.pages.set(attachment.artifactId, { key, cursor });
      }
      return attachments.length ? { ...message, artifactDisplayText: text, attachments } : message;
    });
  }
  final(update: SessionUpdate, roots: readonly string[]): SessionUpdate {
    if (update.type !== 'run_finished' || !update.message) return update;
    const [message] = this.project(update.sessionKey, [{ id: update.runId, role: 'assistant', text: update.message.content,
      attachments: update.message.attachments }], roots);
    return message.attachments?.length ? { ...update, message: { ...update.message, artifactDisplayText: message.artifactDisplayText, attachments: message.attachments } } : update;
  }
}
