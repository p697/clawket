import type { SkillStatusEntry, SkillStatusReport } from '@clawket/agent-protocol';
import { withSkillInvocations } from './skill-invocation';

const entry = { name: 'article-summary', skillKey: 'summary', eligible: true, disabled: false, blockedByAllowlist: false } as SkillStatusEntry;
const report = (skills: SkillStatusEntry[]): SkillStatusReport => ({ workspaceDir: '', managedSkillsDir: '', skills });

it('uses native OpenClaw references and explicit Hermes skill instructions', () => {
  expect(withSkillInvocations(report([entry]), 'reference').skills[0].invocation).toBe('$article-summary');
  expect(withSkillInvocations(report([entry]), 'instruction').skills[0].invocation).toContain('skill_view');
  expect(entry.invocation).toBeUndefined();
});

it.each([{ disabled: true }, { eligible: false }, { blockedByAllowlist: true }, { name: 'bad\n/exec' }, { name: '' }])('removes stale invocation for unavailable/corrupt metadata: %o', (patch) => {
  expect(withSkillInvocations(report([{ ...entry, invocation: 'stale', ...patch }]), 'reference').skills[0].invocation).toBeUndefined();
});
