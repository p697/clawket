/** Calendar-day queries use the phone's zone, including historical DST boundaries. */
export function usageTimeZone(now = new Date()): { mode: 'specific'; timeZone?: string; utcOffset: string } {
  const minutes = -now.getTimezoneOffset();
  const hours = Math.floor(Math.abs(minutes) / 60);
  const remainder = String(Math.abs(minutes) % 60).padStart(2, '0');
  let timeZone: string | undefined;
  try {
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    // Older runtimes retain offset support.
  }
  return { mode: 'specific', ...(timeZone ? { timeZone } : {}), utcOffset: `UTC${minutes < 0 ? '-' : '+'}${hours}:${remainder}` };
}

/** Only downgrade the IANA field when an older Gateway explicitly rejects that field. */
export async function requestLocalUsage<P extends object, R>(request: (params: P & ReturnType<typeof usageTimeZone>) => Promise<R>, params: P): Promise<R> {
  const zone = usageTimeZone();
  try {
    return await request({ ...params, ...zone });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!zone.timeZone || !/unexpected property ['"]timeZone['"]/.test(message)) throw error;
    const { timeZone: _unused, ...offset } = zone;
    return request({ ...params, ...offset });
  }
}
