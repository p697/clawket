/** A final payload may contain only the tail, or repeat all earlier text. */
export function finalReplyTail(finalText: string, segments: ReadonlyArray<{ text: string }>, currentTail?: string): string {
  if (currentTail && finalText === currentTail) return finalText;
  let tail = finalText;
  for (const segment of segments) {
    const prefix = segment.text.trim();
    if (!prefix) continue;
    const trimmed = tail.trimStart();
    // Only remove an exact ordered prefix, never a substring or a fuzzy match.
    if (!trimmed.startsWith(prefix)) return finalText;
    tail = trimmed.slice(prefix.length).trimStart();
  }
  return tail;
}


/**
 * What a live tail showed before its final reply when the final repeats only
 * its last paragraphs: a backend's final carries its last message, while the
 * live tail holds every paragraph since the last tool. Committing the earlier
 * paragraphs keeps them on screen instead of dropping them until history
 * brings them back (device check 2026-10-06). Exact paragraph boundary only.
 */
export function liveTailBeforeFinal(liveTail: string, finalTail: string): string | undefined {
  const live = liveTail.trim();
  const final = finalTail.trim();
  if (!final || live.length <= final.length || !live.endsWith(final)) return undefined;
  const before = live.slice(0, live.length - final.length);
  if (!/\n[^\S\n]*\n\s*$/.test(before)) return undefined;
  return before.trimEnd() || undefined;
}
