import { ClaudeFault } from './errors.js';
import { randomUUID } from 'node:crypto';
import type { CanUseTool, PermissionResult } from '@anthropic-ai/claude-agent-sdk';
import type { AgentQuestion, ApprovalRequest, SessionUpdate } from '@clawket/agent-protocol';

type Pending = {
  input: Record<string, unknown>;
  question?: AgentQuestion;
  approval?: Extract<ApprovalRequest, { kind: 'exec' }>;
  settle(result: PermissionResult): void;
};
type Answer = { answers?: Record<string, string[]>; cancelled?: boolean };

function text(value: unknown, max = 4_000): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function form(id: string, input: Record<string, unknown>): AgentQuestion {
  if (!Array.isArray(input.questions) || input.questions.length < 1 || input.questions.length > 4) {
    throw new ClaudeFault('Unsupported Claude question shape');
  }
  const seen = new Set<string>();
  const fields = input.questions.map((item, index) => {
    if (!object(item) || !text(item.question) || seen.has(item.question)
      || !Array.isArray(item.options) || item.options.length > 4 || item.options.length < 2
      || (item.multiSelect !== undefined && typeof item.multiSelect !== 'boolean')) {
      throw new ClaudeFault('Unsupported Claude question shape');
    }
    seen.add(item.question);
    const labels = new Set<string>();
    const options = item.options.map(option => {
      if (!object(option) || !text(option.label, 1_000) || labels.has(option.label)
        || (option.description !== undefined && !text(option.description, 8_000))) {
        throw new ClaudeFault('Unsupported Claude question options');
      }
      labels.add(option.label);
      return { label: option.label, ...(typeof option.description === 'string' ? { description: option.description } : {}) };
    });
    return { id: `q${index}`, title: item.question,
      ...(text(item.header, 200) ? { header: item.header } : {}),
      options, allowCustom: true, multiSelect: item.multiSelect === true };
  });
  return { id, kind: 'form', title: 'Claude needs your input', fields, expiresAtMs: null };
}

/** Consent belongs to the native callback, not the lifetime of a phone socket. */
export class ClaudeInteractions {
  private pending = new Map<string, Pending>();
  private closed = false;

  constructor(private readonly sessionKey: string, private readonly emit: (update: SessionUpdate) => void) {}

  readonly canUseTool: CanUseTool = async (toolName, input, options) => {
    if (this.closed || options.signal.aborted || this.pending.size >= 16) {
      return { behavior: 'deny', message: 'This interaction is no longer available.', toolUseID: options.toolUseID };
    }
    const id = randomUUID();
    let question: AgentQuestion | undefined;
    let approval: Extract<ApprovalRequest, { kind: 'exec' }> | undefined;
    if (toolName === 'AskUserQuestion') {
      try { question = form(id, input); }
      catch { return { behavior: 'deny', message: 'This question format cannot be shown safely. Ask in plain text.', toolUseID: options.toolUseID }; }
    } else {
      const isPlan = toolName === 'ExitPlanMode';
      const command = typeof input.command === 'string' ? input.command
        : isPlan && typeof input.plan === 'string' ? input.plan : JSON.stringify(input, null, 2);
      if (command.length > 64_000) return { behavior: 'deny', message: 'This request is too large to review safely.', toolUseID: options.toolUseID };
      approval = { kind: 'exec', id, command,
        category: toolName === 'Bash' ? 'command' : /^(Write|Edit|NotebookEdit)$/.test(toolName) ? 'file' : 'permissions',
        reason: isPlan ? 'Review and approve this plan. Later tool permissions are checked separately.' : options.title ?? `Allow ${toolName}?`,
        decisions: ['allow-once', 'deny'], expiresAtMs: null };
    }
    return new Promise<PermissionResult>(resolve => {
      const abort = () => settle({ behavior: 'deny', message: 'Claude cancelled this request.', toolUseID: options.toolUseID });
      const settle = (answer: PermissionResult) => {
        if (!this.pending.delete(id)) return;
        options.signal.removeEventListener('abort', abort);
        resolve({ ...answer, toolUseID: options.toolUseID });
        this.emit(question ? { type: 'question_resolved', sessionKey: this.sessionKey, questionId: id }
          : { type: 'approval_resolved', approvalId: id, kind: 'exec', decision: answer.behavior === 'allow' ? 'allow-once' : 'deny' });
      };
      this.pending.set(id, { input, question, approval, settle });
      options.signal.addEventListener('abort', abort, { once: true });
      if (options.signal.aborted) { abort(); return; }
      this.emit(question ? { type: 'question_requested', sessionKey: this.sessionKey, question }
        : { type: 'approval_requested', sessionKey: this.sessionKey, approval: approval! });
    });
  };

  questions(): AgentQuestion[] { return [...this.pending.values()].flatMap(p => p.question ? [p.question] : []); }
  approvals(): ApprovalRequest[] { return [...this.pending.values()].flatMap(p => p.approval ? [p.approval] : []); }

  answer(id: string, answer: Answer): void {
    const item = this.pending.get(id);
    if (!item?.question) throw new ClaudeFault('Claude question is no longer pending');
    if (answer.cancelled === true) {
      item.settle({ behavior: 'deny', message: 'The user cancelled this task.', interrupt: true });
      return;
    }
    const fields = item.question.fields!;
    if (!object(answer.answers) || Object.keys(answer.answers).length !== fields.length) throw new ClaudeFault('Answer every question');
    const mapped = Object.create(null) as Record<string, string>;
    for (const field of fields) {
      const values = answer.answers[field.id];
      if (!Array.isArray(values) || !values.length || values.length > (field.multiSelect ? field.options.length : 1)
        || !values.every(value => text(value, 64_000) && value.trim()) || new Set(values).size !== values.length) {
        throw new ClaudeFault('Invalid Claude question answer');
      }
      // Free text is one explicit answer; arbitrary extra labels cannot grant hidden choices.
      if (values.length > 1 && values.some(value => !field.options.some(option => option.label === value))) {
        throw new ClaudeFault('Choose listed options or provide one custom answer');
      }
      mapped[field.title] = values.join(', ');
    }
    item.settle({ behavior: 'allow', updatedInput: { ...item.input, answers: mapped } });
  }

  approve(id: string, decision: string): void {
    const item = this.pending.get(id);
    if (!item?.approval) throw new ClaudeFault('Claude approval is no longer pending');
    if (decision !== 'allow-once' && decision !== 'deny') throw new ClaudeFault('Only one-time Claude approval is supported');
    item.settle(decision === 'allow-once' ? { behavior: 'allow', updatedInput: item.input }
      : { behavior: 'deny', message: 'The user denied this action.' });
  }

  cancelPending(): void {
    for (const item of [...this.pending.values()]) item.settle({ behavior: 'deny', message: 'The native task has ended.', interrupt: true });
  }
  close(): void { this.closed = true; this.cancelPending(); }
}
