import { isRecord } from './internal.js';

/** Use structured native result evidence, never keywords inside ordinary output. */
export function hermesToolResultFailed(content: unknown): boolean {
  let value = content;
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { return false; }
  }
  if (!isRecord(value)) return false;
  const exitCode = typeof value.exit_code === 'number' ? value.exit_code
    : typeof value.exit_code === 'string' && /^-?\d+$/.test(value.exit_code) ? Number(value.exit_code) : undefined;
  return (typeof exitCode === 'number' && Number.isFinite(exitCode) && exitCode !== 0)
    || value.success === false || value.is_error === true || value.isError === true
    || value.error === true || (typeof value.error === 'string' && value.error.trim().length > 0)
    || (isRecord(value.error) && Object.keys(value.error).length > 0)
    || ['error', 'failed', 'cancelled', 'interrupted', 'timeout'].includes(String(value.status ?? '').toLowerCase());
}
