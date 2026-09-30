import { DeliveredArtifacts } from '../delivered-artifacts.js';
import type { HermesHistoryMessage } from './native-sessions.js';

/** Cache only the configured local roots, never a transcript or file payload. */
export class HermesArtifacts extends DeliveredArtifacts {
  private roots?: { expires: number; value: string[] };
  private pending?: Promise<string[]>;
  constructor(private readonly loadRoots: () => Promise<string[]>, private readonly generation: () => number) { super(); }
  override clear(): void { super.clear(); this.roots = undefined; }
  private getRoots(): Promise<string[]> {
    if (this.roots && this.roots.expires > Date.now()) return Promise.resolve(this.roots.value);
    if (this.pending) return this.pending;
    const generation = this.generation();
    const pending = this.loadRoots().then(value => {
      if (generation !== this.generation()) return [];
      this.roots = { value, expires: Date.now() + 30_000 }; return value;
    }).catch(() => []).finally(() => { if (this.pending === pending) this.pending = undefined; });
    this.pending = pending; return pending;
  }
  async history<T extends { messages: HermesHistoryMessage[] }>(key: string, load: () => Promise<T>, cursor?: unknown): Promise<T> {
    const generation = this.generation();
    const epoch = this.epoch;
    const history = await load();
    const roots = await this.getRoots();
    if (generation !== this.generation()) throw new Error('Connection changed.');
    if (epoch !== this.epoch) throw new Error('Attachment session changed.');
    return { ...history, messages: history.messages.map(message => message.role === 'assistant'
      ? { ...message, content: this.content(key, message.content, roots, cursor) } : message) };
  }
  content(key: string, value: unknown, roots = this.roots?.value ?? [], cursor?: unknown): any {
    const projectText = (text: string): unknown[] => {
      const [message] = this.project(key, [{ id: 'delivery', role: 'assistant', text }], roots, this.epoch, cursor);
      return [{ type: 'text', text: message.text, artifactDisplayText: message.artifactDisplayText }, ...(message.attachments ?? [])];
    };
    if (typeof value === 'string') {
      const projected = projectText(value);
      return projected.length > 1 ? projected : value;
    }
    if (!Array.isArray(value)) return value;
    return value.flatMap(block => block?.type === 'text' && typeof block.text === 'string' ? projectText(block.text) : [block]);
  }
}
