# 03 · 两个适配器

每个适配器：一个文件（≤ 900 行，超过就拆子模块）、一组录制报文 fixture、一份能力表、一张错误码映射表。适配器不 import React，不知道 UI。

## 1. OpenClawAdapter

OpenClaw 技能文档读写按当前握手 `features.methods` 分别开放 `skills.get` / `skills.content.update`，不能从通用 skills 能力推断。Clawket Bridge 在能力协商成功的独立客户端通道上，为本机 Gateway 补齐缺失的方法；通过该客户端的 `skills.status(agentId)` 解析路径，只处理默认 SKILL.md（1 MiB 上限）。内置/额外目录只读，workspace/managed 的非 bundled 文件且 operator.admin 才能原子保存。旧 Bridge、共享旧通道与不提供原生方法的直连 Gateway 不显示文档入口；完整 Relay 修复需 App 与 Bridge 一起更新。Hermes 继续使用原有文档接口。

### 1.1 传输

- `transportKind = relay`：`RelayWsTransport`（从 `gateway-relay.ts` + `gateway.ts` 抽出）：注册表引导（`relay-pairing.ts`）、`connect.start` + challenge、tick / pong（声明 `relay.client-pong.v1`）、退避 `RECONNECT_BASE_MS × 1.7^n`，上限 `RECONNECT_MAX_MS`，只在 `connect_ready` 后重置（根 AGENTS.md Relay Liveness 规则 4）。
- `local / tailscale / cloudflare / custom`：`DirectWsTransport`，首个有效帧后重置退避。
- 三段状态：`connecting`（socket）→ `handshaking`（connect 请求已发）→ `ready`（收到 connect 响应且 `ok`）。
- 安全配对返回的 OpenClaw device token 按连接与角色共同隔离存储：主适配器只读取 `operator`，Node sidecar 只读取 `node`；移动端 bootstrap 一次返回多角色 token 时分别持久化，任何一方的失效清理不得删除另一方。
- 连接设置里的 Bridge 运行信息只读取 Relay 双方协商 `bridge.capabilities.v2` 后响应 meta 的 `bridgeVersion` / `capabilities`。Direct OpenClaw、未协商或旧 Bridge 显示未知；Gateway `server.version` 仅作为 Gateway 信息保留，不映射成 Bridge 版本。

### 1.2 方法映射

| 契约 | Gateway 方法 / 事件 |
|---|---|
| `listAgents` | `agents.list`（现有 `fetchIdentity` 逐个补名字与 emoji）；`isMain = agentId === 'main'`（或配置的 mainKey） |
| `listSessions(agentId)` | `sessions.list` 过滤 `agent:<id>:` 前缀；`kind` 由 key 推断：`:main` → main，`:cron:` → cron，`:subagent:` → subagent，含 channel 字段 → channel，`kind==='direct'` → direct，`'group'` → group |
| `loadSession` | `chat.history`（limit）；本地 `chat-cache` 合并（现有 `historyMergePolicy`） |
| `prompt` | `chat.send`；支持图片与非图片文件，附件走现有 `preparePendingImagesForSend` |
| `cancel` | `chat.abort` |
| `patchSession / resetSession / deleteSession` | `sessions.patch` / `sessions.reset` / `sessions.delete` |
| `management.*` | 现有 `model.*`、`models.list`、`skills.*`、`cron.*`、`agents.*`、`agents.files.*`、`sessions.usage`、`usage.cost`、`tools.catalog`、`node.*`、`device.*`、config / permissions / diagnostics / backups 的现有请求 |
| `management.channels`（`channelManage`） | `status` = `channels.status`；`getRouting` 读 `config.get` 的 `session.dmScope`（未设置按 OpenClaw 默认 `main`）；`setRouting` = `config.patch { session: { dmScope } }`；`setAccountEnabled` = `config.patch { channels[id].accounts[accountId].enabled }`。两个写入都先读 hash，Gateway 拒绝时抛 `server` 错误。Hermes / local-model 没有这组操作（2026-09-19 找回 2.0 的「DM Scope Settings」与账号开关时新增） |

### 1.3 事件映射

| Gateway 事件（现有 `GatewayEvents`） | `SessionUpdate` |
|---|---|
| `chatRunStart` | `run_started` |
| `chatDelta` | `agent_message_chunk` |
| `agent` 事件 `stream: 'item'`、`kind: 'preamble'`（update / end）→ `chatCommentary` | `agent_commentary_chunk{ itemId, text }`：过程说明不进 `chatDelta`，这是它在写入记录前唯一的实时副本（2026-10-06） |
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
- Cron 运行结果卡：`cron.runs` 的最近一次运行（状态、耗时、摘要）按 `updatedAt` 插入主会话时间线；卡片带完整 `CronRunLogEntry`，`sessionKey` 去掉 OpenClaw 隐藏的 `:run:<sessionId>` 后缀（`resolveCronRunSessionKey`）。
- `cron.runContent(entry)`：一次运行真正产出的内容。OpenClaw 用稳定键调 `chat.history`（limit 200），校验返回 `sessionId` 等于记录的 `sessionId`，从原始消息里提取 `message` 工具的 `send` / `broadcast` 调用（直接调用、`tool_call` 包装 `{id:'message', args}`、`custom` 回显三种形态，按渠道 · 收件人 · 正文去重）→ `deliveries[]` + `sessionKey`；会话已归属更新的运行或不存在时返回空。`CronRunLogEntry` 额外带 `delivery` 轨迹（`intended` / `resolved` / `messageToolSentTo`，只有路由没有正文）、`completionStatus`、`runId`。
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

Hermes 的 Bridge 版本与能力从 HTTP / WebSocket health 读取；进入重连、关闭或显式断开时立即清空，避免沿用旧实例的运行信息。旧 Bridge 没有字段时显示未知。

### 2.3 方法映射

| 契约 | Bridge 方法 |
|---|---|
| `listAgents` | 固定一个：`{ agentId: 'hermes', name: 连接 label 或 Bridge 返回的名字, emoji: '🪽' 可由用户改, isMain: true, mainSessionKey: 'main' }` |
| `listSessions` | `sessions.list` |
| `loadSession` | `chat.history`（分页） |
| `prompt` | `chat.send`（附件按 PR #27 的 `attachments` 字段，仅支持 MIME 为 `image/*` 的 `type=image` 项） |
| `cancel` | `chat.abort` |
| `createSession / patch / reset / delete` | `sessions.create / patch / reset / delete` |
| `management` | `models.list` + `hermes.*.get/set`（全局模型、思考、reasoning、fast）；`skills.*`；`hermes.cron.jobs.*`（含 create）；`hermes.cron.outputs.list` 映射为 `cron.runs`（每条记录带 `outputRef` = 输出文件名），`cron.runContent` 用 `hermes.cron.outputs.get` 返回全文 `output`；`agents.files.*`；`sessions.usage` / `usage.cost` |

### 2.4 事件映射

Bridge 已把 Hermes 的 `/v1/runs` 流映射成与 OpenClaw 相同的 `chat*` 事件；复用 §1.3 的表。斜杠命令（`/model` 等）的应答作为 `system_event`（用 `session_info_update` 携带 `_meta: { userCommand: … }`）在线程里显示为系统事件行。

### 2.5 错误码

同 §1.6，另加：`/v1/hermes/health` 不可达 → `bridge_offline`；Bridge 报 Hermes API 不可达 → `gateway_offline`（文案里写「Hermes 未响应」）。

## 3. 注册表对适配器的调用策略

- 打开 App：只对「活动连接」调用 `connect()`；其他连接不建传输。
- 切换连接：`disconnect()` 旧的 → `connect()` 新的；切换动画 200 ms 交叉淡入（`05`）。
- 前台回归：对活动连接 `probe()`，失败则 `connect()`（沿用 `foregroundReconnectPolicy`）。
- 每 5 秒 keepalive（现有 `gatewayKeepAlivePolicy`）只对 Relay 传输。
- 未读：`listSessions` 结果与 `unread-watermarks` 比较；`prompt` 成功与打开线程都推进水位线。

## 4. Fixture 与测试

- `tests/fixtures/openclaw/*.json`、`hermes/*.json`：从 Preview 或本地录制的真实帧 / chunk 流，去除凭据。
- 每个适配器：连接成功、鉴权失败、中止、流中断恢复、会话列表分类、能力降级（Hermes）六类用例。
- 传输层：退避序列、`ready` 前不重置退避、tick / pong、帧上限拒绝。
