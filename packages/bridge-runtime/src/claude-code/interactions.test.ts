import { describe, expect, it } from 'vitest';
import type { SessionUpdate } from '@clawket/agent-protocol';
import { ClaudeInteractions } from './interactions.js';

function setup() {
  const events: SessionUpdate[] = [];
  const interactions = new ClaudeInteractions('owned-session', event => events.push(event));
  const controller = new AbortController();
  return { interactions, events, controller, options: { signal: controller.signal, toolUseID: 'native-call' } };
}
const input = { questions: [{ question: 'Which checks?', header: 'Checks', multiSelect: true,
  options: [{ label: 'Unit tests', description: 'Fast checks' }, { label: 'Integration tests' }] }] };

describe('Claude pending interactions', () => {
  it('maps multi-select answers back to exact native question text and settles only once', async () => {
    const { interactions, options, events } = setup();
    const result = interactions.canUseTool('AskUserQuestion', input, options);
    const question = interactions.questions()[0];
    expect(question.fields?.[0].multiSelect).toBe(true);
    interactions.answer(question.id, { answers: { q0: ['Unit tests', 'Integration tests'] } });
    expect(await result).toMatchObject({ behavior: 'allow', toolUseID: 'native-call', updatedInput: {
      questions: input.questions, answers: { 'Which checks?': 'Unit tests, Integration tests' },
    } });
    expect(() => interactions.answer(question.id, { answers: { q0: ['Unit tests'] } })).toThrow('no longer pending');
    expect(events.filter(event => event.type === 'question_resolved')).toHaveLength(1);
  });

  it('rejects extra answer fields without resolving the original native question', async () => {
    const { interactions, options, controller } = setup();
    const pending = interactions.canUseTool('AskUserQuestion', input, options);
    const { id } = interactions.questions()[0];
    expect(() => interactions.answer(id, { answers: { q0: ['Unit tests'], injected: ['yes'] } })).toThrow();
    expect(interactions.questions()).toHaveLength(1);
    controller.abort();
    expect(await pending).toMatchObject({ behavior: 'deny' });
    expect(interactions.questions()).toHaveLength(0);
  });

  it('does not upgrade a one-time approval into persistent rules or a bypass mode', async () => {
    const { interactions, options } = setup();
    const pending = interactions.canUseTool('ExitPlanMode', { plan: 'Review a file.' }, options);
    const { id } = interactions.approvals()[0];
    expect(() => interactions.approve(id, 'allow-always')).toThrow('one-time');
    interactions.approve(id, 'allow-once');
    expect(await pending).toEqual({ behavior: 'allow', updatedInput: { plan: 'Review a file.' }, toolUseID: 'native-call' });
  });

  it('refuses malformed/ambiguous questions and closes outstanding permissions', async () => {
    const { interactions, options } = setup();
    const ambiguous = { questions: [input.questions[0], input.questions[0]] };
    expect(await interactions.canUseTool('AskUserQuestion', ambiguous, options)).toMatchObject({ behavior: 'deny' });
    const pending = interactions.canUseTool('Bash', { command: 'pwd' }, options);
    interactions.close();
    expect(await pending).toMatchObject({ behavior: 'deny', interrupt: true });
    expect(interactions.approvals()).toHaveLength(0);
    expect(await interactions.canUseTool('Read', {}, options)).toMatchObject({ behavior: 'deny' });
  });
});
