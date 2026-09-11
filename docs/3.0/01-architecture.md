# 01 · 架构与仓库改造

## 1. 现状（为什么要改）

| 位置 | 行数 | 问题 |
|---|---|---|
| `apps/mobile/src/services/gateway.ts` | 3,005 | 传输（Relay / 直连）、握手、重连、OpenClaw 与 Hermes 请求语义混在一个类；Hermes 探活、Hermes Cron 方法直接长在上面 |
| `apps/mobile/src/services/youmind.ts` | 3,032 | 独立世界，不经过连接层；聊天 UI 因此分叉成 `YouMindChatTab` |
| `apps/mobile/src/screens/ChatScreen/hooks/useChatController.ts` | 2,555 | 编排绑定 OpenClaw 事件形状，Hermes 靠特判 |
| `packages/bridge-runtime/src/hermes.ts` | 5,878 | 会话存储、用量账本、命令、流转换、HTTP 服务塞在一个文件 |
| `apps/relay-worker` 与 `apps/hermes-relay-worker`；两套 Registry | 2 × ~2,000 | 六成逐行相同，按后端复制而不是按配置部署 |
| 后端分支 | 36 处 `backendKind ===`、13 处 `mode === 'hermes'`、23 处 youmind 特判 | 能力矩阵存在但没人只靠它 |

## 2. 目标：四层，每层只认一个接口

```
┌──────────────────────────── UI 层（花名册 / 线程 / 面板 / 设置）────────────────────────────┐
│  只 import @clawket/agent-protocol 的类型 + src/connection/index.ts 的 hooks                  │
└──────────────────────────────────────────────┬──────────────────────────────────────────────┘
                                               │ AgentAdapter · Capabilities · SessionUpdate
┌──────────────────────────── 适配器层 src/connection/adapters ────────────────────────────────┐
│  OpenClawAdapter        HermesAdapter          YouMindSpriteAdapter                            │
│  Gateway JSON-RPC       Bridge 协议            HTTPS + CompletionStreamChunk                   │
└──────────────────────────────────────────────┬──────────────────────────────────────────────┘
                                               │ Transport（send / onMessage / state）
┌──────────────────────────── 传输层 src/connection/transports ────────────────────────────────┐
│  RelayWsTransport        DirectWsTransport      HttpStreamTransport                            │
│  握手、探活、退避、心跳协商；不含任何后端语义                                                    │
└──────────────────────────────────────────────┬──────────────────────────────────────────────┘
                                               │
┌──────────────────────────── 连接注册表 src/connection/registry ──────────────────────────────┐
│  ConnectionStore（多连接持久化） · RosterCache（第 0 档缓存） · UnreadWatermarks · 遥测         │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
```

规则：

1. UI 层禁止 import `connection/adapters/*` 与 `connection/transports/*`，只能通过 `connection/index.ts`。
2. 适配器禁止 import React。
3. 传输禁止知道 `backendKind`。
4. `backendKind` 的分支只允许出现在 `connection/registry/adapter-factory.ts` 一处（按类型实例化适配器）。M4 完成标准里的 grep 就是查这条。

## 3. `@clawket/agent-protocol`（M1）

位置 `packages/agent-protocol`，纯 TypeScript，无运行时依赖。

### 3.1 描述符

```ts
// 持久化记录：含凭据，存 SecureStore；只有连接注册表读写它
export type ConnectionRecord = {
  id: string;
  backendKind: BackendKind;
  transportKind: TransportKind;
  label: string;
  environment?: 'production' | 'preview';
  createdAt: number;
  url: string;                          // 直连 / Bridge / YouMind base URL
  auth?: { token?: string; password?: string };
  bootstrap?: OpenClawBootstrapConfig;  // 现有类型原样迁移
  relay?: RelayGatewayConfig;           // 现有类型原样迁移
  hermes?: HermesGatewayConfig;         // 现有类型原样迁移
  youmind?: { authScopeKey: string };   // 邮箱登录会话的存储 key
  debugMode?: boolean;
};

// 脱敏视图：UI 与协议层只见这个
export type BackendKind = 'openclaw' | 'hermes' | 'youmind';
export type TransportKind = 'relay' | 'local' | 'tailscale' | 'cloudflare' | 'custom' | 'https';

export type ConnectionDescriptor = {
  id: string;                 // 本地生成的稳定 id
  backendKind: BackendKind;
  transportKind: TransportKind;
  label: string;              // 用户可见名，如 lucy / hermes / YouMind
  environment?: 'production' | 'preview';
  createdAt: number;
  bridgeOutdated?: boolean;   // Bridge 未声明所需能力（如 hermes.multi-session.v2）
  isFreeSlot: boolean;        // 免费额度占用的那个连接
};

export type AgentDescriptor = {
  connectionId: string;
  agentId: string;            // OpenClaw agent id；Hermes 固定 'hermes'；YouMind 为 spriteId
  name: string;
  emoji?: string;             // OpenClaw identity emoji
  avatarUrl?: string;         // YouMind 精灵头像
  isMain: boolean;            // 免费额度判定：连接内 isMain 的那一个免费
  mainSessionKey: string;
};

export type SessionKind = 'main' | 'channel' | 'direct' | 'group' | 'subagent' | 'cron' | 'other';

export type SessionDescriptor = {
  connectionId: string;
  agentId: string;
  key: string;
  kind: SessionKind;
  title: string;
  channel?: string;           // slack / discord / telegram …
  updatedAt: number | null;
  preview?: string;
  model?: string;
  hasActiveRun: boolean;
  attention?: 'approval' | 'error' | 'cron_failed' | null;
  parentSessionKey?: string;          // 子 Agent / Cron 运行的父会话（有 lineage 时）
  source?: 'bridge' | 'native';       // Hermes：Bridge 创建的会话 vs 只读的原生会话
  allowedActions: { rename: boolean; reset: boolean; delete: boolean; pin: boolean };  // 会话级能力，UI 只看它
};

export type PromptInput = {
  text: string;
  attachments?: Array<{ type: 'image' | 'file'; mimeType: string; content: string /* base64 */; name?: string }>;
  skillId?: string;
  thinkingLevel?: string;
  idempotencyKey: string;
};

export type SessionHistory = {
  key: string;
  messages: ChatMessage[];           // 复用现有 UiMessage 的数据部分（src/types/chat.ts），不含渲染字段
  nextCursor?: string;
  hasActiveRun: boolean;
};

export type FinalMessage = { role: 'assistant'; content: string; provider?: string; model?: string };
export type Usage = { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; total?: number; costUsd?: number };

export type ApprovalRequest =
  | { kind: 'exec'; id: string; command: string; cwd?: string; host?: string; expiresAtMs: number }
  | { kind: 'plugin'; id: string; pluginId: string; title: string; expiresAtMs: number }
  | { kind: 'pair'; id: string; target: 'device' | 'node'; displayName: string | null; platform: string | null; receivedAtMs: number };
```

`allowedActions` 的规则：OpenClaw 的 main 会话不可删除、可重置；渠道会话可重命名不可删除（删除由渠道侧决定）；Hermes 原生会话（`source = native`）只读：不可重命名、重置、删除，只能打开与置顶；Bridge 创建的 Hermes 会话全可用；YouMind 只有一个会话，全部为 false 除 pin。UI 按 `allowedActions` 显隐长按菜单，不再看后端级布尔值。

### 3.2 能力矩阵

```ts
export type Capabilities = {
  chat: boolean; abort: boolean; history: boolean; attachments: boolean;
  fileAttachments?: boolean; // 非图片文件；缺省为 false，保持旧实现源码兼容
  replyNotifications?: boolean; // 客户端回复通知；缺省为 false
  sessions: boolean; sessionCreate: boolean; sessionRename: boolean; sessionReset: boolean; sessionDelete: boolean;
  agents: boolean; agentEdit: boolean; agentCreate: boolean;
  models: boolean; modelPerSession: boolean; thinkingLevels: boolean;
  skills: boolean; skillDiscover: boolean; skillInstall: boolean;
  cron: boolean; cronCreate: boolean; heartbeat: boolean;
  files: boolean; fileEdit: boolean;
  usage: boolean; cost: boolean;
  configManage: boolean; permissions: boolean; diagnostics: boolean; backups: boolean;
  tools: boolean; channels: boolean; devices: boolean; nodes: boolean; logs: boolean;
  execApproval: boolean; pairRequests: boolean;
};
export const CAPABILITY_MATRIX: Record<BackendKind, Capabilities>;
```

矩阵值：OpenClaw 全 true。`attachments` 精确表示图片附件；`fileAttachments` 是非图片文件的 additive 细化能力，缺省按 false。`replyNotifications` 是客户端对适配器运行完成事件显示本地回复通知的 additive 细化能力，缺省按 false。Hermes：chat / abort / history / attachments / replyNotifications / sessions / sessionCreate / sessionRename / sessionReset / sessionDelete / agents（只读单 Agent）/ models / thinkingLevels / skills / skillDiscover / skillInstall / cron / cronCreate / files / fileEdit / usage / cost 为 true，`fileAttachments` 与其余能力为 false，因此仍可选图、拍照和粘贴图片，但不显示任意文件入口。YouMind：chat / abort / history 为 true，其余 false。适配器可以在运行时按 Bridge 声明的能力字符串把 true 降为 false（例如老 Bridge 没有 `hermes.multi-session.v2` 时 `sessions*` 降级），不能反向升级。

### 3.3 适配器接口（ACP 形状）

```ts
export interface AgentAdapter {
  readonly connection: ConnectionDescriptor;
  readonly capabilities: Capabilities;
  readonly state: ConnectionState;            // 'idle' | 'connecting' | 'handshaking' | 'ready' | 'reconnecting' | 'offline' | 'error'
  connect(): Promise<void>;
  disconnect(): void;
  probe(timeoutMs?: number): Promise<boolean>;  // 真实请求探针，不是 socket open
  listAgents(): Promise<AgentDescriptor[]>;
  listSessions(agentId?: string): Promise<SessionDescriptor[]>;
  loadSession(key: string, opts?: { limit?: number; cursor?: string }): Promise<SessionHistory>;
  prompt(key: string, input: PromptInput): Promise<{ runId: string }>;
  cancel(key: string, runId?: string): Promise<void>;
  createSession?(agentId: string, opts?: { title?: string }): Promise<SessionDescriptor>;
  patchSession?(key: string, patch: { title?: string }): Promise<void>;
  resetSession?(key: string): Promise<void>;
  deleteSession?(key: string): Promise<void>;
  management?: ManagementOperations;          // 模型 / 技能 / Cron / 文件 / 用量 / 配置 / 工具 / 渠道 / 设备 / 日志
  on(event: 'update', listener: (u: SessionUpdate) => void): () => void;
  on(event: 'state', listener: (s: ConnectionState, reason?: string) => void): () => void;
  on(event: 'sessions', listener: (s: SessionDescriptor[]) => void): () => void;
}
```

### 3.4 事件流

```ts
export type SessionUpdate =
  | { type: 'run_started'; sessionKey: string; runId: string }
  | { type: 'agent_message_chunk'; sessionKey: string; runId: string; text: string }
  | { type: 'agent_thought_chunk'; sessionKey: string; runId: string; text: string }
  | { type: 'tool_call'; sessionKey: string; runId: string; toolCallId: string; title: string; kind?: string; rawInput?: unknown }
  | { type: 'tool_call_update'; sessionKey: string; runId: string; toolCallId: string; status: 'running' | 'success' | 'error'; rawOutput?: unknown }
  | { type: 'run_finished'; sessionKey: string; runId: string; stopReason: 'end_turn' | 'cancelled' | 'error' | 'max_tokens'; message?: FinalMessage; usage?: Usage }
  | { type: 'compaction'; sessionKey: string; phase: 'start' | 'end' }
  | { type: 'approval_requested'; sessionKey?: string; approval: ApprovalRequest }   // exec / plugin / pair
  | { type: 'approval_resolved'; approvalId: string; decision: string }
  | { type: 'session_info_update'; session: Partial<SessionDescriptor> & { key: string } }
  | { type: 'usage_update'; sessionKey: string; contextUsed?: number; contextWindow?: number; costToday?: number }
  | { type: 'system_event'; sessionKey: string; kind: 'command_ack' | 'connection' | 'compaction_note' | 'info'; text: string; timestampMs: number }
  | { type: 'error'; sessionKey?: string; runId?: string; code: AdapterErrorCode; message: string };
```

命名对齐 ACP 的 `SessionUpdate`；未来 ACP 原生适配器只需把 ACP 事件一比一映射。

`ManagementOperations` 是按能力分组的可选子接口，签名在 M1 里从现有 `GatewayClient` 公开方法**逐个抄过来并定型**（返回类型沿用现有类型文件，不新造）：

```ts
export type ManagementOperations = Partial<{
  models: { list(): Promise<ModelInfo[]>; getSelection(agentId?: string): Promise<ModelSelectionState>; setSelection(p: ModelSelectionWrite): Promise<ModelSelectionState>; listThinkingLevels(): ThinkingLevel[] };
  skills: { status(agentId?: string): Promise<SkillStatusReport>; get(key: string): Promise<SkillDetail>; update(key: string, patch: SkillPatch): Promise<void>; updateContent(key: string, content: string): Promise<void>; remove(key: string): Promise<void>; discover?(query: string): Promise<DiscoverResult> };
  cron: { list(): Promise<CronJob[]>; add(job: CronJobCreate): Promise<CronJob>; update(id: string, patch: CronJobPatch): Promise<CronJob>; remove(id: string): Promise<void>; run(id: string): Promise<void>; runs(id: string): Promise<CronRun[]>; heartbeat?: { get(): Promise<HeartbeatSettings>; set(s: HeartbeatSettings): Promise<void> } };
  agents: { list(): Promise<AgentDescriptor[]>; create(input: AgentCreate): Promise<AgentDescriptor>; update(id: string, patch: AgentPatch): Promise<void>; remove(id: string): Promise<void>; files: { list(id: string): Promise<AgentFile[]>; get(id: string, name: string): Promise<AgentFile>; set(id: string, name: string, content: string): Promise<void> } };
  usage: { sessions(p: UsageQuery): Promise<UsageResult>; cost(p: CostQuery): Promise<CostSummary> };
  config: { view(): Promise<ConfigView>; permissions(): Promise<PermissionsReport>; repair(): Promise<RepairResult>; doctor(): Promise<DoctorResult>; backups: { list(): Promise<Backup[]>; create(): Promise<Backup>; restore(id: string): Promise<void> } };
  tools: { catalog(): Promise<ToolCatalog>; save(p: ToolPolicy): Promise<void> };
  channels: { status(p?: { probe?: boolean }): Promise<ChannelsStatusResult> };
  devices: { list(): Promise<DevicePairListResult>; approve(id: string): Promise<void>; reject(id: string): Promise<void>; remove(id: string): Promise<void> };
  nodes: { list(): Promise<NodeListResult>; rename(id: string, name: string): Promise<void>; pairRequests(): Promise<NodePairListResult>; approve(id: string): Promise<void>; reject(id: string): Promise<void> };
  logs: { fetch(p: LogQuery): Promise<LogPage> };
}>;
```

未支持的分组不存在于对象上（不是抛错），与 `Capabilities` 一一对应；M1 的测试用 `createMockAdapter()` 校验「能力为 true 的分组必须存在」。

### 3.5 错误码

`AdapterErrorCode`：`unauthorized` / `pairing_required` / `pairing_expired` / `bridge_offline` / `gateway_offline` / `network` / `timeout` / `rate_limited` / `frame_too_large` / `unsupported` / `server`。每个错误码在 `04-app-screens.md` §错误文案表里有一句用户文案与一个动作。

### 3.6 `createMockAdapter()`

接受一组 fixture（Agent、会话、历史、按时间线回放的 `SessionUpdate`），供 A2 轨道在 M4 完成前开发全部界面；也用于界面测试。

## 4. 仓库结构（完成后）

```
apps/
  mobile/                      React Native App
  relay-worker/                合一后的 Relay（RELAY_BACKEND 决定实例）
  relay-registry/              合一后的 Registry
  bridge-cli/                  @p697/clawket CLI（命令面不变）
packages/
  agent-protocol/              新：适配器契约与能力矩阵
  relay-shared/                协议常量与能力字符串
  bridge-core/                 配对、配置、服务安装（不变）
  bridge-runtime/              openclaw/ 与 hermes/ 两个运行时目录 + 共享 relay 会话
tests/
  compat/                      v1 客户端协议回放
  integration/                 既有集成测试
docs/
  3.0/                         本规格
  relay/ bridge/ mobile/       保留但按 10 清理
```

删除：`apps/hermes-relay-worker`、`apps/hermes-relay-registry`。

## 5. App 内目录（完成后）

```
apps/mobile/src/
  connection/                  连接层 v2（见 §2）
  screens/
    Onboarding/                首启引导
    Roster/                    花名册
    Thread/                    线程（复用 chat 运行时）
    SessionPanel/              会话面板
    AgentSettings/             Agent 设置 + 二级页（models, skills, cron, files, usage, openclaw, tools, channels-devices, logs）
    AccountSettings/           账户设置
    Search/                    全局搜索
    Paywall/                   付费墙
  components/
    ui/                        基础组件（05 定义）
    chat/                      气泡、卡片、输入区
  chat/                        useChatController 与消息模型（从 screens/ChatScreen/hooks 上移）
  theme/                       token
  services/                    只剩与连接无关的服务：storage、chat-cache、analytics、pro-subscription、speech、image-cache、notifications、deepLinks
```

`screens/ChatScreen`、`ConsoleScreen`、`ConfigScreen`、`DiscoverScreen`、`LiveScreen`、`ProfileScreen` 全部删除；可复用的二级管理页面移动到 `AgentSettings/` 下并换皮（清单见 `10-migration-map.md`）。

## 6. 老客户端兼容的架构保证

- 传输层的 v1 握手实现与今天逐字节一致，由 `tests/compat` 锁定。
- 新增行为一律经能力字符串协商：客户端在 `connect.start` 的 meta 里带 `capabilities`，Relay 在 `/v1/health` 与握手回包里带 `capabilities`，Bridge 在握手 meta 与健康接口里带 `capabilities`。任一方缺失即按 v1 行为。
- App 对老 Bridge：`Capabilities` 降级，设置页连接组显示「升级 bridge 到 3.0 以解锁多会话」。
- App 对老 Relay：不发 v2 帧，帧大小自限 256 KB。
