import { isRecord } from './internal.js';
import type { HermesHistoryMessage } from './native-sessions.js';

/** Bind a native call while it is still running, before a result exists. */
export function correlateActiveNativeTools(native: HermesHistoryMessage[], tools: Array<{
  toolCallId: string; toolName: string; startedAt: number; args?: string;
}>): Record<string, { toolCallId: string; toolName: string }> {
  const calls = native.flatMap(message => Array.isArray(message.content)
    ? message.content.flatMap(block => isRecord(block) && block.type === 'toolCall'
      && typeof block.id === 'string' && typeof block.name === 'string'
      ? [{ id: block.id, name: block.name, args: block.arguments, timestamp: message.timestamp }] : []) : []);
  const pairs = tools.flatMap(tool => tool.args?.trim() ? calls.filter(call =>
    call.name === tool.toolName && Math.abs(call.timestamp - tool.startedAt) <= 10_000
      && matchesArgs(call.args, tool.args!)).map(call => ({ tool, call })) : []);
  return Object.fromEntries(pairs.filter(pair =>
    pairs.filter(other => other.tool.toolCallId === pair.tool.toolCallId).length === 1
      && pairs.filter(other => other.call.id === pair.call.id).length === 1)
    .map(({ tool, call }) => [call.id, { toolCallId: tool.toolCallId, toolName: tool.toolName }]));
}

/** Reconcile late native persistence only with an unambiguous matching tool argument. */
export function correlateLateNativeTools(native: HermesHistoryMessage[], local: HermesHistoryMessage[]): HermesHistoryMessage[] {
  const calls = new Map<string, { name: string; args: unknown }>();
  for (const message of native) {
    if (!Array.isArray(message.content)) continue;
    for (const block of message.content) {
      if (isRecord(block) && block.type === 'toolCall' && typeof block.id === 'string' && typeof block.name === 'string') {
        calls.set(block.id, { name: block.name, args: block.arguments });
      }
    }
  }
  const used = new Set(local.map(message => message._nativeToolCallId).filter(Boolean));
  return local.map(message => {
    if (message.role !== 'toolResult' || message._nativeToolCallId || !message.toolArgs?.trim()) return message;
    const candidates = native.filter(result => {
      if (result.role !== 'toolResult' || !result.toolCallId || used.has(result.toolCallId)
        || Math.abs(result.timestamp - message.timestamp) > 10_000) return false;
      const call = calls.get(result.toolCallId);
      return Boolean(call && call.name === message.toolName && matchesArgs(call.args, message.toolArgs!));
    });
    if (candidates.length !== 1) return message;
    const nativeResult = candidates[0]!;
    used.add(nativeResult.toolCallId);
    return { ...message, _nativeToolCallId: nativeResult.toolCallId, content: nativeResult.content };
  });
}

function matchesArgs(native: unknown, preview: string): boolean {
  if (typeof native === 'string') {
    if (native.trim() === preview.trim()) return true;
    try { native = JSON.parse(native); } catch { return false; }
  }
  if (!isRecord(native)) return false;
  // Hermes terminal preview is exactly the command; other tools may expose
  // the complete JSON arguments. Do not guess from truncated previews.
  if (typeof native.command === 'string' && native.command.trim() === preview.trim()) return true;
  try {
    const expected = JSON.parse(preview);
    if (!isRecord(expected)) return false;
    const keys = Object.keys(native).sort();
    return JSON.stringify(keys) === JSON.stringify(Object.keys(expected).sort())
      && keys.every(key => JSON.stringify(native[key]) === JSON.stringify(expected[key]));
  } catch { return false; }
}
