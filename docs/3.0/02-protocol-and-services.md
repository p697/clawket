# 02 · 协议与服务端（Relay、Registry、Bridge）

## 1. 不变量（先读）

1. 控制帧前缀 `__clawket_relay_control__:` 与现有 `RelayControl` 结构不变；`connect` / `connect.start` / challenge 的顺序与超时不变；关闭码表（含 `RATE_LIMITED = 4008`）只增不改。
2. Registry 的配对流程（register / access-code / claim / session / session resolve / verify）的请求与响应字段不变；六位码与 12 位加密码的派生规则不变（根 AGENTS.md 的 Secure Pairing 规则）。
3. Preview 与 Production 的 Registry、Relay、KV、DO、密钥、本地配对文件继续隔离；Hermes 实例继续使用自己的 KV 与 DO。
4. 任何新增字段对老客户端必须是可忽略的；任何新增行为必须由能力字符串开关。

## 2. 能力字符串

| 字符串 | 谁声明 | 含义 |
|---|---|---|
| `relay.client-pong.v1` | 客户端（已有） | 客户端会应答带该能力要求的 tick；Relay 才可按 pong 超时清理它 |
| `pairing.secure-short-code.v2` | Relay / Registry（已有） | 六位码配对可用 |
| `relay.frame-limit.v2` | Relay | 声明应用层帧上限 256 KB；客户端据此自限 |
| `bridge.capabilities.v2` | Bridge | 握手 meta 与健康接口里带 `capabilities: string[]`，并可附带真实 CLI `bridgeVersion` |
| `hermes.multi-session.v2` | Hermes Bridge | 支持 `sessions.create / patch / reset / delete` 与分页 `chat.history` |

声明位置：OpenClaw 客户端在既有的 `connect.params.caps` 数组追加 `bridge.capabilities.v2`，保持旧 Gateway 的闭合请求 schema 合法；Relay 在 `/v1/health` 的 `capabilities` 与握手成功后的第一条控制帧 `relay.ready`（新增，老客户端不认识则忽略，因为它是以控制前缀发出的额外帧——**必须验证 2.1.x 客户端对未知控制事件是忽略而不是断开**，`tests/compat` 覆盖）；OpenClaw Bridge 识别 `params.caps`，并继续兼容预发布客户端的顶层 Bridge meta；不得把该 meta 转发给闭合 schema 的 Gateway，并仅在对应的协商成功响应里回写能力；Hermes Bridge 在 `/v1/hermes/health` 与同构 health 帧里声明。

## 3. Relay / Registry 合一

### 3.1 结构

```
apps/relay-worker/src/
  index.ts             导出 RelayRoom 与 HermesRelayRoom（子类，只覆盖 policy）
  backend-policy.ts    由 env.RELAY_BACKEND 生成 BackendPolicy
  relay/               现有模块，去掉所有 hermes 字样的分叉，改读 policy
```

```ts
export type BackendPolicy = {
  backend: 'openclaw' | 'hermes';
  principalParam: 'gatewayId' | 'bridgeId';            // /ws 查询参数与内部路由里的主体 id 名
  principalIdPrefix: string | null;                     // hermes 为 'hbg_'
  kvBinding: 'ROUTES_KV' | 'HERMES_ROUTES_KV';
  kvKeys: { pair: 'pair-gateway:' | 'hermes-pair-bridge:'; pairingSession: string; pairingCode: string; rateLimit: string };
  registryVerifyPath: '/v1/verify/' | '/v1/hermes/verify/';
  internalRoutes: { clientTokens: string; bridgeStatus: string | null };   // 现有路径原样保留
  doBinding: 'ROOM' | 'HERMES_ROOM';
  ownerRole: 'gateway' | 'bridge';
  ownerLeaseMs: number;
  heartbeatIntervalMs: number;
  clientPongTimeoutMs: number;                          // openclaw 120_000；hermes 30_000
  gatewayPingTimeoutMs: number | null;                  // hermes 12_000；openclaw null
  watchdog: 'none' | 'hermes-bridge-probe';
};
```

合并前先做**差异盘点**：把两套 Worker 与 Registry 的每一处分歧列成表（参数名、KV key、路由、鉴权字段、owner / watchdog 语义、关闭码、遥测事件名），每一项落到 `BackendPolicy` 的一个字段或标注为「行为相同」；表写进 `PROGRESS.md`。凡是无法用策略表达的差异，保留为子类里的独立方法覆盖，不得改变任一后端的线上行为。

### 3.2 部署矩阵

| 实例 | Worker 名 | 配置文件 | DO 类 | KV | RELAY_BACKEND |
|---|---|---|---|---|---|
| OpenClaw Production | `clawket-relay` | `wrangler.local.toml` | `RelayRoom` | `ROUTES_KV`（现有 id） | openclaw |
| OpenClaw Preview | `clawket-relay-preview` | `wrangler.preview.local.toml` | `RelayRoom` | 现有 preview id | openclaw |
| Hermes | `clawket-hermes-relay` | `wrangler.hermes.local.toml`（新，从 `apps/hermes-relay-worker/wrangler.local.toml` 迁移） | `HermesRelayRoom` | `HERMES_ROUTES_KV`（现有 id） | hermes |
| Hermes Preview（新建） | `clawket-hermes-relay-preview` | `wrangler.hermes.preview.local.toml`（新） | `HermesRelayRoom` | 新建 KV（`wrangler kv namespace create`） | hermes |

Registry 同理：`clawket-registry` / `clawket-registry-preview` / `clawket-hermes-registry`。模板文件 `wrangler.hermes.toml` 与 `wrangler.hermes.local.example.toml` 提交；`*.local.toml` 不提交。

**DO 迁移标签不变**（`tag = "v1"`，类名不变），否则 Cloudflare 会把它当成新类，现有房间状态丢失。

### 3.3 根脚本

`relay:*:hermes-*` 改为 `node scripts/relay/run-wrangler.mjs <cmd> relay-worker --config-file wrangler.hermes.local.toml`（Registry 同理）；`relay:typecheck` / `relay:test` 去掉两个 Hermes 工作区。

## 4. 安全口子的实现

### 4.1 `/ws` 未鉴权 DO 创建

```
fetch(request):
  if pathname !== '/ws' → 现有逻辑
  gatewayId = query.gatewayId
  cached = memoryCache.get(gatewayId)             // Worker isolate 内 Map，TTL 60s，上限 10_000 条
  exists = cached ?? (await env[policy.kvBinding].get(`pair-gateway:${gatewayId}`)) != null
  if !exists → 404 { code: 'UNKNOWN_GATEWAY' }    // 不进 DO
  → 现有 stub.fetch
```

注意：Hermes 实例的 KV key 前缀以现有 `apps/hermes-relay-worker/src/relay/auth.ts` 为准，先读代码确认再实现。`tests/compat` 里加「未知 gatewayId 不触发 DO」的断言（用 miniflare 的 DO 调用计数）。

### 4.2 帧大小上限

现状：图片附件以 base64 内联在 `chat.send` 帧里（`attachments[].content`），客户端压缩软目标 2 MB、硬上限 5 MB（`preparePendingImagesForSend.ts`），Bridge 的 `maxPayload` 是 25 MB。所以**应用层上限必须高于现有最大帧**，否则老客户端发图会坏。

- M0 先测量：用 2.1.x 客户端发一张压缩后最大的图片，记录经 Relay 的实际帧大小，并确认 Cloudflare 平台对 Durable Object WebSocket 消息的上限（文档值），写进 `PROGRESS.md`。若平台上限已低于 5 MB 图片的 base64（约 6.7 MB），说明大图今天就走不通 Relay，记录为已知现状，不在本次修复（分块上传是 3.x 的事）。
- 应用层上限：**8 MiB**，只用于拒绝明显异常的帧；DO 的 `webSocketMessage` 入口超限 → `ws.close(1009, 'frame_too_large')` 并计数。Bridge 侧同样 8 MiB。App 发送前自检，错误码 `frame_too_large`。
- `tests/compat` 加一条带 1.5 MB 图片附件的 `chat.send` 回放，证明老客户端发图不受影响。

### 4.3 注册限速与过期

`POST /v1/pair/register`：
- 不用 KV 计数（最终一致且非原子，并发可绕过，攻击流量本身就产生 KV 费用）。用 **Cloudflare Workers Rate Limiting binding**（wrangler 里 `[[ratelimits]]`，`{ limit: 10, period: 3600 }`，key 为 `sha256(CF-Connecting-IP)`）；若该 binding 在当前账户不可用，退回到一个专用 `RateLimiter` Durable Object（`idFromName(ipHash)`，内存计数 + alarm 清零），同样是原子的。超限 → 429 `PAIRING_REGISTER_RATE_LIMITED`。
- 记录写入时 `expirationTtl` 改为 86_400；claim 成功时重写记录并把 TTL 恢复为 365 天（现有值）。
- `PAIR_CLIENT_TOKEN_MAX = 8` 不变。

### 4.4 Hermes 心跳

- 合一后默认 `HEARTBEAT_INTERVAL_MS = 30000`；Hermes 实例配置文件里也改为 30000。
- 对 Bridge 的 ping 只在 `hasOpenClients()` 为真时发送；Bridge 侧 `hermes-relay.ts` 的 watchdog 已有请求级探针（根 AGENTS.md Hermes 规则 5），保留。
- 客户端 pong 清理沿用 `relay.client-pong.v1` 协商。

## 5. WAF 规则与告警（HT-1，人在 Cloudflare 后台配置；实现者只把配置写进 HUMAN TODO）

Rate limiting rules（每个 zone：`clawket.ai`，同时在 Preview 的 workers.dev 域不可配 WAF，Preview 靠代码层限速即可）：

| 规则 | 匹配 | 阈值 | 动作 |
|---|---|---|---|
| ws-connect | `http.request.uri.path eq "/ws"` 且 host 为 relay / hermes-relay | 30 次 / 1 分钟 / IP | Block 60 秒 |
| pair-register | `http.request.uri.path eq "/v1/pair/register"` | 10 次 / 1 小时 / IP | Block 1 小时 |
| pair-resolve | `http.request.uri.path contains "/v1/pair/session"` | 20 次 / 1 分钟 / IP | Block 60 秒 |
| registry-global | host 为 registry / hermes-registry | 300 次 / 1 分钟 / IP | Managed Challenge |

Notifications（账户级）：Workers 请求量日阈值 2,000,000；Durable Objects 请求量日阈值 500,000；KV 写入日阈值 50,000；收件为邮箱 + Discord webhook。预算目标 ≤ $30 / 月，$50 告警，$100 人工介入。

## 6. Bridge

### 6.1 目录

```
packages/bridge-runtime/src/
  index.ts
  protocol.ts                 控制帧（不变）+ capabilities meta 的编解码
  relay-session.ts            与 Relay 的连接、重连、心跳（从 runtime.ts 抽出的共享部分）
  openclaw/
    runtime.ts                现有 BridgeRuntime（按需连接 Gateway 的契约不变）
  hermes/
    index.ts                  HermesBridge 组装
    http-server.ts            /v1/hermes/ws、/v1/hermes/health
    session-store.ts          hermes-bridge-sessions.json 读写
    native-sessions.ts        只读 Hermes 原生会话（SessionDB / 会话目录），不写
    usage-ledger.ts
    commands.ts               /model /thinking /reasoning /fast
    stream-mapping.ts         Hermes /v1/runs 事件 → Bridge 协议事件
    relay.ts                  现有 hermes-relay.ts
```

### 6.2 能力声明

握手 meta：`{ ...existing, capabilities: ['bridge.capabilities.v2', 'hermes.multi-session.v2'], bridgeVersion?: string }`；`/v1/hermes/health` 及 WebSocket health 返回同一能力数组和可选 `bridgeVersion`；OpenClaw Bridge 仅在客户端请求且 Bridge 回应 `bridge.capabilities.v2` 的成功 connect 响应 meta 中声明 `['bridge.capabilities.v2']` 和可选 `bridgeVersion`。版本值来自正在运行的 CLI 包，空白、控制字符或超长值省略；不得透传 Gateway 伪造的同名字段，也不得用 Gateway `server.version` 冒充。未协商、v1、失败响应保持原字节。`clawket status` 打印能力。

### 6.3 Hermes 多会话协议（Bridge 方法）

| 方法 | 入参 | 出参 |
|---|---|---|
| `sessions.list` | `{ limit? }` | `{ sessions: [{ key, title, kind: 'main'|'direct', updatedAt, preview, hasActiveRun, source: 'bridge'|'native', allowedActions }] }`；`native` 会话 `allowedActions` 全 false（只读，不做影子记录与墓碑），`bridge` 会话全 true |
| `sessions.create` | `{ title? }` | `{ session }` |
| `sessions.patch` | `{ key, title }` | `{ ok }` |
| `sessions.reset` | `{ key }` | `{ ok }` |
| `sessions.delete` | `{ key }` | `{ ok }` |
| `chat.history` | `{ sessionKey, limit?, cursor? }` | `{ messages, nextCursor? }` |
| `chat.send` | 现有 | 现有 |
| `chat.abort` | `{ sessionKey, runId? }` | `{ ok }`；随后发 `chatAborted` 事件 |

原生会话读取规则：只读，不改 Hermes 文件；读取失败时降级为仅 Bridge 存储并在 `sessions.list` 的 `warnings` 里说明。Hermes 源码在本机 `~/.hermes/hermes-agent` 目前不存在，实现者以 Hermes 官方文档的会话存储格式为准，并把依据写进 `PROGRESS.md`。

### 6.4 CLI

命令面：`pair`（含 `local` / `--backend`）、`refresh-code`、`install` / `start` / `restart` / `stop` / `uninstall` / `reset` / `status` / `logs` / `doctor` / `run`、`hermes ...` 子命令——**不增不减**。根 AGENTS.md 的 Pair / Observability / Lifecycle 规则继续适用。

## 7. 老客户端回放测试（tests/compat）

- 目录：`tests/compat/fixtures/v1/{registry,relay-openclaw,relay-hermes,bridge}/*.json`，每个 fixture 是「请求帧序列 + 期望响应帧序列 + 期望关闭码」。
- 录制方式：在基线代码上用 `tests/integration/harness.ts` 跑一遍真实流程，把双方帧按顺序落盘；人工检查一次字段后冻结。fixture 里不得含真实密钥（用测试密钥）。
- 断言：逐帧结构相等（忽略时间戳、随机 id 字段，白名单在 fixture 内声明）。
- 覆盖矩阵：老客户端 × 新 Relay；老客户端 × 新 Bridge；老 Bridge（用基线 `bridge-runtime` 构建产物）× 新 Relay。
- 触发：本地 `npm run test:compat`；CI 必跑；部署脚本 `scripts/relay/run-wrangler.mjs deploy` 在执行前先跑一次 compat，红灯则拒绝部署，**没有任何跳过开关**。紧急情况用 Cloudflare 的版本回滚（`wrangler rollback` / 控制台 Versions）回到上一版，而不是部署新构建。
- 录制来源必须是**线上已发布版本**，不是「基线代码」：用 `git log -S'"version": "2.1.1"' -- apps/mobile/app.json apps/mobile/package.json` 等方式找到 2.1.0 / 2.1.1 / 2.1.2 三个版本的提交（2.1.1 是 PostHog 里占比最高的线上版本），在 `git worktree` 里检出这些提交，从那份客户端代码与那时的 `bridge-runtime` 构建产物录制 fixture；`tests/compat/PINNED.md` 记录每个版本对应的提交 sha 与录制日期。CI 里通过 `git worktree add` 检出这些 sha 来构建「老 Bridge」。
