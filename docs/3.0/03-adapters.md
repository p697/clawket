# 03 · 三个适配器

每个适配器：一个文件（≤ 900 行，超过就拆子模块）、一组录制报文 fixture、一份能力表、一张错误码映射表。适配器不 import React，不知道 UI。

## 1. OpenClawAdapter

### 1.1 传输

- `transportKind = relay`：`RelayWsTransport`（从 `gateway-relay.ts` + `gateway.ts` 抽出）：注册表引导（`relay-pairing.ts`）、`connect.start` + challenge、tick / pong（声明 `relay.client-pong.v1`）、退避 `RECONNECT_BASE_MS × 1.7^n`，上限 `RECONNECT_MAX_MS`，只在 `connect_ready` 后重置（根 AGENTS.md Relay Liveness 规则 4）。
- `local / tailscale / cloudflare / custom`：`DirectWsTransport`，首个有效帧后重置退避。
- 三段状态：`connecting`（socket）→ `handshaking`（connect 请求已发）→ `ready`（收到 connect 响应且 `ok`）。

### 1.2 方法映射

| 契约 | Gateway 方法 / 事件 |
|---|---|
| `listAgents` | `agents.list`（现有 `fetchIdentity` 逐个补名字与 emoji）；`isMain = agentId === 'main'`（或配置的 mainKey） |
| `listSessions(agentId)` | `sessions.list` 过滤 `agent:<id>:` 前缀；`kind` 由 key 推断：`:main` → main，`:cron:` → cron，`:subagent:` → subagent，含 channel 字段 → channel，`kind==='direct'` → direct，`'group'` → group |
| `loadSession` | `chat.history`（limit）；本地 `chat-cache` 合并（现有 `historyMergePolicy`） |
| `prompt` | `chat.send`；附件走现有 `preparePendingImagesForSend` |
| `cancel` | `chat.abort` |
| `patchSession / resetSession / deleteSession` | `sessions.patch` / `sessions.reset` / `sessions.delete` |
| `management.*` | 现有 `model.*`、`models.list`、`skills.*`、`cron.*`、`agents.*`、`agents.files.*`、`sessions.usage`、`usage.cost`、`tools.catalog`、`node.*`、`device.*`、config / permissions / diagnostics / backups 的现有请求 |

### 1.3 事件映射

| Gateway 事件（现有 `GatewayEvents`） | `SessionUpdate` |
|---|---|
| `chatRunStart` | `run_started` |
| `chatDelta` | `agent_message_chunk` |
| `chatTool` phase start / update / result | `tool_call` / `tool_call_update` |
| `chatFinal` | `run_finished{ stopReason: 'end_turn', message, usage }` |
| `chatAborted` | `run_finished{ stopReason: 'cancelled' }` |
| `chatError` | `error` + `run_finished{ stopReason: 'error' }` |
| `chatCompaction` | `compaction` |
| `execApprovalRequested / Resolved` | `approval_requested{ kind: 'exec' }` / `approval_resolved` |
| `pairingRequired / Resolved` | `approval_requested{ kind: 'pair' }` / `approval_resolved` |
| `seqGap` | 触发 `loadSession` 重新对账（现有 `historyReconcile`） |
| `health` / `tick` | 传输内部，不上抛 |
| `canvas*` | 3.0 不做 Canvas，移除监听与 UI |

### 1.4 会话增量

若 Gateway 支持 `sessions.subscribe`（OpenClaw 2026.8 起，见其协议文档），连接就绪后订阅并把 `sessions.changed` 转成 `sessions` 事件；不支持时按现有轮询（前台每 30 秒 + 线程回到前台时）。

### 1.5 线程内卡片的来源

- 子 Agent 运行卡：`listSessions` 里 `kind === 'subagent'` 且 `parentSessionKey`（若 Gateway 提供）或 `spawnedBy` 指向当前主会话；无 lineage 字段时按时间窗归并（现有 `childSessionActivity.ts` 的规则）。
- Cron 运行结果卡：`cron.runs` 的最近一次运行（状态、耗时、摘要）按 `updatedAt` 插入主会话时间线。
- 卡片位置：按时间戳插在消息之间；同一 Cron 任务连续多次运行折叠成一张卡显示最近一次与次数。

### 1.6 错误码映射

| 现象 | `AdapterErrorCode` |
|---|---|
| 注册表返回 401 / claim 失效 | `pairing_expired` |
| Relay 关闭码 4008 | `rate_limited` |
| Relay 关闭码 1009 | `frame_too_large` |
| 握手超时（Bridge 未应答） | `bridge_offline` |
| connect 响应 `ok=false` 且错误为鉴权 | `unauthorized` |
| Gateway 返回 unavailable | `gateway_offline` |
| socket 打不开 / DNS | `network` |

## 2. HermesAdapter

### 2.1 传输

- `relay`：同 `RelayWsTransport`，Registry 为 Hermes 实例；请求级探针每 15 秒（现有 `HERMES_IDLE_PROBE_*`）迁到适配器的 `probe()`，由注册表按策略调用。
- `local / tailscale / cloudflare / custom`：`DirectWsTransport` 连 `/v1/hermes/ws`；首帧超时 8 秒。

### 2.2 能力协商

连接就绪后读握手 meta 的 `capabilities`：含 `hermes.multi-session.v2` → 会话相关能力保持 true；否则降级为单一 `main`，`sessions* = false`，并在 `ConnectionDescriptor` 上标记 `bridgeOutdated = true`（设置页连接组据此显示升级提示）。

### 2.3 方法映射

| 契约 | Bridge 方法 |
|---|---|
| `listAgents` | 固定一个：`{ agentId: 'hermes', name: 连接 label 或 Bridge 返回的名字, emoji: '🪽' 可由用户改, isMain: true, mainSessionKey: 'main' }` |
| `listSessions` | `sessions.list` |
| `loadSession` | `chat.history`（分页） |
| `prompt` | `chat.send`（附件按 PR #27 的 `attachments` 字段） |
| `cancel` | `chat.abort` |
| `createSession / patch / reset / delete` | `sessions.create / patch / reset / delete` |
| `management` | `models.list` + `hermes.*.get/set`（全局模型、思考、reasoning、fast）；`skills.*`；`hermes.cron.jobs.*`（含 create）；`agents.files.*`；`sessions.usage` / `usage.cost` |

### 2.4 事件映射

Bridge 已把 Hermes 的 `/v1/runs` 流映射成与 OpenClaw 相同的 `chat*` 事件；复用 §1.3 的表。斜杠命令（`/model` 等）的应答作为 `system_event`（用 `session_info_update` 携带 `_meta: { userCommand: … }`）在线程里显示为系统事件行。

### 2.5 错误码

同 §1.6，另加：`/v1/hermes/health` 不可达 → `bridge_offline`；Bridge 报 Hermes API 不可达 → `gateway_offline`（文案里写「Hermes 未响应」）。

## 3. YouMindSpriteAdapter

### 3.1 认证

- `HttpStreamTransport` 携带 `Authorization: Bearer <accessToken>`；401 → 用 `refreshToken` 刷新一次，仍 401 → `unauthorized`（UI 引导重新登录）。
- 登录流程复用现有 `signInWithOTP` + `validateOTPToken`（邮箱验证码），存储复用 `StorageService.setYouMindAuthSession`。删除 Google / Apple 登录代码。
- Base URL：默认官方；Debug 模式允许自定义（沿用现有 `youmind:custom` 的 URL 字段）。

### 3.2 方法映射

| 契约 | HTTP |
|---|---|
| `connect` | `POST /api/v1/sprite/ensureDefault` → `{ sprite }`；缓存 `spriteId`、`ownerPersonaId`（`owner_persona.persona_id`，字段名以响应为准）、名字、头像 |
| `probe` | 同上，5 秒超时 |
| `listAgents` | 固定一个：`{ agentId: spriteId, name: sprite.name, avatarUrl: sprite.avatar, isMain: true, mainSessionKey: 'main' }` |
| `listSessions` | 固定一条 `main`，`updatedAt` 取最近一条消息时间 |
| `loadSession` | `POST /api/v1/sprite/sessionLoad` `{ spriteId, limit (≤50), cursor? }` → 映射为 `SessionHistory`；`nextCursor` 透传 |
| `prompt` | `POST /api/v1/sprite/sessionPrompt`，body：`{ spriteId, userId, messages: [{ role: 'user', content, currentLocalTime, messageContext: { schema: 'youmind.sprite.message_context.v1', currentLocalTime, timeZone, surface: 'saas', conversationType: 'direct' } }] }`；流式响应用 XHR `onprogress` 增量解析（沿用现有 `streamRequest` 实现） |
| `cancel` | `POST /api/v1/sprite/abort` `{ spriteId, personaId }` |
| 开场 | `loadSession` 返回空且本地无「已开场」标记时，自动 `prompt` 文本 `WakeUp`（界面语言以 zh 开头则 `醒来吧`），该条用户消息不渲染；写本地标记 |

不实现：`createSession / patch / reset / delete`、`management`、附件、`useComputer`、`additionalContexts`。

### 3.3 事件映射（CompletionStreamChunk → SessionUpdate）

沿用现有 `applyYouMindChunk` 的解析，只映射以下项，其余静默丢弃并计数：

| chunk | `SessionUpdate` |
|---|---|
| `insert(Message, role=assistant)` | `run_started`（runId = message id） |
| `append_string(CompletionBlock type=content)` | `agent_message_chunk` |
| `append_string(CompletionBlock type=reasoning)` | `agent_thought_chunk`（线程默认不展示思考，保留事件） |
| `insert(CompletionBlock type=tool)` / `replace(... status)` | `tool_call` / `tool_call_update`，线程里只显示为「正在使用工具」一条系统事件，不显示细节（精灵产品定位） |
| `event(task-ended)` | `run_finished{ end_turn }` |
| `event(aborted)` | `run_finished{ cancelled }` |
| `mode=error` / `replace(Message, path=error)` | `error` + `run_finished{ error }` |
| `event(refund-credits)` 等账单事件 | 丢弃 |

### 3.4 恢复

流中断（网络 / iOS 挂起）后：以 3 秒、6 秒、12 秒间隔调用 `loadSession` 兜底对账，直到最后一条 assistant 消息状态为终态；沿用 youmind-mobile 的「恢复轮询」思路但不移植其全部复杂度。

### 3.5 错误码

| 现象 | 码 |
|---|---|
| 401 且刷新失败 | `unauthorized` |
| 429 | `rate_limited` |
| 网络 / 超时 | `network` / `timeout` |
| 5xx / 非预期 JSON | `server` |

## 4. 注册表对适配器的调用策略

- 打开 App：只对「活动连接」调用 `connect()`；其他连接不建传输。
- 切换连接：`disconnect()` 旧的 → `connect()` 新的；切换动画 200 ms 交叉淡入（`05`）。
- 前台回归：对活动连接 `probe()`，失败则 `connect()`（沿用 `foregroundReconnectPolicy`）。
- 每 5 秒 keepalive（现有 `gatewayKeepAlivePolicy`）只对 Relay 传输。
- 未读：`listSessions` 结果与 `unread-watermarks` 比较；`prompt` 成功与打开线程都推进水位线。

## 5. Fixture 与测试

- `tests/fixtures/openclaw/*.json`、`hermes/*.json`、`youmind-sprite/*.json`：从 Preview 或本地录制的真实帧 / chunk 流，去除凭据。
- 每个适配器：连接成功、鉴权失败、中止、流中断恢复、会话列表分类、能力降级（Hermes）六类用例。
- 传输层：退避序列、`ready` 前不重置退避、tick / pong、帧上限拒绝。
