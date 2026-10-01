/** Validate the complete bounded request before any observation starts. */
export function sessionActivityKeys(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 32 || value.some(key => typeof key !== 'string' || !key || key.length > 200)
    || new Set(value).size !== value.length) throw new Error('Invalid session activity request');
  return value;
}
