import type { SkillStatusReport } from '@clawket/agent-protocol';

/** Keep backend invocation syntax out of shared UI. Invalid/unavailable names never become commands. */
export function withSkillInvocations(report: SkillStatusReport, style: 'reference' | 'instruction'): SkillStatusReport {
  return { ...report, skills: report.skills.map((skill) => {
    const { invocation: _ignored, ...entry } = skill;
    if (!skill.eligible || skill.disabled || skill.blockedByAllowlist || !/^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,127}$/.test(skill.name)) return entry;
    return { ...entry, invocation: style === 'reference' ? `$${skill.name}`
      : `Use the installed skill ${JSON.stringify(skill.name)} for this request. Read its instructions with skill_view before proceeding.` };
  }) };
}
