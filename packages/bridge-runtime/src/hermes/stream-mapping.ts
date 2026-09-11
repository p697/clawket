import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import type { HermesModelState } from './commands.js';
import {
  HermesNativeSessionReader,
  normalizeHermesHistoryContent,
  type HermesHistoryMessage,
} from './native-sessions.js';
import type { HermesBridgeSessionStore } from './session-store.js';
import type { HermesObservedSessionUsageSnapshot } from './usage-ledger.js';
import {
  DEFAULT_SESSION_ID,
  HERMES_STATE_DB_PATH,
  formatError,
  isAbortError,
  isRecord,
  mapHermesUsage,
  readNumber,
  readString,
  stringifyUnknown,
  summarizeText,
} from './internal.js';

type HermesRunStartedResponse = { run_id?: string; status?: string };

export type HermesActiveRun = {
  runId: string;
  sessionKey: string;
  sessionId: string;
  abortController: AbortController;
  usageBaseline?: HermesObservedSessionUsageSnapshot | null;
};

export type HermesPendingRunStart = {
  requestId: string;
  sessionKey: string;
  sessionId: string;
  abortController: AbortController;
};

type NormalizedImageAttachment = { mimeType: string; content: string };

function normalizeImageAttachments(value: unknown): NormalizedImageAttachment[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error('chat.send attachments must be an array.');
  return value.map((entry, index) => {
    if (!isRecord(entry)) throw new Error(`chat.send attachment ${index} is malformed.`);
    if (entry.type !== undefined && entry.type !== 'image') {
      throw new Error(`chat.send attachment ${index} has unsupported type.`);
    }
    const mimeType = readString(entry.mimeType);
    const content = readString(entry.content);
    if (!/^image\/[A-Za-z0-9][A-Za-z0-9.+-]*$/.test(mimeType)) {
      throw new Error(`chat.send attachment ${index} must use an image MIME type.`);
    }
    if (!content || !isCanonicalBase64(content)) {
      throw new Error(`chat.send attachment ${index} must contain valid base64 image data.`);
    }
    return { mimeType, content };
  });
}

function isCanonicalBase64(value: string): boolean {
  if (value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) return false;
  try {
    return Buffer.from(value, 'base64').toString('base64') === value;
  } catch {
    return false;
  }
}

export abstract class HermesStreamMethods {
  declare apiBaseUrl: string;
  declare apiKey: string | null;
  declare sessionStore: HermesBridgeSessionStore;
  declare nativeSessions: HermesNativeSessionReader;
  declare activeRuns: Map<string, HermesActiveRun>;
  declare pendingRunStarts: Map<string, HermesPendingRunStart>;
  declare options: { hermesStateDbPath?: string };
  declare executeModelCommand: (command: string) => Promise<string>;
  declare executeThinkingCommand: (command: string) => Promise<string>;
  declare executeReasoningCommand: (command: string) => Promise<string>;
  declare executeFastCommand: (command: string) => Promise<string>;
  declare readHermesSessionUsageSnapshot: (sessionId: string) => HermesObservedSessionUsageSnapshot | null;
  declare recordHermesRunUsageDelta: (input: { sessionKey: string; sessionId: string; observedAtMs: number; baseline: HermesObservedSessionUsageSnapshot | null }) => void;
  declare runHermesPython: <T>(script: string, stdinPayload?: unknown) => Promise<T>;
  declare getHermesSessionHistory: (key: string, limit: number, cursor?: unknown) => Promise<{ messages: HermesHistoryMessage[]; sessionId: string; thinkingLevel: string; nextCursor?: string }>;
  declare isNativeOnlySession: (key: string) => Promise<boolean>;
  declare updateSnapshot: (patch: { sessionCount?: number }) => void;
  declare broadcastEvent: (event: string, payload: unknown) => void;

  async handleChatSend(payload: Record<string, unknown>): Promise<{ runId: string }> {
    const sessionKey = readString(payload.sessionKey) || DEFAULT_SESSION_ID;
    const text = readString(payload.message);
    const idempotencyKey = readString(payload.idempotencyKey);
    if (!text) {
      throw new Error('chat.send requires a non-empty message.');
    }
    const imageAttachments = normalizeImageAttachments(payload.attachments);
    const isCommand = isModelCommand(text)
      || isThinkingCommand(text)
      || isReasoningCommand(text)
      || isFastCommand(text);
    if (isCommand && imageAttachments.length > 0) {
      throw new Error('Hermes slash commands do not accept attachments.');
    }

    if (sessionKey !== DEFAULT_SESSION_ID && !this.sessionStore.owns(sessionKey)) {
      if ((await this.isNativeOnlySession(sessionKey))) {
        throw new Error(`Hermes native session is read-only: ${sessionKey}`);
      }
      throw new Error(`Hermes Bridge session not found; create it before sending: ${sessionKey}`);
    }
    const session = this.sessionStore.ensureSession(sessionKey);

    if (isModelCommand(text)) {
      return (await this.handleModelCommand(sessionKey, text, idempotencyKey || undefined));
    }

    if (isThinkingCommand(text)) {
      return (await this.handleThinkingCommand(sessionKey, text, idempotencyKey || undefined));
    }

    if (isReasoningCommand(text)) {
      return (await this.handleReasoningCommand(sessionKey, text, idempotencyKey || undefined));
    }

    if (isFastCommand(text)) {
      return (await this.handleFastCommand(sessionKey, text, idempotencyKey || undefined));
    }

    const abortController = new AbortController();
    const sessionId = session.sessionId;
    const requestId = `pending:${randomUUID()}`;
    this.pendingRunStarts.set(requestId, { requestId, sessionKey, sessionId, abortController });
    let runId: string;
    try {
      const priorHistory = (await this.getHermesSessionHistory(sessionKey, 0)).messages.map((message) => ({
        role: message.role,
        content: message.content,
      }));
      const nativeBoundaryId = (await this.nativeSessions
        .readHistoryBySessionId(session.sessionId))
        ?.messages.at(-1)?._nativeId;
      if (abortController.signal.aborted || this.sessionStore.findSession(sessionKey)?.sessionId !== session.sessionId) {
        throw new Error('Hermes run start was aborted.');
      }
      this.sessionStore.appendMessage(sessionKey, {
        role: 'user',
        content: text,
        ts: Date.now(),
        idempotencyKey: idempotencyKey || undefined,
        _nativeBoundaryId: nativeBoundaryId,
      });
      this.updateSnapshot({ sessionCount: this.sessionStore.count() });

      let input: string | Array<Record<string, unknown>>;
      if (imageAttachments.length > 0) {
        const parts: Array<Record<string, unknown>> = [{ type: 'text', text }];
        for (const att of imageAttachments) {
          parts.push({
            type: 'image_url',
            image_url: { url: `data:${att.mimeType};base64,${att.content}` },
          });
        }
        input = [{ role: 'user', content: parts }];
      } else {
        input = text;
      }

      const startResponse = await fetch(`${this.apiBaseUrl}/v1/runs`, {
        method: 'POST',
        headers: buildHermesApiHeaders(this.apiKey),
        body: JSON.stringify({
          input,
          conversation_history: priorHistory,
          session_id: sessionId,
        }),
        signal: abortController.signal,
      });
      if (!startResponse.ok) {
        const textBody = await startResponse.text();
        throw new Error(`Hermes /v1/runs failed (${startResponse.status}): ${summarizeText(textBody)}`);
      }
      const runPayload = await startResponse.json() as HermesRunStartedResponse;
      runId = runPayload.run_id?.trim() || '';
      if (!runId) throw new Error('Hermes /v1/runs did not return a run_id.');
    } catch (error) {
      if (isAbortError(error) || abortController.signal.aborted) {
        throw new Error('Hermes run start was aborted.');
      }
      throw error;
    } finally {
      this.pendingRunStarts.delete(requestId);
    }

    const currentSession = this.sessionStore.findSession(sessionKey);
    if (abortController.signal.aborted || currentSession?.sessionId !== sessionId) {
      throw new Error('Hermes run start was invalidated by a session reset or delete.');
    }
    const usageBaseline = this.readHermesSessionUsageSnapshot(sessionId);
    this.activeRuns.set(runId, {
      runId,
      sessionKey,
      sessionId,
      abortController,
      usageBaseline,
    });
    this.sendAgentLifecycleStart(runId, sessionKey);
    void this.streamRunEvents(runId, sessionKey, sessionId, Date.now(), abortController.signal);
    return { runId };
  }

  async handleModelCommand(
    sessionKey: string,
    rawCommand: string,
    preferredRunId?: string,
  ): Promise<{ runId: string }> {
    const runId = preferredRunId || randomUUID();
    this.sendAgentLifecycleStart(runId, sessionKey);
    try {
      const responseText = (await this.executeModelCommand(rawCommand));
      const timestamp = Date.now();
      this.sessionStore.appendMessage(sessionKey, {
        role: 'assistant',
        content: responseText,
        ts: timestamp,
        runId,
      });
      this.updateSnapshot({ sessionCount: this.sessionStore.count() });
      this.broadcastEvent('chat', {
        runId,
        sessionKey,
        seq: 1,
        state: 'final',
        message: {
          role: 'assistant',
          content: responseText,
        },
      });
      return { runId };
    } catch (error) {
      this.sendChatError(runId, sessionKey, formatError(error));
      return { runId };
    }
  }

  async handleThinkingCommand(
    sessionKey: string,
    rawCommand: string,
    preferredRunId?: string,
  ): Promise<{ runId: string }> {
    const runId = preferredRunId || randomUUID();
    this.sendAgentLifecycleStart(runId, sessionKey);
    try {
      const responseText = (await this.executeThinkingCommand(rawCommand));
      const timestamp = Date.now();
      this.sessionStore.appendMessage(sessionKey, {
        role: 'assistant',
        content: responseText,
        ts: timestamp,
        runId,
      });
      this.updateSnapshot({ sessionCount: this.sessionStore.count() });
      this.broadcastEvent('chat', {
        runId,
        sessionKey,
        seq: 1,
        state: 'final',
        message: {
          role: 'assistant',
          content: responseText,
        },
      });
      return { runId };
    } catch (error) {
      this.sendChatError(runId, sessionKey, formatError(error));
      return { runId };
    }
  }

  async handleReasoningCommand(
    sessionKey: string,
    rawCommand: string,
    preferredRunId?: string,
  ): Promise<{ runId: string }> {
    const runId = preferredRunId || randomUUID();
    this.sendAgentLifecycleStart(runId, sessionKey);
    try {
      const responseText = (await this.executeReasoningCommand(rawCommand));
      const timestamp = Date.now();
      this.sessionStore.appendMessage(sessionKey, {
        role: 'assistant',
        content: responseText,
        ts: timestamp,
        runId,
      });
      this.updateSnapshot({ sessionCount: this.sessionStore.count() });
      this.broadcastEvent('chat', {
        runId,
        sessionKey,
        seq: 1,
        state: 'final',
        message: {
          role: 'assistant',
          content: responseText,
        },
      });
      return { runId };
    } catch (error) {
      this.sendChatError(runId, sessionKey, formatError(error));
      return { runId };
    }
  }

  async handleFastCommand(
    sessionKey: string,
    rawCommand: string,
    preferredRunId?: string,
  ): Promise<{ runId: string }> {
    const runId = preferredRunId || randomUUID();
    this.sendAgentLifecycleStart(runId, sessionKey);
    try {
      const responseText = (await this.executeFastCommand(rawCommand));
      const timestamp = Date.now();
      this.sessionStore.appendMessage(sessionKey, {
        role: 'assistant',
        content: responseText,
        ts: timestamp,
        runId,
      });
      this.updateSnapshot({ sessionCount: this.sessionStore.count() });
      this.broadcastEvent('chat', {
        runId,
        sessionKey,
        seq: 1,
        state: 'final',
        message: {
          role: 'assistant',
          content: responseText,
        },
      });
      return { runId };
    } catch (error) {
      this.sendChatError(runId, sessionKey, formatError(error));
      return { runId };
    }
  }

  async handleChatAbort(payload: Record<string, unknown>): Promise<{
    ok: true;
    abortedRunIds: string[];
    upstreamCancelled: false;
  }> {
    const sessionKey = readString(payload.sessionKey) || DEFAULT_SESSION_ID;
    const runId = readString(payload.runId);
    const selectedRun = runId ? this.activeRuns.get(runId) : null;
    const abortedRunIds = runId
      ? (selectedRun?.sessionKey === sessionKey && this.abortActiveRun(runId, true) ? [runId] : [])
      : this.abortActiveRunsForSession(sessionKey, true);
    return {
      ok: true,
      abortedRunIds,
      upstreamCancelled: false,
    };
  }

  async streamRunEvents(
    runId: string,
    sessionKey: string,
    sessionId: string,
    runStartedAtMs: number,
    signal: AbortSignal,
  ): Promise<void> {
    let sawTerminalEvent = false;
    try {
      const response = await fetch(`${this.apiBaseUrl}/v1/runs/${encodeURIComponent(runId)}/events`, {
        headers: buildHermesApiHeaders(this.apiKey),
        signal,
      });
      if (!response.ok || !response.body) {
        this.sendChatError(runId, sessionKey, `Hermes events stream failed (${response.status}).`);
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';
      let seq = 0;
      let assistantText = '';
      let toolIndex = 0;
      const activeTools = new Map<string, Array<{
        toolCallId: string;
        startedAt: number;
        args?: string;
      }>>();
      const completedTools: Array<{
        toolCallId: string;
        toolName: string;
        isError: boolean;
        toolDurationMs?: number;
      }> = [];

      for await (const chunk of response.body) {
        buffer += decoder.decode(chunk, { stream: true });
        while (true) {
          const boundary = buffer.indexOf('\n\n');
          if (boundary < 0) break;
          const rawEvent = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const parsed = parseSseDataLine(rawEvent);
          if (!parsed) continue;

          const event = isRecord(parsed) ? parsed : {};
          const eventName = readString(event.event);
          if (!eventName) continue;

          if (eventName === 'message.delta') {
            const delta = readString(event.delta);
            if (!delta) continue;
            assistantText += delta;
            seq += 1;
            this.broadcastEvent('chat', {
              runId,
              sessionKey,
              seq,
              state: 'delta',
              message: {
                role: 'assistant',
                content: delta,
              },
            });
            continue;
          }

          if (eventName === 'tool.started') {
            toolIndex += 1;
            const toolName = readString(event.tool) || 'tool';
            const toolCallId = `${runId}:tool:${toolIndex}`;
            const startedAt = readNumber(event.timestamp) ?? Date.now();
            const args = readString(event.preview) || stringifyUnknown(event.args);
            const queue = activeTools.get(toolName) ?? [];
            queue.push({
              toolCallId,
              startedAt,
              args: args || undefined,
            });
            activeTools.set(toolName, queue);
            this.broadcastEvent('agent', {
              runId,
              sessionKey,
              stream: 'tool',
              ts: startedAt,
              data: {
                phase: 'start',
                name: toolName,
                toolCallId,
                args: args || undefined,
              },
            });
            continue;
          }

          if (eventName === 'tool.completed') {
            const toolName = readString(event.tool) || 'tool';
            const queue = activeTools.get(toolName) ?? [];
            const activeTool = queue.shift();
            const toolCallId = activeTool?.toolCallId ?? `${runId}:tool:${++toolIndex}`;
            if (queue.length > 0) {
              activeTools.set(toolName, queue);
            } else {
              activeTools.delete(toolName);
            }
            const toolTimestamp = readNumber(event.timestamp) ?? Date.now();
            const toolOutput = extractToolOutput(event);
            const toolDurationMs = readNumber(event.duration)
              ?? (typeof activeTool?.startedAt === 'number'
                ? Math.max(0, toolTimestamp - activeTool.startedAt)
                : undefined);
            this.sessionStore.appendMessage(sessionKey, {
              role: 'toolResult',
              content: toolOutput,
              ts: toolTimestamp,
              runId,
              toolName,
              toolCallId,
              isError: event.error === true,
              toolArgs: activeTool?.args,
              toolDurationMs,
              toolStartedAt: activeTool?.startedAt,
              toolFinishedAt: toolTimestamp,
            });
            this.updateSnapshot({ sessionCount: this.sessionStore.count() });
            completedTools.push({
              toolCallId,
              toolName,
              isError: event.error === true,
              toolDurationMs,
            });
            this.broadcastEvent('agent', {
              runId,
              sessionKey,
              stream: 'tool',
              ts: toolTimestamp,
              data: {
                phase: 'result',
                name: toolName,
                toolCallId,
                result: toolOutput || undefined,
                output: toolOutput || undefined,
                args: activeTool?.args,
                duration: toolDurationMs ?? 0,
                isError: event.error === true,
              },
            });
            continue;
          }

          if (eventName === 'run.completed') {
            sawTerminalEvent = true;
            const output = readString(event.output) || assistantText;
            assistantText = output;
            const usage = mapHermesUsage(event.usage);
            await this.hydrateToolOutputsFromHermesState({
              runId,
              sessionKey,
              sessionId,
              runStartedAtMs,
              completedTools,
              signal,
            });
            if (signal.aborted) return;
            this.recordHermesRunUsageDelta({
              sessionKey,
              sessionId,
              observedAtMs: Date.now(),
              baseline: this.activeRuns.get(runId)?.usageBaseline ?? null,
            });
            this.sessionStore.appendMessage(sessionKey, {
              role: 'assistant',
              content: output,
              ts: Date.now(),
              runId,
            });
            this.updateSnapshot({ sessionCount: this.sessionStore.count() });
            seq += 1;
            this.broadcastEvent('chat', {
              runId,
              sessionKey,
              seq,
              state: 'final',
              message: {
                role: 'assistant',
                content: output,
              },
              usage,
            });
            return;
          }

          if (eventName === 'run.failed') {
            sawTerminalEvent = true;
            this.sendChatError(runId, sessionKey, readString(event.error) || 'Hermes run failed.');
            return;
          }
        }
      }

      const trailing = parseSseDataLine(buffer);
      if (trailing && isRecord(trailing) && readString(trailing.event) === 'run.completed') {
        sawTerminalEvent = true;
        const output = readString(trailing.output) || assistantText;
        const usage = mapHermesUsage(trailing.usage);
        await this.hydrateToolOutputsFromHermesState({
          runId,
          sessionKey,
          sessionId,
          runStartedAtMs,
          completedTools,
          signal,
        });
        if (signal.aborted) return;
        this.recordHermesRunUsageDelta({
          sessionKey,
          sessionId,
          observedAtMs: Date.now(),
          baseline: this.activeRuns.get(runId)?.usageBaseline ?? null,
        });
        this.sessionStore.appendMessage(sessionKey, {
          role: 'assistant',
          content: output,
          ts: Date.now(),
          runId,
        });
        this.updateSnapshot({ sessionCount: this.sessionStore.count() });
        seq += 1;
        this.broadcastEvent('chat', {
          runId,
          sessionKey,
          seq,
          state: 'final',
          message: {
            role: 'assistant',
            content: output,
          },
          usage,
        });
        return;
      }

      if (!sawTerminalEvent) {
        const finalized = await this.finalizeRunAfterMissingTerminalEvent({
          runId,
          sessionKey,
          sessionId,
          runStartedAtMs,
          seq,
          assistantText,
          completedTools,
          signal,
        });
        if (!finalized && !signal.aborted) {
          this.sendChatError(
            runId,
            sessionKey,
            'Hermes events stream ended before a terminal event was received.',
          );
        }
      }
    } catch (error) {
      if (isAbortError(error) || signal.aborted) {
        return;
      }
      this.sendChatError(runId, sessionKey, `Hermes events stream failed: ${formatError(error)}`);
    } finally {
      this.activeRuns.delete(runId);
    }
  }

  async finalizeRunAfterMissingTerminalEvent(params: {
    runId: string;
    sessionKey: string;
    sessionId: string;
    runStartedAtMs: number;
    signal: AbortSignal;
    seq: number;
    assistantText: string;
    completedTools: Array<{
      toolCallId: string;
      toolName: string;
      isError: boolean;
      toolDurationMs?: number;
    }>;
  }): Promise<boolean> {
    await this.hydrateToolOutputsFromHermesState({
      runId: params.runId,
      sessionKey: params.sessionKey,
      sessionId: params.sessionId,
      runStartedAtMs: params.runStartedAtMs,
      completedTools: params.completedTools,
      signal: params.signal,
    });

    this.recordHermesRunUsageDelta({
      sessionKey: params.sessionKey,
      sessionId: params.sessionId,
      observedAtMs: Date.now(),
      baseline: this.activeRuns.get(params.runId)?.usageBaseline ?? null,
    });

    const history = (await this.getHermesSessionHistory(params.sessionKey, 24));
    if (params.signal.aborted) return true;
    const historyOutput = [...history.messages]
      .reverse()
      .find((message) => (
        message.role === 'assistant'
        && normalizeHermesHistoryContent(message.content).length > 0
        && message.timestamp >= params.runStartedAtMs - 1000
      ));
    const output = normalizeHermesHistoryContent(historyOutput?.content) || params.assistantText.trim();

    if (output) {
      const shouldAppendLocalAssistant = !historyOutput || normalizeHermesHistoryContent(historyOutput.content) !== output;
      if (shouldAppendLocalAssistant) {
        this.sessionStore.appendMessage(params.sessionKey, {
          role: 'assistant',
          content: output,
          ts: Date.now(),
          runId: params.runId,
        });
        this.updateSnapshot({ sessionCount: this.sessionStore.count() });
      }
      this.broadcastEvent('chat', {
        runId: params.runId,
        sessionKey: params.sessionKey,
        seq: params.seq + 1,
        state: 'final',
        message: {
          role: 'assistant',
          content: output,
        },
      });
      return true;
    }

    if (params.completedTools.length > 0) {
      this.broadcastEvent('chat', {
        runId: params.runId,
        sessionKey: params.sessionKey,
        seq: params.seq + 1,
        state: 'final',
      });
      return true;
    }

    return false;
  }

  cancelAllActiveRuns(): void {
    for (const [requestId, pending] of this.pendingRunStarts) {
      this.pendingRunStarts.delete(requestId);
      pending.abortController.abort();
    }
    for (const runId of [...this.activeRuns.keys()]) {
      this.abortActiveRun(runId, false);
    }
  }

  cancelActiveRunsForSession(sessionKey: string): void {
    this.abortActiveRunsForSession(sessionKey, false);
  }

  abortActiveRunsForSession(sessionKey: string, notifyClient: boolean): string[] {
    const abortedRunIds: string[] = [];
    for (const [requestId, pending] of this.pendingRunStarts) {
      if (pending.sessionKey !== sessionKey) continue;
      this.pendingRunStarts.delete(requestId);
      pending.abortController.abort();
    }
    for (const [runId, activeRun] of this.activeRuns) {
      if (activeRun.sessionKey !== sessionKey) continue;
      if (this.abortActiveRun(runId, notifyClient)) {
        abortedRunIds.push(runId);
      }
    }
    return abortedRunIds;
  }

  abortActiveRun(runId: string, notifyClient: boolean): boolean {
    const activeRun = this.activeRuns.get(runId);
    if (!activeRun) {
      return false;
    }
    this.activeRuns.delete(runId);
    activeRun.abortController.abort();
    if (notifyClient) {
      this.broadcastEvent('chat', {
        runId,
        sessionKey: activeRun.sessionKey,
        seq: 1,
        state: 'aborted',
      });
    }
    return true;
  }

  sendAgentLifecycleStart(runId: string, sessionKey: string): void {
    this.broadcastEvent('agent', {
      runId,
      sessionKey,
      stream: 'lifecycle',
      ts: Date.now(),
      data: {
        phase: 'start',
      },
    });
  }

  sendChatError(runId: string, sessionKey: string, message: string): void {
    this.broadcastEvent('chat', {
      runId,
      sessionKey,
      seq: 1,
      state: 'error',
      errorMessage: message,
    });
  }

  async hydrateToolOutputsFromHermesState(params: {
    runId: string;
    sessionKey: string;
    sessionId: string;
    runStartedAtMs: number;
    signal: AbortSignal;
    completedTools: Array<{
      toolCallId: string;
      toolName: string;
      isError: boolean;
      toolDurationMs?: number;
    }>;
  }): Promise<void> {
    const toolOutputs = (await this.readHermesToolOutputsFromLocalState(
      params.sessionId,
      params.runStartedAtMs,
    ));
    if (params.signal.aborted || toolOutputs.length === 0 || params.completedTools.length === 0) {
      return;
    }

    const unmatched = params.completedTools.map((tool) => ({ ...tool, matched: false }));
    for (const output of toolOutputs) {
      const match = unmatched.find((candidate) => {
        if (candidate.matched) return false;
        if (output.toolName && candidate.toolName === output.toolName) return true;
        return false;
      }) ?? unmatched.find((candidate) => !candidate.matched);
      if (!match) continue;
      match.matched = true;
      if (!output.content.trim()) continue;
      const updated = this.sessionStore.updateToolResult(params.sessionKey, match.toolCallId, {
        content: output.content,
      });
      if (!updated) continue;
      this.broadcastEvent('agent', {
        runId: params.runId,
        sessionKey: params.sessionKey,
        stream: 'tool',
        ts: output.timestampMs,
        data: {
          phase: 'result',
          name: match.toolName,
          toolCallId: match.toolCallId,
          result: output.content,
          output: output.content,
          duration: match.toolDurationMs ?? 0,
          isError: match.isError,
        },
      });
    }
  }

  async readHermesToolOutputsFromLocalState(
    sessionId: string,
    runStartedAtMs: number,
  ): Promise<Array<{ toolCallId?: string; toolName?: string; content: string; timestampMs: number }>> {
    const stateDbPath = this.options.hermesStateDbPath?.trim() || HERMES_STATE_DB_PATH;
    if (!existsSync(stateDbPath)) {
      return [];
    }

    try {
      const parsed = (await this.runHermesPython<unknown>(
        [
          'import json, pathlib, sqlite3, sys',
          'payload = json.loads(sys.stdin.read() or "{}")',
          'db_path = str(payload.get("dbPath") or "")',
          'session_id = str(payload.get("sessionId") or "")',
          'since_ts = float(payload.get("sinceTs") or 0)',
          'db_uri = pathlib.Path(db_path).resolve().as_uri() + "?mode=ro"',
          'conn = sqlite3.connect(db_uri, uri=True)',
          'conn.execute("PRAGMA query_only = ON")',
          'conn.row_factory = sqlite3.Row',
          'cur = conn.cursor()',
          'cur.execute("SELECT role, content, tool_call_id, tool_name, tool_calls, timestamp FROM messages WHERE session_id = ? AND timestamp >= ? ORDER BY timestamp, id", (session_id, since_ts))',
          'tool_names = {}',
          'out = []',
          'for row in cur.fetchall():',
          '    role = row["role"]',
          '    if role == "assistant" and row["tool_calls"]:',
          '        try: tool_calls = json.loads(row["tool_calls"])',
          '        except Exception: tool_calls = []',
          '        for tc in tool_calls or []:',
          '            call_id = tc.get("id") or tc.get("call_id")',
          '            func = tc.get("function") or {}',
          '            name = func.get("name")',
          '            if call_id and name: tool_names[call_id] = name',
          '    elif role == "tool" and row["content"]:',
          '        out.append({"toolCallId": row["tool_call_id"] or None, "toolName": tool_names.get(row["tool_call_id"]) or row["tool_name"] or None, "content": row["content"], "timestampMs": int(float(row["timestamp"]) * 1000)})',
          'print(json.dumps(out))',
        ].join('\n'),
        {
          dbPath: stateDbPath,
          sessionId,
          sinceTs: Math.max(0, runStartedAtMs - 1_000) / 1_000,
        },
      ));
      if (!Array.isArray(parsed)) {
        return [];
      }
      return parsed.flatMap((entry) => {
        if (!isRecord(entry)) return [];
        const content = readString(entry.content);
        const timestampMs = readNumber(entry.timestampMs);
        if (!content || timestampMs == null) return [];
        return [{
          toolCallId: readString(entry.toolCallId) || undefined,
          toolName: readString(entry.toolName) || undefined,
          content,
          timestampMs,
        }];
      });
    } catch {
      return [];
    }
  }
}

function buildHermesApiHeaders(apiKey: string | null): Record<string, string> {
  return {
    accept: 'application/json',
    'content-type': 'application/json',
    ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
  };
}

function parseSseDataLine(rawEvent: string): unknown | null {
  const dataLines = rawEvent
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice('data:'.length).trim())
    .filter(Boolean);
  if (dataLines.length === 0) {
    return null;
  }
  const text = dataLines.join('\n');
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function extractToolOutput(event: Record<string, unknown>): string {
  const direct = readString(event.preview)
    || readString(event.result)
    || readString(event.output)
    || readString(event.error_message);
  if (direct) {
    return direct;
  }

  const nestedCandidates = [
    event.result,
    event.output,
  ];
  for (const candidate of nestedCandidates) {
    if (!isRecord(candidate)) continue;
    const nested = readString(candidate.output)
      || readString(candidate.result)
      || readString(candidate.content)
      || readString(candidate.text)
      || readString(candidate.stdout)
      || readString(candidate.stderr);
    if (nested) {
      return nested;
    }
  }

  if (event.result != null) {
    return stringifyUnknown(event.result);
  }
  if (event.output != null) {
    return stringifyUnknown(event.output);
  }
  if (event.error === true && event.error_message != null) {
    return stringifyUnknown(event.error_message);
  }
  return '';
}

function isModelCommand(text: string): boolean {
  return /^\/model(?:\s|$)/i.test(text.trim());
}

function isThinkingCommand(text: string): boolean {
  return /^\/think(?:\s|$)/i.test(text.trim());
}

function isReasoningCommand(text: string): boolean {
  return /^\/reasoning(?:\s|$)/i.test(text.trim());
}

function isFastCommand(text: string): boolean {
  return /^\/fast(?::|\s|$)/i.test(text.trim());
}
