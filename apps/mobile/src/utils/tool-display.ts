type Translate = (key: string, options?: Record<string, unknown>) => string;

export function resolveToolDetail(name: string, args?: unknown): string | undefined {
  if (typeof args === 'string') {
    const raw = args;
    try { args = JSON.parse(raw); } catch { return undefined; }
  }
  if (!args || typeof args !== 'object') return undefined;
  const a = args as Record<string, unknown>;
  const lowerName = name.toLowerCase();

  let detail: string | undefined;
  if (lowerName === 'exec' || lowerName === 'bash') {
    detail = typeof a.command === 'string' ? a.command : typeof a.cmd === 'string' ? a.cmd : undefined;
  } else if (lowerName === 'read' || lowerName === 'write' || lowerName === 'edit') {
    detail = typeof a.path === 'string'
      ? a.path
      : typeof a.file_path === 'string'
        ? a.file_path
        : undefined;
  } else if (lowerName === 'web_search') {
    detail = typeof a.query === 'string' ? a.query : undefined;
  } else if (lowerName === 'web_fetch') {
    detail = typeof a.url === 'string' ? a.url : undefined;
  } else if (lowerName === 'browser' || lowerName === 'message') {
    detail = typeof a.action === 'string' ? a.action : undefined;
  } else {
    for (const key of ['path', 'file_path', 'command', 'query', 'url', 'action', 'name']) {
      if (typeof a[key] === 'string') {
        detail = a[key] as string;
        break;
      }
    }
  }

  if (!detail) return undefined;
  return detail
    .replace(/^\/Users\/[^/]+\//, '~/')
    .replace(/^\/home\/[^/]+\//, '~/');
}

function withTrimmedDetail(base: string, detail?: string): string {
  if (!detail) return base;
  const clipped = detail.length > 60 ? `${detail.slice(0, 57)}...` : detail;
  return `${base} ${clipped}`;
}

export function formatToolDisplayName(name: string, t?: Translate): string {
  const plain = name.replace(/_/g, ' ');
  if (!t) return plain;
  const localName = name.replace(/^mcp__.+?__/, '');
  const lower = localName.toLowerCase();
  if (lower === 'session_status') return t('Session status', { ns: 'chat' });
  if (lower === 'exec' || lower === 'bash') return t('Command', { ns: 'chat' });
  if (lower === 'read' || lower === 'read_file') return t('Read file', { ns: 'chat' });
  if (lower === 'write' || lower === 'edit' || lower === 'apply_patch' || lower === 'write_file' || lower === 'edit_file') return t('Write file', { ns: 'chat' });
  if (lower === 'web_search') return t('Web Search', { ns: 'chat' });
  if (lower === 'web_fetch') return t('Web Fetch', { ns: 'chat' });
  if (lower === 'browser') return t('Browse', { ns: 'chat' });
  if (lower === 'message') return t('Message', { ns: 'chat' });
  return localName.replace(/_+/g, ' ').trim();
}

/**
 * Map a tool name to a short human-readable activity phrase for the header.
 * Returns a localized label like "Running command" or "Reading file".
 */
export function formatToolActivity(
  name: string,
  t: Translate,
): string {
  const lower = name.toLowerCase();
  if (lower === 'exec' || lower === 'bash') return t('Running command', { ns: 'chat' });
  if (lower === 'read' || lower === 'read_file') return t('Reading file', { ns: 'chat' });
  if (lower === 'write' || lower === 'edit' || lower === 'apply_patch' || lower === 'write_file' || lower === 'edit_file') return t('Writing file', { ns: 'chat' });
  if (lower === 'web_search') return t('Searching web', { ns: 'chat' });
  if (lower === 'web_fetch') return t('Web fetching', { ns: 'chat' });
  if (lower === 'browser') return t('Browsing', { ns: 'chat' });
  if (lower === 'message') return t('Messaging', { ns: 'chat' });
  return t('Using {{toolName}}', { ns: 'chat', toolName: name });
}

/** Strip status wrapper (Running/Failed/Completed) from a tool summary. */
export function stripToolStatusPrefix(summary: string, t?: Translate): string {
  const trimmed = summary.trim();
  // Always try English prefixes first (legacy/cached summaries)
  const englishStripped = trimmed.replace(/^(Running|Failed|Completed)\s+/i, '');
  if (englishStripped !== trimmed) return englishStripped;
  if (!t) return trimmed;
  // Try stripping localized status wrappers by rendering a placeholder
  // through the template and removing the surrounding text.
  const placeholder = '\x00';
  const localizedWrappers = [
    t('Running {{name}}', { ns: 'chat', name: placeholder }),
    t('Failed {{name}}', { ns: 'chat', name: placeholder }),
    t('Completed {{name}}', { ns: 'chat', name: placeholder }),
  ];
  for (const wrapped of localizedWrappers) {
    const idx = wrapped.indexOf(placeholder);
    if (idx < 0) continue;
    const before = wrapped.slice(0, idx);
    const after = wrapped.slice(idx + placeholder.length);
    const matchesBefore = !before || trimmed.startsWith(before);
    const matchesAfter = !after || trimmed.endsWith(after);
    if (matchesBefore && matchesAfter) {
      const start = before.length;
      const end = after ? trimmed.length - after.length : trimmed.length;
      if (start < end) return trimmed.slice(start, end).trim();
    }
  }
  return trimmed;
}

/**
 * Format a one-line tool summary for display.
 */
export function formatToolOneLiner(name: string, args?: unknown): string {
  return withTrimmedDetail(formatToolDisplayName(name), resolveToolDetail(name, args));
}

/** Format a one-line tool summary with localized known tool labels. */
export function formatToolOneLinerLocalized(name: string, args: unknown, t: Translate): string {
  return withTrimmedDetail(formatToolDisplayName(name, t), resolveToolDetail(name, args));
}
