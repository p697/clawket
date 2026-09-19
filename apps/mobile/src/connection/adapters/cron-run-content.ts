import type { CronRunDeliveredMessage } from '@clawket/agent-protocol';

/**
 * Cron run content helpers shared by the OpenClaw adapter and its tests.
 *
 * OpenClaw reports each run under a hidden per-run session key
 * (`agent:<id>:cron:<job>:run:<sessionId>`) that `chat.history` does not
 * resolve; the transcript of the newest run lives on the stable job key.
 * The messages the Agent sent through the `message` tool appear there as
 * tool calls, either directly or wrapped in a generic `tool_call` with the
 * nested tool id, and the Gateway echoes the nested call once more as a
 * `custom` row — the extractor reads all three shapes and de-duplicates.
 */

const CRON_RUN_KEY = /^(agent:[^:]+:cron:[^:]+):run:[^:]+$/u;
const SEND_ACTIONS = new Set(['send', 'broadcast']);

/** The stable session key that carries a run's transcript, without the hidden `:run:<id>` suffix. */
export function resolveCronRunSessionKey(sessionKey: string | undefined): string | undefined {
  const key = sessionKey?.trim();
  if (!key) return undefined;
  return CRON_RUN_KEY.exec(key)?.[1] ?? key;
}

/** Messages sent through the channel message tool inside raw Gateway history rows, in order. */
export function extractCronDeliveries(messages: ReadonlyArray<unknown>): CronRunDeliveredMessage[] {
  const seen = new Set<string>();
  const deliveries: CronRunDeliveredMessage[] = [];
  for (const message of messages) {
    if (!isRecord(message) || !Array.isArray(message.content)) continue;
    for (const block of message.content) {
      const delivery = readMessageSend(block);
      if (!delivery) continue;
      const identity = `${delivery.channel ?? ''}|${delivery.target ?? ''}|${delivery.text}`;
      if (seen.has(identity)) continue;
      seen.add(identity);
      deliveries.push(delivery);
    }
  }
  return deliveries;
}

function readMessageSend(block: unknown): CronRunDeliveredMessage | null {
  if (!isRecord(block)) return null;
  if (block.type !== 'toolCall' && block.type !== 'tool_use') return null;
  const name = readString(block.name) ?? readString(block.toolName) ?? readString(block.tool);
  const rawArguments = isRecord(block.arguments) ? block.arguments
    : isRecord(block.input) ? block.input
      : isRecord(block.args) ? block.args : null;
  if (!name || !rawArguments) return null;
  let args: Record<string, unknown> | null = null;
  if (name === 'message') args = rawArguments;
  else if (name === 'tool_call' && readString(rawArguments.id) === 'message' && isRecord(rawArguments.args)) args = rawArguments.args;
  if (!args) return null;
  const action = readString(args.action);
  if (action && !SEND_ACTIONS.has(action)) return null;
  const text = readString(args.message) ?? readString(args.text);
  if (!text) return null;
  const channel = readString(args.channel);
  const target = readString(args.target) ?? readString(args.to);
  return { ...(channel ? { channel } : {}), ...(target ? { target } : {}), text };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
