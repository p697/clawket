/** Unknown timings stay absent; a zero-resolution measurement is not a true 0 ms run. */
export function formatToolDuration(ms?: number): string | undefined {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return undefined;
  if (ms < 1) return '<1 ms';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60000) return `${Number((ms / 1000).toFixed(1))} s`;
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)} m ${seconds % 60} s`;
}

/** Bound initial native rendering; copying always uses the unmodified source. */
export function prepareToolPayload(raw: string, limit = 6000): { text: string; structured: boolean; truncated: boolean } {
  const text = raw.trim();
  if (text.length > limit) return { text: text.slice(0, limit), structured: false, truncated: true };
  if (/^(?:\{|\[)/.test(text)) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (parsed !== null && typeof parsed === 'object') return { text, structured: true, truncated: false };
    } catch { /* Malformed or partial JSON remains readable as text. */ }
  }
  return { text, structured: false, truncated: false };
}
