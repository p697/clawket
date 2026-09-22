/** Display only: preserve the exact wire prefix when reopening a saved draft. */
export function readSkillDraft(input: string): { name: string; prefix: string } | null {
  const match = /^(?:\$([A-Za-z0-9][A-Za-z0-9_-]{0,99})|Use the installed skill "([A-Za-z0-9][A-Za-z0-9_-]{0,99})" for this request\. Read its instructions with skill_view before proceeding\.)\n\n/.exec(input);
  return match ? { name: match[1] || match[2], prefix: match[0] } : null;
}
