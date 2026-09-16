/** One line reported by `Text.onTextLayout`; only its text matters here. */
export type MeasuredDraftLine = Readonly<{ text?: string }>;

/**
 * Visual line count of a measured draft. iOS reports only laid-out line
 * fragments, so a draft that ends with a line break — the empty line holding
 * the caret right after Return — comes back one line short until the next
 * character lands. Android already lists that empty trailing line as its own
 * entry, whose text is empty, so counting it here stays platform-neutral.
 */
export function countDraftLines(lines: ReadonlyArray<MeasuredDraftLine>): number {
  const measured = Math.max(1, lines.length);
  const last = lines[lines.length - 1];
  return last?.text?.endsWith('\n') ? measured + 1 : measured;
}
