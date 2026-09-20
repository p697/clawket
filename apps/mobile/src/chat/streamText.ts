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

