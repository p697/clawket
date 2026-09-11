/** Display diagnostics locally; never send backend error text to analytics. */
export function sanitizeReplyFailure(message: string): string {
  if (typeof message !== 'string') return '';
  return message
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+\/-]+=*/gi, '[redacted]')
    .replace(/\b(?:sk-|gct_|gwt_)[A-Za-z0-9_-]+/g, '[redacted]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[redacted]')
    .replace(/((?:["']?)(?:access[_-]?token|refresh[_-]?token|api[_-]?key|client[_-]?(?:secret|token)|token|secret|password|authorization)(?:["']?)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;}]+)/gi, '$1[redacted]')
    .replace(/(?:https?|wss?):\/\/[^\s<>`]+/gi, (value) => {
      try {
        const url = new URL(value);
        url.username = ''; url.password = '';
        url.search = ''; url.hash = '';
        return url.toString();
      } catch { return '[url]'; }
    })
    .trim().slice(0, 12_000);
}

export function describeReplyFailure(raw: string, code?: string): {
  summaryKey: string;
  details: string;
} {
  const details = sanitizeReplyFailure(raw);
  const auth = /(?:oauth|model|claude|provider|credential|api.?key).*(?:expired|authenticat|unauthoriz|invalid|login)|failed to authenticate|model login expired/i.test(raw);
  const quota = /insufficient[_ ]quota|credit balance|billing|payment required|quota exceeded/i.test(raw);
  const limited = code === 'rate_limited' || /rate.?limit|too many requests|\b429\b/i.test(raw);
  return {
    summaryKey: auth
      ? 'Model authentication failed. Sign in again on your computer.'
      : quota
        ? 'The model account has insufficient credits or quota.'
        : limited
          ? 'The model is rate limited. Try again shortly.'
          : "The agent couldn't complete this reply. Please try again.",
    details,
  };
}
