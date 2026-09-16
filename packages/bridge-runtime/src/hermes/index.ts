import { createServer, type Server as HttpServer } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { resolveHermesCommand, resolveHermesSourcePath } from './installation.js';
import { correlateActiveNativeTools, correlateLateNativeTools } from './tool-history.js';
import WebSocket, { WebSocketServer } from 'ws';
import { WEBSOCKET_FRAME_LIMIT_BYTES } from '../frame-limit.js';
import { normalizeBridgeVersion } from '../protocol.js';
import { HermesCommandMethods, type HermesModelState } from './commands.js';
import { HermesCronMethods } from './cron.js';
import { HermesHttpServerMethods, inspectHermesApi, probeHermesApi, type HermesLocalBridgeClient } from './http-server.js';
import { HermesManagementMethods } from './management.js';
import {
  HermesNativeSessionReader,
  decodeHermesHistoryCursor,
  encodeHermesHistoryCursor,
  normalizeHermesHistoryContent,
  type HermesHistoryMessage,
} from './native-sessions.js';
import { HermesPythonRunner } from './python-runner.js';
import {
  HermesBridgeSessionStore,
  type HermesSessionListEntry,
} from './session-store.js';
import {
  HermesStreamMethods,
  type HermesActiveRun,
  type HermesPendingRunStart,
} from './stream-mapping.js';
import {
  HermesUsageLedgerStore,
  HermesUsageMethods,
} from './usage-ledger.js';
import {
  BRIDGE_TICK_INTERVAL_MS,
  DEFAULT_AGENT_NAME,
  DEFAULT_BRIDGE_HOST,
  DEFAULT_BRIDGE_PORT,
  DEFAULT_HERMES_API_BASE_URL,
  DEFAULT_HERMES_HOME_PATH,
  DEFAULT_SESSION_ID,
  HEALTH_POLL_INTERVAL_MS,
  HERMES_BOOT_TIMEOUT_MS,
  HERMES_BRIDGE_CAPABILITIES,
  HERMES_STATE_DB_PATH,
  SESSION_STORE_PATH,
  USAGE_LEDGER_PATH,
  WS_HEARTBEAT_INTERVAL_MS,
  buildHermesBridgeHttpUrl,
  buildHermesBridgeWsUrl,
  delay,
  extractHostname,
  extractPort,
  formatError,
  installHermesMethods,
  isRecord,
  normalizeHost,
  normalizeHttpBase,
  normalizePort,
  readPositiveInt,
  readRequestPathname,
  readString,
} from './internal.js';

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
  bridgeVersion?: string;
  sessionStorePath?: string;
  usageLedgerPath?: string;
  hermesStateDbPath?: string;
  startHermesIfNeeded?: boolean;
  hermesCommand?: string;
  hermesSourcePath?: string;
  hermesHomePath?: string;
  hermesPythonPath?: string;
  keepSpawnedHermesGatewayAliveOnStop?: boolean;
  onLog?: (line: string) => void;
  onStatus?: (snapshot: HermesLocalBridgeSnapshot) => void;
};

export class HermesLocalBridge {
  readonly host: string;
  readonly port: number;
  readonly apiBaseUrl: string;
  apiKey: string | null;
  readonly bridgeToken: string;
  readonly displayName: string;
  readonly bridgeVersion: string | undefined;
  readonly hermesSourcePath: string;
  readonly hermesHomePath: string;
  readonly hermesPythonPath: string;
  readonly pythonRunner: HermesPythonRunner;
  readonly nativeSessions: HermesNativeSessionReader;
  readonly sessionStore: HermesBridgeSessionStore;
  readonly usageLedger: HermesUsageLedgerStore;
  readonly clients = new Set<HermesLocalBridgeClient>();
  readonly activeRuns = new Map<string, HermesActiveRun>();
  readonly pendingRunStarts = new Map<string, HermesPendingRunStart>();
  readonly snapshot: HermesLocalBridgeSnapshot;
  httpServer: HttpServer | null = null;
  wsServer: WebSocketServer | null = null;
  tickTimer: NodeJS.Timeout | null = null;
  healthTimer: NodeJS.Timeout | null = null;
  wsHeartbeatTimer: NodeJS.Timeout | null = null;
  hermesChild: ChildProcess | null = null;
  private managedApi = false;
  private apiRecoveryAfterMs = 0;
  private apiRecoveryAttempts = 0;
  private healthRefresh: Promise<void> | null = null;
  modelStateReadVersion = 0;
  modelStateCache: { value: HermesModelState; expiresAt: number } | null = null;
  readonly contextWindowCache = new Map<string, number | null>();
  bridgeRequestSeq = 0;
  readonly sessionWarnings: string[] = [];

  constructor(readonly options: HermesLocalBridgeOptions = {}) {
    this.host = normalizeHost(options.host);
    this.port = normalizePort(options.port);
    this.apiBaseUrl = normalizeHttpBase(options.apiBaseUrl ?? DEFAULT_HERMES_API_BASE_URL);
    this.bridgeToken = options.bridgeToken?.trim() || randomUUID();
    this.displayName = options.displayName?.trim() || DEFAULT_AGENT_NAME;
    this.bridgeVersion = normalizeBridgeVersion(options.bridgeVersion);
    this.hermesSourcePath = options.hermesSourcePath?.trim() || resolveHermesSourcePath();
    this.hermesHomePath = options.hermesHomePath?.trim() || DEFAULT_HERMES_HOME_PATH;
    // The CLI persists the bridge token. Derive a separate, scope-bound API key
    // so a Clawket-owned gateway can survive a Bridge restart without losing auth.
    this.apiKey = options.apiKey?.trim() || process.env.CLAWKET_HERMES_API_KEY?.trim()
      || createHash('sha256').update(JSON.stringify([
        'clawket-hermes-api-v1', this.bridgeToken, this.apiBaseUrl, this.hermesHomePath,
      ])).digest('hex');
    this.pythonRunner = new HermesPythonRunner({
      hermesSourcePath: this.hermesSourcePath,
      hermesHomePath: this.hermesHomePath,
      hermesPythonPath: options.hermesPythonPath,
    });
    this.hermesPythonPath = this.pythonRunner.pythonPath;
    this.sessionStore = new HermesBridgeSessionStore(options.sessionStorePath ?? SESSION_STORE_PATH);
    this.usageLedger = new HermesUsageLedgerStore(options.usageLedgerPath ?? USAGE_LEDGER_PATH);
    this.nativeSessions = new HermesNativeSessionReader(
      options.hermesStateDbPath?.trim() || HERMES_STATE_DB_PATH,
      this.pythonRunner,
    );
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
    this.pythonRunner.resume();

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
    this.wsServer = new WebSocketServer({
      noServer: true,
      maxPayload: WEBSOCKET_FRAME_LIMIT_BYTES,
    });
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
    this.wsHeartbeatTimer = setInterval(() => {
      this.sweepWsHeartbeats();
    }, WS_HEARTBEAT_INTERVAL_MS);

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
    this.operationGeneration += 1;
    this.managedApi = false;
    this.pythonRunner.stop();
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }
    if (this.wsHeartbeatTimer) {
      clearInterval(this.wsHeartbeatTimer);
      this.wsHeartbeatTimer = null;
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

    // Drain debounced disk writers so we never lose the last few writes when
    // the bridge process is being torn down.
    await Promise.all([
      this.sessionStore.flush().catch(() => undefined),
      this.usageLedger.flush().catch(() => undefined),
    ]);

    this.updateSnapshot({
      running: false,
      prewarmComplete: false,
      clientCount: 0,
    });
  }

  async ensureHermesApiReady(): Promise<boolean> {
    const generation = this.operationGeneration;
    const startedAt = Date.now();
    const apiStatus = await inspectHermesApi(this.apiBaseUrl, this.apiKey);
    if (generation !== this.operationGeneration) return false;
    if (apiStatus === 'ready') {
      this.updateSnapshot({ hermesApiReachable: true, lastError: null });
      this.logPerf('hermes_api_probe', {
        result: 'warm',
        elapsedMs: Date.now() - startedAt,
      });
      this.log(`reusing Hermes API already running at ${this.apiBaseUrl}`);
      return true;
    }

    if (apiStatus === 'unauthorized') {
      this.updateSnapshot({ hermesApiReachable: false, lastError: 'The running Hermes API rejected the configured API key. Set CLAWKET_HERMES_API_KEY to its API_SERVER_KEY, or explicitly restart the gateway with clawket hermes run --restart-hermes.' });
      this.logPerf('hermes_api_probe', { result: 'unauthorized', elapsedMs: Date.now() - startedAt });
      return false;
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

  async startHermesGatewayProcess(): Promise<boolean> {
    const generation = this.operationGeneration;
    const command = this.options.hermesCommand?.trim() || resolveHermesCommand();
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
    // Current Hermes requires an authenticated API even on loopback. A key for
    // our child is scoped separately from the bridge token and reused by API requests.
    this.apiKey ??= randomUUID();
    const hermesChildEnv: NodeJS.ProcessEnv = {
      ...process.env,
      HERMES_HOME: this.hermesHomePath,
      API_SERVER_ENABLED: 'true',
      API_SERVER_KEY: this.apiKey,
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
    this.managedApi = true;

    let spawnFailure: Error | null = null;
    const child = this.hermesChild;
    child.once('error', (error: NodeJS.ErrnoException) => {
      if (generation !== this.operationGeneration || this.hermesChild !== child) return;
      spawnFailure = new Error(error.code === 'ENOENT'
        ? 'Hermes command was not found. Install Hermes and restart the Clawket bridge.'
        : `Hermes could not start (${error.code ?? 'spawn_failed'}).`);
      this.updateSnapshot({ hermesApiReachable: false, lastError: spawnFailure.message });
      if (this.hermesChild === child) this.hermesChild = null;
      this.log(spawnFailure.message);
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
      if (generation !== this.operationGeneration || this.hermesChild !== child) return;
      this.hermesChild = null;
      this.apiRecoveryAfterMs = Math.max(this.apiRecoveryAfterMs, Date.now() + 30_000);
      this.updateSnapshot({ hermesApiReachable: false, lastError: 'The managed Hermes API stopped. Clawket will retry starting it automatically.' });
    });

    const startMs = Date.now();
    while (Date.now() - startMs < HERMES_BOOT_TIMEOUT_MS) {
      if (spawnFailure || generation !== this.operationGeneration || this.hermesChild !== child) return false;
      const reachable = await probeHermesApi(this.apiBaseUrl, this.apiKey);
      if (generation !== this.operationGeneration) return false;
      if (reachable) {
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

  async refreshHermesHealth(): Promise<void> {
    if (this.healthRefresh) return this.healthRefresh;
    const refresh = this.refreshHermesHealthOnce();
    this.healthRefresh = refresh;
    try { await refresh; } finally {
      if (this.healthRefresh === refresh) this.healthRefresh = null;
    }
  }

  private async refreshHermesHealthOnce(): Promise<void> {
    const generation = this.operationGeneration;
    let reachable = await probeHermesApi(this.apiBaseUrl, this.apiKey);
    if (generation !== this.operationGeneration) return;
    // Only restart an API this runtime owned after its child has actually
    // exited. A failed probe must never replace a live or externally owned API.
    if (!reachable && this.managedApi && !this.hermesChild
        && this.snapshot.running && this.options.startHermesIfNeeded !== false
        && Date.now() >= this.apiRecoveryAfterMs) {
      this.apiRecoveryAttempts += 1;
      this.apiRecoveryAfterMs = Date.now() + Math.min(300_000, 30_000 * 2 ** Math.min(4, this.apiRecoveryAttempts - 1));
      this.logPerf('hermes_api_recovery_begin', { attempt: this.apiRecoveryAttempts });
      reachable = await this.ensureHermesApiReady();
      if (generation !== this.operationGeneration) return;
    }
    if (reachable) {
      this.apiRecoveryAttempts = 0;
      this.apiRecoveryAfterMs = 0;
    }
    this.updateSnapshot({
      hermesApiReachable: reachable,
      lastError: reachable ? null : this.snapshot.lastError ?? 'Hermes API is not reachable. Check the local gateway.',
    });
    this.broadcastEvent('health', {
      status: reachable ? 'ok' : 'degraded',
      ts: Date.now(),
      hermesApiReachable: reachable,
      mode: 'hermes',
      capabilities: [...HERMES_BRIDGE_CAPABILITIES],
      ...(this.bridgeVersion ? { bridgeVersion: this.bridgeVersion } : {}),
    });
  }

  async prewarmBridgeState(): Promise<void> {
    const startedAt = Date.now();
    this.logPerf('bridge_prewarm_begin');
    const tasks: Array<() => Promise<void>> = [
      async () => {
        (await this.listHermesSessions(24));
      },
      async () => {
        const mainSession = this.sessionStore.findSession(DEFAULT_SESSION_ID);
        if (mainSession) (await this.getHermesSessionHistory(mainSession.key, 24));
      },
      async () => {
        (await this.readHermesModelState({ caller: 'prewarm' }));
      },
    ];

    await Promise.allSettled(tasks.map(async (task) => {
      try {
        await task();
      } catch (error) {
        this.log(`bridge prewarm skipped: ${formatError(error)}`);
      }
    }));
    this.logPerf('bridge_prewarm_done', {
      elapsedMs: Date.now() - startedAt,
    });
  }


  async runHermesPython<T>(script: string, stdinPayload?: unknown): Promise<T> {
    return (await this.pythonRunner.run<T>(script, stdinPayload));
  }

  async listHermesSessions(limit: number): Promise<HermesSessionListEntry[]> {
    const active = (key: string) => [...this.activeRuns.values()].some((run) => run.sessionKey === key);
    const bridgeSessions: HermesSessionListEntry[] = [];
    for (const session of this.sessionStore.listSessions(limit, active)) {
      const backing = (await this.nativeSessions.readHistoryBySessionId(session.sessionId));
      const lastMessage = backing?.messages.at(-1);
      const preview = lastMessage ? normalizeHermesHistoryContent(lastMessage.content) : session.preview;
      bridgeSessions.push({
        ...session,
        updatedAt: Math.max(session.updatedAt, backing?.updatedAt ?? 0),
        preview,
        lastMessagePreview: preview,
        model: lastMessage?.model ?? session.model,
        modelProvider: lastMessage?.provider ?? session.modelProvider,
      });
    }
    const bridgeKeys = new Set(bridgeSessions.map((session) => session.key));
    const nativeSessions = (await this.nativeSessions
      .listSessions(Math.max(limit, limit + bridgeSessions.length), active))
      .filter((session) => !bridgeKeys.has(session.key));
    return [...bridgeSessions, ...nativeSessions]
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, limit);
  }

  async isNativeOnlySession(key: string): Promise<boolean> {
    if (this.sessionStore.owns(key)) return false;
    return (await this.nativeSessions.findSession(key)) !== null;
  }

  async getHermesSessionListDefaults(): Promise<{ contextTokens?: number } | undefined> {
    try {
      const current = (await this.readHermesCurrentModelState());
      const contextTokens = (await this.resolveHermesContextWindow({
        model: current.currentModel,
        provider: current.currentProvider,
        baseUrl: current.currentBaseUrl,
      }));
      return typeof contextTokens === 'number' && Number.isFinite(contextTokens) && contextTokens > 0
        ? { contextTokens }
        : undefined;
    } catch (error) {
      this.sessionWarnings.push(`Hermes model defaults are unavailable: ${formatError(error)}`);
      return undefined;
    }
  }

  async getHermesSessionHistory(
    key: string,
    limit: number,
    rawCursor?: unknown,
  ): Promise<{ messages: HermesHistoryMessage[]; sessionId: string; thinkingLevel: string; nextCursor?: string;
    hasActiveRun?: boolean; toolCallAliases?: Record<string, string>;
    inFlightRun?: { runId: string; text: string; startedAt?: number; sessionAbortable: boolean } }> {
    const bridgeSession = this.sessionStore.findSession(key);
    const nativeListEntry = bridgeSession
      ? null
      : (await this.nativeSessions.findSession(key));
    if (!bridgeSession && !nativeListEntry) {
      if (key === DEFAULT_SESSION_ID) {
        return {
          messages: [],
          sessionId: DEFAULT_SESSION_ID,
          thinkingLevel: (await this.getSafeHermesThinkingLevel()),
        };
      }
      throw new Error(`Hermes session not found: ${key}`);
    }
    const sessionId = bridgeSession?.sessionId ?? nativeListEntry!.sessionId;
    const native = (await this.nativeSessions.readHistoryBySessionId(sessionId));
    const nativeMessages = native?.messages ?? [];
    if (bridgeSession) {
      const tools = [...this.activeRuns.values()]
        .filter(run => run.sessionKey === key && run.sessionId === sessionId)
        .flatMap(run => [...(run.tools ?? [])].flatMap(([toolName, calls]) => calls.map(call => ({ ...call, toolName }))));
      this.sessionStore.rememberToolAliases(key, correlateActiveNativeTools(nativeMessages, tools));
    }
    let localMessages: HermesHistoryMessage[] = (bridgeSession?.messages ?? [])
      .map((message) => ({
        role: message.role,
        content: message.content,
        timestamp: message.ts,
        runId: message.runId,
        idempotencyKey: message.idempotencyKey,
        toolName: message.toolName,
        toolCallId: message.toolCallId,
        _nativeToolCallId: message._nativeToolCallId,
        isError: message.isError,
        toolArgs: message.toolArgs,
        toolDurationMs: message.toolDurationMs,
        toolStartedAt: message.toolStartedAt,
        toolFinishedAt: message.toolFinishedAt,
        _nativeBoundaryId: message._nativeBoundaryId,
      }));
    localMessages = correlateLateNativeTools(nativeMessages, localMessages);
    if (bridgeSession) {
      this.sessionStore.rememberToolAliases(key, Object.fromEntries(localMessages.flatMap(message =>
        message._nativeToolCallId && message.toolCallId
          ? [[message._nativeToolCallId, { toolCallId: message.toolCallId, toolName: message.toolName }]] : [])));
    }
    const messages = mergeHermesHistoryMessages(nativeMessages, localMessages, bridgeSession?.toolAliases);
    const cursor = decodeHermesHistoryCursor(rawCursor, sessionId);
    let eligible = messages;
    if (cursor) {
      const boundaryIndex = messages.findIndex((message) => message._cursorId === cursor.beforeId);
      if (boundaryIndex < 0) throw new Error('chat.history cursor boundary is no longer available.');
      if (messages[boundaryIndex]?.timestamp !== cursor.beforeTimestamp) {
        throw new Error('chat.history cursor boundary does not match its timestamp.');
      }
      eligible = messages.slice(0, boundaryIndex);
    }
    const pageWithIds = limit > 0 ? eligible.slice(-limit) : eligible;
    const hasOlder = eligible.length > pageWithIds.length;
    const first = pageWithIds[0];
    const page = pageWithIds.map(({
      _cursorId: _discarded,
      _nativeId: _nativeId,
      _nativeBoundaryId: _nativeBoundaryId,
      _nativeToolCallId: _nativeToolCallId,
      _sortId: _sortId,
      ...message
    }) => message);
    // Old clients may have cached a provider ID before its live alias was known.
    // Expose only confirmed aliases represented on this page, never guesses.
    const pageToolIds = new Set(page.flatMap(message => [
      ...(message.toolCallId ? [message.toolCallId] : []),
      ...(Array.isArray(message.content) ? message.content.flatMap(block =>
        isRecord(block) && block.type === 'toolCall' && typeof block.id === 'string' ? [block.id] : []) : []),
    ]));
    const toolCallAliases = Object.fromEntries(Object.entries(bridgeSession?.toolAliases ?? {})
      .filter(([nativeId, alias]) => nativeId !== alias.toolCallId && pageToolIds.has(alias.toolCallId))
      .map(([nativeId, alias]) => [nativeId, alias.toolCallId]));
    const thinkingLevel = await this.getSafeHermesThinkingLevel();
    // Read after asynchronous history/model work: a terminal event may have
    // removed the run while those reads were pending. Never resurrect it.
    const active = [...this.activeRuns.values()].find(run => run.sessionKey === key && run.sessionId === sessionId);
    return {
      messages: page,
      sessionId,
      thinkingLevel,
      hasActiveRun: Boolean(active),
      ...(Object.keys(toolCallAliases).length ? { toolCallAliases } : {}),
      ...(active ? { inFlightRun: {
        runId: active.runId, text: active.text ?? '', startedAt: active.startedAt, sessionAbortable: true,
      } } : {}),
      ...(hasOlder && first ? {
        nextCursor: encodeHermesHistoryCursor({
          version: 1,
          sessionId,
          beforeTimestamp: first.timestamp,
          beforeId: first._cursorId!,
        }),
      } : {}),
    };
  }

  async getSafeHermesThinkingLevel(): Promise<string> {
    try {
      return (await this.getHermesThinkingLevel());
    } catch (error) {
      this.sessionWarnings.push(`Hermes thinking state is unavailable: ${formatError(error)}`);
      return 'medium';
    }
  }

  createHermesSession(payload: Record<string, unknown>): HermesSessionListEntry {
    if (payload.title !== undefined && typeof payload.title !== 'string') {
      throw new Error('sessions.create title must be a string.');
    }
    const created = this.sessionStore.createSession({ title: readString(payload.title) || null });
    this.updateSnapshot({ sessionCount: this.sessionStore.count() });
    return this.sessionStore.listSessions(this.sessionStore.count())
      .find((session) => session.key === created.key)!;
  }

  patchHermesSession(key: string, title: string): { ok: true; key: string } {
    if (!this.sessionStore.owns(key)) throw new Error(`Hermes native session is read-only: ${key}`);
    if (!title) throw new Error('sessions.patch requires title.');
    this.sessionStore.renameSession(key, title);
    return { ok: true, key };
  }

  resetHermesSession(key: string): { ok: true; key: string; sessionId: string } {
    if (!this.sessionStore.owns(key)) throw new Error(`Hermes native session is read-only: ${key}`);
    this.cancelActiveRunsForSession(key);
    const session = this.sessionStore.resetSession(key);
    return { ok: true, key, sessionId: session.sessionId };
  }

  deleteHermesSession(key: string): { ok: true; key: string } {
    if (!this.sessionStore.owns(key)) throw new Error(`Hermes native session is read-only: ${key}`);
    this.cancelActiveRunsForSession(key);
    this.sessionStore.deleteSession(key);
    this.updateSnapshot({ sessionCount: this.sessionStore.count() });
    return { ok: true, key };
  }

  private operationGeneration = 0;
  private mutationTail: Promise<unknown> = Promise.resolve();
  private queuedMutations = 0;

  async dispatchRequest(method: string, params: unknown): Promise<unknown> {
    // Keep whole config/session mutations serialized after making Python nonblocking.
    // Read-only requests and health must never wait behind these operations.
    if (/^(model\.set|skills\.(update|delete|content\.update)|hermes\.(reasoning|fast)\.set|hermes\.cron\.jobs\.(create|update|pause|resume|run|remove)|chat\.send)$/.test(method)) {
      if (this.queuedMutations >= 32) throw new Error('Hermes is busy. Try again shortly.');
      this.queuedMutations += 1;
      const generation = this.operationGeneration;
      const operation = this.mutationTail.catch(() => undefined).then(() => {
        if (generation !== this.operationGeneration) throw new Error('Hermes operation cancelled.');
        return this.dispatchRequestNow(method, params);
      });
      this.mutationTail = operation;
      try { return await operation; }
      finally { this.queuedMutations -= 1; }
    }
    return this.dispatchRequestNow(method, params);
  }

  private async dispatchRequestNow(method: string, params: unknown): Promise<unknown> {
    const payload = isRecord(params) ? params : {};
    const shouldTracePerf = method === 'health'
      || method === 'last-heartbeat'
      || method === 'sessions.list'
      || method === 'chat.history'
      || method === 'chat.send'
      || method === 'models.list'
      || method === 'model.current'
      || method === 'model.get';
    const requestStartedAt = shouldTracePerf ? Date.now() : 0;
    const requestSeq = shouldTracePerf ? ++this.bridgeRequestSeq : 0;
    if (shouldTracePerf) {
      this.logPerf('bridge_request_begin', {
        requestSeq,
        method,
        sessionKey: readString(payload.sessionKey) || undefined,
        limit: readPositiveInt(payload.limit, 0) || undefined,
      });
    }
    switch (method) {
      case 'health':
      case 'last-heartbeat':
        return this.traceBridgeRequest(method, requestStartedAt, requestSeq, {
          status: this.snapshot.hermesApiReachable ? 'ok' : 'degraded',
          ts: Date.now(),
          hermesApiReachable: this.snapshot.hermesApiReachable,
          capabilities: [...HERMES_BRIDGE_CAPABILITIES],
          ...(this.bridgeVersion ? { bridgeVersion: this.bridgeVersion } : {}),
        });
      case 'sessions.list': {
        const defaults = (await this.getHermesSessionListDefaults());
        const sessions = (await this.listHermesSessions(readPositiveInt(payload.limit, 100)));
        const warnings = [...this.nativeSessions.consumeWarnings(), ...this.sessionWarnings.splice(0)];
        return this.traceBridgeRequest(method, requestStartedAt, requestSeq, {
          defaults,
          sessions,
          warnings,
        });
      }
      case 'sessions.create':
        return { session: this.createHermesSession(payload) };
      case 'chat.history': {
        const sessionKey = readString(payload.sessionKey);
        if (!sessionKey) throw new Error('chat.history requires sessionKey.');
        return this.traceBridgeRequest(method, requestStartedAt, requestSeq, (await this.getHermesSessionHistory(
          sessionKey,
          readPositiveInt(payload.limit, 50),
          payload.cursor,
        )));
      }
      case 'chat.send':
        return this.traceBridgeRequest(method, requestStartedAt, requestSeq, (await this.handleChatSend(payload)));
      case 'sessions.reset': {
        const key = readString(payload.key);
        if (!key) throw new Error('sessions.reset requires key.');
        return this.resetHermesSession(key);
      }
      case 'sessions.delete': {
        const key = readString(payload.key);
        if (!key) throw new Error('sessions.delete requires key.');
        return this.deleteHermesSession(key);
      }
      case 'sessions.patch': {
        const key = readString(payload.key);
        if (!key) throw new Error('sessions.patch requires key.');
        if (payload.title !== undefined && typeof payload.title !== 'string') {
          throw new Error('sessions.patch title must be a string.');
        }
        if (payload.title === undefined && payload.label !== undefined && typeof payload.label !== 'string') {
          throw new Error('sessions.patch label must be a string.');
        }
        return this.patchHermesSession(
          key,
          readString(payload.title) || readString(payload.label),
        );
      }
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
        return (await this.getHermesSkillsStatus(readString(payload.agentId) || 'main'));
      case 'skills.get':
        return (await this.getHermesSkillDetail(
          readString(payload.agentId) || 'main',
          readString(payload.skillKey),
          readString(payload.filePath),
        ));
      case 'skills.update':
        return (await this.updateHermesSkill(readString(payload.agentId) || 'main', payload));
      case 'skills.delete':
        return (await this.deleteHermesSkill(
          readString(payload.agentId) || 'main',
          readString(payload.skillKey),
        ));
      case 'skills.content.update':
        return (await this.updateHermesSkillContent(
          readString(payload.agentId) || 'main',
          readString(payload.skillKey),
          readString(payload.content) ?? '',
        ));
      case 'sessions.usage':
        return this.readHermesUsageBundle(payload).usageResult;
      case 'usage.cost':
        return this.readHermesUsageBundle(payload).costSummary;
      case 'models.list':
        return {
          models: (await this.readHermesModelState({ caller: 'models.list' })).models,
        };
      case 'model.current':
        return (await this.readHermesCurrentModelState());
      case 'model.get':
        return (await this.readHermesModelState({ caller: 'model.get' }));
      case 'model.set':
        return (await this.setHermesModel(payload));
      case 'hermes.reasoning.get':
        return (await this.getHermesReasoningPayload());
      case 'hermes.reasoning.set':
        return (await this.setHermesReasoningPayload(payload));
      case 'hermes.fast.get':
        return (await this.getHermesFastModePayload());
      case 'hermes.fast.set':
        return (await this.setHermesFastModePayload(payload));
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

  async traceBridgeRequest<T>(
    method: string,
    startedAt: number,
    requestSeq: number,
    value: T | Promise<T>,
  ): Promise<T> {
    const result = await value;
    if (startedAt > 0) {
      this.logPerf('bridge_request', {
        requestSeq,
        method,
        elapsedMs: Date.now() - startedAt,
      });
    }
    return result;
  }


  updateSnapshot(patch: Partial<HermesLocalBridgeSnapshot>): void {
    Object.assign(this.snapshot, patch, {
      lastUpdatedMs: Date.now(),
      sessionCount: this.sessionStore.count(),
    });
    this.options.onStatus?.(this.getSnapshot());
  }

  log(line: string): void {
    this.options.onLog?.(line);
  }

  logPerf(event: string, fields?: Record<string, unknown>): void {
    const payload = fields
      ? Object.entries(fields)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => `${key}=${String(value)}`)
        .join(' ')
      : '';
    this.log(`[perf] ${event}${payload ? ` ${payload}` : ''}`);
  }


}

type CursorHistoryMessage = HermesHistoryMessage & { _cursorId: string; _sortId: string };

function mergeHermesHistoryMessages(
  nativeMessages: HermesHistoryMessage[],
  localMessages: HermesHistoryMessage[],
  persistedAliases: Record<string, { toolCallId: string; toolName?: string }> = {},
): CursorHistoryMessage[] {
  // SSE tools have Bridge IDs; native history learns provider IDs later.
  // Keep the live identity authoritative while this runtime still owns it.
  const toolAliases = new Map<string, { toolCallId?: string; toolName?: string; isError?: boolean }>(Object.entries(persistedAliases));
  for (const [id, message] of localMessages.flatMap(message => (
    message.role === 'toolResult' && message._nativeToolCallId && message.toolCallId
      ? [[message._nativeToolCallId, message] as const] : []
  ))) toolAliases.set(id, message);
  nativeMessages = nativeMessages.map(message => {
    if (message.role === 'toolResult' && message.toolCallId) {
      const local = toolAliases.get(message.toolCallId);
      if (local) return { ...message, toolCallId: local.toolCallId, toolName: local.toolName ?? message.toolName, isError: local.isError ?? message.isError };
    }
    if (message.role === 'assistant' && Array.isArray(message.content)) {
      return { ...message, content: message.content.map(block => {
        if (!isRecord(block) || block.type !== 'toolCall' || typeof block.id !== 'string') return block;
        const local = toolAliases.get(block.id);
        return local ? { ...block, id: local.toolCallId } : block;
      }) };
    }
    return message;
  });
  const nativeByDigest = new Map<string, Array<{
    message: CursorHistoryMessage;
    matched: boolean;
  }>>();
  const taggedNative = nativeMessages.map((message, index) => {
    const digest = hermesHistorySemanticDigest(message);
    const tagged: CursorHistoryMessage = {
      ...message,
      _cursorId: message._cursorId
        ?? `native:${String(message._nativeId ?? index).padStart(20, '0')}`,
      _sortId: `0:${String(Number(message._nativeId) || index).padStart(20, '0')}`,
    };
    const entries = nativeByDigest.get(digest) ?? [];
    entries.push({ message: tagged, matched: false });
    nativeByDigest.set(digest, entries);
    return tagged;
  });

  const localEntries = localMessages.map((message, index) => ({
    digest: hermesHistorySemanticDigest(message),
    index,
    message,
  }));
  const candidatePairs = localEntries.flatMap((local) => {
    const boundaryId = Number(local.message._nativeBoundaryId);
    return (nativeByDigest.get(local.digest) ?? []).flatMap((candidate) => {
      const timestampDelta = Math.abs(candidate.message.timestamp - local.message.timestamp);
      const isEligible = Number.isFinite(boundaryId) && boundaryId >= 0
        ? Number(candidate.message._nativeId) > boundaryId
        : timestampDelta <= 10_000;
      return isEligible ? [{ candidate, local, timestampDelta }] : [];
    });
  }).sort((left, right) => (
    left.timestampDelta - right.timestampDelta
      || left.local.index - right.local.index
      || left.candidate.message._sortId.localeCompare(right.candidate.message._sortId)
  ));
  const matchedLocalIndexes = new Set<number>();
  const localMatches = new Map<number, (typeof candidatePairs)[number]['candidate']>();
  for (const pair of candidatePairs) {
    if (pair.candidate.matched || matchedLocalIndexes.has(pair.local.index)) continue;
    pair.candidate.matched = true;
    matchedLocalIndexes.add(pair.local.index);
    localMatches.set(pair.local.index, pair.candidate);
  }

  const localNativeAnchors = new Map<number, number>();
  const localCounts = new Map<string, number>();
  const mergedLocal = localEntries.map(({ digest, index, message }) => {
    const match = localMatches.get(index);
    const matchedNativeId = Number(match?.message._nativeId);
    const boundaryNativeId = Number(message._nativeBoundaryId);
    const nativeAnchor = Number.isFinite(matchedNativeId)
      ? matchedNativeId
      : (Number.isFinite(boundaryNativeId) ? boundaryNativeId : null);
    if (nativeAnchor != null) {
      localNativeAnchors.set(
        message.timestamp,
        Math.max(localNativeAnchors.get(message.timestamp) ?? -1, nativeAnchor),
      );
    }
    const localOccurrence = (localCounts.get(digest) ?? 0) + 1;
    localCounts.set(digest, localOccurrence);
    return {
      ...(match?.message ?? {}),
      ...message,
      _cursorId: `local:${digest}:${String(localOccurrence).padStart(8, '0')}`,
      _sortId: `1:${String(index).padStart(20, '0')}`,
    };
  });

  const unmatchedNative = taggedNative
    .filter((message) => (
      !(nativeByDigest.get(hermesHistorySemanticDigest(message)) ?? [])
        .some((candidate) => candidate.message === message && candidate.matched)
    ))
    .map((message) => {
      const nativeId = Number(message._nativeId);
      const localAnchor = localNativeAnchors.get(message.timestamp);
      const followsLocalMessages = localAnchor !== undefined
        && Number.isFinite(nativeId)
        && nativeId > localAnchor;
      return {
        ...message,
        _sortId: `${followsLocalMessages ? '2' : '0'}:${String(nativeId || 0).padStart(20, '0')}`,
      };
    });

  return [
    ...unmatchedNative,
    ...mergedLocal,
  ].sort((left, right) => (
    left.timestamp - right.timestamp || left._sortId.localeCompare(right._sortId)
  ));
}

function hermesHistorySemanticDigest(message: HermesHistoryMessage): string {
  return createHash('sha256').update(JSON.stringify({
    role: message.role,
    content: normalizeHermesHistoryContent(message.content),
    toolName: message.toolName ?? '',
    toolCallId: message.toolCallId ?? '',
    isError: message.isError === true,
  })).digest('base64url');
}

export interface HermesLocalBridge extends
  HermesCommandMethods,
  HermesCronMethods,
  HermesHttpServerMethods,
  HermesManagementMethods,
  HermesStreamMethods,
  HermesUsageMethods {}

installHermesMethods(HermesLocalBridge.prototype, HermesCommandMethods.prototype);
installHermesMethods(HermesLocalBridge.prototype, HermesCronMethods.prototype);
installHermesMethods(HermesLocalBridge.prototype, HermesHttpServerMethods.prototype);
installHermesMethods(HermesLocalBridge.prototype, HermesManagementMethods.prototype);
installHermesMethods(HermesLocalBridge.prototype, HermesStreamMethods.prototype);
installHermesMethods(HermesLocalBridge.prototype, HermesUsageMethods.prototype);

export { buildHermesBridgeWsUrl } from './internal.js';
