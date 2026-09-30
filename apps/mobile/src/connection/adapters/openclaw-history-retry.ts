/** CLI transcript projection can temporarily reject reads after a successful final. */
export async function readRebuildingOpenClawHistory<T>(read: () => Promise<T>, isCurrent: () => boolean): Promise<T> {
  const delays = [500, 1000, 2000, 4000];
  for (let attempt = 0; ; attempt++) {
    try { return await read(); }
    catch (error) {
      // Match the native read-only rebuild signal, never general network/auth failures.
      if (!(error instanceof Error)
        || error.message !== '[UNAVAILABLE] session history is rebuilding; retry shortly'
        || attempt >= delays.length || !isCurrent()) throw error;
      await new Promise(resolve => setTimeout(resolve, delays[attempt]));
      if (!isCurrent()) throw error;
    }
  }
}
