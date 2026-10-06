import { isIncomingParticipant } from '../../chat/messageAttribution';
import { isNewUserTurn, originalRunUserIndex, type RunWorkIdentity } from '../../chat/turnIdentity';
import type { UiMessage } from '../../types/chat';

/**
 * One turn of Agent work as the work dock and the receipts see it (tool
 * process design C, owner decision 2026-10-02). The conversation keeps only
 * what was said; a running turn's steps live in the dock above the composer,
 * and a finished turn leaves one receipt under its last reply (owner decision
 * 2026-10-05: never a centred pill).
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

/** Same native execution guides do not open another work record. Legacy users still do. */
function workBoundaries(messages: ReadonlyArray<UiMessage>, active?: RunWorkIdentity): boolean[] {
  const boundaries = new Array<boolean>(messages.length).fill(false);
  let original: UiMessage | undefined;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    if (!opensTurn(message)) continue;
    if (!original || isNewUserTurn(message, original)) {
      original = message;
      boundaries[index] = true;
    }
  }
  if (active) {
    const originalIndex = originalRunUserIndex(messages, active.turnId, active.inputMessageId, active.inputMessageKey);
    for (let index = 0; index < messages.length; index += 1) {
      const message = messages[index]!;
      if (opensTurn(message) && message.turnId === active.turnId && index !== originalIndex
        && !message.idempotencyKey) boundaries[index] = false;
    }
  }
  return boundaries;
}

/** A partial page may supply a run clock, but cannot nominate its first guide as the input. */
export function liveTurnMessages(messages: ReadonlyArray<UiMessage>, active?: RunWorkIdentity): ReadonlyArray<UiMessage> {
  const boundaries = workBoundaries(messages, active);
  let end = 0;
  while (end < messages.length && !boundaries[end]) end += 1;
  const turn = messages.slice(0, end);
  return active && originalRunUserIndex(messages, active.turnId, active.inputMessageId, active.inputMessageKey) < 0
    ? turn.filter(message => message.turnId === active.turnId) : turn;
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
  /** When the first step started, for the dock's one-second grace. */
  firstStepAt?: number;
  /** An approval of this turn still waiting for the user. */
  pendingApproval?: UiMessage;
  /** The prompt that opened the turn, when the loaded page holds it: where its timeline starts. */
  prompt?: UiMessage;
  /** A finished turn's newest message (its last reply, else its last step): where its timeline ends. */
  endedAt?: number;
}>;

export const EMPTY_TURN_WORK: TurnWork = Object.freeze({ entries: [], steps: [], running: 0 });

/**
 * Builds a turn from its messages, newest first. In the running turn a step
 * whose result is not recorded yet can read `unknown` (Claude Code and Pi
 * history reloads mid-run): when nothing else runs, the newest such legacy
 * step is still working. Explicit unknown state is never execution evidence.
 */
function buildTurnWork(turn: ReadonlyArray<UiMessage>, live = false, prompt?: UiMessage): TurnWork {
  if (turn.length === 0) return EMPTY_TURN_WORK;
  const entries: TurnEntry[] = [];
  const steps: UiMessage[] = [];
  let current: UiMessage | undefined;
  let running = 0;
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
  if (live && !current && steps[0]?.toolStatus === 'unknown' && !steps[0].toolStatusReported) {
    current = steps[0];
    running = 1;
  }
  entries.reverse();
  steps.reverse();
  const endedAt = live ? undefined : validTime(turn[0]!.timestampMs);
  return { entries, steps, current, running, firstStepAt, pendingApproval, prompt, endedAt };
}

/** The prompt that opened the newest turn; a partial page that lacks it has none. */
function liveTurnPrompt(messages: ReadonlyArray<UiMessage>, active?: RunWorkIdentity): UiMessage | undefined {
  if (active && originalRunUserIndex(messages, active.turnId, active.inputMessageId, active.inputMessageKey) < 0) return undefined;
  const end = workBoundaries(messages, active).indexOf(true);
  return end < 0 ? undefined : messages[end];
}

/** The newest turn: everything after the latest prompt the Agent received. */
export function collectLiveTurnWork(messages: ReadonlyArray<UiMessage>, active?: RunWorkIdentity): TurnWork {
  return buildTurnWork(liveTurnMessages(messages, active), true, liveTurnPrompt(messages, active));
}

/**
 * The turn around `anchorKey` (a message render key): from the prompt that
 * opened it to the next prompt. An unknown anchor yields an empty turn.
 */
export function collectTurnWorkAround(messages: ReadonlyArray<UiMessage>, anchorKey: string): TurnWork {
  const anchor = messages.findIndex((message) => renderKeyOf(message) === anchorKey);
  if (anchor < 0) return EMPTY_TURN_WORK;
  const boundaries = workBoundaries(messages);
  let newest = anchor;
  while (newest > 0 && !boundaries[newest - 1]) newest -= 1;
  let oldest = anchor;
  while (oldest < messages.length - 1 && !boundaries[oldest + 1]) oldest += 1;
  const prompt = oldest + 1 < messages.length && boundaries[oldest + 1] ? messages[oldest + 1] : undefined;
  return buildTurnWork(messages.slice(newest, oldest + 1), false, prompt);
}

export type TurnReceipt = Readonly<{
  /** The turn's tool calls, oldest first. */
  steps: ReadonlyArray<UiMessage>;
}>;

export type FoldedTurns = Readonly<{
  /** Messages the conversation shows, newest first: a turn's steps leave it. */
  messages: ReadonlyArray<UiMessage>;
  /** The receipt under each finished turn's last reply, by that reply's render key. */
  receipts: ReadonlyMap<string, TurnReceipt>;
  /**
   * A finished turn that said nothing at all keeps its receipt in a bubble of
   * its own, standing at its newest step's render key (that step stays in `messages`).
   */
  standalone: ReadonlyMap<string, TurnReceipt>;
}>;

const NO_RECEIPTS: ReadonlyMap<string, TurnReceipt> = new Map();

/**
 * Takes tool steps out of the conversation. A finished turn puts its receipt
 * under its last words, even when they came before its last step; a turn
 * that said nothing keeps the receipt standing where its newest step was.
 * The running turn (`liveTurnOpen`) shows nothing for its steps: the dock does. Approvals
 * and everything said stay where they are.
 */
export function foldTurnSteps(messages: ReadonlyArray<UiMessage>, liveTurnOpen: boolean, active?: RunWorkIdentity): FoldedTurns {
  if (!messages.some(isTurnStep)) return { messages, receipts: NO_RECEIPTS, standalone: NO_RECEIPTS };
  if (liveTurnOpen && active
    && originalRunUserIndex(messages, active.turnId, active.inputMessageId, active.inputMessageKey) < 0) {
    // Without the input, only exact execution-tagged rows belong to its dock.
    // Keep older/unreported work in its own legacy record, never under this run's reply.
    const older = foldTurnSteps(messages.filter(message => message.turnId !== active.turnId), false);
    const retained = new Set(older.messages);
    return { ...older, messages: messages.filter(message => message.turnId === active.turnId
      ? !isTurnStep(message) : retained.has(message)) };
  }
  const shown: UiMessage[] = [];
  const receipts = new Map<string, TurnReceipt>();
  const standalone = new Map<string, TurnReceipt>();
  const boundaries = workBoundaries(messages, liveTurnOpen ? active : undefined);
  let index = 0;
  let newestTurn = true;
  while (index < messages.length) {
    const start = index;
    while (index < messages.length && !boundaries[index]) index += 1;
    const turn = messages.slice(start, index);
    const live = newestTurn && liveTurnOpen;
    newestTurn = false;
    const newestStep = turn.find(isTurnStep);
    if (!newestStep) {
      shown.push(...turn);
    } else if (live) {
      for (const message of turn) if (!isTurnStep(message)) shown.push(message);
    } else {
      const receipt = { steps: turn.filter(isTurnStep).reverse() };
      const lastWords = turn.find(saysSomething);
      if (lastWords) {
        receipts.set(renderKeyOf(lastWords), receipt);
        for (const message of turn) if (!isTurnStep(message)) shown.push(message);
      } else {
        standalone.set(renderKeyOf(newestStep), receipt);
        for (const message of turn) if (!isTurnStep(message) || message === newestStep) shown.push(message);
      }
    }
    if (index < messages.length) {
      shown.push(messages[index]!);
      index += 1;
    }
  }
  return { messages: shown, receipts, standalone };
}
