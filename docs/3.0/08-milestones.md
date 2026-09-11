# 08 · 里程碑与验收标准（执行计划）

> 按顺序执行。每个里程碑的「完成标准」全部满足、验证命令全绿、`PROGRESS.md` 已更新，才算完成。
> 轨道标记：S = 服务端与 Bridge，A1 = App 连接层，A2 = App 界面。M1 完成后 S / A1 / A2 可并行。

---

## M0 · 基线与护栏

**目的**：记录基线，建立「老客户端不坏」的机器证明，准备工具。

1. 工作树应当只有 `docs/3.0/` 相关改动；若还有其他未提交改动，先把它们单独提交为 `chore: park pre-3.0 changes`，不要丢弃。
2. 从 `main` 创建 `release/3.0` 分支；记录基线提交 sha 到 `PROGRESS.md`。把 `apps/mobile`（`package.json` 与 `app.json`）、`apps/bridge-cli`、`packages/bridge-runtime`、`packages/bridge-core` 的版本号改为 `3.0.0`（Android versionCode 按现有脚本自增）。
3. 新增 `scripts/metrics/loc.mjs` 与根脚本 `metrics:loc`：按 `apps/*`、`packages/*` 分别统计非测试 ts/tsx 行数、测试行数、测试文件数，以及 `git ls-files '*.md'` 的数量（**包含** `docs/3.0`，基线与终值口径一致，不做任何排除）。输出 Markdown 表。把结果填入 `PROGRESS.md` 基线。
4. 建立 `tests/compat/`（vitest，根脚本 `test:compat`）：
   - 先按 `02` §7 找到 2.1.0 / 2.1.1 / 2.1.2 的提交并写入 `tests/compat/PINNED.md`；用 `git worktree` 检出，从那份客户端代码与那时的 `bridge-runtime` 构建产物**录制真实帧**为 fixture（`tests/compat/fixtures/v1/`）：Registry 的 register / access-code / claim / session resolve；Relay 的 gateway 连接、客户端连接、`connect` 与 `connect.start` + challenge、`chat.send` 请求与响应信封、`sessions.list`、tick / pong（含声明了 `relay.client-pong.v1` 的客户端与未声明的老客户端两种）、关闭码；Hermes Relay 的握手与 `sessions.list`；Bridge 对以上帧的转发行为。
   - 测试对 Worker 用 `wrangler dev`（miniflare）启动，对 Bridge 用 `BridgeRuntime` 进程内启动；fixture 里必须包含一条带 1.5 MB 图片附件的 `chat.send`。
   - **必须先在基线代码上全绿**，证明 fixture 正确；之后任何服务端改动都以它为门槛。
5. 升级 `wrangler` 到最新 4.x；根 CI（`.github/workflows/required-checks.yml`）加 `npm run test:compat` 与 `npm audit --audit-level=high`。
6. 更新 `PROGRESS.md`。

**验证**：`npm run check:required && npm run test:compat && npm run metrics:loc`

**完成标准**：基线表填齐；compat 全绿；CI 配置已含两项新检查。

---

## M1 · 契约与包骨架

**目的**：先冻结接口，让三条轨道可以并行。

1. 新建 `packages/agent-protocol`（`@clawket/agent-protocol`），内容见 `01-architecture.md` §3：`AgentAdapter`、`ManagementOperations`、`Capabilities` 与 `CAPABILITY_MATRIX`、`SessionUpdate` 联合类型、`AgentDescriptor` / `SessionDescriptor` / `ConnectionDescriptor`、`AdapterError` 与错误码、`createMockAdapter()`（可回放 fixture 的假适配器，供 A2 轨道使用）。纯 TypeScript，无 RN 依赖，100% 分支覆盖。
2. `packages/relay-shared` 新增能力常量：`RELAY_FRAME_LIMIT_V2 = 'relay.frame-limit.v2'`、`BRIDGE_CAPABILITIES_V2 = 'bridge.capabilities.v2'`、`HERMES_MULTI_SESSION_V2 = 'hermes.multi-session.v2'`，以及握手 meta 中 `capabilities: string[]` 的解析与序列化（未知能力忽略）。
3. `apps/mobile/src/services/gateway-backends.ts` 的能力矩阵迁到 `agent-protocol`，原文件改为 re-export（M4 删除）。
4. 根 `AGENTS.md` 与 `packages/agent-protocol/AGENTS.md`（含 `CLAUDE.md` 符号链接）说明该包的边界。

**验证**：`npm run check:required`

**完成标准**：新包有测试且被 App 与 Bridge 的 typecheck 引用通过；App 行为零变化。

---

## M2 · Relay / Registry 合一与安全口子（轨道 S）

**目的**：一套代码四个实例；堵住四个放大口子；Preview 验证。

按根 AGENTS.md 的 Mechanical Merge 规则，M2 分两步做、分两次提交、分两次部署验证：**M2a 是行为零变化的机械合并，M2b 才是安全与协议增强。** M2a 的 compat 必须在合并前后各跑一次且结果逐字节相同。

### M2a · 机械合并（零行为变化）

1. 把 `apps/hermes-relay-worker` 的差异折进 `apps/relay-worker`：新增环境变量 `RELAY_BACKEND=openclaw|hermes`，由一个 `BackendPolicy` 对象承载差异（心跳默认值、pong 超时、`/v1/internal/hermes/bridge-status` 是否启用、Registry 校验 URL、KV 绑定名）。入口同时导出 `RelayRoom` 与 `HermesRelayRoom`（后者为子类，只覆盖策略），**保持两个部署里的 Durable Object 类名与迁移标签不变**。
2. 同样把 `apps/hermes-relay-registry` 折进 `apps/relay-registry`。
3. 新增 `apps/relay-worker/wrangler.hermes.toml`（模板）与本地 `wrangler.hermes.local.toml`（从 `apps/hermes-relay-worker/wrangler.local.toml` 迁移，不提交），Registry 同理。根脚本 `relay:deploy:hermes-*` / `relay:tail:hermes-*` / `relay:dev:hermes-*` 改为指向合一后的目录与 Hermes 配置文件。
3a. 部署 Preview（OpenClaw Preview 与新建的 Hermes Preview 两个实例）；跑 compat 与 `relay:test:preview-product`；通过后提交 `3.0(M2a)`。

### M2b · 安全与协议增强

4. 安全口子（规格见 `02-protocol-and-services.md` §4）：
   - Worker `fetch` 在 `idFromName` 之前先按 `BackendPolicy.kvKeys.pair` 前缀查 KV；不存在返回 404 `UNKNOWN_GATEWAY`；命中结果在 Worker 内存缓存 60 秒。
   - WebSocket 消息 > 8 MiB：关闭码 1009，telemetry 计数 `frame_too_large`（上限依据见 `02` §4.2，M0 的测量结果若显示需要更高，以测量为准）。
   - `/v1/pair/register`：Cloudflare Rate Limiting binding（或 Durable Object 计数器）按 IP 每小时 10 次，超限 429；未 claim 的注册 24 小时过期（claim 后延长到现有的 365 天）。
   - Hermes 心跳：默认 30 秒；只在有客户端附着时对 Bridge 发 ping；客户端声明 `relay.client-pong.v1` 才按 pong 超时清理（沿用现有规则）。
5. Worker 在 `/v1/health` 与握手 meta 里声明 `relay.frame-limit.v2`。
6. 更新 `docs/relay/*.md`：删除 `HERMES-RELAY-DESIGN.md` 中已过时的「独立代码库」描述，改为「同一代码、独立实例」；`CONFIGURATION.md` 加 Hermes 实例配置节。
7. 部署 Preview（OpenClaw Preview 与 Hermes Preview）：`npm run relay:deploy:preview-worker && npm run relay:deploy:preview-registry` 及 Hermes 对应脚本；跑 `npm run relay:test:preview-product`；若 `apps/bridge-cli/.env.local` 里有 `CLAWKET_PREVIEW_*` 变量，再跑 `node scripts/relay/preview-openclaw-e2e.mjs`。
8. **HT-1**：把 `02-protocol-and-services.md` §5 的 WAF 规则与告警配置原文写进 `PROGRESS.md` 的 HUMAN TODO，继续。
9. 删除 `apps/hermes-relay-worker`、`apps/hermes-relay-registry`，更新根 `package.json` workspaces 与脚本、`docs/relay/*`、根 `README*.md` 的工作区表。

**验证**：`npm run check:required && npm run test:compat && npm run relay:test:integration`，然后 Preview 冒烟。

**完成标准**：M2a 合并前后 compat 结果逐字节相同；M2b 后 compat 在 `RELAY_BACKEND=openclaw` 与 `hermes` 两种配置下全绿；两个 Preview 实例部署成功且冒烟通过；两个 Hermes 目录已删除；LOC 报告已更新（预期 `apps/` 净减少，未减少则说明原因）。

---

## M3 · Bridge 拆分与 Hermes 多会话（轨道 S）

**目的**：Hermes 与 OpenClaw 同级；Bridge 声明能力；CLI 不变。

1. 拆分 `packages/bridge-runtime/src/hermes.ts`（5,878 行）为 `hermes/` 目录：`session-store.ts`、`native-sessions.ts`（只读 Hermes SessionDB / 会话文件）、`usage-ledger.ts`、`commands.ts`（/model /thinking /reasoning /fast）、`stream-mapping.ts`、`http-server.ts`、`index.ts`。行为不变，测试随之拆分。
2. 握手 meta 与 `/v1/hermes/health` 增加 `capabilities`，Hermes Bridge 声明 `bridge.capabilities.v2`、`hermes.multi-session.v2`。
3. Hermes 多会话（规格见 `03-adapters.md` §Hermes）：`sessions.list`（合并 Bridge 存储与原生会话，含 `updatedAt`、预览、类型）、`sessions.create`、`sessions.patch`（重命名）、`sessions.reset`、`sessions.delete`、`chat.history` 分页；`chat.abort` 用 AbortController 取消 `/v1/runs` 流并回 `chatAborted`。
4. 附件：确认 PR #27 的图片转发端到端可用，补测试。
5. `hermes.cron.jobs.create` 已存在，补齐参数校验与测试，供 App 放开创建。
6. `clawket status` 与 `clawket doctor` 输出 Bridge 能力列表；命令面不增不减。
7. `packages/bridge-runtime/AGENTS.md` 更新模块地图；删除文件内过时注释。
8. **HT-2**：`npm run bridge:cli:verify-package` 通过后，`npm pack` 生成 tarball 并在本机 `npm install -g` 它供 Preview 测试；正式发布写进 HUMAN TODO。

**验证**：`npm run bridge:typecheck && npm run bridge:test && npm run test:compat`

**完成标准**：拆分后 `hermes/` 下没有单文件超过 1,200 行；多会话操作有录制报文测试；老 App 连新 Bridge 的 compat 全绿。

---

## M4 · App 连接层 v2（轨道 A1）

**目的**：一个连接注册表、三种传输、三个适配器；删除 `gateway.ts` 与 `youmind.ts`。

1. 新建 `apps/mobile/src/connection/`：
   - `transports/relay-ws.ts`、`transports/direct-ws.ts`（从 `gateway.ts` / `gateway-relay.ts` / `gateway-shared.ts` 抽出握手、探活、退避、心跳协商）、`transports/http-stream.ts`（从 `youmind.ts` 的 `streamRequest` 抽出，XHR 增量读取）。
   - `adapters/openclaw.ts`、`adapters/hermes.ts`、`adapters/youmind-sprite.ts`（规格见 `03-adapters.md`）。
   - `registry/connection-store.ts`（多连接持久化，替代 `activeGatewayConfigId`）、`registry/unread-watermarks.ts`、`registry/roster-cache.ts`（第 0 档缓存）。
   - `index.ts`：`useConnections()`、`useAdapter(connectionId)`、`useRoster()`。
2. 绞杀式迁移，顺序固定：
   - 第一步：适配器先包装现有 `GatewayClient` / `YouMindClient`，把事件翻成 `SessionUpdate`；`useChatController` 改为只消费适配器事件。此时 App 行为不变，全部测试仍绿。
   - 第二步：把传输代码搬进 `transports/`，适配器改用传输；删除 `GatewayClient` 内的 Hermes 特判（`HERMES_*` 常量、`hermesIdleProbe*`）。
   - 第三步：删除 `services/gateway.ts`、`gateway-relay.ts`、`gateway-shared.ts`、`gateway-backend-operations.ts`、`gateway-backends.ts`、`youmind.ts`、`youmind-*.ts`、`gateway-hermes-*.ts`、`hermes-relay-pairing.ts` 中已迁移的部分；`storage.ts` 里 YouMind 会话存储只保留邮箱登录会话。
3. 连接注册表：同一时刻只有一个连接的传输在线；切换连接 = 关旧开新；其余连接读缓存。
4. 未读水位线与「需要你」聚合（规格见 `04-app-screens.md` §花名册）。
5. 连接遥测事件（`07-analytics.md`）。
6. 测试：每个适配器用 `tests/fixtures/` 里录制的真实报文；传输重连状态机、水位线、注册表切换都是纯函数测试。

**验证**：`npm run mobile:typecheck && npm run mobile:test && npm run check:required`；三个适配器各有一条 Node 环境的集成测试（`tests/integration/adapters/`，对 Preview 端点或录制报文：连接、发一条消息、中止一次）；iOS 模拟器构建与 Android debug 构建通过。

**完成标准**：`useChatController` 不再 import `services/gateway`；`grep -rn "backendKind ===" apps/mobile/src` 在 `connection/` 之外为 0；`10` 里列出的连接层旧文件已删除。目标（非门槛）：连接层总行数 ≤ 5,000（原 `gateway.ts + gateway-relay.ts + gateway-shared.ts + youmind.ts` ≈ 7,300），超出则在 `PROGRESS.md` 说明。

---

## M5 · App 界面（轨道 A2，可与 M4 并行，先用 mock 适配器）

**目的**：方案 D 的全部页面与新视觉。

**M5a 视觉基础**（先做）
1. 按 `05-visual-system.md` 重写 `src/theme/theme.ts` 的语义 token（浅 / 深）、`tokens.ts` 的字阶与间距；`accents.ts` 保留可选强调色。
2. 新增 / 重写基础组件：`FloatingButton`、`HeaderPill`、`AgentAvatar`（含状态环）、`Bubble`、`SystemEventRow`、`RunCard`、`ApprovalCard`、`Composer`、`Sheet`、`SettingsGroup/Row`、`Roster Row`。删除不再使用的 `Card` 变体、`SegmentedTabs` 若无使用者、`IconButton` 迁完后删除。
3. `scripts/check-ui-style.mjs`：baseline 只允许下降；新增规则「列表行不得有 borderWidth」「业务文件不得出现 emoji 字面量作为图标」「业务屏幕文件里 `FontSize.` 取值不超过 3 种」。
4. **自检**：用 `createMockAdapter()` 的假数据先做出花名册与线程两屏，为两屏各写组件渲染测试（浅色与深色），断言使用的 token（圆角、字号档数、间距、控件尺寸）符合 `05` §2–§5 且无 `borderWidth`；把对照 `05` §11 组件规范的核对表写进 `PROGRESS.md`。不做截图，不需要人签字；核对通过后再做 M5b。

**M5b 页面**（规格见 `04-app-screens.md`）
4. 首启引导、花名册、线程（复用 `useChatController` 的运行时，头部与卡片换新）、会话面板、Agent 设置（含把现有模型 / 技能 / 定时 / 文件 / 用量 / OpenClaw 管理 / 工具 / 渠道设备 / 日志页面按新分组重新挂载并换皮）、账户设置、全局搜索、宽限期横幅。
5. 删除 `10-migration-map.md` 里标注删除的屏幕、组件、服务与导航路由；`App.tsx` 去掉底部 Tab 导航，改为单根栈。
6. i18n：6 个语言目录同步；新增 `apps/mobile/scripts/i18n-prune.mjs`（找出源码未引用的 key 并删除，带自测）。
7. `src/utils/posthog-navigation.ts` 的页面定义按新路由重写。

**验证**：`npm run mobile:typecheck && npm run mobile:test && npm run mobile:check:design-system`；每个页面的五种状态（加载 / 空 / 错误 / 离线 / 无权限）各有一个用 mock 适配器的组件渲染测试；iOS 模拟器构建与 Android debug 构建通过。

**完成标准**：`10` 里标注删除的屏幕、组件、服务全部删除；无任何页面引用被删除的服务；双端构建通过；目标（非门槛）：`apps/mobile/src/screens` 行数比基线减少 ≥ 12,000，未达到则说明原因；每个页面在 `PROGRESS.md` 里有 `05` §9 的文案预算自检表（两档字、无描述性副标题、无装饰性标签），由渲染测试的断言支撑。

---

## M6 · 付费墙、免费额度与埋点

1. 免费额度：`utils/pro.ts` 改为「1 连接 + 1 Agent（main）」；`canUseAgent` 只放行 main，除非 Pro 或宽限期；宽限期判定与 14 天倒计时存本地（规格见 `06-paywall-and-growth.md`）。
2. 付费墙：全屏页面 + 五套英雄图 + 情境文案表 + 冷启动规则 + 成功态自动续做被拦动作。
3. RevenueCat：offering 与 package 读取顺序（年付默认）、`paywall_purchase_failed` 的 `reason`；**HT-3**：终身价格与实验的后台配置写进 HUMAN TODO，App 侧不依赖它。
4. 埋点：`07-analytics.md` 全表落地；删除已废弃事件的调用。
5. Android 结账排查清单执行并记录（`06` §Android）。

**验证**：`npm run mobile:test`；付费墙与额度逻辑用 RevenueCat 的 mock 走通购买、恢复、取消、失败四条路径的测试；沙盒真机购买留给人。

**完成标准**：所有触发点可弹（有测试）；连接就绪触发的例外有测试；埋点属性白名单由 `events.test.ts` 断言；真机 PostHog 验证留给人。

---

## M7 · 减法收尾

1. 运行 `npx knip`（或等价）扫描 `apps/mobile`、`packages/*`、`apps/bridge-cli`，删除未使用的导出、文件、依赖；报告写进 `PROGRESS.md`。
2. 文档：按 `10-migration-map.md` §文档删除重复与过时文档；更新根 `AGENTS.md`、`apps/mobile/AGENTS.md`（同步 `CLAUDE.md` 副本）、`packages/bridge-runtime/AGENTS.md`、`docs/relay/*`；`README.md` 与 `README.zh-CN.md` 同步更新工作区表、功能列表、隐私承诺。
3. `npm run metrics:loc`：报告非测试代码总行数与 Markdown 数量与基线的差值。目标是低于基线；若高于基线，写清增长来自哪些目录、为什么必要、哪些是以后可删的候选。不得用删测试、合并文件、压缩排版、删除仍成立的文档来凑数。
4. `npm run check:docs` 通过。

**验证**：`npm run check:required && npm run test && npm run test:compat && npm run metrics:loc`

**完成标准**：删除清单与文档清理全部执行；LOC 与文档数已报告并解释；knip 报告为空或每条剩余项都有理由。

---

## M8 · 发布（通宵运行的终点是第 1 步；第 2 步起次日由人触发）

1. Preview 全量：部署合一后的 Worker 与 Registry 到 Preview；Bridge tarball 指向 Preview；按 `09-release-and-acceptance.md` 清单把可自动验证的项（回放、集成测试、双端构建、服务端行为）执行并记录；界面与真机项标为「待人」。生成商店文案草稿与隐私标签清单到 `PROGRESS.md`。**到这里停止，运行结束。**
2. （人）HT-4：Production 服务端 `relay:deploy:registry`、`relay:deploy:worker`、`relay:deploy:hermes-registry`、`relay:deploy:hermes-worker`（后两者首次由合一代码部署）；发布后立刻用 2.1.x 老 App 验证配对、聊天、重连；`bridge:publish` 正式版。
3. （人）HT-5：TestFlight 与 Play 内测提交、商店文案与截图、隐私标签。
4. （人）HT-6：真机验收。
5. 发布后 48 小时：每天记录连接遥测与崩溃率；出现回归先修连接稳定性。

**通宵运行的完成标准**：`09` 清单里所有可自动验证的项打勾；`PROGRESS.md` 的 HUMAN TODO 与偏离记录完整；`check:required`、`test`、`test:compat`、`metrics:loc` 全绿。最后在 `PROGRESS.md` 顶部写一段不超过 30 行的总结：做了什么、没做什么、偏离了哪些、早上要人做什么、你认为最值得人先看的三个风险。
