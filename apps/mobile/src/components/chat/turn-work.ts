import { isIncomingParticipant } from '../../chat/messageAttribution';
import type { UiMessage } from '../../types/chat';

/**
 * One turn of Agent work as the work dock and the receipts see it (tool
 * process design C, owner decision 2026-10-02). The conversation keeps only
 * what was said; a running turn's steps live in the dock above the composer,
 * and a finished turn leaves one receipt under its last reply.
 *
 * Every function takes `messages` newest-first, as the chat controller keeps them.
 */

/**
 * A prompt that reached the Agent opens a turn. A queued, sending or held
 * draft has not reached it yet, so it never splits the turn that is running.
 */
export function opensTurn(message: UiMessage): boolean {
  return message.role === 'user' && !isIncomingParticipant(message) && message.delivery === undefined;
}

/** A tool call the turn made. Approval requests ask the user; they are not steps. */
export function isTurnStep(message: UiMessage): boolean {
  return message.role === 'tool' && !message.approval;
}

/**
 * An execution approval asked during a turn. The controller delivers these
 * as system rows carrying `approval` (older caches used tool rows); device
 * pairing requests are not turn work.
 */
function isExecApproval(message: UiMessage): boolean {
  return message.approval !== undefined && message.approval.kind !== 'pair';
}

/** An execution approval of this conversation that still waits for the user. */
export function isPendingExecApproval(message: UiMessage): boolean {
  return isExecApproval(message) && message.approval!.status === 'pending';
}

function saysSomething(message: UiMessage): boolean {
  return message.role === 'assistant' && message.text.trim().length > 0;
}

export function renderKeyOf(message: UiMessage): string {
  return message.renderKey ?? message.id;
}

function validTime(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

export type TurnEntry =
  | Readonly<{ kind: 'step'; message: UiMessage }>
  /** Words the Agent said before a later step, so the process reads against the conversation. */
  | Readonly<{ kind: 'said'; message: UiMessage }>
  | Readonly<{ kind: 'approval'; message: UiMessage }>;

export type TurnWork = Readonly<{
  /** Steps, the Agent's words between them and approvals, oldest first. */
  entries: ReadonlyArray<TurnEntry>;
  /** Tool calls, oldest first. */
  steps: ReadonlyArray<UiMessage>;
  /** The newest step still running: the one the dock names. */
  current?: UiMessage;
  /** Steps running at once. */
  running: number;
  /** Failed steps; a failure the Agent moved past is still counted, never shouted. */
  failed: number;
  /** When the first step started, for the dock's one-second grace. */
  firstStepAt?: number;
  /** An approval of this turn still waiting for the user. */
  pendingApproval?: UiMessage;
}>;

export const EMPTY_TURN_WORK: TurnWork = Object.freeze({ entries: [], steps: [], running: 0, failed: 0 });

/**
 * Builds a turn from its messages, newest first. In the running turn a step
 * whose result is not recorded yet can read `unknown` (Claude Code and Pi
 * history reloads mid-run): when nothing else runs, the newest such step is
 * the one still working.
 */
function buildTurnWork(turn: ReadonlyArray<UiMessage>, live = false): TurnWork {
  if (turn.length === 0) return EMPTY_TURN_WORK;
  const entries: TurnEntry[] = [];
  const steps: UiMessage[] = [];
  let current: UiMessage | undefined;
  let running = 0;
  let failed = 0;
  let firstStepAt: number | undefined;
  let pendingApproval: UiMessage | undefined;
  // Walking newest-first: whether a step came after the message in hand.
  let stepFollows = false;
  for (const message of turn) {
    if (isTurnStep(message)) {
      entries.push({ kind: 'step', message });
      steps.push(message);
      stepFollows = true;
      if (message.toolStatus === 'running') {
        running += 1;
        current ??= message;
      } else if (message.toolStatus === 'error') {
        failed += 1;
      }
      const started = validTime(message.toolStartedAt) ?? validTime(message.timestampMs);
      if (started !== undefined) firstStepAt = firstStepAt === undefined ? started : Math.min(firstStepAt, started);
    } else if (isExecApproval(message)) {
      entries.push({ kind: 'approval', message });
      if (message.approval!.status === 'pending') pendingApproval ??= message;
    } else if (saysSomething(message) && stepFollows) {
      entries.push({ kind: 'said', message });
    }
  }
  if (steps.length === 0 && !pendingApproval) return EMPTY_TURN_WORK;
  // `steps` is still newest-first here.
  if (live && !current && steps[0]?.toolStatus === 'unknown') {
    current = steps[0];
    running = 1;
  }
  entries.reverse();
  steps.reverse();
  return { entries, steps, current, running, failed, firstStepAt, pendingApproval };
}

/** The newest turn: everything after the latest prompt the Agent received. */
export function collectLiveTurnWork(messages: ReadonlyArray<UiMessage>): TurnWork {
  let end = 0;
  while (end < messages.length && !opensTurn(messages[end]!)) end += 1;
  return buildTurnWork(messages.slice(0, end), true);
}

/**
 * The turn around `anchorKey` (a message render key): from the prompt that
 * opened it to the next prompt. An unknown anchor yields an empty turn.
 */
export function collectTurnWorkAround(messages: ReadonlyArray<UiMessage>, anchorKey: string): TurnWork {
  const anchor = messages.findIndex((message) => renderKeyOf(message) === anchorKey);
  if (anchor < 0) return EMPTY_TURN_WORK;
  let newest = anchor;
  while (newest > 0 && !opensTurn(messages[newest - 1]!)) newest -= 1;
  let oldest = anchor;
  while (oldest < messages.length - 1 && !opensTurn(messages[oldest + 1]!)) oldest += 1;
  return buildTurnWork(messages.slice(newest, oldest + 1));
}

export type TurnReceipt = Readonly<{
  /** The turn's tool calls, oldest first. */
  steps: ReadonlyArray<UiMessage>;
  /** The turn ended on a failed step with nothing said after it: the one time a turn reads red. */
  failed: boolean;
}>;

export type FoldedTurns = Readonly<{
  /** Messages the conversation shows, newest first: a turn's steps leave it. */
  messages: ReadonlyArray<UiMessage>;
  /** The receipt under each finished turn's last reply, by that reply's render key. */
  receipts: ReadonlyMap<string, TurnReceipt>;
  /**
   * A finished turn that said nothing after its last step keeps one pill,
   * standing at that step's render key (its message stays in `messages`).
   */
  pills: ReadonlyMap<string, TurnReceipt>;
}>;

const NO_RECEIPTS: ReadonlyMap<string, TurnReceipt> = new Map();

/**
 * Takes tool steps out of the conversation. A finished turn whose newest
 * words come after its last step puts a receipt under those words; one that
 * ended on a step keeps a single pill there, red only when that step failed.
 * The running turn (`liveTurnOpen`) shows nothing for its steps: the dock does.
 * Approvals and everything said stay where they are.
 */
export function foldTurnSteps(messages: ReadonlyArray<UiMessage>, liveTurnOpen: boolean): FoldedTurns {
  if (!messages.some(isTurnStep)) return { messages, receipts: NO_RECEIPTS, pills: NO_RECEIPTS };
  const shown: UiMessage[] = [];
  const receipts = new Map<string, TurnReceipt>();
  const pills = new Map<string, TurnReceipt>();
  let index = 0;
  let newestTurn = true;
  while (index < messages.length) {
    const start = index;
    while (index < messages.length && !opensTurn(messages[index]!)) index += 1;
    const turn = messages.slice(start, index);
    const live = newestTurn && liveTurnOpen;
    newestTurn = false;
    const newestStep = turn.find(isTurnStep);
    if (!newestStep) {
      shown.push(...turn);
    } else if (live) {
      for (const message of turn) if (!isTurnStep(message)) shown.push(message);
    } else {
      const steps = turn.filter(isTurnStep).reverse();
      const newestWork = turn.find((message) => isTurnStep(message) || saysSomething(message))!;
      if (saysSomething(newestWork)) {
        receipts.set(renderKeyOf(newestWork), { steps, failed: false });
        for (const message of turn) if (!isTurnStep(message)) shown.push(message);
      } else {
        pills.set(renderKeyOf(newestStep), { steps, failed: newestStep.toolStatus === 'error' });
        for (const message of turn) if (!isTurnStep(message) || message === newestStep) shown.push(message);
      }
    }
    if (index < messages.length) {
      shown.push(messages[index]!);
      index += 1;
    }
  }
  return { messages: shown, receipts, pills };
}
