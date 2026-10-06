import type { UiMessage } from '../../types/chat';
import { unwrapShellCommand } from '../../utils/tool-display';

type Translate = (key: string, options?: Record<string, unknown>) => string;
import { liveTurnMessages, type TurnWork } from './turn-work';
import type { RunWorkIdentity } from '../../chat/turnIdentity';

/**
 * What the work dock says (tool process design C, owner decision
 * 2026-10-02). It names the step running now; between steps the Agent is
 * thinking, and while its words stream it is replying. A request waiting for
 * the user outranks all of that, and a lost connection outranks everything.
 */
export type WorkDockPhase =
  | Readonly<{ kind: 'thinking' }>
  | Readonly<{ kind: 'step'; step: UiMessage }>
  | Readonly<{ kind: 'replying' }>
  | Readonly<{ kind: 'approval'; request: UiMessage }>
  | Readonly<{ kind: 'question' }>
  | Readonly<{ kind: 'offline' }>;

/**
 * A running turn that has neither used a tool nor said a word for this long
 * raises the dock to say the Agent is thinking; a quick reply never does.
 */
export const WORK_DOCK_GRACE_MS = 1_000;

/** The newest turn has said something so far. `messages` is newest-first. */
export function liveTurnHasWords(messages: ReadonlyArray<UiMessage>, active?: RunWorkIdentity): boolean {
  return liveTurnMessages(messages, active).some(message => message.role === 'assistant' && message.text.trim().length > 0);
}

/** The newest turn's reply is streaming words. `messages` is newest-first. */
function isReplying(messages: ReadonlyArray<UiMessage>, active?: RunWorkIdentity): boolean {
  for (const message of liveTurnMessages(messages, active)) {
    if (message.role === 'tool' && !message.approval) return false;
    if (message.role === 'assistant' && message.text.trim()) return message.streaming === true;
  }
  return false;
}

/**
 * The running turn's phase. A waiting question is not resolved here: it
 * takes the dock's place above the composer itself (`AgentQuestions`).
 */
export function resolveWorkDockPhase({
  work,
  messages,
  offline,
  active,
}: Readonly<{
  work: TurnWork;
  /** Newest-first, as the controller keeps them. */
  messages: ReadonlyArray<UiMessage>;
  offline: boolean;
  active?: RunWorkIdentity;
}>): WorkDockPhase {
  if (offline) return { kind: 'offline' };
  if (work.pendingApproval) return { kind: 'approval', request: work.pendingApproval };
  if (work.current) return { kind: 'step', step: work.current };
  if (isReplying(messages, active)) return { kind: 'replying' };
  return { kind: 'thinking' };
}

/** "0:42", "2:40", "1:05:03": the turn's elapsed time on the dock. */
export function formatElapsedClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`;
}

function stepIndex(work: TurnWork, step: NonNullable<TurnWork['current']>): number {
  const index = work.steps.indexOf(step);
  return index >= 0 ? index + 1 : work.steps.length;
}

/**
 * The dock's second line, shared with the work panel: which step and how far
 * along, and the turn's time. An approval shows
 * its command, a question what it asks, a lost connection what it means.
 */
export function formatWorkDockCaption({ phase, work, elapsed, detail, t }: Readonly<{
  phase: WorkDockPhase;
  work: TurnWork;
  elapsed?: number;
  detail?: string;
  t: Translate;
}>): string {
  if (phase.kind === 'offline') return t('The Agent may still be working on your computer', { ns: 'chat' });
  if (phase.kind === 'approval') {
    const approval = phase.request.approval;
    // The card keeps the exact command; the dock's summary drops a shell wrapper.
    return approval && approval.kind !== 'pair' ? unwrapShellCommand(approval.command.replace(/\s+/g, ' ').trim()) : '';
  }
  if (phase.kind === 'question') return detail?.replace(/\s+/g, ' ').trim() ?? '';
  const parts: string[] = [];
  if (work.running > 1) parts.push(t('{{count}} steps at once', { ns: 'chat', count: work.running }));
  else if (phase.kind === 'step') parts.push(t('Step {{count}}', { ns: 'chat', count: stepIndex(work, phase.step) }));
  else if (work.steps.length > 0) parts.push(work.steps.length === 1 ? t('1 step', { ns: 'chat' }) : t('{{count}} steps', { ns: 'chat', count: work.steps.length }));
  // Failures are not counted here (owner decision 2026-10-06): the panel marks each failed step.
  if (elapsed !== undefined && elapsed >= 1000) parts.push(t('Elapsed {{time}}', { ns: 'chat', time: formatElapsedClock(elapsed) }));
  return parts.join(' · ');
}
