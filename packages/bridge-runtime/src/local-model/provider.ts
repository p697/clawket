import type { PromptAttachment } from '@clawket/agent-protocol';

export interface LocalModelEndpoint {
  id: string;
  name: string;
  baseUrl: string;
  apiKey?: string;
  model?: string;
  contextWindow: number;
  maxOutputTokens?: number;
  vision?: boolean;
  engine?: 'llamacpp' | 'ollama' | 'openai-compatible';
}

export interface ModelMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>;
}

export type CompletionEvent =
  | { type: 'text'; text: string }
  | { type: 'thought'; text: string }
  | { type: 'done'; reason: 'end_turn' | 'max_tokens'; usage?: { input?: number; output?: number } };

export class LocalModelProvider {
  private readonly baseUrl: string;
  constructor(readonly config: LocalModelEndpoint, private readonly fetchImpl: typeof fetch = fetch) {
    const url = new URL(config.baseUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      throw new Error('Model endpoint must be an HTTP URL without embedded credentials');
    }
    if (!Number.isSafeInteger(config.contextWindow) || config.contextWindow < 1024) {
      throw new Error('Model context window must be at least 1024 tokens');
    }
    const output = config.maxOutputTokens ?? 1024;
    if (!Number.isSafeInteger(output) || output < 1 || output + 128 >= config.contextWindow) throw new Error('Invalid model output token budget');
    this.baseUrl = url.href.replace(/\/+$/, '').replace(/\/v1$/, '');
  }

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    const response = await this.fetchImpl(this.baseUrl + path, {
      ...init, redirect: 'error',
      headers: { 'Content-Type': 'application/json', ...(this.config.apiKey ? { Authorization: `Bearer ${this.config.apiKey}` } : {}), ...init.headers },
    });
    if (!response.ok) {
      // Do not forward arbitrary upstream bodies containing prompts or keys.
      await response.body?.cancel();
      throw new Error(`Model service returned HTTP ${response.status}`);
    }
    return response;
  }

  async inspect(timeoutMs = 10_000, allowModelLoad = false): Promise<{ models: string[]; vision: boolean }> {
    const signal = AbortSignal.timeout(timeoutMs);
    const response = await this.request('/v1/models', { signal });
    const body = await response.json() as { data?: Array<{ id?: unknown; status?: { value?: string } }> };
    const models = (body.data ?? []).flatMap((m) => typeof m.id === 'string' && m.id ? [m.id] : []);
    if (!models.length) throw new Error('Model service returned no available models');
    let vision = false;
    if (this.config.engine === 'llamacpp') {
      const selected = body.data?.find(model => model.id === (this.config.model ?? models[0]));
      // llama.cpp router exposes state in /v1/models. Do not let a short health
      // probe implicitly cold-load a large model through /props?model=... .
      if (!allowModelLoad && selected?.status?.value && selected.status.value !== 'loaded') {
        throw new Error('Model is not loaded. Select it again to load it before chatting.');
      }
      const query = this.config.model ? `?model=${encodeURIComponent(this.config.model)}` : '';
      const props = await (await this.request('/props' + query, { signal })).json() as { modalities?: { vision?: boolean } };
      vision = props.modalities?.vision === true;
    } else if (this.config.engine === 'ollama') {
      const props = await (await this.request('/api/show', {
        method: 'POST', body: JSON.stringify({ model: this.config.model ?? models[0] }), signal,
      })).json() as { capabilities?: string[] };
      vision = props.capabilities?.includes('vision') === true;
    } else {
      // Generic APIs do not standardize capability discovery: explicit opt-in.
      vision = this.config.vision === true;
    }
    return { models, vision };
  }

  async *complete(messages: ModelMessage[], model: string, signal: AbortSignal): AsyncGenerator<CompletionEvent> {
    const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(10 * 60_000)]);
    const response = await this.request('/v1/chat/completions', {
      method: 'POST', signal: requestSignal,
      body: JSON.stringify({
        model, messages, stream: true, max_tokens: this.config.maxOutputTokens ?? 1024,
        ...(this.config.engine === 'llamacpp' ? { chat_template_kwargs: { enable_thinking: false } } : {}),
      }),
    });
    if (!response.body) throw new Error('Model service returned no response stream');
    let finished = false;
    let terminal: CompletionEvent = { type: 'done', reason: 'end_turn' };
    for await (const data of decodeSse(response.body)) {
      if (signal.aborted) throw signal.reason;
      if (data === '[DONE]') { finished = true; break; }
      const packet = JSON.parse(data) as {
        error?: unknown;
        choices?: Array<{ delta?: { content?: string; reasoning_content?: string }; finish_reason?: string }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      if (packet.error) throw new Error('Model service returned a stream error');
      const choice = packet.choices?.[0];
      if (choice?.delta?.content) yield { type: 'text', text: choice.delta.content };
      if (choice?.delta?.reasoning_content) yield { type: 'thought', text: choice.delta.reasoning_content };
      if (choice?.finish_reason) {
        if (!['stop', 'length'].includes(choice.finish_reason)) throw new Error('Model returned an unsupported completion type');
        terminal = { type: 'done', reason: choice.finish_reason === 'length' ? 'max_tokens' : 'end_turn' };
      }
      if (packet.usage && terminal.type === 'done') terminal.usage = {
        input: packet.usage.prompt_tokens, output: packet.usage.completion_tokens,
      };
    }
    if (!finished) throw new Error('Model stream ended before its completion marker');
    yield terminal;
  }
}

/** Streaming UTF-8 decoder: network chunks do not align with SSE events. */
export async function* decodeSse(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let data: string[] = [];
  let dataSize = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      buffer += decoder.decode(chunk.value, { stream: !chunk.done });
      if (buffer.length > 8 * 1024 * 1024) throw new Error('Upstream stream frame too large');
      let newline: number;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).replace(/\r$/, '');
        buffer = buffer.slice(newline + 1);
        if (line === '') {
          if (data.length) yield data.join('\n');
          data = [];
          dataSize = 0;
        } else if (line.startsWith('data:')) {
          dataSize += line.length;
          if (dataSize > 8 * 1024 * 1024) throw new Error('Upstream stream frame too large');
          data.push(line.slice(5).replace(/^ /, ''));
        }
      }
      if (chunk.done) break;
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export function userMessage(text: string, attachments: PromptAttachment[] = [], vision = false): ModelMessage {
  if (!text.trim() && !attachments.length) throw new Error('Message is empty');
  if (!attachments.length) return { role: 'user', content: text };
  if (!vision) throw new Error('Selected model does not support images');
  let bytes = Buffer.byteLength(text, 'utf8');
  const content: Exclude<ModelMessage['content'], string> = [{ type: 'text', text }];
  for (const image of attachments) {
    if (!image || typeof image.content !== 'string' || image.type !== 'image' || !['image/png', 'image/jpeg'].includes(image.mimeType)
      || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(image.content)
      || !image.content.length) throw new Error('Only valid PNG and JPEG image attachments are supported');
    const decoded = Buffer.from(image.content, 'base64');
    const signature = image.mimeType === 'image/png' ? decoded.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
      : decoded[0] === 255 && decoded[1] === 216 && decoded[2] === 255;
    if (!signature) throw new Error('Image content does not match its MIME type');
    bytes += Buffer.byteLength(image.content);
    if (bytes > 7 * 1024 * 1024) throw new Error('Combined image attachments exceed the message limit');
    content.push({ type: 'image_url', image_url: { url: `data:${image.mimeType};base64,${image.content}` } });
  }
  return { role: 'user', content };
}

/** Conservative UTF-8 upper bound, with a separate visual-token reserve. */
export function budgetMessages(history: ModelMessage[], current: ModelMessage, context: number, output: number): ModelMessage[] {
  const cost = (message: ModelMessage) => typeof message.content === 'string'
    ? Buffer.byteLength(message.content, 'utf8') + 32
    : message.content.reduce((n, part) => n + (part.type === 'text' ? Buffer.byteLength(part.text) : 4096), 32);
  let remaining = context - output - 128 - cost(current);
  if (remaining < 0) throw new Error('Message exceeds the configured model context budget');
  const selected: ModelMessage[] = [];
  // History consists of completed user/assistant pairs. Drop whole oldest turns.
  for (let end = history.length; end >= 2; end -= 2) {
    const pair = history.slice(end - 2, end);
    if (pair[0]?.role !== 'user' || pair[1]?.role !== 'assistant') throw new Error('Invalid conversation history');
    const required = pair.reduce((n, m) => n + cost(m), 0);
    if (required > remaining) break;
    remaining -= required; selected.unshift(...pair);
  }
  return [...selected, current];
}
