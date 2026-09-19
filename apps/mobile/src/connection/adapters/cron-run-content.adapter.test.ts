import type { ConnectionRecord, CronRunLogEntry } from '@clawket/agent-protocol';
import type { GatewayClient } from '../protocol';
import type { ConnectionState, GatewayConfig } from '../../types';
import { HermesAdapter } from './hermes';
import { OpenClawAdapter } from './openclaw';

const BRIEF = '早。昨天周五，主站 DAU 36.5k，比七日均低了 26%。';

class FakeGateway {
  public state: ConnectionState = 'idle';
  public requests: Array<{ method: string; params: object }> = [];
  public requestHandler: ((method: string, params: object) => unknown) | undefined;
  public outputs: Array<Record<string, unknown>> = [];
  public outputDetail: Record<string, unknown> | null = null;
  public outputReads: Array<[string, string]> = [];
  private readonly listeners = new Map<string, Set<(payload: unknown) => void>>();

  public configure(_config: GatewayConfig | null): void {}
  public on(event: string, listener: (payload: unknown) => void): () => void {
    const listeners = this.listeners.get(event) ?? new Set();
    listeners.add(listener);
    this.listeners.set(event, listeners);
    return () => listeners.delete(listener);
  }
  public emit(event: string, payload: unknown): void {
    for (const listener of this.listeners.get(event) ?? []) listener(payload);
  }
  public connect(): void {}
  public disconnect(): void {}
  public setConnectRequestMeta(): void {}
  public getConnectResponseCapabilities(): readonly string[] | undefined { return undefined; }
  public getConnectResponseBridgeVersion(): string | undefined { return undefined; }
  public async probeConnection(): Promise<boolean> { return true; }
  public async request<T>(method: string, params: object = {}): Promise<T> {
    this.requests.push({ method, params });
    return this.requestHandler?.(method, params) as T;
  }
  public async abortChat(): Promise<void> {}
  public async listSessions(): Promise<unknown[]> { return []; }
  public async listAgents(): Promise<unknown> { return { defaultId: 'main', mainKey: 'agent:main:main', agents: [] }; }
  public async fetchIdentity(): Promise<unknown> { return {}; }
  public async listHermesCronOutputs(): Promise<unknown[]> { return this.outputs; }
  public async getHermesCronOutput(jobId: string, fileName: string): Promise<unknown> {
    this.outputReads.push([jobId, fileName]);
    return this.outputDetail;
  }
}

function connection(backendKind: 'openclaw' | 'hermes'): ConnectionRecord {
  return {
    id: `${backendKind}-cron`,
    backendKind,
    transportKind: backendKind === 'openclaw' ? 'relay' : 'local',
    label: backendKind,
    createdAt: 1,
    url: backendKind === 'openclaw' ? 'wss://relay.invalid/ws' : 'ws://127.0.0.1:8787',
  };
}

const runEntry: CronRunLogEntry = {
  ts: 2,
  jobId: '41230a62',
  action: 'finished',
  status: 'ok',
  sessionId: '9e1dda96',
  sessionKey: 'agent:main:cron:41230a62:run:9e1dda96',
  delivery: { messageToolSentTo: [{ channel: 'telegram', to: 'telegram:8053522863' }] },
};

const history = [
  { role: 'assistant', content: [{ type: 'toolCall', id: 'c1', name: 'tool_call', arguments: { id: 'message', args: { action: 'send', channel: 'telegram', target: '8053522863', message: BRIEF } } }] },
  { role: 'custom', customType: 'openclaw.nested-tool.v1', content: [{ type: 'toolCall', id: 'n1', name: 'message', arguments: { action: 'send', channel: 'telegram', target: '8053522863', message: BRIEF }, parentToolCallId: 'c1' }] },
  { role: 'assistant', content: [{ type: 'text', text: '已发送。' }] },
];

describe('OpenClaw cron run content', () => {
  it('reads the stable job session, not the hidden per-run key, and extracts the sent message', async () => {
    const fake = new FakeGateway();
    fake.requestHandler = (method) => (method === 'chat.history' ? { sessionId: '9e1dda96', messages: history } : {});
    const adapter = new OpenClawAdapter(connection('openclaw'), { gateway: fake as unknown as GatewayClient, historyCache: null });
    try {
      const content = await adapter.management?.cron?.runContent?.(runEntry);
      expect(fake.requests).toEqual([{ method: 'chat.history', params: { sessionKey: 'agent:main:cron:41230a62', limit: 200 } }]);
      expect(content).toEqual({
        deliveries: [{ channel: 'telegram', target: '8053522863', text: BRIEF }],
        sessionKey: 'agent:main:cron:41230a62',
      });
    } finally {
      adapter.dispose();
    }
  });

  it('returns nothing when the stable session already belongs to a newer run', async () => {
    const fake = new FakeGateway();
    fake.requestHandler = () => ({ sessionId: 'b0baab9a-newer', messages: history });
    const adapter = new OpenClawAdapter(connection('openclaw'), { gateway: fake as unknown as GatewayClient, historyCache: null });
    try {
      expect(await adapter.management?.cron?.runContent?.(runEntry)).toEqual({ deliveries: [] });
    } finally {
      adapter.dispose();
    }
  });

  it('skips the Gateway for entries without a session and tolerates history without a session id', async () => {
    const fake = new FakeGateway();
    fake.requestHandler = () => ({ messages: history });
    const adapter = new OpenClawAdapter(connection('openclaw'), { gateway: fake as unknown as GatewayClient, historyCache: null });
    try {
      expect(await adapter.management?.cron?.runContent?.({ ...runEntry, sessionKey: undefined })).toEqual({ deliveries: [] });
      expect(fake.requests).toHaveLength(0);
      // An older Gateway that omits `sessionId` still yields the transcript it has.
      const content = await adapter.management?.cron?.runContent?.(runEntry);
      expect(content?.deliveries).toHaveLength(1);
      expect(content?.sessionKey).toBe('agent:main:cron:41230a62');
    } finally {
      adapter.dispose();
    }
  });
});

describe('Hermes cron run content', () => {
  it('carries the output file on each run entry and reads its full content on demand', async () => {
    const fake = new FakeGateway();
    fake.outputs = [{
      jobId: 'digest', jobName: 'Digest', fileName: '2026-09-19T07-00.md', createdAt: 5_000, createdAtIso: null,
      status: 'ok', title: 'Digest', preview: 'Digest ran.',
    }];
    fake.outputDetail = { ...fake.outputs[0], content: '# Digest\n\nAll systems nominal.\n', path: '/home/x/.hermes/cron/output/digest/2026-09-19T07-00.md' };
    const adapter = new HermesAdapter(connection('hermes'), { gateway: fake as unknown as GatewayClient, historyCache: null });
    try {
      const runs = await adapter.management?.cron?.runs?.({ scope: 'all', limit: 10 });
      expect(runs?.entries).toEqual([expect.objectContaining({ jobId: 'digest', summary: 'Digest ran.', outputRef: '2026-09-19T07-00.md' })]);
      const content = await adapter.management?.cron?.runContent?.(runs!.entries[0]);
      expect(fake.outputReads).toEqual([['digest', '2026-09-19T07-00.md']]);
      expect(content).toEqual({ deliveries: [], output: '# Digest\n\nAll systems nominal.' });
      // A run without a stored file never asks the Bridge.
      expect(await adapter.management?.cron?.runContent?.({ ts: 1, jobId: 'digest', action: 'finished' })).toEqual({ deliveries: [] });
      expect(fake.outputReads).toHaveLength(1);
    } finally {
      adapter.dispose();
    }
  });
});
