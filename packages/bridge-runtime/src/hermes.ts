import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { homedir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import WebSocket, { WebSocketServer } from 'ws';

const DEFAULT_HERMES_API_BASE_URL = 'http://127.0.0.1:8642';
const DEFAULT_HERMES_API_HEALTH_PATH = '/health';
const DEFAULT_BRIDGE_HOST = '0.0.0.0';
const DEFAULT_BRIDGE_PORT = 4319;
const DEFAULT_SESSION_ID = 'main';
const DEFAULT_AGENT_NAME = 'Hermes';
const BRIDGE_TICK_INTERVAL_MS = 15_000;
const HEALTH_POLL_INTERVAL_MS = 10_000;
const HERMES_BOOT_TIMEOUT_MS = 20_000;
// Hermes model catalog reads can trigger a fresh models.dev fetch inside a
// one-off Python process. That is expensive enough to block bridge request
// processing, so we keep a short-lived cache for explicit catalog views while
// still refreshing eagerly after any Clawket-initiated model change.
const HERMES_MODEL_STATE_CACHE_TTL_MS = 60_000;
const SLOW_BRIDGE_REQUEST_LOG_THRESHOLD_MS = 250;
const SESSION_STORE_PATH = join(homedir(), '.clawket', 'hermes-bridge-sessions.json');
const USAGE_LEDGER_PATH = join(homedir(), '.clawket', 'hermes-usage-ledger.json');
const HERMES_STATE_DB_PATH = join(homedir(), '.hermes', 'state.db');
const DEFAULT_HERMES_SOURCE_PATH = join(homedir(), '.hermes', 'hermes-agent');
const DEFAULT_HERMES_HOME_PATH = join(homedir(), '.hermes');
const HERMES_AGENT_FILE_NAMES = ['MEMORY.md', 'USER.md'] as const;

type HermesSkillRequirementStatus = {
  bins?: string[];
  anyBins?: string[];
  env?: string[];
  config?: string[];
  os?: string[];
};

type HermesSkillConfigCheck = {
  path: string;
  label: string;
  satisfied: boolean;
};

type HermesSkillInstallOption = {
  id: string;
  kind: 'brew' | 'node' | 'go' | 'uv' | 'download';
  label: string;
  bins: string[];
};

type HermesSkillStatusEntry = {
  name: string;
  description: string;
  source: string;
  bundled: boolean;
  filePath: string;
  baseDir: string;
  skillKey: string;
  primaryEnv?: string;
  emoji?: string;
  homepage?: string;
  always: boolean;
  disabled: boolean;
  blockedByAllowlist: boolean;
  eligible: boolean;
  createdAtMs?: number;
  updatedAtMs?: number;
  deletable?: boolean;
  requirements: HermesSkillRequirementStatus;
  missing: HermesSkillRequirementStatus;
  configChecks: HermesSkillConfigCheck[];
  install: HermesSkillInstallOption[];
};

type HermesSkillStatusReport = {
  workspaceDir: string;
  managedSkillsDir: string;
  skills: HermesSkillStatusEntry[];
};

type HermesSkillLinkedFiles = {
  references?: string[];
  templates?: string[];
  assets?: string[];
  scripts?: string[];
  other?: string[];
} | null;

type HermesSkillContentDetail = {
  skillKey: string;
  name: string;
  path: string;
  content: string;
  filePath?: string | null;
  fileType?: string | null;
  isBinary?: boolean;
  linkedFiles: HermesSkillLinkedFiles;
  editable: boolean;
};

type HermesBridgeSessionMessage = {
  role: 'user' | 'assistant' | 'system' | 'toolResult';
  content: string;
  ts: number;
  runId?: string;
  idempotencyKey?: string;
  toolName?: string;
  toolCallId?: string;
  isError?: boolean;
  toolArgs?: string;
  toolDurationMs?: number;
  toolStartedAt?: number;
  toolFinishedAt?: number;
};

type HermesBridgeSession = {
  key: string;
  sessionId: string;
  title: string;
  updatedAt: number;
  messages: HermesBridgeSessionMessage[];
};

type HermesSessionListEntry = {
  key: string;
  sessionId: string;
  title: string;
  label: string;
  updatedAt: number;
  lastMessagePreview: string;
  channel?: string;
  model?: string;
  modelProvider?: string;
  contextTokens?: number;
};

type HermesHistoryMessage = {
  role: string;
  content: unknown;
  timestamp: number;
  runId?: string;
  idempotencyKey?: string;
  toolName?: string;
  toolCallId?: string;
  isError?: boolean;
  toolArgs?: string;
  toolDurationMs?: number;
  toolStartedAt?: number;
  toolFinishedAt?: number;
  model?: string;
  provider?: string;
};

function normalizeHermesHistoryContent(content: unknown): string {
  if (typeof content === 'string') {
    return content.replace(/\s+/g, ' ').trim();
  }
  if (Array.isArray(content)) {
    return content
      .map((entry) => {
        if (!isRecord(entry)) return '';
        const type = readString(entry.type)?.toLowerCase();
        if (type === 'text') {
          return readString(entry.text) || '';
        }
        if (type === 'toolcall') {
          return JSON.stringify({
            type,
            id: readString(entry.id) || null,
            name: readString(entry.name) || null,
            arguments: entry.arguments ?? null,
          });
        }
        return '';
      })
      .filter(Boolean)
      .join('\n')
      .replace(/\s+/g, ' ')
      .trim();
  }
  return '';
}

function isDuplicateHermesHistoryMessage(
  localMessage: HermesBridgeSessionMessage,
  nativeMessages: HermesHistoryMessage[],
): boolean {
  if (localMessage.role === 'assistant') {
    const localContent = normalizeHermesHistoryContent(localMessage.content);
    if (!localContent) return false;
    return nativeMessages.some((nativeMessage) => (
      nativeMessage.role === 'assistant'
      && normalizeHermesHistoryContent(nativeMessage.content) === localContent
    ));
  }

  if (localMessage.role === 'toolResult') {
    return nativeMessages.some((nativeMessage) => (
      nativeMessage.role === 'toolResult'
      && (
        (
          !!localMessage.toolCallId
          && !!nativeMessage.toolCallId
          && nativeMessage.toolCallId === localMessage.toolCallId
        )
        || (
          (nativeMessage.toolName ?? '') === (localMessage.toolName ?? '')
          && normalizeHermesHistoryContent(nativeMessage.content) === normalizeHermesHistoryContent(localMessage.content)
        )
      )
    ));
  }

  return false;
}

type HermesBridgeStoreState = {
  version: 1;
  sessions: HermesBridgeSession[];
};

type HermesBridgePersistedSession = {
  key: string;
  sessionId: string;
  title: string;
  updatedAt: number;
};

type HermesBridgePersistedState = {
  version: 1;
  sessions: HermesBridgePersistedSession[];
};

type HermesRunStartedResponse = {
  run_id?: string;
  status?: string;
};

type HermesBridgeRequest = {
  type?: unknown;
  id?: unknown;
  method?: unknown;
  params?: unknown;
};

type HermesLocalBridgeClient = {
  socket: WebSocket;
};

type HermesActiveRun = {
  runId: string;
  sessionKey: string;
  sessionId: string;
  abortController: AbortController;
  usageBaseline?: HermesObservedSessionUsageSnapshot | null;
};

type HermesProviderListing = {
  slug: string;
  name: string;
  isCurrent: boolean;
  models: string[];
  totalModels: number;
  source?: string;
  apiUrl?: string;
};

type HermesModelDescriptor = {
  id: string;
  name: string;
  provider: string;
};

type HermesModelState = {
  currentModel: string;
  currentProvider: string;
  currentBaseUrl: string;
  providers: HermesProviderListing[];
  models: HermesModelDescriptor[];
};

type HermesCurrentModelState = {
  currentModel: string;
  currentProvider: string;
  currentBaseUrl: string;
  note?: string | null;
};

type HermesModelSetResult = {
  ok: boolean;
  scope: 'global';
  currentModel: string;
  currentProvider: string;
  currentBaseUrl: string;
  models: HermesModelDescriptor[];
  providers: HermesProviderListing[];
  note?: string;
};

type HermesReasoningState = {
  effort: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
  display: boolean;
};

type HermesFastModeState = {
  enabled: boolean;
  supported: boolean;
};

type HermesCronJob = {
  id: string;
  name: string;
  prompt: string;
  skills: string[];
  skill: string | null;
  model: string | null;
  provider: string | null;
  base_url: string | null;
  script: string | null;
  schedule: {
    kind?: string;
    expr?: string;
    minutes?: number;
    run_at?: string;
    display?: string;
  };
  schedule_display: string;
  repeat: {
    times: number | null;
    completed: number;
  };
  enabled: boolean;
  state: string;
  paused_at: string | null;
  paused_reason: string | null;
  created_at: string | null;
  next_run_at: string | null;
  last_run_at: string | null;
  last_status: string | null;
  last_error: string | null;
  deliver: string;
  origin: Record<string, unknown> | null;
  last_delivery_error: string | null;
};

type HermesCronOutputEntry = {
  jobId: string;
  jobName: string;
  fileName: string;
  createdAt: number;
  createdAtIso: string | null;
  status: 'ok' | 'error' | 'unknown';
  title: string;
  preview: string;
};

type HermesCronOutputDetail = HermesCronOutputEntry & {
  content: string;
  path: string;
};

type HermesUsageTotals = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  totalCost: number;
  inputCost: number;
  outputCost: number;
  cacheReadCost: number;
  cacheWriteCost: number;
  missingCostEntries: number;
};

type HermesUsageResult = {
  updatedAt?: number;
  startDate?: string;
  endDate?: string;
  sessions?: Array<{
    key: string;
    label?: string;
    agentId?: string;
    channel?: string;
    model?: string;
    modelProvider?: string;
    updatedAt?: number;
    usage: {
      totalTokens: number;
      totalCost: number;
      costStatus?: string;
      costSource?: string;
      messageCounts?: {
        total: number;
        user: number;
        assistant: number;
        toolCalls: number;
        toolResults: number;
        errors: number;
      };
    } | null;
  }>;
  totals?: HermesUsageTotals;
  aggregates?: {
    messages: {
      total: number;
      user: number;
      assistant: number;
      toolCalls: number;
      toolResults: number;
      errors: number;
    };
    tools: {
      totalCalls: number;
      uniqueTools: number;
      tools: Array<{ name: string; count: number }>;
    };
    byModel: Array<{
      provider?: string;
      model?: string;
      count: number;
      totals: HermesUsageTotals;
    }>;
    byProvider: Array<{
      provider?: string;
      model?: string;
      count: number;
      totals: HermesUsageTotals;
    }>;
    byAgent: Array<{ agentId: string; totals: HermesUsageTotals }>;
    byChannel: Array<{ channel: string; totals: HermesUsageTotals }>;
    daily: Array<{
      date: string;
      tokens: number;
      cost: number;
      messages: number;
      toolCalls: number;
      errors: number;
    }>;
  };
  costPresentation?: {
    mode: 'currency' | 'included' | 'estimated' | 'actual' | 'unknown' | 'mixed';
    relevantSessions?: number;
    includedSessions?: number;
    estimatedSessions?: number;
    actualSessions?: number;
    unknownSessions?: number;
  };
};

type HermesCostSummary = {
  updatedAt?: number;
  days?: number;
  daily?: Array<HermesUsageTotals & { date: string }>;
  totals?: HermesUsageTotals;
  costPresentation?: HermesUsageResult['costPresentation'];
};

type HermesUsageBundle = {
  usageResult: HermesUsageResult;
  costSummary: HermesCostSummary;
};

type HermesObservedSessionUsageSnapshot = {
  sessionId: string;
  startedAtMs: number | null;
  endedAtMs: number | null;
  title: string | null;
  source: string | null;
  model: string | null;
  billingProvider: string | null;
  costStatus: string | null;
  costSource: string | null;
  totals: HermesUsageTotals;
};

type HermesUsageLedgerSessionEntry = {
  key: string;
  label: string;
  agentId: string;
  channel?: string;
  model?: string;
  modelProvider?: string;
  costStatus?: string;
  costSource?: string;
  updatedAt: number;
  totals: HermesUsageTotals;
};

type HermesUsageLedgerDayRecord = {
  date: string;
  sessions: Record<string, HermesUsageLedgerSessionEntry>;
};

type HermesUsageLedgerSnapshotRecord = {
  sessionId: string;
  key: string;
  label: string;
  agentId: string;
  channel?: string;
  model?: string;
  modelProvider?: string;
  costStatus?: string;
  costSource?: string;
  updatedAt: number;
  startedAtMs?: number;
  totals: HermesUsageTotals;
};

type HermesUsageLedgerPersistedState = {
  version: 1;
  snapshots: Record<string, HermesUsageLedgerSnapshotRecord>;
  days: Record<string, HermesUsageLedgerDayRecord>;
};

export type HermesLocalBridgeSnapshot = {
  running: boolean;
  prewarmComplete: boolean;
  bridgeUrl: string;
  wsUrl: string;
  hermesApiBaseUrl: string;
  hermesApiReachable: boolean;
  clientCount: number;
  sessionCount: number;
  lastError: string | null;
  lastUpdatedMs: number;
};

export type HermesLocalBridgeOptions = {
  host?: string;
  port?: number;
  apiBaseUrl?: string;
  apiKey?: string | null;
  bridgeToken?: string | null;
  displayName?: string | null;
  sessionStorePath?: string;
  usageLedgerPath?: string;
  hermesStateDbPath?: string;
  startHermesIfNeeded?: boolean;
  hermesCommand?: string;
  hermesSourcePath?: string;
  hermesHomePath?: string;
  keepSpawnedHermesGatewayAliveOnStop?: boolean;
  onLog?: (line: string) => void;
  onStatus?: (snapshot: HermesLocalBridgeSnapshot) => void;
};

export class HermesLocalBridge {
  private readonly host: string;
  private readonly port: number;
  private readonly apiBaseUrl: string;
  private readonly apiKey: string | null;
  private readonly bridgeToken: string;
  private readonly displayName: string;
  private readonly hermesSourcePath: string;
  private readonly hermesHomePath: string;
  private readonly hermesPythonPath: string;
  private readonly sessionStore: HermesBridgeSessionStore;
  private readonly usageLedger: HermesUsageLedgerStore;
  private readonly clients = new Set<HermesLocalBridgeClient>();
  private readonly activeRuns = new Map<string, HermesActiveRun>();
  private readonly snapshot: HermesLocalBridgeSnapshot;
  private httpServer: HttpServer | null = null;
  private wsServer: WebSocketServer | null = null;
  private tickTimer: NodeJS.Timeout | null = null;
  private healthTimer: NodeJS.Timeout | null = null;
  private hermesChild: ChildProcess | null = null;
  private modelStateCache: { value: HermesModelState; expiresAt: number } | null = null;
  private readonly contextWindowCache = new Map<string, number | null>();

  constructor(private readonly options: HermesLocalBridgeOptions = {}) {
    this.host = normalizeHost(options.host);
    this.port = normalizePort(options.port);
    this.apiBaseUrl = normalizeHttpBase(options.apiBaseUrl ?? DEFAULT_HERMES_API_BASE_URL);
    this.apiKey = options.apiKey?.trim() || null;
    this.bridgeToken = options.bridgeToken?.trim() || randomUUID();
    this.displayName = options.displayName?.trim() || DEFAULT_AGENT_NAME;
    this.hermesSourcePath = options.hermesSourcePath?.trim() || DEFAULT_HERMES_SOURCE_PATH;
    this.hermesHomePath = options.hermesHomePath?.trim() || DEFAULT_HERMES_HOME_PATH;
    this.hermesPythonPath = resolveHermesPythonPath(this.hermesSourcePath);
    this.sessionStore = new HermesBridgeSessionStore(options.sessionStorePath ?? SESSION_STORE_PATH);
    this.usageLedger = new HermesUsageLedgerStore(options.usageLedgerPath ?? USAGE_LEDGER_PATH);
    this.snapshot = {
      running: false,
      prewarmComplete: false,
      bridgeUrl: buildHermesBridgeHttpUrl(this.host, this.port),
      wsUrl: buildHermesBridgeWsUrl(this.host, this.port, this.bridgeToken),
      hermesApiBaseUrl: this.apiBaseUrl,
      hermesApiReachable: false,
      clientCount: 0,
      sessionCount: this.sessionStore.count(),
      lastError: null,
      lastUpdatedMs: Date.now(),
    };
  }

  getSnapshot(): HermesLocalBridgeSnapshot {
    return {
      ...this.snapshot,
    };
  }

  getBridgeToken(): string {
    return this.bridgeToken;
  }

  getHttpUrl(): string {
    return this.snapshot.bridgeUrl;
  }

  getWsUrl(): string {
    return this.snapshot.wsUrl;
  }

  async start(): Promise<void> {
    if (this.httpServer) {
      return;
    }

    this.logPerf('bridge_start_begin', {
      apiBaseUrl: this.apiBaseUrl,
      host: this.host,
      port: this.port,
    });
    const startStartedAt = Date.now();
    const hermesReady = await this.ensureHermesApiReady();
    this.httpServer = createServer((req, res) => {
      void this.handleHttpRequest(req, res);
    });
    this.wsServer = new WebSocketServer({ noServer: true });
    this.wsServer.on('connection', (socket) => {
      this.handleWsConnection(socket);
    });

    this.httpServer.on('upgrade', (req, socket, head) => {
      const pathname = readRequestPathname(req.url);
      if (pathname !== '/v1/hermes/ws') {
        socket.destroy();
        return;
      }
      if (!this.isAuthorized(req.url)) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
      this.wsServer?.handleUpgrade(req, socket, head, (ws) => {
        this.wsServer?.emit('connection', ws, req);
      });
    });

    await new Promise<void>((resolve, reject) => {
      this.httpServer?.once('error', reject);
      this.httpServer?.listen(this.port, this.host, () => {
        this.httpServer?.off('error', reject);
        resolve();
      });
    });

    this.tickTimer = setInterval(() => {
      this.broadcastEvent('tick', {});
    }, BRIDGE_TICK_INTERVAL_MS);
    this.healthTimer = setInterval(() => {
      void this.refreshHermesHealth();
    }, HEALTH_POLL_INTERVAL_MS);

    await this.refreshHermesHealth();
    await this.prewarmBridgeState();
    this.updateSnapshot({
      running: true,
      prewarmComplete: true,
      lastError: hermesReady ? null : this.snapshot.lastError,
    });
    this.logPerf('bridge_start_ready', {
      elapsedMs: Date.now() - startStartedAt,
      hermesReady,
      hermesApiReachable: this.snapshot.hermesApiReachable,
    });
    this.log(
      hermesReady
        ? `hermes bridge listening on ${this.snapshot.bridgeUrl}`
        : `hermes bridge listening on ${this.snapshot.bridgeUrl} (degraded: Hermes API not ready yet)`,
    );
  }

  async stop(): Promise<void> {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }

    this.cancelAllActiveRuns();

    for (const client of this.clients) {
      client.socket.close();
    }
    this.clients.clear();

    if (this.wsServer) {
      this.wsServer.close();
      this.wsServer = null;
    }

    if (this.httpServer) {
      await new Promise<void>((resolve) => {
        this.httpServer?.close(() => resolve());
      });
      this.httpServer = null;
    }

    if (this.hermesChild) {
      if (this.options.keepSpawnedHermesGatewayAliveOnStop === false) {
        this.hermesChild.kill('SIGTERM');
      } else {
        this.log('leaving spawned Hermes gateway running for faster reuse');
      }
      this.hermesChild = null;
    }

    this.updateSnapshot({
      running: false,
      prewarmComplete: false,
      clientCount: 0,
    });
  }

  private async ensureHermesApiReady(): Promise<boolean> {
    const startedAt = Date.now();
    if (await probeHermesApi(this.apiBaseUrl, this.apiKey)) {
      this.updateSnapshot({ hermesApiReachable: true, lastError: null });
      this.logPerf('hermes_api_probe', {
        result: 'warm',
        elapsedMs: Date.now() - startedAt,
      });
      this.log(`reusing Hermes API already running at ${this.apiBaseUrl}`);
      return true;
    }

    if (this.options.startHermesIfNeeded === false) {
      const error = `Hermes API is not reachable at ${this.apiBaseUrl}. Start Hermes gateway with API server enabled and retry.`;
      this.updateSnapshot({ hermesApiReachable: false, lastError: error });
      this.logPerf('hermes_api_probe', {
        result: 'unreachable_no_autostart',
        elapsedMs: Date.now() - startedAt,
      });
      this.log(error);
      return false;
    }

    this.logPerf('hermes_api_probe', {
      result: 'cold_start_required',
      elapsedMs: Date.now() - startedAt,
    });
    return this.startHermesGatewayProcess();
  }

  private async startHermesGatewayProcess(): Promise<boolean> {
    const command = this.options.hermesCommand?.trim() || 'hermes';
    const startedAt = Date.now();
    this.logPerf('hermes_api_cold_start_begin', {
      command,
      apiBaseUrl: this.apiBaseUrl,
    });
    this.log(`starting hermes gateway via ${command}`);
    // Hermes gateway stdout/stderr may contain prompts, assistant replies,
    // tool invocations, and other session data. Clawket must not persist
    // that content to its log files, so by default we route the child's
    // stdio to /dev/null via `stdio: 'ignore'`. Diagnostic metadata
    // (startup, health probe, exit code) is emitted via this class's own
    // `this.log()` calls and is unaffected. For local debugging, opt in
    // with `CLAWKET_HERMES_VERBOSE=1`; verbose output may contain
    // sensitive data and must not be shared.
    const verboseHermesStdio = process.env.CLAWKET_HERMES_VERBOSE === '1';
    const hermesChildEnv: NodeJS.ProcessEnv = {
      ...process.env,
      API_SERVER_ENABLED: '1',
      API_SERVER_HOST: extractHostname(this.apiBaseUrl),
      API_SERVER_PORT: String(extractPort(this.apiBaseUrl)),
    };
    // Strip the bridge token before inheriting env into hermes gateway.
    // Hermes does not need it, and we keep its blast radius minimal.
    delete hermesChildEnv.CLAWKET_HERMES_BRIDGE_TOKEN;
    this.hermesChild = spawn(command, ['gateway', 'run', '--replace'], {
      env: hermesChildEnv,
      stdio: verboseHermesStdio ? 'pipe' : 'ignore',
    });

    if (verboseHermesStdio) {
      this.log(
        'CLAWKET_HERMES_VERBOSE=1: forwarding hermes gateway stdio to bridge logs. ' +
          'Output may contain prompts, responses, and other session data; do not share these logs.',
      );
      this.hermesChild.stdout?.on('data', (chunk) => {
        const text = chunk.toString().trim();
        if (text) this.log(`[hermes] ${text}`);
      });
      this.hermesChild.stderr?.on('data', (chunk) => {
        const text = chunk.toString().trim();
        if (text) this.log(`[hermes] ${text}`);
      });
    }
    this.hermesChild.once('exit', (code) => {
      this.log(`hermes gateway exited code=${code ?? 'null'}`);
      this.hermesChild = null;
    });

    const startMs = Date.now();
    while (Date.now() - startMs < HERMES_BOOT_TIMEOUT_MS) {
      if (await probeHermesApi(this.apiBaseUrl, this.apiKey)) {
        this.updateSnapshot({ hermesApiReachable: true, lastError: null });
        this.logPerf('hermes_api_cold_start_ready', {
          elapsedMs: Date.now() - startedAt,
        });
        return true;
      }
      await delay(500);
    }

    const error = `Hermes API did not become ready within ${HERMES_BOOT_TIMEOUT_MS}ms at ${this.apiBaseUrl}.`;
    this.updateSnapshot({ hermesApiReachable: false, lastError: error });
    this.logPerf('hermes_api_cold_start_timeout', {
      elapsedMs: Date.now() - startedAt,
      timeoutMs: HERMES_BOOT_TIMEOUT_MS,
    });
    this.log(error);
    return false;
  }

  private async refreshHermesHealth(): Promise<void> {
    const reachable = await probeHermesApi(this.apiBaseUrl, this.apiKey);
    this.updateSnapshot({
      hermesApiReachable: reachable,
      lastError: reachable ? null : this.snapshot.lastError,
    });
    this.broadcastEvent('health', {
      status: reachable ? 'ok' : 'degraded',
      ts: Date.now(),
      hermesApiReachable: reachable,
      mode: 'hermes',
    });
  }

  private async prewarmBridgeState(): Promise<void> {
    const startedAt = Date.now();
    this.logPerf('bridge_prewarm_begin');
    const tasks: Array<() => void> = [
      () => {
        this.listHermesSessions(24);
      },
      () => {
        this.getHermesSessionHistory(DEFAULT_SESSION_ID, 24);
      },
      () => {
        this.readHermesModelState({ caller: 'prewarm' });
      },
    ];

    await Promise.allSettled(tasks.map(async (task) => {
      try {
        task();
      } catch (error) {
        this.log(`bridge prewarm skipped: ${formatError(error)}`);
      }
    }));
    this.logPerf('bridge_prewarm_done', {
      elapsedMs: Date.now() - startedAt,
    });
  }

  private async handleHttpRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const pathname = readRequestPathname(req.url);
    if (req.method === 'GET' && (pathname === '/health' || pathname === '/v1/hermes/health')) {
      const reachable = await probeHermesApi(this.apiBaseUrl, this.apiKey);
      this.writeJson(res, 200, {
        ok: true,
        running: this.snapshot.running,
        prewarmComplete: this.snapshot.prewarmComplete,
        status: reachable ? 'ok' : 'degraded',
        bridgeUrl: this.snapshot.bridgeUrl,
        wsPath: '/v1/hermes/ws',
        hermesApiBaseUrl: this.apiBaseUrl,
        hermesApiReachable: reachable,
      });
      return;
    }

    this.writeJson(res, 404, {
      error: {
        code: 'not_found',
        message: 'Hermes bridge endpoint was not found.',
      },
    });
  }

  private handleWsConnection(socket: WebSocket): void {
    const client: HermesLocalBridgeClient = { socket };
    this.clients.add(client);
    this.updateSnapshot({ clientCount: this.clients.size });

    socket.on('message', (raw) => {
      void this.handleWsMessage(client, raw);
    });
    socket.on('close', () => {
      this.clients.delete(client);
      this.updateSnapshot({ clientCount: this.clients.size });
    });

    this.sendEvent(socket, 'health', {
      status: this.snapshot.hermesApiReachable ? 'ok' : 'degraded',
      ts: Date.now(),
      hermesApiReachable: this.snapshot.hermesApiReachable,
      mode: 'hermes',
    });
  }

  private async handleWsMessage(client: HermesLocalBridgeClient, raw: WebSocket.RawData): Promise<void> {
    let request: HermesBridgeRequest;
    try {
      request = JSON.parse(raw.toString()) as HermesBridgeRequest;
    } catch {
      this.sendError(client.socket, null, 'invalid_json', 'Failed to parse request JSON.');
      return;
    }

    if (request.type !== 'req' || typeof request.id !== 'string' || typeof request.method !== 'string') {
      this.sendError(client.socket, typeof request.id === 'string' ? request.id : null, 'invalid_request', 'Malformed request envelope.');
      return;
    }

    const startedAt = Date.now();
    try {
      const payload = await this.dispatchRequest(request.method, request.params ?? {});
      this.logSlowBridgeRequest(request.method, startedAt);
      this.sendResponse(client.socket, request.id, payload);
    } catch (error) {
      this.logSlowBridgeRequest(request.method, startedAt, error);
      this.sendError(client.socket, request.id, 'request_failed', formatError(error));
    }
  }

  private logSlowBridgeRequest(method: string, startedAt: number, error?: unknown): void {
    const elapsedMs = Date.now() - startedAt;
    if (elapsedMs < SLOW_BRIDGE_REQUEST_LOG_THRESHOLD_MS) {
      return;
    }
    const suffix = error ? ` error=${formatError(error)}` : '';
    this.log(`slow bridge request method=${method} elapsedMs=${elapsedMs}${suffix}`);
  }

  private async dispatchRequest(method: string, params: unknown): Promise<unknown> {
    const payload = isRecord(params) ? params : {};
    const shouldTracePerf = method === 'health'
      || method === 'sessions.list'
      || method === 'chat.history'
      || method === 'chat.send';
    const requestStartedAt = shouldTracePerf ? Date.now() : 0;
    switch (method) {
      case 'health':
      case 'last-heartbeat':
        return this.traceBridgeRequest(method, requestStartedAt, {
          status: this.snapshot.hermesApiReachable ? 'ok' : 'degraded',
          ts: Date.now(),
          hermesApiReachable: this.snapshot.hermesApiReachable,
        });
      case 'sessions.list':
        return this.traceBridgeRequest(method, requestStartedAt, {
          defaults: this.getHermesSessionListDefaults(),
          sessions: this.listHermesSessions(readPositiveInt(payload.limit, 100)),
        });
      case 'chat.history':
        return this.traceBridgeRequest(method, requestStartedAt, this.getHermesSessionHistory(
          readString(payload.sessionKey) || DEFAULT_SESSION_ID,
          readPositiveInt(payload.limit, 50),
        ));
      case 'chat.send':
        return this.traceBridgeRequest(method, requestStartedAt, this.handleChatSend(payload));
      case 'sessions.reset':
        this.cancelActiveRunsForSession(readString(payload.key) || DEFAULT_SESSION_ID);
        this.sessionStore.resetSession(readString(payload.key) || DEFAULT_SESSION_ID);
        this.updateSnapshot({ sessionCount: this.sessionStore.count() });
        return { ok: true, key: readString(payload.key) || DEFAULT_SESSION_ID };
      case 'sessions.delete':
        this.cancelActiveRunsForSession(readString(payload.key) || DEFAULT_SESSION_ID);
        this.sessionStore.deleteSession(readString(payload.key) || DEFAULT_SESSION_ID);
        this.updateSnapshot({ sessionCount: this.sessionStore.count() });
        return { ok: true, key: readString(payload.key) || DEFAULT_SESSION_ID };
      case 'sessions.patch':
        return this.patchHermesSession(readString(payload.key) || DEFAULT_SESSION_ID, readString(payload.label));
      case 'chat.abort':
        return this.handleChatAbort(payload);
      case 'agents.list':
        return {
          defaultId: 'main',
          mainKey: DEFAULT_SESSION_ID,
          agents: [
            {
              id: 'main',
              name: this.displayName,
              identity: {
                name: this.displayName,
              },
            },
          ],
        };
      case 'agent.identity.get':
        return {
          name: this.displayName,
        };
      case 'agents.files.list':
        return {
          files: this.listHermesAgentFiles(readString(payload.agentId) || 'main'),
        };
      case 'agents.files.get':
        return {
          file: this.getHermesAgentFile(
            readString(payload.agentId) || 'main',
            readString(payload.name),
          ),
        };
      case 'agents.files.set':
        this.setHermesAgentFile(
          readString(payload.agentId) || 'main',
          readString(payload.name),
          readString(payload.content) ?? '',
        );
        return { ok: true };
      case 'skills.status':
        return this.getHermesSkillsStatus(readString(payload.agentId) || 'main');
      case 'skills.get':
        return this.getHermesSkillDetail(
          readString(payload.agentId) || 'main',
          readString(payload.skillKey),
          readString(payload.filePath),
        );
      case 'skills.update':
        return this.updateHermesSkill(readString(payload.agentId) || 'main', payload);
      case 'skills.delete':
        return this.deleteHermesSkill(
          readString(payload.agentId) || 'main',
          readString(payload.skillKey),
        );
      case 'skills.content.update':
        return this.updateHermesSkillContent(
          readString(payload.agentId) || 'main',
          readString(payload.skillKey),
          readString(payload.content) ?? '',
        );
      case 'sessions.usage':
        return this.readHermesUsageBundle(payload).usageResult;
      case 'usage.cost':
        return this.readHermesUsageBundle(payload).costSummary;
      case 'models.list':
        return {
          models: this.readHermesModelState({ caller: 'models.list' }).models,
        };
      case 'model.current':
        return this.readHermesCurrentModelState();
      case 'model.get':
        return this.readHermesModelState({ caller: 'model.get' });
      case 'model.set':
        return this.setHermesModel(payload);
      case 'hermes.reasoning.get':
        return this.getHermesReasoningPayload();
      case 'hermes.reasoning.set':
        return this.setHermesReasoningPayload(payload);
      case 'hermes.fast.get':
        return this.getHermesFastModePayload();
      case 'hermes.fast.set':
        return this.setHermesFastModePayload(payload);
      case 'hermes.cron.jobs.list':
        return {
          jobs: await this.listHermesCronJobs(payload),
        };
      case 'hermes.cron.jobs.get':
        return {
          job: await this.getHermesCronJob(readString(payload.jobId)),
        };
      case 'hermes.cron.jobs.create':
        return {
          job: await this.createHermesCronJob(payload),
        };
      case 'hermes.cron.jobs.update':
        return {
          job: await this.updateHermesCronJob(readString(payload.jobId), payload),
        };
      case 'hermes.cron.jobs.pause':
        return {
          job: await this.pauseHermesCronJob(readString(payload.jobId)),
        };
      case 'hermes.cron.jobs.resume':
        return {
          job: await this.resumeHermesCronJob(readString(payload.jobId)),
        };
      case 'hermes.cron.jobs.run':
        return {
          job: await this.runHermesCronJob(readString(payload.jobId)),
        };
      case 'hermes.cron.jobs.remove':
        return {
          ok: await this.removeHermesCronJob(readString(payload.jobId)),
        };
      case 'hermes.cron.outputs.list':
        return {
          outputs: this.listHermesCronOutputs(payload),
        };
      case 'hermes.cron.outputs.get':
        return {
          output: this.getHermesCronOutput(readString(payload.jobId), readString(payload.fileName)),
        };
      default:
        throw new Error(`Unsupported Hermes bridge method: ${method}`);
    }
  }

  private async traceBridgeRequest<T>(method: string, startedAt: number, value: T | Promise<T>): Promise<T> {
    const result = await value;
    if (startedAt > 0) {
      this.logPerf('bridge_request', {
        method,
        elapsedMs: Date.now() - startedAt,
      });
    }
    return result;
  }

  private async handleChatSend(payload: Record<string, unknown>): Promise<{ runId: string }> {
    const sessionKey = readString(payload.sessionKey) || DEFAULT_SESSION_ID;
    const text = readString(payload.message);
    const idempotencyKey = readString(payload.idempotencyKey);
    if (!text) {
      throw new Error('chat.send requires a non-empty message.');
    }

    if (isModelCommand(text)) {
      return this.handleModelCommand(sessionKey, text, idempotencyKey || undefined);
    }

    if (isThinkingCommand(text)) {
      return this.handleThinkingCommand(sessionKey, text, idempotencyKey || undefined);
    }

    if (isReasoningCommand(text)) {
      return this.handleReasoningCommand(sessionKey, text, idempotencyKey || undefined);
    }

    if (isFastCommand(text)) {
      return this.handleFastCommand(sessionKey, text, idempotencyKey || undefined);
    }

    const session = this.sessionStore.ensureSession(sessionKey);
    this.sessionStore.appendMessage(sessionKey, {
      role: 'user',
      content: text,
      ts: Date.now(),
      idempotencyKey: idempotencyKey || undefined,
    });
    this.updateSnapshot({ sessionCount: this.sessionStore.count() });

    const startResponse = await fetch(`${this.apiBaseUrl}/v1/runs`, {
      method: 'POST',
      headers: buildHermesApiHeaders(this.apiKey),
      body: JSON.stringify({
        input: text,
        conversation_history: session.messages.map((message) => ({
          role: message.role,
          content: message.content,
        })),
        session_id: session.sessionId,
      }),
    });
    if (!startResponse.ok) {
      const textBody = await startResponse.text();
      throw new Error(`Hermes /v1/runs failed (${startResponse.status}): ${summarizeText(textBody)}`);
    }

    const runPayload = await startResponse.json() as HermesRunStartedResponse;
    const runId = runPayload.run_id?.trim();
    if (!runId) {
      throw new Error('Hermes /v1/runs did not return a run_id.');
    }

    const usageBaseline = this.readHermesSessionUsageSnapshot(session.sessionId);
    const abortController = new AbortController();
    this.activeRuns.set(runId, {
      runId,
      sessionKey,
      sessionId: session.sessionId,
      abortController,
      usageBaseline,
    });
    this.sendAgentLifecycleStart(runId, sessionKey);
    void this.streamRunEvents(runId, sessionKey, session.sessionId, Date.now(), abortController.signal);
    return { runId };
  }

  private listHermesSessions(limit: number): HermesSessionListEntry[] {
    const nativeSessions = this.readHermesNativeSessions(Math.max(limit, this.sessionStore.count() + 16));
    for (const session of nativeSessions) {
      this.sessionStore.upsertSessionMeta({
        key: session.key,
        sessionId: session.sessionId,
        title: session.title,
        updatedAt: session.updatedAt,
      });
    }

    const localSessions = this.sessionStore.listSessions(Math.max(limit, nativeSessions.length + this.sessionStore.count() + 4));
    const merged = new Map<string, HermesSessionListEntry>();

    for (const session of nativeSessions) {
      merged.set(session.key, session);
    }

    for (const session of localSessions) {
      const existing = merged.get(session.key);
      if (!existing) {
        merged.set(session.key, session);
        continue;
      }
      const preferLocalPreview = session.updatedAt > existing.updatedAt && session.lastMessagePreview.trim().length > 0;
      merged.set(session.key, {
        ...existing,
        updatedAt: Math.max(existing.updatedAt, session.updatedAt),
        lastMessagePreview: preferLocalPreview
          ? session.lastMessagePreview
          : (existing.lastMessagePreview || session.lastMessagePreview),
      });
    }

    return [...merged.values()]
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, limit);
  }

  private getHermesSessionHistory(
    key: string,
    limit: number,
  ): {
    messages: HermesHistoryMessage[];
    sessionId: string;
    thinkingLevel: string;
  } {
    const native = this.readHermesNativeHistory(key, limit);
    const thinkingLevel = this.getHermesThinkingLevel();
    if (!native) {
      return {
        ...this.sessionStore.getHistory(key, limit),
        thinkingLevel,
      };
    }

    this.sessionStore.upsertSessionMeta({
      key,
      sessionId: native.sessionId,
      title: native.title,
      updatedAt: native.updatedAt,
    });

    const localSession = this.sessionStore.findSession(key);
    const lastNativeTimestamp = native.messages.at(-1)?.timestamp ?? 0;
    const appendedLocalMessages = (localSession?.messages ?? [])
      .filter((message) => message.ts > lastNativeTimestamp)
      .filter((message) => !isDuplicateHermesHistoryMessage(message, native.messages))
      .map((message) => ({
        role: message.role,
        content: message.content,
        timestamp: message.ts,
        runId: message.runId,
        idempotencyKey: message.idempotencyKey,
        toolName: message.toolName,
        toolCallId: message.toolCallId,
        isError: message.isError,
        toolArgs: message.toolArgs,
        toolDurationMs: message.toolDurationMs,
        toolStartedAt: message.toolStartedAt,
        toolFinishedAt: message.toolFinishedAt,
      }));

    const mergedMessages = [...native.messages, ...appendedLocalMessages];
    const trimmedMessages = limit > 0 ? mergedMessages.slice(-limit) : mergedMessages;
    return {
      messages: trimmedMessages,
      sessionId: native.sessionId,
      thinkingLevel,
    };
  }

  private patchHermesSession(key: string, label: string | null | undefined): { ok: true; key: string } {
    if (!this.updateHermesNativeSessionTitle(key, label)) {
      const session = this.sessionStore.findSession(key);
      if (session && label && label.trim()) {
        this.sessionStore.upsertSessionMeta({
          key,
          sessionId: session.sessionId,
          title: label.trim(),
          updatedAt: Date.now(),
        });
      }
    }
    return { ok: true, key };
  }

  private readHermesNativeSessions(limit: number): HermesSessionListEntry[] {
    const stateDbPath = this.getHermesStateDbPath();
    if (!existsSync(stateDbPath)) {
      return [];
    }

    try {
      const raw = JSON.stringify(this.runHermesPython<unknown>(
        [
          'import json, sqlite3',
          'from hermes_cli.config import load_config',
          'payload = json.loads(input() or "{}")',
          'db_path = str(payload.get("dbPath") or "")',
          'limit = int(payload.get("limit") or 1)',
          'cfg = load_config() or {}',
          'model_cfg = cfg.get("model") if isinstance(cfg.get("model"), dict) else {}',
          'current_model = str(model_cfg.get("default") or model_cfg.get("model") or "").strip() if isinstance(model_cfg, dict) else ""',
          'current_provider = str(model_cfg.get("provider") or "").strip() if isinstance(model_cfg, dict) else ""',
          'current_base_url = str(model_cfg.get("base_url") or "").strip() if isinstance(model_cfg, dict) else ""',
          'conn = sqlite3.connect(db_path)',
          'conn.row_factory = sqlite3.Row',
          'cur = conn.cursor()',
          'prefix = "clawket-hermes:"',
          'cur.execute("""',
          'SELECT',
          '  s.id,',
          '  s.source,',
          '  s.model,',
          '  s.billing_provider,',
          '  s.billing_base_url,',
          '  s.title,',
          '  s.started_at,',
          '  s.ended_at,',
          '  COALESCE((',
          '    SELECT MAX(m.timestamp)',
          '    FROM messages m',
          '    WHERE m.session_id = s.id',
          '  ), s.ended_at, s.started_at, 0) AS updated_ts,',
          '  COALESCE((',
          '    SELECT m.content',
          '    FROM messages m',
          '    WHERE m.session_id = s.id',
          '      AND m.content IS NOT NULL',
          '      AND TRIM(m.content) != ""',
          '    ORDER BY m.timestamp DESC, m.id DESC',
          '    LIMIT 1',
          '  ), "") AS last_message_preview',
          'FROM sessions s',
          'ORDER BY updated_ts DESC, s.started_at DESC',
          'LIMIT ?',
          '""", (limit,))',
          'rows = []',
          'for row in cur.fetchall():',
          '    session_id = str(row["id"] or "")',
          '    key = session_id[len(prefix):] if session_id.startswith(prefix) else session_id',
          '    title = str(row["title"] or "").strip()',
          '    source = str(row["source"] or "").strip().lower()',
          '    is_clawket_api_session = source == "api_server" and session_id.startswith(prefix)',
          '    label = title or ("Hermes Clawket" if is_clawket_api_session else ("Hermes" if key == "main" else key))',
          '    model = str(row["model"] or current_model or "").strip()',
          '    provider = str(row["billing_provider"] or current_provider or "").strip()',
          '    base_url = str(row["billing_base_url"] or current_base_url or "").strip()',
          '    rows.append({',
          '      "key": key,',
          '      "sessionId": session_id,',
          '      "title": label,',
          '      "label": label,',
          '      "updatedAt": int(float(row["updated_ts"] or 0) * 1000),',
          '      "lastMessagePreview": str(row["last_message_preview"] or ""),',
          '      "channel": str(row["source"] or "") or None,',
          '      "model": model or None,',
          '      "modelProvider": provider or None,',
          '    })',
          'print(json.dumps(rows))',
        ].join('\n'),
        {
          dbPath: stateDbPath,
          limit: String(Math.max(1, limit)),
        },
      ));
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) {
        return [];
      }
      return parsed.flatMap((entry) => {
        if (!isRecord(entry)) return [];
        const key = readString(entry.key);
        const sessionId = readString(entry.sessionId);
        if (!key || !sessionId) return [];
        return [{
          key,
          sessionId,
          title: readString(entry.title) || key,
          label: readString(entry.label) || readString(entry.title) || key,
          updatedAt: readNumber(entry.updatedAt) ?? 0,
          lastMessagePreview: readString(entry.lastMessagePreview) || '',
          channel: readString(entry.channel) || undefined,
          model: readString(entry.model) || undefined,
          modelProvider: readString(entry.modelProvider) || undefined,
        }];
      });
    } catch {
      return [];
    }
  }

  private getHermesSessionListDefaults(): { contextTokens?: number } | undefined {
    const currentModelState = this.readHermesCurrentModelState();
    const contextTokens = this.resolveHermesContextWindow({
      model: currentModelState.currentModel,
      provider: currentModelState.currentProvider,
      baseUrl: currentModelState.currentBaseUrl,
    });
    if (!(typeof contextTokens === 'number') || !Number.isFinite(contextTokens) || contextTokens <= 0) {
      return undefined;
    }
    return { contextTokens };
  }

  private readHermesNativeHistory(
    key: string,
    limit: number,
  ): {
    sessionId: string;
    title: string;
    updatedAt: number;
    messages: HermesHistoryMessage[];
  } | null {
    const stateDbPath = this.getHermesStateDbPath();
    if (!existsSync(stateDbPath)) {
      return null;
    }

    try {
      const raw = execFileSync(
        'python3',
        [
          '-c',
          [
            'import json, sqlite3, sys',
            'db_path, requested_key, limit = sys.argv[1], sys.argv[2], int(sys.argv[3])',
            'conn = sqlite3.connect(db_path)',
            'conn.row_factory = sqlite3.Row',
            'cur = conn.cursor()',
            'prefix = "clawket-hermes:"',
            'candidates = [requested_key]',
            'prefixed = requested_key if requested_key.startswith(prefix) else f"{prefix}{requested_key}"',
            'if prefixed not in candidates:',
            '    candidates.append(prefixed)',
            'row = None',
            'for candidate in candidates:',
            '    cur.execute("""',
            '      SELECT id, source, title, model, billing_provider,',
            '             COALESCE((',
            '               SELECT MAX(m.timestamp)',
            '               FROM messages m',
            '               WHERE m.session_id = sessions.id',
            '             ), ended_at, started_at, 0) AS updated_ts',
            '      FROM sessions',
            '      WHERE id = ?',
            '      LIMIT 1',
            '    """, (candidate,))',
            '    row = cur.fetchone()',
            '    if row is not None:',
            '        break',
            'if row is None:',
            '    print("null")',
            '    raise SystemExit(0)',
            'session_id = str(row["id"] or "")',
            'title = str(row["title"] or "").strip()',
            'key = session_id[len(prefix):] if session_id.startswith(prefix) else session_id',
            'source = str(row["source"] or "").strip().lower()',
            'is_clawket_api_session = source == "api_server" and session_id.startswith(prefix)',
            'label = title or ("Hermes Clawket" if is_clawket_api_session else ("Hermes" if key == "main" else key))',
            'query_limit = limit if limit > 0 else 1000000',
            'cur.execute("""',
            '  SELECT id, role, content, tool_call_id, tool_calls, tool_name, timestamp, finish_reason',
            '  FROM (',
            '    SELECT id, role, content, tool_call_id, tool_calls, tool_name, timestamp, finish_reason',
            '    FROM messages',
            '    WHERE session_id = ?',
            '    ORDER BY timestamp DESC, id DESC',
            '    LIMIT ?',
            '  )',
            '  ORDER BY timestamp ASC, id ASC',
            '""", (session_id, query_limit))',
            'messages = []',
            'for message in cur.fetchall():',
            '    role = str(message["role"] or "")',
            '    timestamp = int(float(message["timestamp"] or 0) * 1000)',
            '    content = str(message["content"] or "")',
            '    if role == "assistant":',
            '        blocks = []',
            '        if content.strip():',
            '            blocks.append({"type": "text", "text": content})',
            '        tool_calls_raw = message["tool_calls"]',
            '        if tool_calls_raw:',
            '            try:',
            '                tool_calls = json.loads(tool_calls_raw)',
            '            except Exception:',
            '                tool_calls = []',
            '            for tool_call in tool_calls or []:',
            '                if not isinstance(tool_call, dict):',
            '                    continue',
            '                function = tool_call.get("function") or {}',
            '                arguments = function.get("arguments")',
            '                blocks.append({',
            '                    "type": "toolCall",',
            '                    "id": tool_call.get("id") or tool_call.get("call_id"),',
            '                    "name": function.get("name") or tool_call.get("name"),',
            '                    "arguments": arguments,',
            '                })',
            '        if not blocks:',
            '            continue',
            '        messages.append({',
            '            "role": "assistant",',
            '            "content": blocks if len(blocks) > 1 or any(block.get("type") == "toolCall" for block in blocks) else blocks[0].get("text", ""),',
            '            "timestamp": timestamp,',
            '            "model": str(row["model"] or "") or None,',
            '            "provider": str(row["billing_provider"] or "") or None,',
            '        })',
            '    elif role == "tool":',
            '        messages.append({',
            '            "role": "toolResult",',
            '            "content": content,',
            '            "timestamp": timestamp,',
            '            "toolCallId": message["tool_call_id"] or None,',
            '            "toolName": message["tool_name"] or None,',
            '            "isError": False,',
            '        })',
            '    elif role in ("user", "system"):',
            '        messages.append({',
            '            "role": role,',
            '            "content": content,',
            '            "timestamp": timestamp,',
            '        })',
            'payload = {',
            '    "sessionId": session_id,',
            '    "title": label,',
            '    "updatedAt": int(float(row["updated_ts"] or 0) * 1000),',
            '    "messages": messages,',
            '}',
            'print(json.dumps(payload))',
          ].join('\n'),
          stateDbPath,
          key,
          String(Math.max(0, limit)),
        ],
        {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        },
      );
      if (raw.trim() === 'null') {
        return null;
      }
      const parsed = JSON.parse(raw) as unknown;
      if (!isRecord(parsed)) {
        return null;
      }
      const sessionId = readString(parsed.sessionId);
      if (!sessionId) {
        return null;
      }
      const messagesRaw = Array.isArray(parsed.messages) ? parsed.messages : [];
      return {
        sessionId,
        title: readString(parsed.title) || key,
        updatedAt: readNumber(parsed.updatedAt) ?? 0,
        messages: messagesRaw.flatMap((entry) => {
          if (!isRecord(entry)) return [];
          const role = readString(entry.role);
          const timestamp = readNumber(entry.timestamp);
          if (!role || timestamp == null) return [];
          return [{
            role,
            content: entry.content ?? '',
            timestamp,
            toolName: readString(entry.toolName) || undefined,
            toolCallId: readString(entry.toolCallId) || undefined,
            isError: readBoolean(entry.isError) ?? undefined,
            model: readString(entry.model) || undefined,
            provider: readString(entry.provider) || undefined,
          }];
        }),
      };
    } catch {
      return null;
    }
  }

  private updateHermesNativeSessionTitle(key: string, label: string | null | undefined): boolean {
    const stateDbPath = this.getHermesStateDbPath();
    if (!existsSync(stateDbPath)) {
      return false;
    }

    try {
      const raw = execFileSync(
        'python3',
        [
          '-c',
          [
            'import sqlite3, sys',
            'db_path, requested_key, label = sys.argv[1], sys.argv[2], sys.argv[3]',
            'prefix = "clawket-hermes:"',
            'candidates = [requested_key]',
            'prefixed = requested_key if requested_key.startswith(prefix) else f"{prefix}{requested_key}"',
            'if prefixed not in candidates:',
            '    candidates.append(prefixed)',
            'conn = sqlite3.connect(db_path)',
            'cur = conn.cursor()',
            'session_id = None',
            'for candidate in candidates:',
            '    cur.execute("SELECT id FROM sessions WHERE id = ? LIMIT 1", (candidate,))',
            '    row = cur.fetchone()',
            '    if row is not None:',
            '        session_id = row[0]',
            '        break',
            'if session_id is None:',
            '    print("0")',
            '    raise SystemExit(0)',
            'next_label = label.strip() or None',
            'cur.execute("UPDATE sessions SET title = ? WHERE id = ?", (next_label, session_id))',
            'conn.commit()',
            'print("1")',
          ].join('\n'),
          stateDbPath,
          key,
          label ?? '',
        ],
        {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        },
      );
      return raw.trim() === '1';
    } catch {
      return false;
    }
  }

  private handleModelCommand(
    sessionKey: string,
    rawCommand: string,
    preferredRunId?: string,
  ): { runId: string } {
    const runId = preferredRunId || randomUUID();
    this.sendAgentLifecycleStart(runId, sessionKey);
    try {
      const responseText = this.executeModelCommand(rawCommand);
      const timestamp = Date.now();
      this.sessionStore.appendMessage(sessionKey, {
        role: 'assistant',
        content: responseText,
        ts: timestamp,
        runId,
      });
      this.updateSnapshot({ sessionCount: this.sessionStore.count() });
      this.broadcastEvent('chat', {
        runId,
        sessionKey,
        seq: 1,
        state: 'final',
        message: {
          role: 'assistant',
          content: responseText,
        },
      });
      return { runId };
    } catch (error) {
      this.sendChatError(runId, sessionKey, formatError(error));
      return { runId };
    }
  }

  private handleThinkingCommand(
    sessionKey: string,
    rawCommand: string,
    preferredRunId?: string,
  ): { runId: string } {
    const runId = preferredRunId || randomUUID();
    this.sendAgentLifecycleStart(runId, sessionKey);
    try {
      const responseText = this.executeThinkingCommand(rawCommand);
      const timestamp = Date.now();
      this.sessionStore.appendMessage(sessionKey, {
        role: 'assistant',
        content: responseText,
        ts: timestamp,
        runId,
      });
      this.updateSnapshot({ sessionCount: this.sessionStore.count() });
      this.broadcastEvent('chat', {
        runId,
        sessionKey,
        seq: 1,
        state: 'final',
        message: {
          role: 'assistant',
          content: responseText,
        },
      });
      return { runId };
    } catch (error) {
      this.sendChatError(runId, sessionKey, formatError(error));
      return { runId };
    }
  }

  private handleReasoningCommand(
    sessionKey: string,
    rawCommand: string,
    preferredRunId?: string,
  ): { runId: string } {
    const runId = preferredRunId || randomUUID();
    this.sendAgentLifecycleStart(runId, sessionKey);
    try {
      const responseText = this.executeReasoningCommand(rawCommand);
      const timestamp = Date.now();
      this.sessionStore.appendMessage(sessionKey, {
        role: 'assistant',
        content: responseText,
        ts: timestamp,
        runId,
      });
      this.updateSnapshot({ sessionCount: this.sessionStore.count() });
      this.broadcastEvent('chat', {
        runId,
        sessionKey,
        seq: 1,
        state: 'final',
        message: {
          role: 'assistant',
          content: responseText,
        },
      });
      return { runId };
    } catch (error) {
      this.sendChatError(runId, sessionKey, formatError(error));
      return { runId };
    }
  }

  private handleFastCommand(
    sessionKey: string,
    rawCommand: string,
    preferredRunId?: string,
  ): { runId: string } {
    const runId = preferredRunId || randomUUID();
    this.sendAgentLifecycleStart(runId, sessionKey);
    try {
      const responseText = this.executeFastCommand(rawCommand);
      const timestamp = Date.now();
      this.sessionStore.appendMessage(sessionKey, {
        role: 'assistant',
        content: responseText,
        ts: timestamp,
        runId,
      });
      this.updateSnapshot({ sessionCount: this.sessionStore.count() });
      this.broadcastEvent('chat', {
        runId,
        sessionKey,
        seq: 1,
        state: 'final',
        message: {
          role: 'assistant',
          content: responseText,
        },
      });
      return { runId };
    } catch (error) {
      this.sendChatError(runId, sessionKey, formatError(error));
      return { runId };
    }
  }

  private executeModelCommand(rawCommand: string): string {
    const normalizedCommand = canonicalizeHermesModelCommand(
      rawCommand,
      this.readHermesModelState({ caller: 'model.command' }).providers,
    );
    const rawArgs = normalizedCommand.replace(/^\/model\b/i, '').trim();
    if (!rawArgs) {
      const state = this.readHermesModelState({ caller: 'model.command' });
      return formatHermesModelSummary(state);
    }

    const switchPayload = this.runHermesPython<{
      ok?: boolean;
      error?: string;
      result?: {
        new_model?: string;
        target_provider?: string;
        provider_label?: string;
      };
      state?: HermesModelState;
    }>(
      [
        'import json, sys',
        'from hermes_cli.config import load_config, save_config',
        'from hermes_cli.model_switch import switch_model, parse_model_flags, list_authenticated_providers',
        'from hermes_cli.auth import _load_auth_store',
        'from hermes_cli.models import OPENROUTER_MODELS, _PROVIDER_MODELS, provider_model_ids',
        'def build_provider_listing(cfg, current_provider, max_models=50):',
        '  providers = list_authenticated_providers(',
        '    current_provider=current_provider,',
        '    user_providers=cfg.get("providers"),',
        '    custom_providers=cfg.get("custom_providers"),',
        '    max_models=max_models,',
        '  )',
        '  seen = set()',
        '  for provider in providers:',
        '    slug = str(provider.get("slug") or "").strip()',
        '    if not slug:',
        '      continue',
        '    seen.add(slug)',
        '    if slug == "openai-codex":',
        '      try:',
        '        live_models = list(provider_model_ids(slug) or [])',
        '      except Exception:',
        '        live_models = []',
        '      if live_models:',
        '        provider["models"] = live_models[:max_models]',
        '        provider["total_models"] = len(live_models)',
        '  try:',
        '    store = _load_auth_store() or {}',
        '  except Exception:',
        '    store = {}',
        '  credential_pool = store.get("credential_pool") if isinstance(store, dict) else {}',
        '  if not isinstance(credential_pool, dict):',
        '    credential_pool = {}',
        '  provider_names = {"openrouter": "OpenRouter", "anthropic": "Anthropic", "openai": "OpenAI"}',
        '  for slug, entries in credential_pool.items():',
        '    if slug in seen or not isinstance(entries, list) or len(entries) == 0:',
        '      continue',
        '    if slug == "openrouter":',
        '      curated = [mid for mid, _ in OPENROUTER_MODELS]',
        '    else:',
        '      try:',
        '        curated = list(provider_model_ids(slug) or [])',
        '      except Exception:',
        '        curated = []',
        '      if not curated:',
        '        curated = list(_PROVIDER_MODELS.get(slug, []))',
        '    providers.append({',
        '      "slug": slug,',
        '      "name": provider_names.get(slug) or slug.replace("-", " ").title(),',
        '      "is_current": slug == current_provider,',
        '      "is_user_defined": False,',
        '      "models": curated[:max_models],',
        '      "total_models": len(curated),',
        '      "source": "credential-pool",',
        '    })',
        '    seen.add(slug)',
        '  custom_providers = cfg.get("custom_providers") if isinstance(cfg.get("custom_providers"), list) else []',
        '  for entry in custom_providers:',
        '    if not isinstance(entry, dict):',
        '      continue',
        '    display_name = str(entry.get("name") or "").strip()',
        '    api_url = (str(entry.get("base_url") or entry.get("url") or entry.get("api") or "")).strip()',
        '    if not display_name or not api_url:',
        '      continue',
        '    slug = "custom:" + display_name.lower().replace(" ", "-")',
        '    default_model = str(entry.get("model") or entry.get("default_model") or "").strip()',
        '    existing = next((provider for provider in providers if str(provider.get("slug") or "").strip() == slug), None)',
        '    if existing is not None:',
        '      if default_model:',
        '        models = existing.get("models") if isinstance(existing.get("models"), list) else []',
        '        if default_model not in models:',
        '          models = [default_model, *models][:max_models]',
        '        existing["models"] = models',
        '        existing["total_models"] = max(int(existing.get("total_models") or 0), 1)',
        '      if not existing.get("api_url"):',
        '        existing["api_url"] = api_url',
        '      continue',
        '    providers.append({',
        '      "slug": slug,',
        '      "name": display_name,',
        '      "is_current": slug == current_provider,',
        '      "is_user_defined": True,',
        '      "models": [default_model] if default_model else [],',
        '      "total_models": 1 if default_model else 0,',
        '      "source": "user-config",',
        '      "api_url": api_url,',
        '    })',
        '    seen.add(slug)',
        '  providers.sort(key=lambda provider: (not provider.get("is_current"), -int(provider.get("total_models") or 0), str(provider.get("name") or provider.get("slug") or "")))',
        '  return providers',
        'def build_model_entries(providers, current_model, current_provider):',
        '  models = []',
        '  seen = set()',
        '  for provider in providers:',
        '    slug = str(provider.get("slug") or "").strip()',
        '    for model in provider.get("models") or []:',
        '      ref = f"{slug}/{model}" if slug and model else model',
        '      if not ref or ref in seen:',
        '        continue',
        '      seen.add(ref)',
        '      models.append({"id": str(model), "name": str(model), "provider": slug})',
        '  current_ref = f"{current_provider}/{current_model}" if current_provider and current_model else current_model',
        '  if current_ref and current_ref not in seen:',
        '    models.insert(0, {"id": str(current_model), "name": str(current_model), "provider": str(current_provider)})',
        '  return models',
        'payload = json.loads(sys.stdin.read() or "{}")',
        'cfg = load_config() or {}',
        'model_cfg = cfg.get("model", {})',
        'current_model = model_cfg.get("default", "") if isinstance(model_cfg, dict) else ""',
        'current_provider = model_cfg.get("provider", "openrouter") if isinstance(model_cfg, dict) else "openrouter"',
        'current_base_url = model_cfg.get("base_url", "") if isinstance(model_cfg, dict) else ""',
        'model_input, explicit_provider, persist_global = parse_model_flags(payload.get("raw_args", ""))',
        'result = switch_model(',
        '  raw_input=model_input,',
        '  current_provider=current_provider,',
        '  current_model=current_model,',
        '  current_base_url=current_base_url,',
        '  current_api_key="",',
        '  is_global=True,',
        '  explicit_provider=explicit_provider,',
        '  user_providers=cfg.get("providers"),',
        '  custom_providers=cfg.get("custom_providers"),',
        ')',
        'if not result.success:',
        '  print(json.dumps({"ok": False, "error": result.error_message}))',
        '  raise SystemExit(0)',
        'model_cfg = cfg.setdefault("model", {})',
        'model_cfg["default"] = result.new_model',
        'model_cfg["provider"] = result.target_provider',
        'if result.base_url:',
        '  model_cfg["base_url"] = result.base_url',
        'save_config(cfg)',
        'providers = build_provider_listing(cfg, result.target_provider, max_models=50)',
        'models = build_model_entries(providers, result.new_model, result.target_provider)',
        'state = {',
        '  "currentModel": result.new_model,',
        '  "currentProvider": result.target_provider,',
        '  "currentBaseUrl": result.base_url or "",',
        '  "providers": providers,',
        '  "models": models,',
        '}',
        'print(json.dumps({"ok": True, "result": {',
        '  "new_model": result.new_model,',
        '  "target_provider": result.target_provider,',
        '  "provider_label": result.provider_label,',
        '}, "state": state}))',
      ].join('\n'),
      { raw_args: rawArgs },
    );

    if (!switchPayload.ok) {
      throw new Error(readString(switchPayload.error) || 'Failed to switch Hermes model.');
    }

    const state = isRecord(switchPayload.state) ? normalizeHermesModelState(switchPayload.state) : null;
    const nextModel = readString(switchPayload.result?.new_model);
    const nextProvider = readString(switchPayload.result?.provider_label)
      || readString(switchPayload.result?.target_provider);

    return [
      `Model switched to ${nextModel || 'unknown'}.`,
      nextProvider ? `Provider: ${nextProvider}` : null,
      'Scope: global (future Hermes runs will use this model).',
      state ? `Current default: ${formatHermesCurrentModel(state)}` : null,
    ].filter(Boolean).join('\n');
  }

  private listHermesAgentFiles(agentId: string): Array<{
    name: string;
    path: string;
    missing: boolean;
    size?: number;
    updatedAtMs?: number;
  }> {
    this.assertSupportedHermesAgentId(agentId);
    return HERMES_AGENT_FILE_NAMES.map((name) => this.readHermesAgentFileSummary(name));
  }

  private getHermesAgentFile(
    agentId: string,
    name: string | null,
  ): {
    name: string;
    path: string;
    missing: boolean;
    size?: number;
    updatedAtMs?: number;
    content?: string;
  } {
    this.assertSupportedHermesAgentId(agentId);
    const normalizedName = this.normalizeHermesAgentFileName(name);
    const summary = this.readHermesAgentFileSummary(normalizedName);
    return {
      ...summary,
      content: summary.missing ? '' : readFileSync(summary.path, 'utf8'),
    };
  }

  private setHermesAgentFile(agentId: string, name: string | null, content: string): void {
    this.assertSupportedHermesAgentId(agentId);
    const normalizedName = this.normalizeHermesAgentFileName(name);
    const path = this.getHermesAgentFilePath(normalizedName);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, 'utf8');
  }

  private readHermesAgentFileSummary(name: (typeof HERMES_AGENT_FILE_NAMES)[number]): {
    name: string;
    path: string;
    missing: boolean;
    size?: number;
    updatedAtMs?: number;
  } {
    const path = this.getHermesAgentFilePath(name);
    if (!existsSync(path)) {
      return {
        name,
        path,
        missing: true,
      };
    }

    const stats = statSync(path);
    return {
      name,
      path,
      missing: false,
      size: stats.size,
      updatedAtMs: stats.mtimeMs,
    };
  }

  private getHermesAgentFilePath(name: (typeof HERMES_AGENT_FILE_NAMES)[number]): string {
    return join(this.hermesHomePath, 'memories', name);
  }

  private normalizeHermesAgentFileName(name: string | null): (typeof HERMES_AGENT_FILE_NAMES)[number] {
    if (name === 'MEMORY.md' || name === 'USER.md') {
      return name;
    }
    throw new Error(`Unsupported Hermes agent file: ${name || 'unknown'}.`);
  }

  private assertSupportedHermesAgentId(agentId: string): void {
    if (agentId !== 'main') {
      throw new Error(`Hermes bridge exposes memory files for the main agent only (received: ${agentId}).`);
    }
  }

  private getHermesSkillsStatus(agentId: string): HermesSkillStatusReport {
    this.assertSupportedHermesAgentId(agentId);
    return this.runHermesPython<HermesSkillStatusReport>(
      [
        'import json, os',
        'from pathlib import Path',
        'from agent.skill_utils import get_external_skills_dirs',
        'from tools.skills_tool import SKILLS_DIR, _parse_frontmatter, _get_required_environment_variables, _collect_prerequisite_values, load_env, skill_matches_platform',
        'def resolve_created_at(path: Path):',
        '  try:',
        '    stat = path.stat()',
        '  except Exception:',
        '    return None',
        '  for attr in ("st_birthtime", "st_ctime", "st_mtime"):',
        '    value = getattr(stat, attr, None)',
        '    if value is not None:',
        '      return int(float(value) * 1000)',
        '  return None',
        'def resolve_updated_at(path: Path):',
        '  latest = None',
        '  for child in path.rglob("*"):',
        '    if not child.is_file():',
        '      continue',
        '    try:',
        '      value = int(float(child.stat().st_mtime) * 1000)',
        '    except Exception:',
        '      continue',
        '    latest = value if latest is None else max(latest, value)',
        '  return latest',
        'def load_json(path: Path, default):',
        '  try:',
        '    if path.exists():',
        '      return json.loads(path.read_text(encoding="utf-8"))',
        '  except Exception:',
        '    pass',
        '  return default',
        'def load_config():',
        '  cfg_path = Path(os.environ.get("HERMES_HOME", "")) / "config.yaml"',
        '  if not cfg_path.exists():',
        '    return {}',
        '  try:',
        '    import yaml',
        '    parsed = yaml.safe_load(cfg_path.read_text(encoding="utf-8"))',
        '    return parsed if isinstance(parsed, dict) else {}',
        '  except Exception:',
        '    return {}',
        'cfg = load_config()',
        'skills_cfg = cfg.get("skills") if isinstance(cfg.get("skills"), dict) else {}',
        'disabled = {str(v).strip() for v in (skills_cfg.get("disabled") or []) if str(v).strip()}',
        'env_snapshot = load_env()',
        'dirs_to_scan = []',
        'if SKILLS_DIR.exists():',
        '  dirs_to_scan.append(SKILLS_DIR)',
        'dirs_to_scan.extend([d for d in get_external_skills_dirs() if d.exists()])',
        'seen = set()',
        'skills = []',
        'for scan_dir in dirs_to_scan:',
        '  for skill_md in scan_dir.rglob("SKILL.md"):',
        '    if any(part in {".git", ".github", ".hub"} for part in skill_md.parts):',
        '      continue',
        '    try:',
        '      content = skill_md.read_text(encoding="utf-8")',
        '      frontmatter, body = _parse_frontmatter(content)',
        '    except Exception:',
        '      continue',
        '    if not skill_matches_platform(frontmatter):',
        '      continue',
        '    skill_dir = skill_md.parent',
        '    name = str(frontmatter.get("name") or skill_dir.name).strip()',
        '    if not name or name in seen:',
        '      continue',
        '    seen.add(name)',
        '    description = str(frontmatter.get("description") or "").strip()',
        '    if not description:',
        '      for line in body.splitlines():',
        '        line = line.strip()',
        '        if line and not line.startswith("#"):',
        '          description = line',
        '          break',
        '    legacy_env, legacy_cmds = _collect_prerequisite_values(frontmatter)',
        '    required_env = _get_required_environment_variables(frontmatter, legacy_env)',
        '    required_env_names = [str(entry.get("name") or "").strip() for entry in required_env if str(entry.get("name") or "").strip()]',
        '    missing_env = [name for name in required_env_names if not str(env_snapshot.get(name) or "").strip()]',
        '    required_cmds = [str(cmd).strip() for cmd in legacy_cmds if str(cmd).strip()]',
        '    missing_cmds = []',
        '    if required_cmds:',
        '      import shutil',
        '      missing_cmds = [cmd for cmd in required_cmds if shutil.which(cmd) is None]',
        '    required_cred_files = frontmatter.get("required_credential_files") or []',
        '    if not isinstance(required_cred_files, list):',
        '      required_cred_files = []',
        '    missing_cred = []',
        '    for raw in required_cred_files:',
        '      rel = str(raw).strip()',
        '      if not rel:',
        '        continue',
        '      candidate = Path(os.path.expandvars(os.path.expanduser(rel)))',
        '      if not candidate.exists():',
        '        missing_cred.append(rel)',
        '    try:',
        '      rel_path = str(skill_md.relative_to(SKILLS_DIR))',
        '      source = "managed"',
        '    except Exception:',
        '      rel_path = str(skill_md)',
        '      source = "workspace"',
        '    created_at = resolve_created_at(skill_dir) or resolve_created_at(skill_md)',
        '    updated_at = resolve_updated_at(skill_dir) or resolve_created_at(skill_md)',
        '    requirements = {',
        '      "bins": required_cmds,',
        '      "env": required_env_names,',
        '      "config": [str(item).strip() for item in required_cred_files if str(item).strip()],',
        '      "os": [],',
        '    }',
        '    missing = {',
        '      "bins": missing_cmds,',
        '      "env": missing_env,',
        '      "config": missing_cred,',
        '      "os": [],',
        '    }',
        '    config_checks = [',
        '      {"path": env_name, "label": env_name, "satisfied": env_name not in missing_env}',
        '      for env_name in required_env_names',
        '    ]',
        '    metadata = frontmatter.get("metadata") if isinstance(frontmatter.get("metadata"), dict) else {}',
        '    hermes_meta = metadata.get("hermes") if isinstance(metadata.get("hermes"), dict) else {}',
        '    primary_env = required_env_names[0] if required_env_names else ""',
        '    skills.append({',
        '      "name": name,',
        '      "description": description,',
        '      "source": source,',
        '      "bundled": False,',
        '      "filePath": str(skill_md),',
        '      "baseDir": str(skill_dir),',
        '      "skillKey": name,',
        '      "primaryEnv": primary_env or None,',
        '      "emoji": hermes_meta.get("emoji") if isinstance(hermes_meta.get("emoji"), str) else None,',
        '      "homepage": frontmatter.get("homepage") if isinstance(frontmatter.get("homepage"), str) else None,',
        '      "always": False,',
        '      "disabled": name in disabled,',
        '      "blockedByAllowlist": False,',
        '      "eligible": (name not in disabled) and not missing_env and not missing_cmds and not missing_cred,',
        '      "createdAtMs": created_at,',
        '      "updatedAtMs": updated_at,',
        '      "deletable": source == "managed",',
        '      "requirements": requirements,',
        '      "missing": missing,',
        '      "configChecks": config_checks,',
        '      "install": [],',
        '    })',
        'skills.sort(key=lambda item: item.get("name", "").lower())',
        'print(json.dumps({',
        '  "workspaceDir": str(Path(os.environ.get("HERMES_HOME", ""))),',
        '  "managedSkillsDir": str(SKILLS_DIR),',
        '  "skills": skills,',
        '}))',
      ].join('\n'),
    );
  }

  private getHermesSkillDetail(
    agentId: string,
    skillKey: string | null,
    filePath: string | null,
  ): HermesSkillContentDetail {
    this.assertSupportedHermesAgentId(agentId);
    const normalizedSkillKey = skillKey?.trim();
    if (!normalizedSkillKey) {
      throw new Error('skills.get requires skillKey.');
    }
    const result = this.runHermesPython<HermesSkillContentDetail & {
      success?: boolean;
      error?: string;
    }>(
      [
        'import json',
        'from pathlib import Path',
        'from agent.skill_utils import get_external_skills_dirs',
        'from tools.skills_tool import SKILLS_DIR, _parse_frontmatter',
        'payload = json.loads(input() or "{}")',
        'skill_key = str(payload.get("skillKey") or "").strip()',
        'file_path = payload.get("filePath")',
        'if not skill_key:',
        '  print(json.dumps({"success": False, "error": "skills.get requires skillKey."}))',
        '  raise SystemExit(0)',
        'dirs_to_scan = []',
        'if SKILLS_DIR.exists():',
        '  dirs_to_scan.append(SKILLS_DIR)',
        'dirs_to_scan.extend([d for d in get_external_skills_dirs() if d.exists()])',
        'skill_md = None',
        'skill_dir = None',
        'for search_dir in dirs_to_scan:',
        '  direct = search_dir / skill_key',
        '  if direct.is_dir() and (direct / "SKILL.md").exists():',
        '    skill_dir = direct',
        '    skill_md = direct / "SKILL.md"',
        '    break',
        'for search_dir in dirs_to_scan if skill_md is None else []:',
        '  for found in search_dir.rglob("SKILL.md"):',
        '    if found.parent.name == skill_key:',
        '      skill_dir = found.parent',
        '      skill_md = found',
        '      break',
        '  if skill_md is not None:',
        '    break',
        'if skill_md is None or skill_dir is None or not skill_md.exists():',
        '  print(json.dumps({"success": False, "error": f"Skill \'{skill_key}\' not found."}))',
        '  raise SystemExit(0)',
        'raw_content = skill_md.read_text(encoding="utf-8")',
        'frontmatter, _ = _parse_frontmatter(raw_content)',
        'name = str(frontmatter.get("name") or skill_dir.name).strip() or skill_key',
        'linked = {"references": [], "templates": [], "assets": [], "scripts": [], "other": []}',
        'for root_name in ("references", "templates", "assets", "scripts"):',
        '  root_dir = skill_dir / root_name',
        '  if root_dir.exists():',
        '    for child in sorted(root_dir.rglob("*")):',
        '      if child.is_file():',
        '        linked[root_name].append(str(child.relative_to(skill_dir)))',
        'for child in sorted(skill_dir.rglob("*")):',
        '  if not child.is_file() or child.name == "SKILL.md":',
        '    continue',
        '  rel = str(child.relative_to(skill_dir))',
        '  if any(rel.startswith(prefix + "/") for prefix in ("references", "templates", "assets", "scripts")):',
        '    continue',
        '  linked["other"].append(rel)',
        'linked = {key: value for key, value in linked.items() if value}',
        'target_path = None',
        'editable = False',
        'content = raw_content',
        'file_type = ".md"',
        'is_binary = False',
        'if file_path:',
        '  normalized = Path(str(file_path))',
        '  if ".." in normalized.parts:',
        '    print(json.dumps({"success": False, "error": "Path traversal is not allowed."}))',
        '    raise SystemExit(0)',
        '  candidate = (skill_dir / normalized)',
        '  resolved = candidate.resolve()',
        '  if skill_dir.resolve() not in resolved.parents and resolved != skill_dir.resolve():',
        '    print(json.dumps({"success": False, "error": "Path escapes skill directory boundary."}))',
        '    raise SystemExit(0)',
        '  if not candidate.exists() or not candidate.is_file():',
        '    print(json.dumps({"success": False, "error": f"File \'{file_path}\' not found in skill \'{skill_key}\'."}))',
        '    raise SystemExit(0)',
        '  target_path = str(normalized)',
        '  editable = False',
        '  file_type = candidate.suffix or None',
        '  try:',
        '    content = candidate.read_text(encoding="utf-8")',
        '  except UnicodeDecodeError:',
        '    is_binary = True',
        '    content = f"[Binary file: {candidate.name}, size: {candidate.stat().st_size} bytes]"',
        'else:',
        '  editable = True',
        'try:',
        '  rel_path = str(skill_md.relative_to(SKILLS_DIR))',
        'except Exception:',
        '  rel_path = str(skill_md)',
        'print(json.dumps({',
        '  "success": True,',
        '  "skillKey": name,',
        '  "name": name,',
        '  "path": rel_path,',
        '  "content": content,',
        '  "filePath": target_path,',
        '  "fileType": file_type,',
        '  "isBinary": is_binary,',
        '  "linkedFiles": linked or None,',
        '  "editable": editable,',
        '}))',
      ].join('\n'),
      {
        skillKey: normalizedSkillKey,
        ...(filePath?.trim() ? { filePath: filePath.trim() } : {}),
      },
    );
    if (result.success === false) {
      throw new Error(readString(result.error) || 'Failed to load Hermes skill.');
    }
    return {
      skillKey: readString(result.skillKey) || normalizedSkillKey,
      name: readString(result.name) || normalizedSkillKey,
      path: readString(result.path) || '',
      content: readString(result.content) || '',
      filePath: readString(result.filePath),
      fileType: readString(result.fileType),
      isBinary: readBoolean(result.isBinary) ?? false,
      linkedFiles: isRecord(result.linkedFiles) ? result.linkedFiles as HermesSkillLinkedFiles : null,
      editable: readBoolean(result.editable) ?? false,
    };
  }

  private updateHermesSkill(agentId: string, payload: Record<string, unknown>): {
    ok: boolean;
    skillKey: string;
    config: Record<string, unknown>;
  } {
    this.assertSupportedHermesAgentId(agentId);
    const skillKey = readString(payload.skillKey)?.trim();
    if (!skillKey) {
      throw new Error('skills.update requires skillKey.');
    }
    const result = this.runHermesPython<{
      ok?: boolean;
      skillKey?: string;
      config?: Record<string, unknown>;
      error?: string;
    }>(
      [
        'import json',
        'from pathlib import Path',
        'from hermes_cli.config import load_config, save_config',
        'from tools.skills_tool import load_env, _find_all_skills',
        'from tools.skill_manager_tool import _find_skill',
        'payload = json.loads(input() or "{}")',
        'skill_key = str(payload.get("skillKey") or "").strip()',
        'if not skill_key:',
        '  print(json.dumps({"ok": False, "error": "skills.update requires skillKey."}))',
        '  raise SystemExit(0)',
        'cfg = load_config() or {}',
        'skills_cfg = cfg.setdefault("skills", {})',
        'disabled = {str(v).strip() for v in (skills_cfg.get("disabled") or []) if str(v).strip()}',
        'enabled = payload.get("enabled")',
        'if isinstance(enabled, bool):',
        '  if enabled:',
        '    disabled.discard(skill_key)',
        '  else:',
        '    disabled.add(skill_key)',
        '  skills_cfg["disabled"] = sorted(disabled)',
        '  save_config(cfg)',
        'skill_dir = None',
        'found = _find_skill(skill_key)',
        'if found:',
        '  skill_dir = found.get("path")',
        'env_updates = payload.get("env") if isinstance(payload.get("env"), dict) else {}',
        'api_key = payload.get("apiKey")',
        'if api_key is not None and skill_dir is not None:',
        '  skill_md = Path(skill_dir) / "SKILL.md"',
        '  primary_env = None',
        '  try:',
        '    from tools.skills_tool import _parse_frontmatter, _get_required_environment_variables, _collect_prerequisite_values',
        '    content = skill_md.read_text(encoding="utf-8")',
        '    frontmatter, _ = _parse_frontmatter(content)',
        '    legacy_env, _ = _collect_prerequisite_values(frontmatter)',
        '    required_env = _get_required_environment_variables(frontmatter, legacy_env)',
        '    primary_env = next((str(entry.get("name") or "").strip() for entry in required_env if str(entry.get("name") or "").strip()), None)',
        '  except Exception:',
        '    primary_env = None',
        '  if primary_env:',
        '    env_updates = dict(env_updates)',
        '    env_updates[primary_env] = str(api_key or "")',
        'if env_updates:',
        '  env_path = Path.home()',
        '  from hermes_constants import get_hermes_home',
        '  env_path = get_hermes_home() / ".env"',
        '  existing = load_env()',
        '  for key, value in env_updates.items():',
        '    k = str(key).strip()',
        '    if not k:',
        '      continue',
        '    v = str(value).strip()',
        '    if v:',
        '      existing[k] = v',
        '    elif k in existing:',
        '      del existing[k]',
        '  env_path.parent.mkdir(parents=True, exist_ok=True)',
        '  lines = [f"{key}={value}" for key, value in sorted(existing.items())]',
        '  env_path.write_text("\\n".join(lines) + ("\\n" if lines else ""), encoding="utf-8")',
        'print(json.dumps({"ok": True, "skillKey": skill_key, "config": {"enabled": skill_key not in disabled}}))',
      ].join('\n'),
      {
        skillKey,
        ...(payload.enabled !== undefined ? { enabled: payload.enabled } : {}),
        ...(payload.apiKey !== undefined ? { apiKey: payload.apiKey } : {}),
        ...(isRecord(payload.env) ? { env: payload.env } : {}),
      },
    );
    if (result.ok === false) {
      throw new Error(readString(result.error) || 'Failed to update Hermes skill.');
    }
    return {
      ok: result.ok ?? true,
      skillKey: readString(result.skillKey) || skillKey,
      config: isRecord(result.config) ? result.config : {},
    };
  }

  private deleteHermesSkill(
    agentId: string,
    skillKey: string | null,
  ): {
    ok: boolean;
    skillKey: string;
  } {
    this.assertSupportedHermesAgentId(agentId);
    const normalizedSkillKey = skillKey?.trim();
    if (!normalizedSkillKey) {
      throw new Error('skills.delete requires skillKey.');
    }
    const result = this.runHermesPython<{
      success?: boolean;
      ok?: boolean;
      error?: string;
    }>(
      [
        'import json',
        'from pathlib import Path',
        'from hermes_cli.config import load_config, save_config',
        'from tools.skill_manager_tool import _find_skill, skill_manage',
        'from tools.skills_tool import SKILLS_DIR',
        'payload = json.loads(input() or "{}")',
        'skill_key = str(payload.get("skillKey") or "").strip()',
        'if not skill_key:',
        '  print(json.dumps({"success": False, "error": "skills.delete requires skillKey."}))',
        '  raise SystemExit(0)',
        'found = _find_skill(skill_key)',
        'if not found or not found.get("path"):',
        '  print(json.dumps({"success": False, "error": f"Skill \'{skill_key}\' not found."}))',
        '  raise SystemExit(0)',
        'skill_path = Path(found.get("path")).resolve()',
        'managed_root = SKILLS_DIR.resolve()',
        'if managed_root not in skill_path.parents:',
        '  print(json.dumps({"success": False, "error": "Only managed Hermes skills can be deleted from Clawket."}))',
        '  raise SystemExit(0)',
        'result = json.loads(skill_manage(action="delete", name=skill_key))',
        'if result.get("success"):',
        '  cfg = load_config() or {}',
        '  skills_cfg = cfg.setdefault("skills", {})',
        '  disabled = [str(v).strip() for v in (skills_cfg.get("disabled") or []) if str(v).strip()]',
        '  if skill_key in disabled:',
        '    skills_cfg["disabled"] = [item for item in disabled if item != skill_key]',
        '    save_config(cfg)',
        'print(json.dumps(result))',
      ].join('\n'),
      { skillKey: normalizedSkillKey },
    );
    if (result.success === false || result.ok === false) {
      throw new Error(readString(result.error) || 'Failed to delete Hermes skill.');
    }
    return {
      ok: true,
      skillKey: normalizedSkillKey,
    };
  }

  private updateHermesSkillContent(
    agentId: string,
    skillKey: string | null,
    content: string,
  ): {
    ok: boolean;
    skillKey: string;
    path: string;
  } {
    this.assertSupportedHermesAgentId(agentId);
    const normalizedSkillKey = skillKey?.trim();
    if (!normalizedSkillKey) {
      throw new Error('skills.content.update requires skillKey.');
    }
    const result = this.runHermesPython<{
      success?: boolean;
      error?: string;
      path?: string;
    }>(
      [
        'import json',
        'from tools.skill_manager_tool import _find_skill, skill_manage',
        'payload = json.loads(input() or "{}")',
        'skill_key = str(payload.get("skillKey") or "").strip()',
        'content = str(payload.get("content") or "")',
        'if not skill_key:',
        '  print(json.dumps({"success": False, "error": "skills.content.update requires skillKey."}))',
        '  raise SystemExit(0)',
        'result = json.loads(skill_manage(action="edit", name=skill_key, content=content))',
        'if result.get("success"):',
        '  found = _find_skill(skill_key) or {}',
        '  result["path"] = str(found.get("path") or "")',
        'print(json.dumps(result))',
      ].join('\n'),
      {
        skillKey: normalizedSkillKey,
        content,
      },
    );
    if (result.success === false) {
      throw new Error(readString(result.error) || 'Failed to update Hermes skill content.');
    }
    return {
      ok: true,
      skillKey: normalizedSkillKey,
      path: readString(result.path) || '',
    };
  }

  private readHermesUsageBundle(payload: Record<string, unknown>): HermesUsageBundle {
    const startDate = readString(payload.startDate);
    const endDate = readString(payload.endDate);
    if (!startDate || !endDate) {
      throw new Error('Hermes usage queries require startDate and endDate.');
    }

    const stateDbPath = this.getHermesStateDbPath();
    if (!existsSync(stateDbPath)) {
      return {
        usageResult: {
          updatedAt: Date.now(),
          startDate,
          endDate,
          sessions: [],
          totals: createEmptyHermesUsageTotals(),
          aggregates: {
            messages: { total: 0, user: 0, assistant: 0, toolCalls: 0, toolResults: 0, errors: 0 },
            tools: { totalCalls: 0, uniqueTools: 0, tools: [] },
            byModel: [],
            byProvider: [],
            byAgent: [],
            byChannel: [],
            daily: [],
          },
        },
        costSummary: {
          updatedAt: Date.now(),
          days: countDateRangeDays(startDate, endDate),
          daily: [],
          totals: createEmptyHermesUsageTotals(),
        },
      };
    }

    const raw = execFileSync(
      'python3',
      [
        '-c',
        [
          'import json, sqlite3, sys',
          'db_path, start_date, end_date = sys.argv[1], sys.argv[2], sys.argv[3]',
          'conn = sqlite3.connect(db_path)',
          'conn.row_factory = sqlite3.Row',
          'cur = conn.cursor()',
          'cur.execute("""',
          'SELECT id, source, model, title, started_at, ended_at,',
          '       message_count, tool_call_count,',
          '       input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,',
          '       estimated_cost_usd, actual_cost_usd, cost_status, cost_source, billing_provider',
          'FROM sessions',
          'WHERE date(started_at, "unixepoch", "localtime") >= ?',
          '  AND date(started_at, "unixepoch", "localtime") <= ?',
          'ORDER BY started_at DESC',
          '""", (start_date, end_date))',
          'session_rows = [dict(row) for row in cur.fetchall()]',
          'session_ids = [row["id"] for row in session_rows]',
          'message_rows = []',
          'if session_ids:',
          '    placeholders = ",".join("?" for _ in session_ids)',
          '    cur.execute(f"""',
          '    SELECT m.session_id, m.role, m.content, m.tool_name, m.tool_calls, m.timestamp',
          '    FROM messages m',
          '    WHERE m.session_id IN ({placeholders})',
          '    ORDER BY m.timestamp, m.id',
          '    """, session_ids)',
          '    message_rows = [dict(row) for row in cur.fetchall()]',
          '',
          'def empty_totals():',
          '    return {',
          '        "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0,',
          '        "totalTokens": 0, "totalCost": 0.0,',
          '        "inputCost": 0.0, "outputCost": 0.0,',
          '        "cacheReadCost": 0.0, "cacheWriteCost": 0.0,',
          '        "missingCostEntries": 0,',
          '    }',
          '',
          'def allocate_cost(row):',
          '    input_tokens = int(row.get("input_tokens") or 0)',
          '    output_tokens = int(row.get("output_tokens") or 0)',
          '    cache_read_tokens = int(row.get("cache_read_tokens") or 0)',
          '    cache_write_tokens = int(row.get("cache_write_tokens") or 0)',
          '    total_tokens = input_tokens + output_tokens + cache_read_tokens + cache_write_tokens',
          '    raw_cost = row.get("actual_cost_usd")',
          '    if raw_cost is None:',
          '        raw_cost = row.get("estimated_cost_usd")',
          '    total_cost = float(raw_cost or 0.0)',
          '    allocated = {',
          '        "inputCost": 0.0, "outputCost": 0.0,',
          '        "cacheReadCost": 0.0, "cacheWriteCost": 0.0,',
          '    }',
          '    if total_cost > 0 and total_tokens > 0:',
          '        allocated["inputCost"] = total_cost * (input_tokens / total_tokens)',
          '        allocated["outputCost"] = total_cost * (output_tokens / total_tokens)',
          '        allocated["cacheReadCost"] = total_cost * (cache_read_tokens / total_tokens)',
          '        allocated["cacheWriteCost"] = total_cost * (cache_write_tokens / total_tokens)',
          '    missing = 1 if total_tokens > 0 and total_cost <= 0 and str(row.get("cost_status") or "") not in ("included", "none") else 0',
          '    return total_cost, allocated, missing',
          '',
          'def add_totals(dst, row, total_cost, allocated, missing):',
          '    dst["input"] += int(row.get("input_tokens") or 0)',
          '    dst["output"] += int(row.get("output_tokens") or 0)',
          '    dst["cacheRead"] += int(row.get("cache_read_tokens") or 0)',
          '    dst["cacheWrite"] += int(row.get("cache_write_tokens") or 0)',
          '    dst["totalTokens"] += int(row.get("input_tokens") or 0) + int(row.get("output_tokens") or 0) + int(row.get("cache_read_tokens") or 0) + int(row.get("cache_write_tokens") or 0)',
          '    dst["totalCost"] += total_cost',
          '    dst["inputCost"] += allocated["inputCost"]',
          '    dst["outputCost"] += allocated["outputCost"]',
          '    dst["cacheReadCost"] += allocated["cacheReadCost"]',
          '    dst["cacheWriteCost"] += allocated["cacheWriteCost"]',
          '    dst["missingCostEntries"] += missing',
          '',
          'messages_by_session = {}',
          'tool_counts = {}',
          'message_totals = {"total": 0, "user": 0, "assistant": 0, "toolCalls": 0, "toolResults": 0, "errors": 0}',
          'daily = {}',
          '',
          'for row in message_rows:',
          '    session_id = row.get("session_id")',
          '    messages_by_session[session_id] = messages_by_session.get(session_id, {"total": 0, "user": 0, "assistant": 0, "toolResults": 0, "errors": 0})',
          '    role = str(row.get("role") or "")',
          '    ts = float(row.get("timestamp") or 0.0)',
          '    day = ""',
          '    if ts > 0:',
          '        cur.execute(\'SELECT date(?, "unixepoch", "localtime") AS d\', (ts,))',
          '        day = (cur.fetchone()["d"] or "")',
          '    if day and day not in daily:',
          '        daily[day] = {"date": day, "tokens": 0, "cost": 0.0, "messages": 0, "toolCalls": 0, "errors": 0}',
          '    if role in ("user", "assistant", "tool"):',
          '        message_totals["total"] += 1',
          '        messages_by_session[session_id]["total"] += 1',
          '        if day:',
          '            daily[day]["messages"] += 1',
          '    if role == "user":',
          '        message_totals["user"] += 1',
          '        messages_by_session[session_id]["user"] += 1',
          '    elif role == "assistant":',
          '        message_totals["assistant"] += 1',
          '        messages_by_session[session_id]["assistant"] += 1',
          '        try:',
          '            tool_calls = json.loads(row.get("tool_calls") or "[]") if row.get("tool_calls") else []',
          '        except Exception:',
          '            tool_calls = []',
          '        for tool_call in tool_calls or []:',
          '            function = tool_call.get("function") or {}',
          '            tool_name = str(function.get("name") or "").strip()',
          '            if not tool_name:',
          '                continue',
          '            tool_counts[tool_name] = tool_counts.get(tool_name, 0) + 1',
          '            message_totals["toolCalls"] += 1',
          '            if day:',
          '                daily[day]["toolCalls"] += 1',
          '    elif role == "tool":',
          '        message_totals["toolResults"] += 1',
          '        messages_by_session[session_id]["toolResults"] += 1',
          '        tool_name = str(row.get("tool_name") or "").strip()',
          '        if tool_name and tool_name not in tool_counts:',
          '            tool_counts[tool_name] = 0',
          '        content = str(row.get("content") or "")',
          '        lowered = content.lower()',
          '        if "\\"error\\"" in lowered or lowered.startswith("error:"):',
          '            message_totals["errors"] += 1',
          '            messages_by_session[session_id]["errors"] += 1',
          '            if day:',
          '                daily[day]["errors"] += 1',
          '',
          'totals = empty_totals()',
          'cost_daily = {}',
          'by_model = {}',
          'by_provider = {}',
          'by_channel = {}',
          'sessions = []',
          'relevant_sessions = 0',
          'included_sessions = 0',
          'estimated_sessions = 0',
          'actual_sessions = 0',
          'unknown_sessions = 0',
          '',
          'for row in session_rows:',
          '    session_id = str(row.get("id") or "")',
          '    total_cost, allocated, missing = allocate_cost(row)',
          '    total_tokens = int(row.get("input_tokens") or 0) + int(row.get("output_tokens") or 0) + int(row.get("cache_read_tokens") or 0) + int(row.get("cache_write_tokens") or 0)',
          '    status = str(row.get("cost_status") or "").strip().lower()',
          '    if total_tokens > 0:',
          '        relevant_sessions += 1',
          '        if status == "included":',
          '            included_sessions += 1',
          '        elif row.get("actual_cost_usd") is not None and float(row.get("actual_cost_usd") or 0) > 0:',
          '            actual_sessions += 1',
          '        elif total_cost > 0:',
          '            estimated_sessions += 1',
          '        else:',
          '            unknown_sessions += 1',
          '    add_totals(totals, row, total_cost, allocated, missing)',
          '    session_day = ""',
          '    started_at = float(row.get("started_at") or 0.0)',
          '    if started_at > 0:',
          '        cur.execute(\'SELECT date(?, "unixepoch", "localtime") AS d\', (started_at,))',
          '        session_day = (cur.fetchone()["d"] or "")',
          '    if session_day:',
          '        entry = cost_daily.get(session_day)',
          '        if not entry:',
          '            entry = empty_totals()',
          '            entry["date"] = session_day',
          '            cost_daily[session_day] = entry',
          '        add_totals(entry, row, total_cost, allocated, missing)',
          '        if session_day not in daily:',
          '            daily[session_day] = {"date": session_day, "tokens": 0, "cost": 0.0, "messages": 0, "toolCalls": 0, "errors": 0}',
          '        daily[session_day]["tokens"] += int(row.get("input_tokens") or 0) + int(row.get("output_tokens") or 0) + int(row.get("cache_read_tokens") or 0) + int(row.get("cache_write_tokens") or 0)',
          '        daily[session_day]["cost"] += total_cost',
          '    provider = str(row.get("billing_provider") or "").strip()',
          '    model = str(row.get("model") or "").strip()',
          '    source = str(row.get("source") or "").strip()',
          '    model_key = f"{provider}|{model}"',
          '    if model_key not in by_model:',
          '        by_model[model_key] = {"provider": provider or None, "model": model or None, "count": 0, "totals": empty_totals()}',
          '    by_model[model_key]["count"] += int(row.get("message_count") or 0)',
          '    add_totals(by_model[model_key]["totals"], row, total_cost, allocated, missing)',
          '    provider_key = provider or "unknown"',
          '    if provider_key not in by_provider:',
          '        by_provider[provider_key] = {"provider": provider or None, "model": provider or None, "count": 0, "totals": empty_totals()}',
          '    by_provider[provider_key]["count"] += int(row.get("message_count") or 0)',
          '    add_totals(by_provider[provider_key]["totals"], row, total_cost, allocated, missing)',
          '    channel_key = source or "unknown"',
          '    if channel_key not in by_channel:',
          '        by_channel[channel_key] = {"channel": channel_key, "totals": empty_totals()}',
          '    add_totals(by_channel[channel_key]["totals"], row, total_cost, allocated, missing)',
          '    session_message_counts = messages_by_session.get(session_id, {"total": 0, "user": 0, "assistant": 0, "toolResults": 0, "errors": 0})',
          '    sessions.append({',
          '        "key": session_id,',
          '        "label": row.get("title") or session_id,',
          '        "agentId": "main",',
          '        "channel": source or None,',
          '        "model": model or None,',
          '        "modelProvider": provider or None,',
          '        "updatedAt": int(float(row.get("ended_at") or row.get("started_at") or 0.0) * 1000) if (row.get("ended_at") or row.get("started_at")) else None,',
          '        "usage": {',
          '            "totalTokens": total_tokens,',
          '            "totalCost": total_cost,',
          '            "costStatus": row.get("cost_status") or None,',
          '            "costSource": row.get("cost_source") or None,',
          '            "messageCounts": {',
          '                "total": session_message_counts["total"],',
          '                "user": session_message_counts["user"],',
          '                "assistant": session_message_counts["assistant"],',
          '                "toolCalls": int(row.get("tool_call_count") or 0),',
          '                "toolResults": session_message_counts["toolResults"],',
          '                "errors": session_message_counts["errors"],',
          '            },',
          '        },',
          '    })',
          '',
          'tool_entries = [{"name": name, "count": count} for name, count in sorted(tool_counts.items(), key=lambda item: (-item[1], item[0]))]',
          'daily_usage = [daily[key] for key in sorted(daily.keys())]',
          'daily_cost = [cost_daily[key] for key in sorted(cost_daily.keys())]',
          'presentation_mode = "currency"',
          'if relevant_sessions > 0:',
          '    if included_sessions == relevant_sessions:',
          '        presentation_mode = "included"',
          '    elif unknown_sessions == relevant_sessions:',
          '        presentation_mode = "unknown"',
          '    elif included_sessions > 0 and (estimated_sessions > 0 or actual_sessions > 0 or unknown_sessions > 0):',
          '        presentation_mode = "mixed"',
          '    elif actual_sessions > 0 and estimated_sessions == 0 and unknown_sessions == 0:',
          '        presentation_mode = "actual"',
          '    elif estimated_sessions > 0:',
          '        presentation_mode = "estimated"',
          'presentation = {',
          '    "mode": presentation_mode,',
          '    "relevantSessions": relevant_sessions,',
          '    "includedSessions": included_sessions,',
          '    "estimatedSessions": estimated_sessions,',
          '    "actualSessions": actual_sessions,',
          '    "unknownSessions": unknown_sessions,',
          '}',
          'payload = {',
          '    "usageResult": {',
          '        "updatedAt": __import__("time").time() * 1000,',
          '        "startDate": start_date,',
          '        "endDate": end_date,',
          '        "sessions": sessions,',
          '        "totals": totals,',
          '        "aggregates": {',
          '            "messages": message_totals,',
          '            "tools": {"totalCalls": sum(item["count"] for item in tool_entries), "uniqueTools": len(tool_entries), "tools": tool_entries},',
          '            "byModel": list(by_model.values()),',
          '            "byProvider": list(by_provider.values()),',
          '            "byAgent": [{"agentId": "main", "totals": totals}] if sessions else [],',
          '            "byChannel": list(by_channel.values()),',
          '            "daily": daily_usage,',
          '        },',
          '        "costPresentation": presentation,',
          '    },',
          '    "costSummary": {',
          '        "updatedAt": __import__("time").time() * 1000,',
          '        "days": len(daily_cost),',
          '        "daily": daily_cost,',
          '        "totals": totals,',
          '        "costPresentation": presentation,',
          '    },',
          '}',
          'print(json.dumps(payload))',
        ].join('\n'),
        stateDbPath,
        startDate,
        endDate,
      ],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    );

    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed) || !isRecord(parsed.usageResult) || !isRecord(parsed.costSummary)) {
      throw new Error('Hermes usage query returned an invalid payload.');
    }

    return mergeHermesUsageLedger(
      parsed as HermesUsageBundle,
      this.usageLedger.readRange(startDate, endDate),
    );
  }

  private getHermesStateDbPath(): string {
    return this.options.hermesStateDbPath?.trim() || join(this.hermesHomePath, 'state.db');
  }

  private recordHermesRunUsageDelta(input: {
    sessionKey: string;
    sessionId: string;
    observedAtMs: number;
    baseline: HermesObservedSessionUsageSnapshot | null;
  }): void {
    const current = this.readHermesSessionUsageSnapshot(input.sessionId);
    if (!current) return;
    this.usageLedger.recordObservation({
      sessionId: input.sessionId,
      key: input.sessionKey,
      label: current.title?.trim() || input.sessionKey,
      agentId: 'main',
      channel: current.source?.trim() || undefined,
      model: current.model?.trim() || undefined,
      modelProvider: current.billingProvider?.trim() || undefined,
      costStatus: current.costStatus?.trim() || undefined,
      costSource: current.costSource?.trim() || undefined,
      observedAtMs: input.observedAtMs,
      startedAtMs: current.startedAtMs ?? undefined,
      currentTotals: current.totals,
      baselineTotals: input.baseline?.totals ?? null,
      allowAbsoluteBootstrap: input.baseline == null && isSameLocalDate(input.observedAtMs, current.startedAtMs),
    });
  }

  private readHermesSessionUsageSnapshot(sessionId: string): HermesObservedSessionUsageSnapshot | null {
    if (!sessionId.trim()) return null;
    const stateDbPath = this.getHermesStateDbPath();
    if (!existsSync(stateDbPath)) return null;

    try {
      const raw = execFileSync(
        'python3',
        [
          '-c',
          [
            'import json, sqlite3, sys',
            'db_path, session_id = sys.argv[1], sys.argv[2]',
            'conn = sqlite3.connect(db_path)',
            'conn.row_factory = sqlite3.Row',
            'cur = conn.cursor()',
            'cur.execute("""',
            'SELECT id, source, model, title, started_at, ended_at, billing_provider, cost_status, cost_source,',
            '       input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,',
            '       estimated_cost_usd, actual_cost_usd',
            'FROM sessions',
            'WHERE id = ?',
            'LIMIT 1',
            '""", (session_id,))',
            'row = cur.fetchone()',
            'if not row:',
            '    print("null")',
            'else:',
            '    raw_cost = row["actual_cost_usd"]',
            '    if raw_cost is None:',
            '        raw_cost = row["estimated_cost_usd"]',
            '    payload = {',
            '        "sessionId": row["id"],',
            '        "startedAtMs": int(float(row["started_at"]) * 1000) if row["started_at"] is not None else None,',
            '        "endedAtMs": int(float(row["ended_at"]) * 1000) if row["ended_at"] is not None else None,',
            '        "title": row["title"],',
            '        "source": row["source"],',
            '        "model": row["model"],',
            '        "billingProvider": row["billing_provider"],',
            '        "costStatus": row["cost_status"],',
            '        "costSource": row["cost_source"],',
            '        "totals": {',
            '            "input": int(row["input_tokens"] or 0),',
            '            "output": int(row["output_tokens"] or 0),',
            '            "cacheRead": int(row["cache_read_tokens"] or 0),',
            '            "cacheWrite": int(row["cache_write_tokens"] or 0),',
            '            "totalTokens": int(row["input_tokens"] or 0) + int(row["output_tokens"] or 0) + int(row["cache_read_tokens"] or 0) + int(row["cache_write_tokens"] or 0),',
            '            "totalCost": float(raw_cost or 0.0),',
            '            "inputCost": 0.0,',
            '            "outputCost": 0.0,',
            '            "cacheReadCost": 0.0,',
            '            "cacheWriteCost": 0.0,',
            '            "missingCostEntries": 1 if (int(row["input_tokens"] or 0) + int(row["output_tokens"] or 0) + int(row["cache_read_tokens"] or 0) + int(row["cache_write_tokens"] or 0)) > 0 and float(raw_cost or 0.0) <= 0 and str(row["cost_status"] or "") not in ("included", "none") else 0,',
            '        },',
            '    }',
            '    total_tokens = payload["totals"]["totalTokens"]',
            '    total_cost = payload["totals"]["totalCost"]',
            '    if total_tokens > 0 and total_cost > 0:',
            '        payload["totals"]["inputCost"] = total_cost * (payload["totals"]["input"] / total_tokens)',
            '        payload["totals"]["outputCost"] = total_cost * (payload["totals"]["output"] / total_tokens)',
            '        payload["totals"]["cacheReadCost"] = total_cost * (payload["totals"]["cacheRead"] / total_tokens)',
            '        payload["totals"]["cacheWriteCost"] = total_cost * (payload["totals"]["cacheWrite"] / total_tokens)',
            '    print(json.dumps(payload))',
          ].join('\n'),
          stateDbPath,
          sessionId,
        ],
        {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        },
      ).trim();

      if (!raw || raw === 'null') return null;
      const parsed = JSON.parse(raw) as HermesObservedSessionUsageSnapshot;
      return parsed;
    } catch {
      return null;
    }
  }

  private readHermesModelState(options: { forceRefresh?: boolean; caller?: string } = {}): HermesModelState {
    if (!options.forceRefresh && this.modelStateCache && this.modelStateCache.expiresAt > Date.now()) {
      return this.modelStateCache.value;
    }

    const startedAt = Date.now();
    const payload = this.runHermesPython<unknown>(
      [
        'import json',
        'import time',
        'from hermes_cli.config import load_config',
        'from hermes_cli.model_switch import list_authenticated_providers',
        'from hermes_cli.auth import _load_auth_store',
        'from hermes_cli.models import OPENROUTER_MODELS, _PROVIDER_MODELS, provider_model_ids',
        'def build_provider_listing(cfg, current_provider, max_models=50):',
        '  providers = list_authenticated_providers(',
        '    current_provider=current_provider,',
        '    user_providers=cfg.get("providers"),',
        '    custom_providers=cfg.get("custom_providers"),',
        '    max_models=max_models,',
        '  )',
        '  seen = set()',
        '  for provider in providers:',
        '    slug = str(provider.get("slug") or "").strip()',
        '    if not slug:',
        '      continue',
        '    seen.add(slug)',
        '    if slug == "openai-codex":',
        '      try:',
        '        live_models = list(provider_model_ids(slug) or [])',
        '      except Exception:',
        '        live_models = []',
        '      if live_models:',
        '        provider["models"] = live_models[:max_models]',
        '        provider["total_models"] = len(live_models)',
        '  try:',
        '    store = _load_auth_store() or {}',
        '  except Exception:',
        '    store = {}',
        '  credential_pool = store.get("credential_pool") if isinstance(store, dict) else {}',
        '  if not isinstance(credential_pool, dict):',
        '    credential_pool = {}',
        '  provider_names = {"openrouter": "OpenRouter", "anthropic": "Anthropic", "openai": "OpenAI"}',
        '  for slug, entries in credential_pool.items():',
        '    if slug in seen or not isinstance(entries, list) or len(entries) == 0:',
        '      continue',
        '    if slug == "openrouter":',
        '      curated = [mid for mid, _ in OPENROUTER_MODELS]',
        '    else:',
        '      try:',
        '        curated = list(provider_model_ids(slug) or [])',
        '      except Exception:',
        '        curated = []',
        '      if not curated:',
        '        curated = list(_PROVIDER_MODELS.get(slug, []))',
        '    providers.append({',
        '      "slug": slug,',
        '      "name": provider_names.get(slug) or slug.replace("-", " ").title(),',
        '      "is_current": slug == current_provider,',
        '      "is_user_defined": False,',
        '      "models": curated[:max_models],',
        '      "total_models": len(curated),',
        '      "source": "credential-pool",',
        '    })',
        '    seen.add(slug)',
        '  custom_providers = cfg.get("custom_providers") if isinstance(cfg.get("custom_providers"), list) else []',
        '  for entry in custom_providers:',
        '    if not isinstance(entry, dict):',
        '      continue',
        '    display_name = str(entry.get("name") or "").strip()',
        '    api_url = (str(entry.get("base_url") or entry.get("url") or entry.get("api") or "")).strip()',
        '    if not display_name or not api_url:',
        '      continue',
        '    slug = "custom:" + display_name.lower().replace(" ", "-")',
        '    default_model = str(entry.get("model") or entry.get("default_model") or "").strip()',
        '    existing = next((provider for provider in providers if str(provider.get("slug") or "").strip() == slug), None)',
        '    if existing is not None:',
        '      if default_model:',
        '        models = existing.get("models") if isinstance(existing.get("models"), list) else []',
        '        if default_model not in models:',
        '          models = [default_model, *models][:max_models]',
        '        existing["models"] = models',
        '        existing["total_models"] = max(int(existing.get("total_models") or 0), 1)',
        '      if not existing.get("api_url"):',
        '        existing["api_url"] = api_url',
        '      continue',
        '    providers.append({',
        '      "slug": slug,',
        '      "name": display_name,',
        '      "is_current": slug == current_provider,',
        '      "is_user_defined": True,',
        '      "models": [default_model] if default_model else [],',
        '      "total_models": 1 if default_model else 0,',
        '      "source": "user-config",',
        '      "api_url": api_url,',
        '    })',
        '    seen.add(slug)',
        '  providers.sort(key=lambda provider: (not provider.get("is_current"), -int(provider.get("total_models") or 0), str(provider.get("name") or provider.get("slug") or "")))',
        '  return providers',
        'def build_model_entries(providers, current_model, current_provider):',
        '  models = []',
        '  seen = set()',
        '  for provider in providers:',
        '    slug = str(provider.get("slug") or "").strip()',
        '    for model in provider.get("models") or []:',
        '      ref = f"{slug}/{model}" if slug and model else model',
        '      if not ref or ref in seen:',
        '        continue',
        '      seen.add(ref)',
        '      models.append({"id": str(model), "name": str(model), "provider": slug})',
        '  current_ref = f"{current_provider}/{current_model}" if current_provider and current_model else current_model',
        '  if current_ref and current_ref not in seen:',
        '    models.insert(0, {"id": str(current_model), "name": str(current_model), "provider": str(current_provider)})',
        '  return models',
        'total_started = time.perf_counter()',
        'load_started = time.perf_counter()',
        'cfg = load_config() or {}',
        'load_finished = time.perf_counter()',
        'model_cfg = cfg.get("model", {})',
        'current_model = model_cfg.get("default", "") if isinstance(model_cfg, dict) else ""',
        'current_provider = model_cfg.get("provider", "openrouter") if isinstance(model_cfg, dict) else "openrouter"',
        'current_base_url = model_cfg.get("base_url", "") if isinstance(model_cfg, dict) else ""',
        'providers_started = time.perf_counter()',
        'providers = build_provider_listing(cfg, current_provider, max_models=50)',
        'providers_finished = time.perf_counter()',
        'models_started = time.perf_counter()',
        'models = build_model_entries(providers, current_model, current_provider)',
        'models_finished = time.perf_counter()',
        'print(json.dumps({',
        '  "currentModel": current_model,',
        '  "currentProvider": current_provider,',
        '  "currentBaseUrl": current_base_url,',
        '  "providers": providers,',
        '  "models": models,',
        '  "_debugTimings": {',
        '    "loadConfigMs": round((load_finished - load_started) * 1000, 2),',
        '    "buildProvidersMs": round((providers_finished - providers_started) * 1000, 2),',
        '    "buildModelsMs": round((models_finished - models_started) * 1000, 2),',
        '    "totalMs": round((models_finished - total_started) * 1000, 2),',
        '  },',
        '  "_debugProviderCount": len(providers),',
        '  "_debugModelCount": len(models),',
        '}))',
      ].join('\n'),
    );
    const payloadRecord = isRecord(payload) ? payload : {};
    const debugTimings = isRecord(payloadRecord._debugTimings) ? payloadRecord._debugTimings : null;
    const totalMs = Number(debugTimings?.totalMs);
    if (Number.isFinite(totalMs) && totalMs >= SLOW_BRIDGE_REQUEST_LOG_THRESHOLD_MS) {
      const loadConfigMs = Number(debugTimings?.loadConfigMs);
      const buildProvidersMs = Number(debugTimings?.buildProvidersMs);
      const buildModelsMs = Number(debugTimings?.buildModelsMs);
      const providerCount = Number(payloadRecord._debugProviderCount);
      const modelCount = Number(payloadRecord._debugModelCount);
      this.log(
        'slow model state refresh '
          + `caller=${options.caller ?? 'unknown'} `
          + `cache=${options.forceRefresh ? 'force' : 'miss'} `
          + `elapsedMs=${Date.now() - startedAt} `
          + `pythonTotalMs=${totalMs} `
          + `loadConfigMs=${Number.isFinite(loadConfigMs) ? loadConfigMs : 'n/a'} `
          + `buildProvidersMs=${Number.isFinite(buildProvidersMs) ? buildProvidersMs : 'n/a'} `
          + `buildModelsMs=${Number.isFinite(buildModelsMs) ? buildModelsMs : 'n/a'} `
          + `providers=${Number.isFinite(providerCount) ? providerCount : 'n/a'} `
          + `models=${Number.isFinite(modelCount) ? modelCount : 'n/a'}`,
      );
    }
    const state = normalizeHermesModelState(payload);
    this.modelStateCache = {
      value: state,
      expiresAt: Date.now() + HERMES_MODEL_STATE_CACHE_TTL_MS,
    };
    return state;
  }

  private resolveHermesContextWindow(input: {
    model?: string;
    provider?: string;
    baseUrl?: string;
  }): number | undefined {
    const model = input.model?.trim() || '';
    if (!model) return undefined;
    const provider = input.provider?.trim() || '';
    const baseUrl = input.baseUrl?.trim() || '';
    const cacheKey = `${provider}\u0000${baseUrl}\u0000${model}`;
    if (this.contextWindowCache.has(cacheKey)) {
      const cached = this.contextWindowCache.get(cacheKey);
      return typeof cached === 'number' ? cached : undefined;
    }

    try {
      const result = this.runHermesPython<{ contextTokens?: number | null }>(
        [
          'import json',
          'from agent.model_metadata import get_model_context_length',
          'payload = json.loads(input() or "{}")',
          'model = str(payload.get("model") or "").strip()',
          'provider = str(payload.get("provider") or "").strip()',
          'base_url = str(payload.get("baseUrl") or "").strip()',
          'if not model:',
          '  print(json.dumps({"contextTokens": None}))',
          '  raise SystemExit(0)',
          'context_tokens = None',
          'try:',
          '  context_tokens = int(get_model_context_length(',
          '    model,',
          '    base_url=base_url,',
          '    api_key="",',
          '    provider=provider,',
          '  ))',
          'except Exception:',
          '  context_tokens = None',
          'print(json.dumps({"contextTokens": context_tokens}))',
        ].join('\n'),
        { model, provider, baseUrl },
      );
      const contextTokens = typeof result?.contextTokens === 'number'
        && Number.isFinite(result.contextTokens)
        && result.contextTokens > 0
        ? result.contextTokens
        : null;
      this.contextWindowCache.set(cacheKey, contextTokens);
      return contextTokens ?? undefined;
    } catch {
      this.contextWindowCache.set(cacheKey, null);
      return undefined;
    }
  }

  private readHermesCurrentModelState(): HermesCurrentModelState {
    const payload = this.runHermesPython<unknown>(
      [
        'import json',
        'from hermes_cli.config import load_config',
        'cfg = load_config() or {}',
        'model_cfg = cfg.get("model", {})',
        'current_model = model_cfg.get("default", "") if isinstance(model_cfg, dict) else ""',
        'current_provider = model_cfg.get("provider", "openrouter") if isinstance(model_cfg, dict) else "openrouter"',
        'current_base_url = model_cfg.get("base_url", "") if isinstance(model_cfg, dict) else ""',
        'print(json.dumps({',
        '  "currentModel": current_model,',
        '  "currentProvider": current_provider,',
        '  "currentBaseUrl": current_base_url,',
        '  "note": None,',
        '}))',
      ].join('\n'),
    );

    const record = isRecord(payload) ? payload : {};
    return {
      currentModel: readString(record.currentModel) ?? '',
      currentProvider: readString(record.currentProvider) ?? '',
      currentBaseUrl: readString(record.currentBaseUrl) ?? '',
      note: readString(record.note) ?? null,
    };
  }

  private setHermesModel(payload: Record<string, unknown>): HermesModelSetResult {
    const scope = readString(payload.scope) || 'global';
    if (scope !== 'global') {
      throw new Error('Hermes bridge supports global model switching only.');
    }

    const state = this.readHermesModelState({ caller: 'model.set' });
    const providerInput = readString(payload.provider);
    const provider = providerInput
      ? canonicalizeHermesProviderSlug(providerInput, state.providers)
      : '';
    const rawModel = readString(payload.model)
      || readString(payload.modelRef)
      || readString(payload.id);
    if (!rawModel) {
      throw new Error('model.set requires a model.');
    }
    const model = rawModel.trim();

    const command = provider
      ? `/model ${model} --provider ${provider} --global`
      : `/model ${model} --global`;
    this.executeModelCommand(command);
    const nextState = this.readHermesModelState({ forceRefresh: true, caller: 'model.set' });

    return {
      ok: true,
      scope: 'global',
      currentModel: nextState.currentModel,
      currentProvider: nextState.currentProvider,
      currentBaseUrl: nextState.currentBaseUrl,
      models: nextState.models,
      providers: nextState.providers,
      note: 'Hermes model changes apply globally to future runs.',
    };
  }

  private getHermesThinkingLevel(): string {
    const state = this.readHermesReasoningState();
    return state.effort === 'none' ? 'off' : state.effort;
  }

  private getHermesReasoningPayload(): {
    level: string;
    rawLevel: string;
    showReasoning: boolean;
  } {
    const state = this.readHermesReasoningState();
    return {
      level: this.getHermesThinkingLevel(),
      rawLevel: state.effort,
      showReasoning: state.display,
    };
  }

  private setHermesReasoningPayload(payload: Record<string, unknown>): {
    level: string;
    rawLevel: string;
    showReasoning: boolean;
  } {
    const requestedLevel = normalizeThinkingLevelAlias(
      readString(payload.level)
      || readString(payload.thinkingLevel)
      || '',
    );
    const requestedShowReasoning = readBoolean(payload.showReasoning);
    if (!requestedLevel && requestedShowReasoning == null) {
      throw new Error('hermes.reasoning.set requires a level or showReasoning value.');
    }

    const current = this.readHermesReasoningState();
    const nextEffort: HermesReasoningState['effort'] = requestedLevel
      ? (requestedLevel === 'off' ? 'none' : requestedLevel as HermesReasoningState['effort'])
      : current.effort;
    const next = this.setHermesReasoningState({
      effort: nextEffort,
      display: requestedShowReasoning ?? current.display,
    });
    return {
      level: next.effort === 'none' ? 'off' : next.effort,
      rawLevel: next.effort,
      showReasoning: next.display,
    };
  }

  private readHermesReasoningState(): HermesReasoningState {
    const payload = this.runHermesPython<unknown>(
      [
        'import json',
        'from hermes_cli.config import load_config',
        'from hermes_constants import parse_reasoning_effort',
        'cfg = load_config() or {}',
        'agent_cfg = cfg.get("agent") if isinstance(cfg.get("agent"), dict) else {}',
        'display_cfg = cfg.get("display") if isinstance(cfg.get("display"), dict) else {}',
        'raw_effort = str(agent_cfg.get("reasoning_effort") or "").strip()',
        'parsed = parse_reasoning_effort(raw_effort)',
        'if parsed is None:',
        '  effort = "medium"',
        'elif parsed.get("enabled") is False:',
        '  effort = "none"',
        'else:',
        '  effort = str(parsed.get("effort") or "medium").strip().lower() or "medium"',
        'display = bool(display_cfg.get("show_reasoning", False))',
        'print(json.dumps({',
        '  "effort": effort,',
        '  "display": display,',
        '}))',
      ].join('\n'),
    );
    const record = isRecord(payload) ? payload : {};
    const effort = readString(record.effort).toLowerCase();
    return {
      effort: isHermesReasoningEffort(effort) ? effort : 'medium',
      display: record.display === true,
    };
  }

  private setHermesReasoningState(next: HermesReasoningState): HermesReasoningState {
    const payload = this.runHermesPython<unknown>(
      [
        'import json',
        'import os',
        'from pathlib import Path',
        'from hermes_cli.config import load_config',
        'from utils import atomic_yaml_write',
        'payload = json.loads(input() or "{}")',
        'cfg = load_config() or {}',
        'agent_cfg = cfg.get("agent") if isinstance(cfg.get("agent"), dict) else {}',
        'display_cfg = cfg.get("display") if isinstance(cfg.get("display"), dict) else {}',
        'effort = str(payload.get("effort") or "medium").strip().lower()',
        'display = bool(payload.get("display", False))',
        'agent_cfg["reasoning_effort"] = "" if effort == "medium" else ("none" if effort == "none" else effort)',
        'display_cfg["show_reasoning"] = display',
        'cfg["agent"] = agent_cfg',
        'cfg["display"] = display_cfg',
        'config_root = Path(os.environ.get("HERMES_HOME") or (Path.home() / ".hermes"))',
        'config_path = config_root / "config.yaml"',
        'atomic_yaml_write(config_path, cfg)',
        'print(json.dumps({',
        '  "effort": effort,',
        '  "display": display,',
        '}))',
      ].join('\n'),
      next,
    );
    const record = isRecord(payload) ? payload : {};
    const effort = readString(record.effort).toLowerCase();
    return {
      effort: isHermesReasoningEffort(effort) ? effort : next.effort,
      display: record.display === true,
    };
  }

  private readHermesFastModeState(): HermesFastModeState {
    const payload = this.runHermesPython<unknown>(
      [
        'import json',
        'from hermes_cli.config import load_config',
        'from hermes_cli.models import model_supports_fast_mode',
        'cfg = load_config() or {}',
        'agent_cfg = cfg.get("agent") if isinstance(cfg.get("agent"), dict) else {}',
        'model_cfg = cfg.get("model") if isinstance(cfg.get("model"), dict) else {}',
        'current_model = str(model_cfg.get("default") or model_cfg.get("model") or "").strip()',
        'service_tier = str(agent_cfg.get("service_tier") or "").strip().lower()',
        'supported = bool(current_model) and bool(model_supports_fast_mode(current_model))',
        'enabled = service_tier == "fast" or service_tier == "priority"',
        'print(json.dumps({',
        '  "enabled": enabled,',
        '  "supported": supported,',
        '}))',
      ].join('\n'),
    );
    const record = isRecord(payload) ? payload : {};
    return {
      enabled: record.enabled === true,
      supported: record.supported === true,
    };
  }

  private setHermesFastModeState(enabled: boolean): HermesFastModeState {
    const payload = this.runHermesPython<unknown>(
      [
        'import json',
        'import os',
        'from pathlib import Path',
        'from hermes_cli.config import load_config',
        'from hermes_cli.models import model_supports_fast_mode',
        'from utils import atomic_yaml_write',
        'payload = json.loads(input() or "{}")',
        'cfg = load_config() or {}',
        'agent_cfg = cfg.get("agent") if isinstance(cfg.get("agent"), dict) else {}',
        'model_cfg = cfg.get("model") if isinstance(cfg.get("model"), dict) else {}',
        'current_model = str(model_cfg.get("default") or model_cfg.get("model") or "").strip()',
        'supported = bool(current_model) and bool(model_supports_fast_mode(current_model))',
        'enabled = bool(payload.get("enabled", False))',
        'if not supported:',
        '  print(json.dumps({',
        '    "enabled": False,',
        '    "supported": False,',
        '  }))',
        '  raise SystemExit(0)',
        'agent_cfg["service_tier"] = "fast" if enabled else "normal"',
        'cfg["agent"] = agent_cfg',
        'config_root = Path(os.environ.get("HERMES_HOME") or (Path.home() / ".hermes"))',
        'config_path = config_root / "config.yaml"',
        'atomic_yaml_write(config_path, cfg)',
        'print(json.dumps({',
        '  "enabled": enabled,',
        '  "supported": True,',
        '}))',
      ].join('\n'),
      { enabled },
    );
    const record = isRecord(payload) ? payload : {};
    return {
      enabled: record.enabled === true,
      supported: record.supported === true,
    };
  }

  private getHermesFastModePayload(): HermesFastModeState {
    return this.readHermesFastModeState();
  }

  private setHermesFastModePayload(payload: Record<string, unknown>): HermesFastModeState {
    const enabled = readBoolean(payload.enabled);
    if (enabled == null) {
      throw new Error('hermes.fast.set requires an enabled boolean.');
    }
    return this.setHermesFastModeState(enabled);
  }

  private executeReasoningCommand(rawCommand: string): string {
    const normalizedCommand = rawCommand.trim();
    const rawArgs = normalizedCommand.replace(/^\/reasoning\b/i, '').trim();
    const currentState = this.readHermesReasoningState();
    if (!rawArgs) {
      return formatHermesReasoningSummary(currentState);
    }

    const arg = normalizeThinkingLevelAlias(rawArgs);
    if (arg === 'show' || arg === 'on') {
      const nextState = this.setHermesReasoningState({
        effort: currentState.effort,
        display: true,
      });
      return [
        'Reasoning display turned on.',
        '',
        formatHermesReasoningSummary(nextState),
      ].join('\n');
    }
    if (arg === 'hide' || arg === 'off-display') {
      const nextState = this.setHermesReasoningState({
        effort: currentState.effort,
        display: false,
      });
      return [
        'Reasoning display turned off.',
        '',
        formatHermesReasoningSummary(nextState),
      ].join('\n');
    }
    if (!isHermesReasoningEffort(arg)) {
      throw new Error('Valid reasoning levels: none, minimal, low, medium, high, xhigh, show, hide.');
    }
    const nextState = this.setHermesReasoningState({
      effort: arg,
      display: currentState.display,
    });
    return [
      `Reasoning effort set to ${formatHermesReasoningEffortLabel(nextState.effort)}.`,
      '',
      formatHermesReasoningSummary(nextState),
    ].join('\n');
  }

  private executeThinkingCommand(rawCommand: string): string {
    const normalizedCommand = rawCommand.trim();
    const rawArgs = normalizedCommand.replace(/^\/think\b/i, '').trim();
    const currentState = this.readHermesReasoningState();
    if (!rawArgs) {
      return formatHermesThinkingSummary(currentState);
    }
    const normalizedLevel = normalizeThinkingLevelAlias(rawArgs);
    if (!isHermesReasoningEffort(normalizedLevel)) {
      throw new Error('Valid thinking levels: off, minimal, low, medium, high, xhigh.');
    }
    const nextState = this.setHermesReasoningState({
      effort: normalizedLevel,
      display: currentState.display,
    });
    return [
      `Thinking level set to ${formatHermesThinkingLevelLabel(nextState.effort)}.`,
      '',
      formatHermesThinkingSummary(nextState),
    ].join('\n');
  }

  private executeFastCommand(rawCommand: string): string {
    const normalizedCommand = rawCommand.trim().replace(/:$/, '');
    const rawArgs = normalizedCommand.replace(/^\/fast\b/i, '').trim().toLowerCase();
    const currentState = this.readHermesFastModeState();
    if (!currentState.supported) {
      throw new Error('Fast mode is only available for models that support it.');
    }
    if (!rawArgs || rawArgs === 'status') {
      return formatHermesFastModeSummary(currentState);
    }
    if (!isHermesFastModeValue(rawArgs)) {
      throw new Error('Valid fast mode values: on, off, fast, normal, status.');
    }
    const nextState = this.setHermesFastModeState(rawArgs === 'on' || rawArgs === 'fast');
    return [
      `Fast mode turned ${nextState.enabled ? 'on' : 'off'}.`,
      '',
      formatHermesFastModeSummary(nextState),
    ].join('\n');
  }

  private async listHermesCronJobs(payload: Record<string, unknown>): Promise<HermesCronJob[]> {
    const includeDisabled = readBoolean(payload.includeDisabled) ?? true;
    const jobs = Object.values(this.readHermesCronJobsFromDisk()).filter((job) => includeDisabled || job.enabled);
    jobs.sort((left, right) => compareIsoTimestamps(left.next_run_at, right.next_run_at) || left.name.localeCompare(right.name));
    return jobs;
  }

  private async getHermesCronJob(jobId: string | null): Promise<HermesCronJob | null> {
    if (!jobId) {
      throw new Error('hermes.cron.jobs.get requires jobId.');
    }
    return this.readHermesCronJobsFromDisk()[jobId] ?? null;
  }

  private async createHermesCronJob(payload: Record<string, unknown>): Promise<HermesCronJob | null> {
    const result = this.runHermesCronTool('create', {
      name: requireNonEmptyString(readString(payload.name), 'Task name is required.'),
      schedule: requireNonEmptyString(readString(payload.schedule), 'Schedule is required.'),
      prompt: readString(payload.prompt) ?? '',
      deliver: readString(payload.deliver) || null,
      skills: normalizeStringArray(payload.skills),
      repeat: readNullablePositiveInt(payload.repeat),
      script: readString(payload.script) || null,
    });
    const jobId = readString((isRecord(result) ? result.job_id : null));
    if (!jobId) {
      return null;
    }
    this.applyHermesCronJobOverrides(jobId, {
      nextRunAt: readString(payload.startAt) || null,
      scheduleDisplay: readString(payload.scheduleDisplay) || null,
    });
    return this.readHermesCronJobsFromDisk()[jobId] ?? null;
  }

  private async updateHermesCronJob(jobId: string | null, payload: Record<string, unknown>): Promise<HermesCronJob | null> {
    if (!jobId) {
      throw new Error('hermes.cron.jobs.update requires jobId.');
    }
    const updates: Record<string, unknown> = { jobId };
    if (payload.name !== undefined) updates.name = readString(payload.name);
    if (payload.schedule !== undefined) updates.schedule = readString(payload.schedule);
    if (payload.prompt !== undefined) updates.prompt = readString(payload.prompt);
    if (payload.deliver !== undefined) updates.deliver = readString(payload.deliver) || null;
    if (payload.skills !== undefined) updates.skills = normalizeStringArray(payload.skills);
    if (payload.repeat !== undefined) updates.repeat = readNullablePositiveInt(payload.repeat);
    if (payload.script !== undefined) updates.script = readString(payload.script) || '';
    this.runHermesCronTool('update', updates);
    this.applyHermesCronJobOverrides(jobId, {
      nextRunAt: payload.startAt === undefined ? undefined : (readString(payload.startAt) || null),
      scheduleDisplay: payload.scheduleDisplay === undefined ? undefined : (readString(payload.scheduleDisplay) || null),
    });
    return this.readHermesCronJobsFromDisk()[jobId] ?? null;
  }

  private async pauseHermesCronJob(jobId: string | null): Promise<HermesCronJob | null> {
    return this.runHermesCronJobAction(jobId, 'pause');
  }

  private async resumeHermesCronJob(jobId: string | null): Promise<HermesCronJob | null> {
    return this.runHermesCronJobAction(jobId, 'resume');
  }

  private async runHermesCronJob(jobId: string | null): Promise<HermesCronJob | null> {
    return this.runHermesCronJobAction(jobId, 'run');
  }

  private async removeHermesCronJob(jobId: string | null): Promise<boolean> {
    if (!jobId) {
      throw new Error('hermes.cron.jobs.remove requires jobId.');
    }
    const result = this.runHermesCronTool('remove', { jobId });
    return Boolean(result.success);
  }

  private async runHermesCronJobAction(jobId: string | null, action: 'pause' | 'resume' | 'run'): Promise<HermesCronJob | null> {
    if (!jobId) {
      throw new Error(`hermes.cron.jobs.${action} requires jobId.`);
    }
    this.runHermesCronTool(action, { jobId });
    return this.readHermesCronJobsFromDisk()[jobId] ?? null;
  }

  private listHermesCronOutputs(payload: Record<string, unknown>): HermesCronOutputEntry[] {
    const requestedJobId = readString(payload.jobId) || null;
    const limit = readPositiveInt(payload.limit, 100);
    const outputsRoot = join(this.hermesHomePath, 'cron', 'output');
    if (!existsSync(outputsRoot)) {
      return [];
    }

    const jobs = this.readHermesCronJobsFromDisk();
    const entries: HermesCronOutputDetail[] = [];
    const discoveredJobDirs = readdirSync(outputsRoot, { withFileTypes: true })
      .filter((dirent) => dirent.isDirectory())
      .map((dirent) => dirent.name);
    const jobDirs = requestedJobId
      ? [requestedJobId]
      : Array.from(new Set([...Object.keys(jobs), ...discoveredJobDirs]));

    for (const jobId of jobDirs) {
      const dirPath = join(outputsRoot, jobId);
      if (!existsSync(dirPath)) {
        continue;
      }
      for (const dirent of readdirSync(dirPath, { withFileTypes: true })) {
        if (!dirent.isFile() || !dirent.name.endsWith('.md')) {
          continue;
        }
        const output = this.readHermesCronOutputDetail(jobId, dirent.name, jobs[jobId]);
        if (output) {
          entries.push(output);
        }
      }
    }

    entries.sort((left, right) => right.createdAt - left.createdAt);
    return entries.slice(0, limit).map(({ content: _content, path: _path, ...entry }) => entry);
  }

  private getHermesCronOutput(jobId: string | null, fileName: string | null): HermesCronOutputDetail | null {
    if (!jobId || !fileName) {
      throw new Error('hermes.cron.outputs.get requires jobId and fileName.');
    }
    const jobs = this.readHermesCronJobsFromDisk();
    return this.readHermesCronOutputDetail(jobId, fileName, jobs[jobId]);
  }

  private readHermesCronJobsFromDisk(): Record<string, HermesCronJob> {
    const jobsPath = join(this.hermesHomePath, 'cron', 'jobs.json');
    if (!existsSync(jobsPath)) {
      return {};
    }
    try {
      const parsed = JSON.parse(readFileSync(jobsPath, 'utf8')) as { jobs?: unknown[] };
      const result: Record<string, HermesCronJob> = {};
      for (const entry of Array.isArray(parsed.jobs) ? parsed.jobs : []) {
        const job = normalizeHermesCronJob(entry);
        if (job) {
          result[job.id] = job;
        }
      }
      return result;
    } catch {
      return {};
    }
  }

  private applyHermesCronJobOverrides(
    jobId: string,
    overrides: {
      nextRunAt?: string | null;
      scheduleDisplay?: string | null;
    },
  ): void {
    if (overrides.nextRunAt === undefined && overrides.scheduleDisplay === undefined) {
      return;
    }
    const jobsPath = join(this.hermesHomePath, 'cron', 'jobs.json');
    if (!existsSync(jobsPath)) {
      return;
    }
    try {
      const parsed = JSON.parse(readFileSync(jobsPath, 'utf8')) as { jobs?: unknown[]; updated_at?: unknown };
      const jobs = Array.isArray(parsed.jobs) ? parsed.jobs : [];
      let changed = false;
      for (const entry of jobs) {
        if (!isRecord(entry) || readString(entry.id) !== jobId) {
          continue;
        }
        if (overrides.nextRunAt !== undefined) {
          entry.next_run_at = overrides.nextRunAt;
          changed = true;
        }
        if (overrides.scheduleDisplay !== undefined && overrides.scheduleDisplay) {
          entry.schedule_display = overrides.scheduleDisplay;
          if (isRecord(entry.schedule)) {
            entry.schedule.display = overrides.scheduleDisplay;
          }
          changed = true;
        }
        break;
      }
      if (!changed) {
        return;
      }
      writeFileSync(
        jobsPath,
        JSON.stringify({
          jobs,
          updated_at: new Date().toISOString(),
        }, null, 2) + '\n',
        'utf8',
      );
    } catch {
      // Ignore override failures and fall back to Hermes defaults.
    }
  }

  private readHermesCronOutputDetail(
    jobId: string,
    fileName: string,
    job?: HermesCronJob,
  ): HermesCronOutputDetail | null {
    if (!/^[A-Za-z0-9._-]+\.md$/.test(fileName)) {
      return null;
    }
    const outputPath = join(this.hermesHomePath, 'cron', 'output', jobId, fileName);
    if (!existsSync(outputPath)) {
      return null;
    }
    const content = readFileSync(outputPath, 'utf8');
    return parseHermesCronOutput(jobId, fileName, content, outputPath, job?.name);
  }

  private runHermesCronTool(
    action: 'create' | 'update' | 'pause' | 'resume' | 'run' | 'remove',
    payload: Record<string, unknown>,
  ): { success?: boolean; job?: unknown; removed_job?: unknown; job_id?: unknown; error?: unknown } {
    const result = this.runHermesPython<{
      success?: boolean;
      job?: unknown;
      removed_job?: unknown;
      job_id?: unknown;
      error?: unknown;
    }>(
      [
        'import json',
        'import sys',
        'from tools.cronjob_tools import cronjob',
        'payload = json.load(sys.stdin)',
        'result = cronjob(',
        '  action=payload.get("action"),',
        '  job_id=payload.get("jobId"),',
        '  prompt=payload.get("prompt"),',
        '  schedule=payload.get("schedule"),',
        '  name=payload.get("name"),',
        '  repeat=payload.get("repeat"),',
        '  deliver=payload.get("deliver"),',
        '  skills=payload.get("skills"),',
        '  script=payload.get("script"),',
        ')',
        'print(result)',
      ].join('\n'),
      { ...payload, action },
    );
    if (result.success === false) {
      throw new Error(readString(result.error) || `Failed to ${action} Hermes scheduled task.`);
    }
    return result;
  }

  private runHermesPython<T>(script: string, stdinPayload?: unknown): T {
    if (!existsSync(this.hermesSourcePath)) {
      throw new Error(`Hermes source is not available at ${this.hermesSourcePath}.`);
    }

    const raw = execFileSync(
      this.hermesPythonPath,
      ['-c', script],
      {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          HERMES_HOME: this.hermesHomePath,
          PYTHONPATH: buildPythonPath(this.hermesSourcePath, process.env.PYTHONPATH),
        },
        input: stdinPayload == null ? '' : JSON.stringify(stdinPayload),
      },
    );
    return JSON.parse(raw) as T;
  }

  private invalidateHermesModelStateCache(): void {
    this.modelStateCache = null;
    this.contextWindowCache.clear();
  }

  private async handleChatAbort(payload: Record<string, unknown>): Promise<{
    ok: true;
    abortedRunIds: string[];
    upstreamCancelled: false;
  }> {
    const sessionKey = readString(payload.sessionKey) || DEFAULT_SESSION_ID;
    const runId = readString(payload.runId);
    const abortedRunIds = runId
      ? (this.abortActiveRun(runId, true) ? [runId] : [])
      : this.abortActiveRunsForSession(sessionKey, true);
    return {
      ok: true,
      abortedRunIds,
      upstreamCancelled: false,
    };
  }

  private async streamRunEvents(
    runId: string,
    sessionKey: string,
    sessionId: string,
    runStartedAtMs: number,
    signal: AbortSignal,
  ): Promise<void> {
    let sawTerminalEvent = false;
    try {
      const response = await fetch(`${this.apiBaseUrl}/v1/runs/${encodeURIComponent(runId)}/events`, {
        headers: buildHermesApiHeaders(this.apiKey),
        signal,
      });
      if (!response.ok || !response.body) {
        this.sendChatError(runId, sessionKey, `Hermes events stream failed (${response.status}).`);
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';
      let seq = 0;
      let assistantText = '';
      let toolIndex = 0;
      const activeTools = new Map<string, Array<{
        toolCallId: string;
        startedAt: number;
        args?: string;
      }>>();
      const completedTools: Array<{
        toolCallId: string;
        toolName: string;
        isError: boolean;
        toolDurationMs?: number;
      }> = [];

      for await (const chunk of response.body) {
        buffer += decoder.decode(chunk, { stream: true });
        while (true) {
          const boundary = buffer.indexOf('\n\n');
          if (boundary < 0) break;
          const rawEvent = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const parsed = parseSseDataLine(rawEvent);
          if (!parsed) continue;

          const event = isRecord(parsed) ? parsed : {};
          const eventName = readString(event.event);
          if (!eventName) continue;

          if (eventName === 'message.delta') {
            const delta = readString(event.delta);
            if (!delta) continue;
            assistantText += delta;
            seq += 1;
            this.broadcastEvent('chat', {
              runId,
              sessionKey,
              seq,
              state: 'delta',
              message: {
                role: 'assistant',
                content: delta,
              },
            });
            continue;
          }

          if (eventName === 'tool.started') {
            toolIndex += 1;
            const toolName = readString(event.tool) || 'tool';
            const toolCallId = `${runId}:tool:${toolIndex}`;
            const startedAt = readNumber(event.timestamp) ?? Date.now();
            const args = readString(event.preview) || stringifyUnknown(event.args);
            const queue = activeTools.get(toolName) ?? [];
            queue.push({
              toolCallId,
              startedAt,
              args: args || undefined,
            });
            activeTools.set(toolName, queue);
            this.broadcastEvent('agent', {
              runId,
              sessionKey,
              stream: 'tool',
              ts: startedAt,
              data: {
                phase: 'start',
                name: toolName,
                toolCallId,
                args: args || undefined,
              },
            });
            continue;
          }

          if (eventName === 'tool.completed') {
            const toolName = readString(event.tool) || 'tool';
            const queue = activeTools.get(toolName) ?? [];
            const activeTool = queue.shift();
            const toolCallId = activeTool?.toolCallId ?? `${runId}:tool:${++toolIndex}`;
            if (queue.length > 0) {
              activeTools.set(toolName, queue);
            } else {
              activeTools.delete(toolName);
            }
            const toolTimestamp = readNumber(event.timestamp) ?? Date.now();
            const toolOutput = extractToolOutput(event);
            const toolDurationMs = readNumber(event.duration)
              ?? (typeof activeTool?.startedAt === 'number'
                ? Math.max(0, toolTimestamp - activeTool.startedAt)
                : undefined);
            this.sessionStore.appendMessage(sessionKey, {
              role: 'toolResult',
              content: toolOutput,
              ts: toolTimestamp,
              runId,
              toolName,
              toolCallId,
              isError: event.error === true,
              toolArgs: activeTool?.args,
              toolDurationMs,
              toolStartedAt: activeTool?.startedAt,
              toolFinishedAt: toolTimestamp,
            });
            this.updateSnapshot({ sessionCount: this.sessionStore.count() });
            completedTools.push({
              toolCallId,
              toolName,
              isError: event.error === true,
              toolDurationMs,
            });
            this.broadcastEvent('agent', {
              runId,
              sessionKey,
              stream: 'tool',
              ts: toolTimestamp,
              data: {
                phase: 'result',
                name: toolName,
                toolCallId,
                result: toolOutput || undefined,
                output: toolOutput || undefined,
                args: activeTool?.args,
                duration: toolDurationMs ?? 0,
                isError: event.error === true,
              },
            });
            continue;
          }

          if (eventName === 'run.completed') {
            sawTerminalEvent = true;
            const output = readString(event.output) || assistantText;
            assistantText = output;
            const usage = mapHermesUsage(event.usage);
            await this.hydrateToolOutputsFromHermesState({
              runId,
              sessionKey,
              sessionId,
              runStartedAtMs,
              completedTools,
            });
            this.recordHermesRunUsageDelta({
              sessionKey,
              sessionId,
              observedAtMs: Date.now(),
              baseline: this.activeRuns.get(runId)?.usageBaseline ?? null,
            });
            this.sessionStore.appendMessage(sessionKey, {
              role: 'assistant',
              content: output,
              ts: Date.now(),
              runId,
            });
            this.updateSnapshot({ sessionCount: this.sessionStore.count() });
            seq += 1;
            this.broadcastEvent('chat', {
              runId,
              sessionKey,
              seq,
              state: 'final',
              message: {
                role: 'assistant',
                content: output,
              },
              usage,
            });
            return;
          }

          if (eventName === 'run.failed') {
            sawTerminalEvent = true;
            this.sendChatError(runId, sessionKey, readString(event.error) || 'Hermes run failed.');
            return;
          }
        }
      }

      const trailing = parseSseDataLine(buffer);
      if (trailing && isRecord(trailing) && readString(trailing.event) === 'run.completed') {
        sawTerminalEvent = true;
        const output = readString(trailing.output) || assistantText;
        const usage = mapHermesUsage(trailing.usage);
        await this.hydrateToolOutputsFromHermesState({
          runId,
          sessionKey,
          sessionId,
          runStartedAtMs,
          completedTools,
        });
        this.recordHermesRunUsageDelta({
          sessionKey,
          sessionId,
          observedAtMs: Date.now(),
          baseline: this.activeRuns.get(runId)?.usageBaseline ?? null,
        });
        this.sessionStore.appendMessage(sessionKey, {
          role: 'assistant',
          content: output,
          ts: Date.now(),
          runId,
        });
        this.updateSnapshot({ sessionCount: this.sessionStore.count() });
        seq += 1;
        this.broadcastEvent('chat', {
          runId,
          sessionKey,
          seq,
          state: 'final',
          message: {
            role: 'assistant',
            content: output,
          },
          usage,
        });
        return;
      }

      if (!sawTerminalEvent) {
        const finalized = await this.finalizeRunAfterMissingTerminalEvent({
          runId,
          sessionKey,
          sessionId,
          runStartedAtMs,
          seq,
          assistantText,
          completedTools,
        });
        if (!finalized) {
          this.sendChatError(
            runId,
            sessionKey,
            'Hermes events stream ended before a terminal event was received.',
          );
        }
      }
    } catch (error) {
      if (isAbortError(error)) {
        return;
      }
      this.sendChatError(runId, sessionKey, `Hermes events stream failed: ${formatError(error)}`);
    } finally {
      this.activeRuns.delete(runId);
    }
  }

  private async finalizeRunAfterMissingTerminalEvent(params: {
    runId: string;
    sessionKey: string;
    sessionId: string;
    runStartedAtMs: number;
    seq: number;
    assistantText: string;
    completedTools: Array<{
      toolCallId: string;
      toolName: string;
      isError: boolean;
      toolDurationMs?: number;
    }>;
  }): Promise<boolean> {
    await this.hydrateToolOutputsFromHermesState({
      runId: params.runId,
      sessionKey: params.sessionKey,
      sessionId: params.sessionId,
      runStartedAtMs: params.runStartedAtMs,
      completedTools: params.completedTools,
    });

    this.recordHermesRunUsageDelta({
      sessionKey: params.sessionKey,
      sessionId: params.sessionId,
      observedAtMs: Date.now(),
      baseline: this.activeRuns.get(params.runId)?.usageBaseline ?? null,
    });

    const history = this.getHermesSessionHistory(params.sessionKey, 24);
    const historyOutput = [...history.messages]
      .reverse()
      .find((message) => (
        message.role === 'assistant'
        && normalizeHermesHistoryContent(message.content).length > 0
        && message.timestamp >= params.runStartedAtMs - 1000
      ));
    const output = normalizeHermesHistoryContent(historyOutput?.content) || params.assistantText.trim();

    if (output) {
      const shouldAppendLocalAssistant = !historyOutput || normalizeHermesHistoryContent(historyOutput.content) !== output;
      if (shouldAppendLocalAssistant) {
        this.sessionStore.appendMessage(params.sessionKey, {
          role: 'assistant',
          content: output,
          ts: Date.now(),
          runId: params.runId,
        });
        this.updateSnapshot({ sessionCount: this.sessionStore.count() });
      }
      this.broadcastEvent('chat', {
        runId: params.runId,
        sessionKey: params.sessionKey,
        seq: params.seq + 1,
        state: 'final',
        message: {
          role: 'assistant',
          content: output,
        },
      });
      return true;
    }

    if (params.completedTools.length > 0) {
      this.broadcastEvent('chat', {
        runId: params.runId,
        sessionKey: params.sessionKey,
        seq: params.seq + 1,
        state: 'final',
      });
      return true;
    }

    return false;
  }

  private cancelAllActiveRuns(): void {
    for (const runId of [...this.activeRuns.keys()]) {
      this.abortActiveRun(runId, false);
    }
  }

  private cancelActiveRunsForSession(sessionKey: string): void {
    this.abortActiveRunsForSession(sessionKey, false);
  }

  private abortActiveRunsForSession(sessionKey: string, notifyClient: boolean): string[] {
    const abortedRunIds: string[] = [];
    for (const [runId, activeRun] of this.activeRuns) {
      if (activeRun.sessionKey !== sessionKey) continue;
      if (this.abortActiveRun(runId, notifyClient)) {
        abortedRunIds.push(runId);
      }
    }
    return abortedRunIds;
  }

  private abortActiveRun(runId: string, notifyClient: boolean): boolean {
    const activeRun = this.activeRuns.get(runId);
    if (!activeRun) {
      return false;
    }
    this.activeRuns.delete(runId);
    activeRun.abortController.abort();
    if (notifyClient) {
      this.broadcastEvent('chat', {
        runId,
        sessionKey: activeRun.sessionKey,
        seq: 1,
        state: 'aborted',
      });
    }
    return true;
  }

  private sendAgentLifecycleStart(runId: string, sessionKey: string): void {
    this.broadcastEvent('agent', {
      runId,
      sessionKey,
      stream: 'lifecycle',
      ts: Date.now(),
      data: {
        phase: 'start',
      },
    });
  }

  private sendChatError(runId: string, sessionKey: string, message: string): void {
    this.broadcastEvent('chat', {
      runId,
      sessionKey,
      seq: 1,
      state: 'error',
      errorMessage: message,
    });
  }

  private sendResponse(socket: WebSocket, id: string, payload: unknown): void {
    socket.send(JSON.stringify({
      type: 'res',
      id,
      ok: true,
      payload,
    }));
  }

  private sendError(socket: WebSocket, id: string | null, code: string, message: string): void {
    socket.send(JSON.stringify({
      type: 'res',
      id: id ?? randomUUID(),
      ok: false,
      error: {
        code,
        message,
      },
    }));
  }

  private broadcastEvent(event: string, payload: unknown): void {
    for (const client of this.clients) {
      this.sendEvent(client.socket, event, payload);
    }
  }

  private sendEvent(socket: WebSocket, event: string, payload: unknown): void {
    if (socket.readyState !== WebSocket.OPEN) {
      return;
    }
    socket.send(JSON.stringify({
      type: 'event',
      event,
      payload,
    }));
  }

  private writeJson(res: ServerResponse, status: number, payload: unknown): void {
    res.statusCode = status;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(payload));
  }

  private isAuthorized(rawUrl: string | undefined): boolean {
    const token = new URL(rawUrl ?? '/', 'http://localhost').searchParams.get('token')?.trim();
    return token === this.bridgeToken;
  }

  private updateSnapshot(patch: Partial<HermesLocalBridgeSnapshot>): void {
    Object.assign(this.snapshot, patch, {
      lastUpdatedMs: Date.now(),
      sessionCount: this.sessionStore.count(),
    });
    this.options.onStatus?.(this.getSnapshot());
  }

  private log(line: string): void {
    this.options.onLog?.(line);
  }

  private logPerf(event: string, fields?: Record<string, unknown>): void {
    const payload = fields
      ? Object.entries(fields)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => `${key}=${String(value)}`)
        .join(' ')
      : '';
    // this.log(`[perf] ${event}${payload ? ` ${payload}` : ''}`);
    void event;
    void payload;
  }

  private async hydrateToolOutputsFromHermesState(params: {
    runId: string;
    sessionKey: string;
    sessionId: string;
    runStartedAtMs: number;
    completedTools: Array<{
      toolCallId: string;
      toolName: string;
      isError: boolean;
      toolDurationMs?: number;
    }>;
  }): Promise<void> {
    const toolOutputs = this.readHermesToolOutputsFromLocalState(
      params.sessionId,
      params.runStartedAtMs,
    );
    if (toolOutputs.length === 0 || params.completedTools.length === 0) {
      return;
    }

    const unmatched = params.completedTools.map((tool) => ({ ...tool, matched: false }));
    for (const output of toolOutputs) {
      const match = unmatched.find((candidate) => {
        if (candidate.matched) return false;
        if (output.toolName && candidate.toolName === output.toolName) return true;
        return false;
      }) ?? unmatched.find((candidate) => !candidate.matched);
      if (!match) continue;
      match.matched = true;
      if (!output.content.trim()) continue;
      const updated = this.sessionStore.updateToolResult(params.sessionKey, match.toolCallId, {
        content: output.content,
      });
      if (!updated) continue;
      this.broadcastEvent('agent', {
        runId: params.runId,
        sessionKey: params.sessionKey,
        stream: 'tool',
        ts: output.timestampMs,
        data: {
          phase: 'result',
          name: match.toolName,
          toolCallId: match.toolCallId,
          result: output.content,
          output: output.content,
          duration: match.toolDurationMs ?? 0,
          isError: match.isError,
        },
      });
    }
  }

  private readHermesToolOutputsFromLocalState(
    sessionId: string,
    runStartedAtMs: number,
  ): Array<{ toolCallId?: string; toolName?: string; content: string; timestampMs: number }> {
    const stateDbPath = this.options.hermesStateDbPath?.trim() || HERMES_STATE_DB_PATH;
    if (!existsSync(stateDbPath)) {
      return [];
    }

    try {
      const raw = execFileSync(
        'python3',
        [
          '-c',
          [
            'import json, sqlite3, sys',
            'db_path, session_id, since_ts = sys.argv[1], sys.argv[2], float(sys.argv[3])',
            'conn = sqlite3.connect(db_path)',
            'conn.row_factory = sqlite3.Row',
            'cur = conn.cursor()',
            'cur.execute("SELECT role, content, tool_call_id, tool_name, tool_calls, timestamp FROM messages WHERE session_id = ? AND timestamp >= ? ORDER BY timestamp, id", (session_id, since_ts))',
            'tool_names = {}',
            'out = []',
            'for row in cur.fetchall():',
            '    role = row["role"]',
            '    if role == "assistant" and row["tool_calls"]:',
            '        try:',
            '            tool_calls = json.loads(row["tool_calls"])',
            '        except Exception:',
            '            tool_calls = []',
            '        for tc in tool_calls or []:',
            '            call_id = tc.get("id") or tc.get("call_id")',
            '            func = tc.get("function") or {}',
            '            name = func.get("name")',
            '            if call_id and name:',
            '                tool_names[call_id] = name',
            '    elif role == "tool" and row["content"]:',
            '        out.append({',
            '            "toolCallId": row["tool_call_id"] or None,',
            '            "toolName": tool_names.get(row["tool_call_id"]) or row["tool_name"] or None,',
            '            "content": row["content"],',
            '            "timestampMs": int(float(row["timestamp"]) * 1000),',
            '        })',
            'print(json.dumps(out))',
          ].join('\n'),
          stateDbPath,
          sessionId,
          String(Math.max(0, runStartedAtMs - 1_000) / 1_000),
        ],
        {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        },
      );
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) {
        return [];
      }
      return parsed.flatMap((entry) => {
        if (!isRecord(entry)) return [];
        const content = readString(entry.content);
        const timestampMs = readNumber(entry.timestampMs);
        if (!content || timestampMs == null) return [];
        return [{
          toolCallId: readString(entry.toolCallId) || undefined,
          toolName: readString(entry.toolName) || undefined,
          content,
          timestampMs,
        }];
      });
    } catch {
      return [];
    }
  }
}

class HermesBridgeSessionStore {
  private state: HermesBridgeStoreState;

  constructor(private readonly filePath: string) {
    this.state = this.load();
  }

  count(): number {
    return this.state.sessions.length;
  }

  findSession(key: string): HermesBridgeSession | undefined {
    return this.state.sessions.find((session) => session.key === key);
  }

  upsertSessionMeta(input: {
    key: string;
    sessionId: string;
    title: string;
    updatedAt: number;
  }): void {
    const existing = this.findSession(input.key);
    if (existing) {
      const nextTitle = input.title.trim() || existing.title;
      const nextUpdatedAt = Math.max(existing.updatedAt, input.updatedAt);
      if (
        existing.sessionId === input.sessionId
        && existing.title === nextTitle
        && existing.updatedAt === nextUpdatedAt
      ) {
        return;
      }
      existing.sessionId = input.sessionId;
      existing.title = nextTitle;
      existing.updatedAt = nextUpdatedAt;
      this.save();
      return;
    }
    this.state.sessions.unshift({
      key: input.key,
      sessionId: input.sessionId,
      title: input.title.trim() || input.key,
      updatedAt: input.updatedAt,
      messages: [],
    });
    this.save();
  }

  ensureSession(key: string): HermesBridgeSession {
    const existing = this.state.sessions.find((session) => session.key === key);
    if (existing) {
      return existing;
    }
    const created: HermesBridgeSession = {
      key,
      sessionId: `clawket-hermes:${key}`,
      title: key === DEFAULT_SESSION_ID ? 'Hermes' : key,
      updatedAt: Date.now(),
      messages: [],
    };
    this.state.sessions.unshift(created);
    this.save();
    return created;
  }

  appendMessage(key: string, message: HermesBridgeSessionMessage): void {
    const session = this.ensureSession(key);
    session.messages.push(message);
    session.updatedAt = message.ts;
    this.save();
  }

  updateToolResult(key: string, toolCallId: string, patch: Partial<Pick<HermesBridgeSessionMessage, 'content'>>): boolean {
    const session = this.ensureSession(key);
    for (let index = session.messages.length - 1; index >= 0; index--) {
      const message = session.messages[index];
      if (message.role !== 'toolResult' || message.toolCallId !== toolCallId) {
        continue;
      }
      session.messages[index] = {
        ...message,
        ...(patch.content !== undefined ? { content: patch.content } : {}),
      };
      this.save();
      return true;
    }
    return false;
  }

  getHistory(key: string, limit: number): {
    messages: Array<{
      role: string;
      content: string;
      timestamp: number;
      runId?: string;
      idempotencyKey?: string;
      toolName?: string;
      toolCallId?: string;
      isError?: boolean;
      toolArgs?: string;
      toolDurationMs?: number;
      toolStartedAt?: number;
      toolFinishedAt?: number;
    }>;
    sessionId: string;
  } {
    const session = this.ensureSession(key);
    const messages = limit > 0
      ? session.messages.slice(-limit)
      : session.messages;
    return {
      messages: messages.map((message) => ({
        role: message.role,
        content: message.content,
        timestamp: message.ts,
        runId: message.runId,
        idempotencyKey: message.idempotencyKey,
        toolName: message.toolName,
        toolCallId: message.toolCallId,
        isError: message.isError,
        toolArgs: message.toolArgs,
        toolDurationMs: message.toolDurationMs,
        toolStartedAt: message.toolStartedAt,
        toolFinishedAt: message.toolFinishedAt,
      })),
      sessionId: session.sessionId,
    };
  }

  listSessions(limit: number): Array<{
    key: string;
    sessionId: string;
    title: string;
    label: string;
    updatedAt: number;
    lastMessagePreview: string;
  }> {
    return [...this.state.sessions]
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, limit)
      .map((session) => ({
        key: session.key,
        sessionId: session.sessionId,
        title: session.title,
        label: session.title,
        updatedAt: session.updatedAt,
        lastMessagePreview: summarizeText(session.messages.at(-1)?.content ?? ''),
      }));
  }

  resetSession(key: string): void {
    const session = this.ensureSession(key);
    session.messages = [];
    session.updatedAt = Date.now();
    this.save();
  }

  deleteSession(key: string): void {
    this.state.sessions = this.state.sessions.filter((session) => session.key !== key);
    this.save();
  }

  private load(): HermesBridgeStoreState {
    if (!existsSync(this.filePath)) {
      return { version: 1, sessions: [] };
    }
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as Partial<HermesBridgePersistedState>;
      const sessions = Array.isArray(parsed.sessions)
        ? parsed.sessions.filter(isPersistedSessionRecord).map((session) => ({
          ...session,
          messages: [],
        }))
        : [];
      return {
        version: 1,
        sessions,
      };
    } catch {
      return { version: 1, sessions: [] };
    }
  }

  private save(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const persisted: HermesBridgePersistedState = {
      version: 1,
      sessions: this.state.sessions.map((session) => ({
        key: session.key,
        sessionId: session.sessionId,
        title: session.title,
        updatedAt: session.updatedAt,
      })),
    };
    writeFileSync(this.filePath, JSON.stringify(persisted, null, 2) + '\n', 'utf8');
  }
}

function isSessionRecord(value: unknown): value is HermesBridgeSession {
  if (!isRecord(value)) return false;
  return typeof value.key === 'string'
    && typeof value.sessionId === 'string'
    && Array.isArray(value.messages);
}

function isPersistedSessionRecord(value: unknown): value is HermesBridgePersistedSession {
  if (!isRecord(value)) return false;
  return typeof value.key === 'string'
    && typeof value.sessionId === 'string'
    && typeof value.title === 'string'
    && typeof value.updatedAt === 'number'
    && Number.isFinite(value.updatedAt);
}

function buildHermesApiHeaders(apiKey: string | null): Record<string, string> {
  return {
    accept: 'application/json',
    'content-type': 'application/json',
    ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
  };
}

async function probeHermesApi(apiBaseUrl: string, apiKey: string | null): Promise<boolean> {
  try {
    const response = await fetch(`${apiBaseUrl}${DEFAULT_HERMES_API_HEALTH_PATH}`, {
      headers: apiKey ? { authorization: `Bearer ${apiKey}` } : undefined,
    });
    return response.ok;
  } catch {
    return false;
  }
}

function parseSseDataLine(rawEvent: string): unknown | null {
  const dataLines = rawEvent
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice('data:'.length).trim())
    .filter(Boolean);
  if (dataLines.length === 0) {
    return null;
  }
  const text = dataLines.join('\n');
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function normalizeHost(host?: string): string {
  const trimmed = host?.trim();
  return trimmed || DEFAULT_BRIDGE_HOST;
}

function normalizePort(port?: number): number {
  if (typeof port === 'number' && Number.isInteger(port) && port > 0) {
    return port;
  }
  return DEFAULT_BRIDGE_PORT;
}

function readRequestPathname(rawUrl: string | undefined): string {
  return new URL(rawUrl ?? '/', 'http://localhost').pathname;
}

function normalizeHttpBase(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

function buildPythonPath(sourcePath: string, existing: string | undefined): string {
  return existing?.trim()
    ? `${sourcePath}${delimiter}${existing}`
    : sourcePath;
}

function resolveHermesPythonPath(sourcePath: string): string {
  const candidates = [
    join(sourcePath, '.venv', 'bin', 'python'),
    join(sourcePath, 'venv', 'bin', 'python'),
    'python3',
  ];
  return candidates.find((candidate) => candidate === 'python3' || existsSync(candidate)) ?? 'python3';
}

function stringifyUnknown(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function readBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  return null;
}

function extractToolOutput(event: Record<string, unknown>): string {
  const direct = readString(event.preview)
    || readString(event.result)
    || readString(event.output)
    || readString(event.error_message);
  if (direct) {
    return direct;
  }

  const nestedCandidates = [
    event.result,
    event.output,
  ];
  for (const candidate of nestedCandidates) {
    if (!isRecord(candidate)) continue;
    const nested = readString(candidate.output)
      || readString(candidate.result)
      || readString(candidate.content)
      || readString(candidate.text)
      || readString(candidate.stdout)
      || readString(candidate.stderr);
    if (nested) {
      return nested;
    }
  }

  if (event.result != null) {
    return stringifyUnknown(event.result);
  }
  if (event.output != null) {
    return stringifyUnknown(event.output);
  }
  if (event.error === true && event.error_message != null) {
    return stringifyUnknown(event.error_message);
  }
  return '';
}

function buildHermesBridgeHttpUrl(host: string, port: number): string {
  return `http://${host}:${port}`;
}

export function buildHermesBridgeWsUrl(host: string, port: number, token: string): string {
  return `ws://${host}:${port}/v1/hermes/ws?token=${encodeURIComponent(token)}`;
}

function extractHostname(url: string): string {
  return new URL(url).hostname;
}

function extractPort(url: string): number {
  const parsed = new URL(url);
  if (parsed.port) {
    return Number(parsed.port);
  }
  return parsed.protocol === 'https:' ? 443 : 80;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value != null && !Array.isArray(value);
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readPositiveInt(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.trunc(value);
}

function readNullablePositiveInt(value: unknown): number | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return Math.trunc(value);
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const result: string[] = [];
  for (const entry of value) {
    const text = readString(entry);
    if (text && !result.includes(text)) {
      result.push(text);
    }
  }
  return result;
}

function requireNonEmptyString(value: string, message: string): string {
  if (!value.trim()) {
    throw new Error(message);
  }
  return value.trim();
}

function compareIsoTimestamps(left: string | null, right: string | null): number {
  const leftMs = left ? Date.parse(left) : Number.POSITIVE_INFINITY;
  const rightMs = right ? Date.parse(right) : Number.POSITIVE_INFINITY;
  if (leftMs === rightMs) return 0;
  return leftMs < rightMs ? -1 : 1;
}

function isModelCommand(text: string): boolean {
  return /^\/model(?:\s|$)/i.test(text.trim());
}

function isThinkingCommand(text: string): boolean {
  return /^\/think(?:\s|$)/i.test(text.trim());
}

function isReasoningCommand(text: string): boolean {
  return /^\/reasoning(?:\s|$)/i.test(text.trim());
}

function isFastCommand(text: string): boolean {
  return /^\/fast(?::|\s|$)/i.test(text.trim());
}

function normalizeHermesCronJob(value: unknown): HermesCronJob | null {
  if (!isRecord(value)) return null;
  const id = readString(value.id);
  const name = readString(value.name);
  if (!id || !name) return null;
  const scheduleRecord = isRecord(value.schedule) ? value.schedule : {};
  const repeatRecord = isRecord(value.repeat) ? value.repeat : {};
  return {
    id,
    name,
    prompt: readString(value.prompt),
    skills: normalizeStringArray(value.skills),
    skill: readString(value.skill) || null,
    model: readString(value.model) || null,
    provider: readString(value.provider) || null,
    base_url: readString(value.base_url ?? value.baseUrl) || null,
    script: readString(value.script) || null,
    schedule: {
      kind: readString(scheduleRecord.kind) || undefined,
      expr: readString(scheduleRecord.expr) || undefined,
      minutes: readNumber(scheduleRecord.minutes) ?? undefined,
      run_at: readString(scheduleRecord.run_at) || undefined,
      display: readString(scheduleRecord.display) || undefined,
    },
    schedule_display: readString(value.schedule_display) || readString(scheduleRecord.display) || '',
    repeat: {
      times: readNullablePositiveInt(repeatRecord.times),
      completed: Math.max(0, readNumber(repeatRecord.completed) ?? 0),
    },
    enabled: readBoolean(value.enabled) ?? true,
    state: readString(value.state) || 'scheduled',
    paused_at: readString(value.paused_at) || null,
    paused_reason: readString(value.paused_reason) || null,
    created_at: readString(value.created_at) || null,
    next_run_at: readString(value.next_run_at) || null,
    last_run_at: readString(value.last_run_at) || null,
    last_status: readString(value.last_status) || null,
    last_error: readString(value.last_error) || null,
    deliver: readString(value.deliver) || 'local',
    origin: isRecord(value.origin) ? value.origin : null,
    last_delivery_error: readString(value.last_delivery_error) || null,
  };
}

function parseHermesCronOutput(
  jobId: string,
  fileName: string,
  content: string,
  path: string,
  fallbackJobName?: string | null,
): HermesCronOutputDetail {
  const jobNameMatch = content.match(/^# Cron Job: (.+)$/m);
  const heading = readString(jobNameMatch?.[1]);
  const failed = /\(FAILED\)$/i.test(heading);
  const title = heading.replace(/\s+\(FAILED\)$/i, '') || fallbackJobName || jobId;
  const responseBlock = content.split(/^## Response\s*$/m)[1] ?? '';
  const preview = responseBlock
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 2)
    .join(' ')
    .slice(0, 220);
  const timestampMatch = fileName.match(/^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})\.md$/);
  const createdAt = timestampMatch
    ? new Date(
      Number(timestampMatch[1]),
      Number(timestampMatch[2]) - 1,
      Number(timestampMatch[3]),
      Number(timestampMatch[4]),
      Number(timestampMatch[5]),
      Number(timestampMatch[6]),
    ).getTime()
    : Date.now();
  return {
    jobId,
    jobName: title,
    fileName,
    createdAt,
    createdAtIso: Number.isFinite(createdAt) ? new Date(createdAt).toISOString() : null,
    status: failed ? 'error' : 'ok',
    title,
    preview,
    content,
    path,
  };
}

function normalizeHermesProviderListing(value: unknown): HermesProviderListing | null {
  if (!isRecord(value)) return null;
  const slug = readString(value.slug);
  const name = readString(value.name) || slug;
  if (!slug || !name) return null;
  const rawModels = Array.isArray(value.models) ? value.models : [];
  const models = rawModels
    .map((entry) => readString(entry))
    .filter(Boolean);
  return {
    slug,
    name,
    isCurrent: value.is_current === true || value.isCurrent === true,
    models,
    totalModels: readNumber(value.total_models ?? value.totalModels) ?? models.length,
    source: readString(value.source) || undefined,
    apiUrl: readString(value.api_url ?? value.apiUrl) || undefined,
  };
}

function normalizeHermesProviderAlias(value: string): string {
  return value.trim().toLowerCase();
}

function canonicalizeHermesModelCommand(
  rawCommand: string,
  providers: HermesProviderListing[],
): string {
  const trimmed = rawCommand.trim();
  if (!trimmed) {
    return rawCommand;
  }

  const commandBody = trimmed.replace(/^\/model\b/i, '').trim();
  if (!commandBody || !commandBody.includes('--provider')) {
    return trimmed;
  }

  const tokens = commandBody.split(/\s+/);
  const rewritten: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === '--provider' && index + 1 < tokens.length) {
      rewritten.push(token, canonicalizeHermesProviderSlug(tokens[index + 1] ?? '', providers));
      index += 1;
      continue;
    }
    rewritten.push(token);
  }

  return `/model ${rewritten.join(' ').trim()}`.trim();
}

function canonicalizeHermesProviderSlug(
  provider: string,
  providers: HermesProviderListing[],
): string {
  const normalized = normalizeHermesProviderAlias(provider);
  if (!normalized) {
    return '';
  }

  for (const entry of providers) {
    if (normalizeHermesProviderAlias(entry.slug) === normalized) {
      return entry.slug;
    }
  }

  for (const entry of providers) {
    const aliases = new Set([
      normalizeHermesProviderAlias(entry.name),
      normalizeHermesProviderAlias(entry.name.replace(/\s+/g, '-')),
    ]);
    if (entry.slug.startsWith('custom:')) {
      aliases.add(normalizeHermesProviderAlias(entry.slug.slice('custom:'.length)));
    }
    if (aliases.has(normalized)) {
      return entry.slug;
    }
  }

  const prefixedCustom = normalized.startsWith('custom:')
    ? normalized
    : `custom:${normalized}`;
  const customMatch = providers.find(
    (entry) => normalizeHermesProviderAlias(entry.slug) === prefixedCustom,
  );
  if (customMatch) {
    return customMatch.slug;
  }

  return provider;
}

function normalizeHermesModelDescriptor(value: unknown): HermesModelDescriptor | null {
  if (!isRecord(value)) return null;
  const id = readString(value.id);
  const provider = readString(value.provider);
  if (!id || !provider) return null;
  return {
    id,
    name: readString(value.name) || id,
    provider,
  };
}

function normalizeHermesModelState(value: unknown): HermesModelState {
  const record = isRecord(value) ? value : {};
  const providers = Array.isArray(record.providers)
    ? record.providers
      .map((entry) => normalizeHermesProviderListing(entry))
      .filter((entry): entry is HermesProviderListing => entry !== null)
    : [];
  const currentModel = readString(record.currentModel);
  const currentProvider = canonicalizeHermesProviderSlug(
    readString(record.currentProvider),
    providers,
  );
  const currentBaseUrl = readString(record.currentBaseUrl);
  const models = Array.isArray(record.models)
    ? record.models
      .map((entry) => normalizeHermesModelDescriptor(entry))
      .filter((entry): entry is HermesModelDescriptor => entry !== null)
      .map((entry) => ({
        ...entry,
        provider: canonicalizeHermesProviderSlug(entry.provider, providers),
      }))
    : [];

  const seenModels = new Set<string>();
  const dedupedModels: HermesModelDescriptor[] = [];
  for (const entry of models) {
    const key = `${entry.provider}::${entry.id}`;
    if (seenModels.has(key)) {
      continue;
    }
    seenModels.add(key);
    dedupedModels.push(entry);
  }

  if (currentModel && currentProvider) {
    const currentExists = dedupedModels.some((entry) => entry.id === currentModel && entry.provider === currentProvider);
    if (!currentExists) {
      dedupedModels.unshift({
        id: currentModel,
        name: currentModel,
        provider: currentProvider,
      });
    }
  }
  return {
    currentModel,
    currentProvider,
    currentBaseUrl,
    providers,
    models: dedupedModels,
  };
}

function formatHermesCurrentModel(state: HermesModelState): string {
  if (!state.currentModel) {
    return 'not configured';
  }
  return state.currentProvider
    ? `${state.currentProvider}/${state.currentModel}`
    : state.currentModel;
}

function formatHermesModelSummary(state: HermesModelState): string {
  const lines = [`Current: ${formatHermesCurrentModel(state)}`];
  if (state.providers.length > 0) {
    lines.push('');
    lines.push('Available providers:');
    for (const provider of state.providers.slice(0, 8)) {
      const models = provider.models.slice(0, 6).join(', ');
      const suffix = provider.totalModels > provider.models.length
        ? ` (+${provider.totalModels - provider.models.length} more)`
        : '';
      const currentTag = provider.isCurrent ? ' [current]' : '';
      lines.push(`- ${provider.name}${currentTag}: ${models || '(no curated models)'}${suffix}`);
    }
  }
  lines.push('');
  lines.push('Use /model <name> --provider <slug> to switch globally.');
  return lines.join('\n');
}

function normalizeThinkingLevelAlias(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'off') return 'none';
  if (normalized === 'hide') return 'off-display';
  return normalized;
}

function isHermesReasoningEffort(value: string): value is HermesReasoningState['effort'] {
  return value === 'none'
    || value === 'minimal'
    || value === 'low'
    || value === 'medium'
    || value === 'high'
    || value === 'xhigh';
}

function formatHermesReasoningEffortLabel(value: HermesReasoningState['effort']): string {
  return value === 'none' ? 'off' : value;
}

function formatHermesThinkingLevelLabel(value: HermesReasoningState['effort']): string {
  return value === 'none' ? 'off' : value;
}

function formatHermesThinkingSummary(state: HermesReasoningState): string {
  return [
    `Current thinking level: ${formatHermesThinkingLevelLabel(state.effort)}`,
    'Options: off, minimal, low, medium, high, xhigh',
  ].join('\n');
}

function formatHermesReasoningSummary(state: HermesReasoningState): string {
  return [
    `Current reasoning level: ${formatHermesReasoningEffortLabel(state.effort)}`,
    'Options: none, minimal, low, medium, high, xhigh',
    `Reasoning display: ${state.display ? 'on' : 'off'}`,
  ].join('\n');
}

function isHermesFastModeValue(value: string): boolean {
  return value === 'on'
    || value === 'off'
    || value === 'fast'
    || value === 'normal'
    || value === 'status';
}

function formatHermesFastModeSummary(state: HermesFastModeState): string {
  return [
    `Current fast mode: ${state.enabled ? 'on' : 'off'}`,
    'Options: on, off',
  ].join('\n');
}

function summarizeText(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= 140) {
    return normalized;
  }
  return `${normalized.slice(0, 137)}...`;
}

function mapHermesUsage(value: unknown): { input?: number; output?: number; total?: number } | undefined {
  if (!isRecord(value)) return undefined;
  const input = readNumber(value.input_tokens);
  const output = readNumber(value.output_tokens);
  const total = readNumber(value.total_tokens);
  if (input == null && output == null && total == null) {
    return undefined;
  }
  return {
    ...(input != null ? { input } : {}),
    ...(output != null ? { output } : {}),
    ...(total != null ? { total } : {}),
  };
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createEmptyHermesUsageTotals(): HermesUsageTotals {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    totalCost: 0,
    inputCost: 0,
    outputCost: 0,
    cacheReadCost: 0,
    cacheWriteCost: 0,
    missingCostEntries: 0,
  };
}

function countDateRangeDays(startDate: string, endDate: string): number {
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  if (Number.isNaN(start.valueOf()) || Number.isNaN(end.valueOf()) || end < start) {
    return 0;
  }
  return Math.floor((end.valueOf() - start.valueOf()) / 86_400_000) + 1;
}

function cloneHermesUsageTotals(value?: Partial<HermesUsageTotals> | null): HermesUsageTotals {
  return {
    ...createEmptyHermesUsageTotals(),
    ...(value ?? {}),
  };
}

function addHermesUsageTotals(target: HermesUsageTotals, value?: Partial<HermesUsageTotals> | null): void {
  if (!value) return;
  target.input += value.input ?? 0;
  target.output += value.output ?? 0;
  target.cacheRead += value.cacheRead ?? 0;
  target.cacheWrite += value.cacheWrite ?? 0;
  target.totalTokens += value.totalTokens ?? 0;
  target.totalCost += value.totalCost ?? 0;
  target.inputCost += value.inputCost ?? 0;
  target.outputCost += value.outputCost ?? 0;
  target.cacheReadCost += value.cacheReadCost ?? 0;
  target.cacheWriteCost += value.cacheWriteCost ?? 0;
  target.missingCostEntries += value.missingCostEntries ?? 0;
}

function subtractHermesUsageTotals(current: HermesUsageTotals, baseline?: HermesUsageTotals | null): HermesUsageTotals {
  if (!baseline) {
    return cloneHermesUsageTotals(current);
  }
  return {
    input: Math.max(0, current.input - baseline.input),
    output: Math.max(0, current.output - baseline.output),
    cacheRead: Math.max(0, current.cacheRead - baseline.cacheRead),
    cacheWrite: Math.max(0, current.cacheWrite - baseline.cacheWrite),
    totalTokens: Math.max(0, current.totalTokens - baseline.totalTokens),
    totalCost: Math.max(0, current.totalCost - baseline.totalCost),
    inputCost: Math.max(0, current.inputCost - baseline.inputCost),
    outputCost: Math.max(0, current.outputCost - baseline.outputCost),
    cacheReadCost: Math.max(0, current.cacheReadCost - baseline.cacheReadCost),
    cacheWriteCost: Math.max(0, current.cacheWriteCost - baseline.cacheWriteCost),
    missingCostEntries: Math.max(0, current.missingCostEntries - baseline.missingCostEntries),
  };
}

function getLocalDateKey(input: number | Date): string {
  const value = input instanceof Date ? input : new Date(input);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

function isSameLocalDate(leftMs: number, rightMs: number | null | undefined): boolean {
  if (rightMs == null || !Number.isFinite(rightMs)) return false;
  return getLocalDateKey(leftMs) === getLocalDateKey(rightMs);
}

function resolveHermesCostPresentationFromSessions(sessions: Array<{ usage?: { totalTokens?: number; totalCost?: number; costStatus?: string } | null }>): HermesUsageResult['costPresentation'] {
  let relevantSessions = 0;
  let includedSessions = 0;
  let estimatedSessions = 0;
  let actualSessions = 0;
  let unknownSessions = 0;
  for (const session of sessions) {
    const usage = session.usage;
    if (!usage) continue;
    const totalTokens = usage.totalTokens ?? 0;
    if (totalTokens <= 0) continue;
    relevantSessions += 1;
    const status = (usage.costStatus ?? '').trim().toLowerCase();
    if (status === 'included') {
      includedSessions += 1;
    } else if (status === 'actual') {
      actualSessions += 1;
    } else if (status === 'estimated' || (usage.totalCost ?? 0) > 0) {
      estimatedSessions += 1;
    } else {
      unknownSessions += 1;
    }
  }

  let mode: NonNullable<HermesUsageResult['costPresentation']>['mode'] = 'currency';
  if (relevantSessions > 0) {
    if (includedSessions === relevantSessions) {
      mode = 'included';
    } else if (unknownSessions === relevantSessions) {
      mode = 'unknown';
    } else if (includedSessions > 0 && (estimatedSessions > 0 || actualSessions > 0 || unknownSessions > 0)) {
      mode = 'mixed';
    } else if (actualSessions > 0 && estimatedSessions === 0 && unknownSessions === 0) {
      mode = 'actual';
    } else if (estimatedSessions > 0) {
      mode = 'estimated';
    }
  }

  return {
    mode,
    relevantSessions,
    includedSessions,
    estimatedSessions,
    actualSessions,
    unknownSessions,
  };
}

function mergeHermesUsageLedger(base: HermesUsageBundle, ledgerDays: HermesUsageLedgerDayRecord[]): HermesUsageBundle {
  if (ledgerDays.length === 0) return base;

  const usageResult: HermesUsageResult = {
    updatedAt: base.usageResult.updatedAt,
    startDate: base.usageResult.startDate,
    endDate: base.usageResult.endDate,
    sessions: [...(base.usageResult.sessions ?? [])],
    totals: cloneHermesUsageTotals(base.usageResult.totals),
    aggregates: {
      messages: { ...(base.usageResult.aggregates?.messages ?? { total: 0, user: 0, assistant: 0, toolCalls: 0, toolResults: 0, errors: 0 }) },
      tools: {
        totalCalls: base.usageResult.aggregates?.tools?.totalCalls ?? 0,
        uniqueTools: base.usageResult.aggregates?.tools?.uniqueTools ?? 0,
        tools: [...(base.usageResult.aggregates?.tools?.tools ?? [])],
      },
      byModel: [...(base.usageResult.aggregates?.byModel ?? [])],
      byProvider: [...(base.usageResult.aggregates?.byProvider ?? [])],
      byAgent: [...(base.usageResult.aggregates?.byAgent ?? [])],
      byChannel: [...(base.usageResult.aggregates?.byChannel ?? [])],
      daily: [...(base.usageResult.aggregates?.daily ?? [])],
    },
    costPresentation: base.usageResult.costPresentation,
  };
  const costSummary: HermesCostSummary = {
    updatedAt: base.costSummary.updatedAt,
    days: base.costSummary.days,
    daily: [...(base.costSummary.daily ?? [])],
    totals: cloneHermesUsageTotals(base.costSummary.totals),
    costPresentation: base.costSummary.costPresentation,
  };
  const usageTotals = usageResult.totals ?? createEmptyHermesUsageTotals();
  const costTotals = costSummary.totals ?? createEmptyHermesUsageTotals();
  usageResult.totals = usageTotals;
  costSummary.totals = costTotals;

  const existingSessionIds = new Set((usageResult.sessions ?? []).map((session) => session.key));
  const dailyUsageMap = new Map((usageResult.aggregates?.daily ?? []).map((entry) => [entry.date, { ...entry }]));
  const dailyCostMap = new Map((costSummary.daily ?? []).map((entry) => [entry.date, {
    ...cloneHermesUsageTotals(entry),
    date: entry.date,
  } as HermesUsageTotals & { date: string }]));

  for (const day of ledgerDays) {
    for (const [sessionId, entry] of Object.entries(day.sessions)) {
      if (existingSessionIds.has(sessionId)) continue;

      const dailyUsage = dailyUsageMap.get(day.date) ?? {
        date: day.date,
        tokens: 0,
        cost: 0,
        messages: 0,
        toolCalls: 0,
        errors: 0,
      };
      dailyUsage.tokens += entry.totals.totalTokens;
      dailyUsage.cost += entry.totals.totalCost;
      dailyUsageMap.set(day.date, dailyUsage);

      const dailyCost = (dailyCostMap.get(day.date) ?? {
        ...createEmptyHermesUsageTotals(),
        date: day.date,
      }) as HermesUsageTotals & { date: string };
      addHermesUsageTotals(dailyCost, entry.totals);
      dailyCostMap.set(day.date, dailyCost);
    }
  }

  const mergedSessions = new Map((usageResult.sessions ?? []).map((session) => [session.key, session]));
  for (const day of ledgerDays) {
    for (const [sessionId, entry] of Object.entries(day.sessions)) {
      if (existingSessionIds.has(sessionId)) continue;
      const existing = mergedSessions.get(sessionId);
      if (existing) {
        existing.usage = {
          totalTokens: (existing.usage?.totalTokens ?? 0) + entry.totals.totalTokens,
          totalCost: (existing.usage?.totalCost ?? 0) + entry.totals.totalCost,
          costStatus: existing.usage?.costStatus ?? entry.costStatus,
          costSource: existing.usage?.costSource ?? entry.costSource,
          messageCounts: existing.usage?.messageCounts ?? {
            total: 0,
            user: 0,
            assistant: 0,
            toolCalls: 0,
            toolResults: 0,
            errors: 0,
          },
        };
        existing.updatedAt = Math.max(existing.updatedAt ?? 0, entry.updatedAt);
        continue;
      }
      mergedSessions.set(sessionId, {
        key: sessionId,
        label: entry.label,
        agentId: entry.agentId,
        channel: entry.channel,
        model: entry.model,
        modelProvider: entry.modelProvider,
        updatedAt: entry.updatedAt,
        usage: {
          totalTokens: entry.totals.totalTokens,
          totalCost: entry.totals.totalCost,
          costStatus: entry.costStatus,
          costSource: entry.costSource,
          messageCounts: {
            total: 0,
            user: 0,
            assistant: 0,
            toolCalls: 0,
            toolResults: 0,
            errors: 0,
          },
        },
      });
    }
  }

  const addedSessions = [...mergedSessions.values()].filter((session) => !existingSessionIds.has(session.key));
  for (const session of addedSessions) {
    addHermesUsageTotals(usageTotals, {
      totalTokens: session.usage?.totalTokens ?? 0,
      totalCost: session.usage?.totalCost ?? 0,
    });
    addHermesUsageTotals(costTotals, {
      totalTokens: session.usage?.totalTokens ?? 0,
      totalCost: session.usage?.totalCost ?? 0,
    });

    upsertHermesUsageModelTotals(usageResult.aggregates?.byModel ?? [], session.modelProvider, session.model, session.usage?.totalTokens ?? 0, session.usage?.totalCost ?? 0);
    upsertHermesUsageModelTotals(usageResult.aggregates?.byProvider ?? [], session.modelProvider, session.modelProvider, session.usage?.totalTokens ?? 0, session.usage?.totalCost ?? 0);
    upsertHermesUsageChannelTotals(usageResult.aggregates?.byChannel ?? [], session.channel, session.usage?.totalTokens ?? 0, session.usage?.totalCost ?? 0);
  }

  if (usageResult.aggregates) {
    usageResult.aggregates.daily = [...dailyUsageMap.values()].sort((left, right) => left.date.localeCompare(right.date));
    usageResult.aggregates.byAgent = usageResult.sessions && usageResult.sessions.length > 0
      ? [{ agentId: 'main', totals: cloneHermesUsageTotals(usageResult.totals) }]
      : [];
  }
  costSummary.daily = [...dailyCostMap.values()].sort((left, right) => left.date.localeCompare(right.date));
  costSummary.days = costSummary.daily.length;

  usageResult.sessions = [...mergedSessions.values()].sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0));
  usageResult.costPresentation = resolveHermesCostPresentationFromSessions(usageResult.sessions);
  costSummary.costPresentation = usageResult.costPresentation;

  return {
    usageResult,
    costSummary,
  };
}

function upsertHermesUsageModelTotals(
  entries: Array<{ provider?: string; model?: string; count: number; totals: HermesUsageTotals }>,
  provider: string | undefined,
  model: string | undefined,
  totalTokens: number,
  totalCost: number,
): void {
  const target = entries.find((entry) => (entry.provider ?? null) === (provider ?? null) && (entry.model ?? null) === (model ?? null));
  if (target) {
    addHermesUsageTotals(target.totals, { totalTokens, totalCost });
    return;
  }
  entries.push({
    provider,
    model,
    count: 0,
    totals: cloneHermesUsageTotals({ totalTokens, totalCost }),
  });
}

function upsertHermesUsageChannelTotals(
  entries: Array<{ channel: string; totals: HermesUsageTotals }>,
  channel: string | undefined,
  totalTokens: number,
  totalCost: number,
): void {
  const normalized = channel?.trim() || 'unknown';
  const target = entries.find((entry) => entry.channel === normalized);
  if (target) {
    addHermesUsageTotals(target.totals, { totalTokens, totalCost });
    return;
  }
  entries.push({
    channel: normalized,
    totals: cloneHermesUsageTotals({ totalTokens, totalCost }),
  });
}

class HermesUsageLedgerStore {
  private state: HermesUsageLedgerPersistedState;

  constructor(private readonly filePath: string) {
    this.state = this.load();
  }

  readRange(startDate: string, endDate: string): HermesUsageLedgerDayRecord[] {
    return Object.values(this.state.days)
      .filter((entry) => entry.date >= startDate && entry.date <= endDate)
      .sort((left, right) => left.date.localeCompare(right.date))
      .map((entry) => ({
        date: entry.date,
        sessions: Object.fromEntries(Object.entries(entry.sessions).map(([sessionId, value]) => [
          sessionId,
          {
            ...value,
            totals: cloneHermesUsageTotals(value.totals),
          },
        ])),
      }));
  }

  recordObservation(input: {
    sessionId: string;
    key: string;
    label: string;
    agentId: string;
    channel?: string;
    model?: string;
    modelProvider?: string;
    costStatus?: string;
    costSource?: string;
    observedAtMs: number;
    startedAtMs?: number;
    currentTotals: HermesUsageTotals;
    baselineTotals: HermesUsageTotals | null;
    allowAbsoluteBootstrap: boolean;
  }): void {
    const previous = this.state.snapshots[input.sessionId];
    const baselineTotals = input.baselineTotals ?? previous?.totals ?? null;
    const delta = baselineTotals
      ? subtractHermesUsageTotals(input.currentTotals, baselineTotals)
      : input.allowAbsoluteBootstrap
        ? cloneHermesUsageTotals(input.currentTotals)
        : createEmptyHermesUsageTotals();
    const hasDelta = delta.totalTokens > 0 || delta.totalCost > 0 || delta.input > 0 || delta.output > 0 || delta.cacheRead > 0 || delta.cacheWrite > 0;
    if (hasDelta) {
      const date = getLocalDateKey(input.observedAtMs);
      const day = this.state.days[date] ?? { date, sessions: {} };
      const existing = day.sessions[input.sessionId];
      if (existing) {
        addHermesUsageTotals(existing.totals, delta);
        existing.updatedAt = Math.max(existing.updatedAt, input.observedAtMs);
        existing.label = input.label;
        existing.key = input.key;
        existing.agentId = input.agentId;
        existing.channel = input.channel;
        existing.model = input.model;
        existing.modelProvider = input.modelProvider;
        existing.costStatus = input.costStatus;
        existing.costSource = input.costSource;
      } else {
        day.sessions[input.sessionId] = {
          key: input.key,
          label: input.label,
          agentId: input.agentId,
          channel: input.channel,
          model: input.model,
          modelProvider: input.modelProvider,
          costStatus: input.costStatus,
          costSource: input.costSource,
          updatedAt: input.observedAtMs,
          totals: cloneHermesUsageTotals(delta),
        };
      }
      this.state.days[date] = day;
    }

    this.state.snapshots[input.sessionId] = {
      sessionId: input.sessionId,
      key: input.key,
      label: input.label,
      agentId: input.agentId,
      channel: input.channel,
      model: input.model,
      modelProvider: input.modelProvider,
      costStatus: input.costStatus,
      costSource: input.costSource,
      updatedAt: input.observedAtMs,
      startedAtMs: input.startedAtMs,
      totals: cloneHermesUsageTotals(input.currentTotals),
    };
    this.save();
  }

  private load(): HermesUsageLedgerPersistedState {
    if (!existsSync(this.filePath)) {
      return {
        version: 1,
        snapshots: {},
        days: {},
      };
    }
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as Partial<HermesUsageLedgerPersistedState>;
      return {
        version: 1,
        snapshots: isRecord(parsed.snapshots) ? parsed.snapshots as Record<string, HermesUsageLedgerSnapshotRecord> : {},
        days: isRecord(parsed.days) ? parsed.days as Record<string, HermesUsageLedgerDayRecord> : {},
      };
    } catch {
      return {
        version: 1,
        snapshots: {},
        days: {},
      };
    }
  }

  private save(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(this.state, null, 2) + '\n', 'utf8');
  }
}
