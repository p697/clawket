/** Only stable codes and server-generated IDs cross the diagnostics boundary. */
export function providerFailure(code: unknown): string {
  if (typeof code !== 'string') return 'speech_provider_failed';
  if (/throttl|rate.?limit|too.?many/i.test(code)) return 'speech_provider_busy';
  if (/auth|api.?key|forbidden|access.?denied/i.test(code)) return 'speech_provider_auth';
  if (/quota|balance|arrear|payment/i.test(code)) return 'speech_provider_quota';
  return 'speech_provider_failed';
}
export function logSpeech(requestId: string, stage: string, code: string, extra: Record<string, number> = {}) {
  console.log(JSON.stringify({ event: 'speech_session', requestId, stage, code, ...extra }));
}
