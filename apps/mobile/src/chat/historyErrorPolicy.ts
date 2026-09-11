export function shouldSuppressHistoryLoadError(state: string): boolean {
  return state === 'connecting'
    || state === 'challenging'
    || state === 'reconnecting'
    || state === 'pairing_pending';
}
