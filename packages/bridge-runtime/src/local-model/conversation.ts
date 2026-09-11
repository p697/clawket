import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { PromptInput, SessionUpdate, SessionHistory, ChatMessage } from '@clawket/agent-protocol';
import { LocalModelProvider, budgetMessages, userMessage, type LocalModelEndpoint, type ModelMessage } from './provider.js';

interface Turn {
  id: string;
  runId: string;
  at: number;
  prompt: ModelMessage;
  reply: string;
  model: string;
  state: 'running' | 'complete' | 'cancelled' | 'error';
}
interface SavedConversation { version: 1; selected: string; turns: Turn[] }

/** One Bridge-owned main thread. A run is durable before its acknowledgement. */
export class LocalModelConversation extends EventEmitter {
  private saved: SavedConversation;
  private active: { id: string; controller: AbortController; task?: Promise<void> } | null = null;
  private mutation = false;
  private stopped = false;
  private capability: { models: string[]; vision: boolean } | null = null;
  private readonly providers: Map<string, LocalModelProvider>;

  constructor(readonly endpoints: LocalModelEndpoint[], private readonly storePath: string, fetchImpl: typeof fetch = fetch) {
    super();
    if (!endpoints.length || new Set(endpoints.map(x => x.id)).size !== endpoints.length) throw new Error('Configure unique model endpoint IDs');
    this.providers = new Map(endpoints.map(x => [x.id, new LocalModelProvider(x, fetchImpl)]));
    this.saved = { version: 1, selected: endpoints[0].id, turns: [] };
    if (existsSync(storePath)) {
      const raw = JSON.parse(readFileSync(storePath, 'utf8')) as SavedConversation;
      if (raw.version !== 1 || !this.providers.has(raw.selected) || !Array.isArray(raw.turns)
        || raw.turns.some(t => !t || typeof t.id !== 'string' || typeof t.reply !== 'string' || t.prompt?.role !== 'user')) {
        throw new Error('Invalid local conversation store; restore or move it before starting');
      }
      this.saved = raw;
      // Never replay requests whose outcome became uncertain during a restart.
      for (const turn of raw.turns) if (turn.state === 'running') turn.state = 'error';
    }
  }

  private save(): void {
    mkdirSync(dirname(this.storePath), { recursive: true, mode: 0o700 });
    const pending = this.storePath + '.pending';
    writeFileSync(pending, JSON.stringify(this.saved), { encoding: 'utf8', mode: 0o600 });
    renameSync(pending, this.storePath);
  }

  private get provider(): LocalModelProvider { return this.providers.get(this.saved.selected)!; }

  async health(): Promise<{ model: string; vision: boolean; contextWindow: number }> {
    if (this.stopped) throw new Error('Local model bridge is stopped');
    const provider = this.provider;
    const capability = await provider.inspect();
    if (provider !== this.provider || this.stopped) throw new Error('Model changed during health check');
    this.capability = capability;
    const model = provider.config.model ?? capability.models[0];
    if (!capability.models.includes(model)) throw new Error('Configured model is not served by this endpoint');
    return { model, vision: capability.vision, contextWindow: provider.config.contextWindow };
  }

  async select(endpointId: string): Promise<void> {
    if (this.stopped || this.active || this.mutation) throw new Error('Wait for the current operation before switching models');
    const provider = this.providers.get(endpointId);
    if (!provider) throw new Error('Unknown configured model');
    this.mutation = true;
    try {
      const capability = await provider.inspect(180_000, true);
      if (this.stopped) throw new Error('Local model bridge is stopped');
      if (provider.config.model && !capability.models.includes(provider.config.model)) throw new Error('Configured model is unavailable');
      const previous = this.saved.selected;
      this.saved.selected = endpointId;
      try { this.save(); } catch (error) { this.saved.selected = previous; throw error; }
      this.capability = capability;
    } finally { this.mutation = false; }
  }

  get selection(): string { return this.saved.selected; }
  get running(): boolean { return this.active !== null; }

  async prompt(input: PromptInput): Promise<{ runId: string }> {
    if (this.stopped) throw new Error('Local model bridge is stopped');
    if (!input.idempotencyKey || input.idempotencyKey.length > 200) throw new Error('A bounded idempotency key is required');
    const prior = this.saved.turns.find(t => t.id === input.idempotencyKey);
    if (prior) {
      if (JSON.stringify(prior.prompt) !== JSON.stringify(userMessage(input.text, input.attachments, true))) throw new Error('Idempotency key was already used for another message');
      return { runId: prior.runId };
    }
    if (this.active || this.mutation) throw new Error('Model is busy');
    this.mutation = true;
    try {
      const health = await this.health();
      if (this.stopped) throw new Error('Local model bridge is stopped');
      const current = userMessage(input.text, input.attachments, health.vision);
      const history = this.saved.turns.filter(t => t.state === 'complete').flatMap(t => [
        !health.vision && Array.isArray(t.prompt.content)
          ? { role: 'user' as const, content: t.prompt.content.filter(p => p.type === 'text').map(p => p.text).join('\n') + '\n[Earlier image attachment is unavailable to this text-only model.]' }
          : t.prompt,
        { role: 'assistant' as const, content: t.reply },
      ]);
      const config = this.provider.config;
      const messages = budgetMessages(history, current, config.contextWindow, config.maxOutputTokens ?? 1024);
      const runId = randomUUID();
      const turn: Turn = { id: input.idempotencyKey, runId, at: Date.now(), prompt: current, reply: '', model: health.model, state: 'running' };
      this.saved.turns.push(turn);
      try { this.save(); } catch (error) { this.saved.turns.pop(); throw error; }
      const active = { id: runId, controller: new AbortController(), task: undefined as Promise<void> | undefined };
      this.active = active;
      // Defer until the RPC acknowledgement has a chance to reach the client.
      active.task = new Promise<void>(resolve => setImmediate(resolve)).then(() => this.generate(turn, messages, active.controller));
      return { runId };
    } finally { this.mutation = false; }
  }

  private update(update: SessionUpdate): void { this.emit('update', update); }

  private async generate(turn: Turn, messages: ModelMessage[], controller: AbortController): Promise<void> {
    const base = { sessionKey: 'main', runId: turn.runId };
    try {
      if (controller.signal.aborted) throw controller.signal.reason;
      this.update({ type: 'run_started', ...base });
      let reason: 'end_turn' | 'max_tokens' = 'end_turn';
      let usage: { input?: number; output?: number } | undefined;
      for await (const event of this.provider.complete(messages, turn.model, controller.signal)) {
        if (event.type === 'text') {
          if (Buffer.byteLength(turn.reply) + Buffer.byteLength(event.text) > 512 * 1024) throw new Error('Model reply exceeds the message limit');
          turn.reply += event.text;
          this.update({ type: 'agent_message_chunk', ...base, text: event.text });
        } else if (event.type === 'thought') {
          this.update({ type: 'agent_thought_chunk', ...base, text: event.text });
        } else { reason = event.reason; usage = event.usage; }
      }
      turn.state = 'complete'; this.save();
      if (this.active?.id === turn.runId) this.active = null;
      this.update({ type: 'run_finished', ...base, stopReason: reason, message: { role: 'assistant', content: turn.reply, model: turn.model }, usage });
    } catch {
      turn.state = controller.signal.aborted ? 'cancelled' : 'error';
      try { this.save(); } catch { /* Retain the durable running record for recovery. */ }
      if (this.active?.id === turn.runId) this.active = null;
      this.update({ type: 'run_finished', ...base, stopReason: turn.state === 'cancelled' ? 'cancelled' : 'error', message: { role: 'assistant', content: turn.reply, model: turn.model } });
    } finally {
      if (this.active?.id === turn.runId) this.active = null;
    }
  }

  async cancel(runId?: string): Promise<void> {
    const active = this.active;
    if (!active || (runId && active.id !== runId)) return;
    active.controller.abort(new Error('Cancelled'));
    await active.task;
  }

  async stop(): Promise<void> { this.stopped = true; await this.cancel(); }

  history(cursor?: string): SessionHistory {
    const end = cursor === undefined ? this.saved.turns.length : Number(cursor);
    if (!Number.isSafeInteger(end) || end < 0 || end > this.saved.turns.length) throw new Error('Invalid history cursor');
    const messages: ChatMessage[] = [];
    let bytes = 0;
    let index = end;
    while (index > 0) {
      const t = this.saved.turns[index - 1];
      const attachments: ChatMessage['attachments'] = typeof t.prompt.content === 'string' ? undefined : t.prompt.content.flatMap(p => {
        if (p.type !== 'image_url') return [];
        const match = /^data:(image\/(?:png|jpeg));base64,(.*)$/.exec(p.image_url.url);
        return match ? [{ type: 'image' as const, mimeType: match[1], content: match[2] }] : [];
      });
      const pair: ChatMessage[] = [
      { id: t.id, idempotencyKey: t.id, role: 'user' as const, text: typeof t.prompt.content === 'string' ? t.prompt.content : t.prompt.content.filter(p => p.type === 'text').map(p => p.text).join('\n'), timestampMs: t.at, attachments },
      ...(t.reply ? [{ id: t.runId, role: 'assistant' as const, text: t.reply, model: t.model, timestampMs: t.at }] : []),
      ];
      const size = Buffer.byteLength(JSON.stringify(pair));
      if (bytes + size > 8 * 1024 * 1024 - 8192) break;
      bytes += size; messages.unshift(...pair); index--;
    }
    return { key: 'main', messages, hasActiveRun: this.running, ...(index > 0 ? { nextCursor: String(index) } : {}) };
  }
}
