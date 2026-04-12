type TraceState = {
  id: string;
  startedAt: number;
};

let activeTrace: TraceState | null = null;

export function startHermesConnectTrace(event: string, fields?: Record<string, unknown>): void {
  activeTrace = {
    id: `hc_${Date.now().toString(36)}`,
    startedAt: Date.now(),
  };
  logHermesConnect(event, fields);
}

export function markHermesConnectTrace(event: string, fields?: Record<string, unknown>): void {
  if (!activeTrace) return;
  logHermesConnect(event, fields);
}

export function finishHermesConnectTrace(event: string, fields?: Record<string, unknown>): void {
  if (!activeTrace) return;
  logHermesConnect(event, fields);
  activeTrace = null;
}

function logHermesConnect(event: string, fields?: Record<string, unknown>): void {
  if (!activeTrace) return;
  const payload = fields
    ? Object.entries(fields)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => `${key}=${String(value)}`)
      .join(' ')
    : '';
  const elapsedMs = Date.now() - activeTrace.startedAt;
  // console.log(
  //   `[hermes-connect] trace=${activeTrace.id} event=${event} elapsedMs=${elapsedMs}${payload ? ` ${payload}` : ''}`,
  // );
  void event;
  void payload;
  void elapsedMs;
}
