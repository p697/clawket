import { ClaudeFault } from './errors.js';
import { EventEmitter } from 'node:events';
import { query, type Options, type Query, type SDKMessage, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import type { PromptInput, SessionUpdate } from '@clawket/agent-protocol';
import { ClaudeInteractions } from './interactions.js';

type SessionOptions = {
  key: string;
  cwd: string;
  executable: string;
  /** Only an already-owned, durably recorded session may be supplied here. */
  resume?: string;
  sessionId?: string;
  model?: string;
  /** QA can disable settings; product callers retain native user/project/local settings. */
  settingSources?: Options['settingSources'];
  tools?: Options['tools'];
};
type Run = { id: string; messageId: string; text: string; started: number; cancelling: boolean; toolIds: Set<string>; model?: string };

export function claudePromptContent(input: PromptInput): SDKUserMessage['message']['content'] {
  if (typeof input.text !== 'string' || input.text.length > 200_000 || !input.text.trim() && !input.attachments?.length) {
    throw new ClaudeFault('A Claude message must contain text or an image');
  }
  const parts: Exclude<SDKUserMessage['message']['content'], string> = [];
  if (input.text) parts.push({ type: 'text', text: input.text });
  let bytes = 0;
  if ((input.attachments?.length ?? 0) > 4) throw new ClaudeFault('Too many Claude images');
  for (const attachment of input.attachments ?? []) {
    if (!attachment || typeof attachment !== 'object' || attachment.type !== 'image' || !['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(attachment.mimeType)
      || !attachment.content || !/^[A-Za-z0-9+/]*={0,2}$/.test(attachment.content)) throw new ClaudeFault('Unsupported Claude attachment');
    bytes += Buffer.byteLength(attachment.content);
    if (bytes > 5 * 1024 * 1024) throw new ClaudeFault('Claude images exceed the message size limit');
    parts.push({ type: 'image', source: { type: 'base64', media_type: attachment.mimeType as 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp', data: attachment.content } });
  }
  return parts;
}

/** A single Clawket-owned, unmodified CLI process. Never attaches to another owner's process. */
export class ClaudeSession extends EventEmitter {
  readonly interactions: ClaudeInteractions;
  private runner?: Query;
  private reader?: Promise<void>;
  private startPromise?: Promise<void>;
  private controller = new AbortController();
  private inbox: SDKUserMessage[] = [];
  private wake?: () => void;
  private closed = false;
  private run?: Run;
  private nativeId?: string;
  private model?: string;

  constructor(private readonly options: SessionOptions, private readonly sdkQuery: typeof query = query) {
    super();
    this.nativeId = options.resume;
    this.interactions = new ClaudeInteractions(options.key, update => this.update(update));
  }

  get currentModel(): string | undefined { return this.model; }
  get sessionId(): string | undefined { return this.nativeId; }
  get activeRun(): { runId: string; text: string; startedAtMs: number; sessionAbortable: boolean } | undefined {
    return this.run ? { runId: this.run.id, text: this.run.text, startedAtMs: this.run.started, sessionAbortable: true } : undefined;
  }
  private update(update: SessionUpdate): void { this.emit('update', update); }

  start(): Promise<void> {
    if (this.closed) return Promise.reject(new ClaudeFault('Claude session is closed'));
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.startOnce();
    return this.startPromise;
  }

  private async startOnce(): Promise<void> {
    this.runner = this.sdkQuery({ prompt: this.inputs(), options: {
      cwd: this.options.cwd, pathToClaudeCodeExecutable: this.options.executable,
      ...(this.options.resume ? { resume: this.options.resume } : {}),
      ...(!this.options.resume && this.options.sessionId ? { sessionId: this.options.sessionId } : {}),
      ...(this.options.model ? { model: this.options.model } : {}),
      ...(this.options.tools ? { tools: this.options.tools } : {}),
      abortController: this.controller, includePartialMessages: true,
      permissionMode: 'default', systemPrompt: { type: 'preset', preset: 'claude_code' },
      settingSources: this.options.settingSources ?? ['user', 'project', 'local'],
      canUseTool: this.interactions.canUseTool,
      // Unexpected SDK dialogs fail closed instead of leaving an invisible dialog waiting on the phone.
      supportedDialogKinds: [],
    } });
    this.reader = this.read(this.runner);
    const deadline = setTimeout(() => this.controller.abort(), 30_000);
    try { await this.runner.initializationResult(); }
    catch { await this.close(); throw new ClaudeFault('Claude Code could not initialize. Check native authentication and configuration.'); }
    finally { clearTimeout(deadline); }
    if (this.closed) throw new ClaudeFault('Claude session closed during initialization');
  }

  private async *inputs(): AsyncGenerator<SDKUserMessage> {
    while (!this.closed) {
      if (!this.inbox.length) await new Promise<void>(resolve => { this.wake = resolve; });
      this.wake = undefined;
      if (this.closed) return;
      const message = this.inbox.shift();
      if (message) yield message;
    }
  }

  /** Caller must persist the acceptance fingerprint before invoking this method. */
  send(runId: string, input: PromptInput): void {
    if (!/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(runId)) throw new ClaudeFault('Invalid Claude run identity');
    if (!this.runner || this.closed) throw new ClaudeFault('Claude session is unavailable');
    if (this.run) throw new ClaudeFault('Claude is still working on this session');
    const messageContent = claudePromptContent(input);
    const messageId = runId;
    this.run = { id: runId, messageId, text: '', started: Date.now(), cancelling: false, toolIds: new Set(), model: this.model };
    this.inbox.push({ type: 'user', uuid: messageId as SDKUserMessage['uuid'], session_id: this.nativeId,
      message: { role: 'user', content: messageContent }, parent_tool_use_id: null });
    this.update({ type: 'run_started', sessionKey: this.options.key, runId });
    this.wake?.();
  }

  private async read(runner: Query): Promise<void> {
    try {
      for await (const message of runner) {
        if (this.closed) break;
        this.receive(message);
      }
      if (!this.closed) {
        this.closed = true;
        this.finish('error');
        this.interactions.close();
        this.emit('closed');
      }
    } catch {
      if (!this.closed) {
        this.closed = true;
        this.finish('error');
        this.interactions.close();
        this.update({ type: 'error', sessionKey: this.options.key, code: 'server',
          message: 'The Claude Code process stopped. Check the connection before continuing.' });
        this.emit('closed');
      }
    }
  }

  private receive(message: SDKMessage): void {
    if (message.type === 'system' && message.subtype === 'init') {
      this.nativeId = message.session_id;
      this.model = message.model;
      this.emit('identity', this.nativeId);
      if (this.run) this.run.model = message.model;
    }
    const run = this.run;
    if (!run) return;
    const sessionKey = this.options.key;
    if (message.type === 'stream_event' && !message.parent_tool_use_id) {
      const event = message.event;
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        run.text += event.delta.text;
        this.update({ type: 'agent_message_chunk', sessionKey, runId: run.id, text: event.delta.text, textMode: 'delta' });
      }
      if (event.type === 'content_block_delta' && event.delta.type === 'thinking_delta') {
        this.update({ type: 'agent_thought_chunk', sessionKey, runId: run.id, text: event.delta.thinking });
      }
    } else if (message.type === 'assistant' && !message.parent_tool_use_id) {
      run.model = message.message.model;
      for (const block of message.message.content) {
        if (block.type !== 'tool_use' || run.toolIds.has(block.id)) continue;
        run.toolIds.add(block.id);
        this.update({ type: 'tool_call', sessionKey, runId: run.id, toolCallId: block.id, title: block.name, kind: block.name, rawInput: block.input });
      }
    } else if (message.type === 'user' && !message.parent_tool_use_id && Array.isArray(message.message.content)) {
      for (const block of message.message.content) {
        if (block.type !== 'tool_result' || !run.toolIds.has(block.tool_use_id)) continue;
        this.update({ type: 'tool_call_update', sessionKey, runId: run.id, toolCallId: block.tool_use_id,
          status: block.is_error ? 'error' : 'success', rawOutput: block.content });
      }
    } else if (message.type === 'result') {
      if (message.user_message_uuid && message.user_message_uuid !== run.messageId
        && !message.user_message_uuids?.includes(run.messageId)) return;
      const aborted = message.terminal_reason === 'aborted_streaming' || message.terminal_reason === 'aborted_tools';
      const reason = run.cancelling && aborted ? 'cancelled' : message.is_error || message.subtype !== 'success' ? 'error' : 'end_turn';
      if (!run.text && message.subtype === 'success' && !message.is_error) run.text = message.result;
      this.finish(reason);
    }
  }

  private finish(stopReason: 'end_turn' | 'cancelled' | 'error'): void {
    const run = this.run;
    if (!run) return;
    this.run = undefined;
    this.interactions.cancelPending();
    this.update({ type: 'run_finished', sessionKey: this.options.key, runId: run.id, stopReason,
      ...(run.text ? { message: { role: 'assistant', content: run.text, model: run.model } } : {}) });
    this.emit('settled');
  }

  async interrupt(runId: string): Promise<void> {
    if (!this.run || this.run.id !== runId || !this.runner) throw new ClaudeFault('Claude run is no longer active');
    this.run.cancelling = true;
    // Keep the run and pending questions until a native result or process termination arrives.
    try { await this.runner.interrupt(); }
    catch { throw new ClaudeFault('Claude interruption could not be confirmed'); }
  }

  async models(): ReturnType<Query['supportedModels']> {
    await this.start();
    return this.runner!.supportedModels();
  }
  async setModel(model: string): Promise<void> {
    if (this.run) throw new ClaudeFault('Wait for Claude to finish before changing models');
    await this.start();
    const models = await this.models();
    if (!models.some(row => row.value === model || row.resolvedModel === model)) throw new ClaudeFault('Unsupported Claude model');
    await this.runner!.setModel(model);
    this.model = model;
  }
  async close(): Promise<void> {
    this.closed = true;
    this.interactions.close();
    this.inbox.length = 0;
    this.wake?.();
    this.controller.abort();
    this.runner?.close();
    await this.reader;
    this.finish('cancelled');
  }
}
