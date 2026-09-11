type RecordedGatewayListener = (payload: any) => void;

export class RecordedGateway {
  public state = 'idle';
  public connectCalls = 0;
  public disconnectCalls = 0;
  public readonly requests: Array<{ method: string; params: object }> = [];
  public readonly aborts: Array<{ key: string; runId?: string }> = [];
  public onConnect: (() => void) | undefined;
  public requestHandler: ((method: string, params: object) => unknown | Promise<unknown>) | undefined;

  private readonly listeners = new Map<string, Set<RecordedGatewayListener>>();

  public configure(_config: unknown): void {}

  public on(event: string, listener: RecordedGatewayListener): () => void {
    const listeners = this.listeners.get(event) ?? new Set<RecordedGatewayListener>();
    listeners.add(listener);
    this.listeners.set(event, listeners);
    return () => {
      listeners.delete(listener);
    };
  }

  public emit(event: string, payload: any): void {
    if (event === 'connection' && typeof payload?.state === 'string') {
      this.state = payload.state;
    }
    for (const listener of this.listeners.get(event) ?? []) listener(payload);
  }

  public connect(): void {
    this.connectCalls += 1;
    this.emit('connection', { state: 'connecting' });
    queueMicrotask(() => this.onConnect?.());
  }

  public disconnect(): void {
    this.disconnectCalls += 1;
    this.emit('connection', { state: 'closed' });
  }

  public getConnectionState(): string {
    return this.state;
  }

  public async probeConnection(): Promise<boolean> {
    return this.state === 'ready';
  }

  public async request<T>(method: string, params: object = {}): Promise<T> {
    this.requests.push({ method, params });
    return await this.requestHandler?.(method, params) as T;
  }

  public async abortChat(key: string, runId?: string): Promise<void> {
    this.aborts.push({ key, runId });
  }
}

export async function flushMicrotasks(turns = 4): Promise<void> {
  for (let index = 0; index < turns; index += 1) await Promise.resolve();
}
