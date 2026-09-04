# PROGRESS · Clawket 3.0 进度日志

> 实现者维护。每次开工先读；每完成一个里程碑更新。人类只读这一份文件了解进度。

## 当前状态

- 当前里程碑：M2b（待开始；M2a 已完成）
- 集成分支：`release/3.0`
- 最近一次全绿：2026-09-05，M2a required、compat、Relay integration、双 Preview 冒烟与 LOC 全绿

## 基线（M0 填写）

| 指标 | 基线 | 最新 | 差值 |
|---|---|---|---|
| 非测试代码行数（apps + packages，ts/tsx） | 124147 | 127000 | +2853 |
| 测试代码行数 | 36018 | 38908 | +2890 |
| 测试文件数 | 186 | 195 | +9 |
| Markdown 文档数（包含 docs/3.0） | 53 | 56 | +3 |
| `git diff --shortstat <baseline>..HEAD` | — | 82 files changed, 27618 insertions(+), 21086 deletions(-) | +6532 净行（含 M2a 合并期仍并存的旧 Hermes workspace；M2b 删除） |

基线提交：`db20f7d0f9b25d094a1e3aa9c83a27c362d2fc7d`

## 里程碑

| 里程碑 | 状态 | 完成日期 | 验证结果 | 提交 |
|---|---|---|---|---|
| M0 基线与护栏 | 已完成 | 2026-09-05 | 干净 `npm ci`；required 全绿；compat 5 files / 34 tests；双 lock audit 0 high/critical；LOC 已记录 | `717f265bd3ca15fcbed4207c653c6c56e920bd6d` |
| M1 契约与包骨架 | 已完成 | 2026-09-05 | required 全绿；协议包 3 files / 23 tests、四项覆盖率 100%；Mobile 162 suites / 1361 tests；compat 5 files / 34 tests；Android Metro 与 Bridge/CLI bundle 验证通过 | `ef8ae596d031d891a4263fa4a3c04d192f8658a1` |
| M2 Relay / Registry 合一与安全口子 | 进行中（M2a 已完成，M2b 待开始） | | M2a compat 前后签名一致；required、integration、配置 dry-run 与双 Preview 冒烟全绿 | |
| M3 Bridge 拆分与 Hermes 多会话 | 未开始 | | | |
| M4 App 连接层 v2 | 未开始 | | | |
| M5 App 界面 | 未开始 | | | |
| M6 付费墙、额度与埋点 | 未开始 | | | |
| M7 减法收尾 | 未开始 | | | |
| M8 发布 | 未开始 | | | |

## M2a 合并前差异盘点

> 2026-09-05 对两套 Worker 与两套 Registry 逐文件盘点；M2a 只把差异移入 policy/override，不改变任一 wire、存储或部署行为。

| 分歧面 | OpenClaw | Hermes | 合并落点 / 不变量 |
|---|---|---|---|
| 后端、主体与 API 前缀 | `openclaw`；`gatewayId`；`/v1/pair/*`、`/v1/verify/*` | `hermes`；`bridgeId`；`/v1/hermes/pair/*`、`/v1/hermes/verify/*` | `backend`、`principalParam`、pair/verify path policy；缺参错误码仍分别为 gateway/bridge |
| ID 与 token 前缀 | Registry 生成 `gw_` / `grs_` / `gct_` | Registry 生成 `hbg_` / `hrs_` / `hct_` | policy 保存精确前缀；Relay 目前不校验主体前缀，M2a 不新增校验 |
| KV binding / 主记录 | `ROUTES_KV`；`pair-gateway:*`；record 用 `gatewayId` | `HERMES_ROUTES_KV`；`hermes-pair-bridge:*`；record 用 `bridgeId` | binding/key/record codec policy；必须继续读写存量字段形状 |
| 配对算法 | register/refresh/claim、6 字符 alphabet、token hash/cap、旧数字 code | 相同 | 一套共享实现；请求/响应主体键、错误码和 corruption 文案由 contract policy 决定 |
| OpenClaw 安全邀请 | session/resolve/v2 resolve/landing/app association、ticket auth、4 类 invitation KV 索引；refresh/claim 会失效邀请 | 全部不存在 | 完整 OpenClaw route/auth/storage extension；Hermes 路径保持 404 |
| verify owner wire role | `{ role: 'gateway' }` | 历史响应同样 `{ role: 'gateway' }` | 固定 wire role，不把语义 `ownerRole='bridge'` 泄漏到协议 |
| Relay token sync | service binding 优先，再 global fetch；`/v1/internal/pairing/client-tokens`；body `gatewayId` | 只 global fetch；`/v1/internal/hermes/pairing/client-tokens`；body `bridgeId` | route/body/service-binding policy；header、hash-only 与失败不阻断 claim 相同 |
| Registry TTL | 主记录 register/refresh/claim 均 365 天；access code 600 秒；邀请按绝对过期与索引 TTL | 主记录与 access code 相同；无邀请 | M2a 原样；未 claim 24 小时属于 M2b |
| DO binding / class / migration | `ROOM` / `RelayRoom` / `v1` | `HERMES_ROOM` / `HermesRelayRoom` / `v1` | 两个类都从同一入口导出；binding、类名、migration tag 永不改写 |
| DO 持久化形状 | `room-meta:{gatewayId}`、`gateway-owner:{gatewayId,seenAt}` | 同 key，但 value 为 `{bridgeId}` | codec policy；不得迁成新的 `principalId` 形状 |
| owner 语义与替换 | gateway；替换 reason `replaced_by_new_gateway` | bridge；替换 reason `replaced_by_new_bridge`，并重置 watchdog | base lifecycle + override；wire query role 两边仍为 `gateway` |
| client message routing | inactive client 的非 connect 请求丢弃；支持 secure pairing client；`client.reconnect-required` 关闭普通客户端 4012 | 任意请求切 active，按 reqId 回原 client；无 Bridge 时非 connect req 回 `BRIDGE_UNAVAILABLE` | 三个独立 override，不能用字段重命名替代 |
| 心跳与 pong | 配置/默认 30 秒；capable client timeout 120 秒 | 当前 production 配置 5 秒、代码 fallback 30 秒；capable client timeout 30 秒 | interval/timeout policy；M2a 保留 5 秒部署值，M2b 再统一 30 秒；legacy client不因静默清理 |
| owner watchdog | 无 | 有 client 才发 `gateway_ping`；证明支持后超时才关闭；`gateway_pong` 更新状态；通常 12 秒、代码 fallback 45 秒 | Hermes override + `watchdog` / timeout policy |
| 关闭码 / reason | 4001 gateway、4002 client/pairing、4008 rate/pairing、4009 pong/handshake/ticket、4011 gateway、4012 reconnect | 4001 bridge、4002 client、4008 rate、4009 pong/handshake/stale gateway、4011 bridge | 数值表共享，公开 reason 与独有路径按后端保留；1009 留给 M2b |
| `/v1/health` | 总有 `capabilities`，有强 ticket secret 才含 secure-pairing | 当前无 `capabilities` 字段 | M2a health hook 保持字节形状；frame-limit 声明只在 M2b 加 |
| telemetry | scope `relay_worker` / `registry_worker`；gateway 字段；OpenClaw pairing/reconnect 事件 | scope `hermes_relay_worker` / `hermes_registry_worker`；bridge 字段、traceHint；request-routing/watchdog 事件 | scope、字段名、路径模板进入 policy；独有事件留 override，事件名不重命名 |
| 部署配置 | production + Preview；OpenClaw DO/KV；Preview 独有 observability/service binding | production；需新增隔离 Hermes Preview；Hermes DO/KV | 四实例配置显式 `RELAY_BACKEND`；保留所有现有 ID/name，Hermes Preview 新 KV，不交叉绑定 |
| device-dev 临时配置 | 不适用 | 旧脚本仍指旧 workspace，写了已不用的 idle timeout 且漏 watchdog timeout | 改指合一 workspace/配置，并用测试锁定生成内容 |

合并前测试：OpenClaw Worker 40、Hermes Worker 43、OpenClaw Registry 10、Hermes Registry 6，全部通过。compat JSON 去除时钟/耗时/路径后按测试名和结果排序，34/34 的字节签名为 `787da06bddccd115537a7dc0c4c7a80ed820e1be718defa856f8e489b8f97caf`。

## M2a 完成证据

- 合并后 Relay 聚合类型检查全绿；shared 32、Registry 29、Worker 90 项测试全绿。旧 OpenClaw/Hermes 测试全部迁入，另加 policy、dispatch、storage shape 与非法 backend fail-closed 回归。
- `npm run check:required` 全绿；`npm run relay:test:integration` 1 file / 4 tests 全绿；Relay Node 编排与 Preview smoke helper 24/24 全绿。
- 12 份 tracked Wrangler 模板与 8 份本地配置全部 `deploy --dry-run` 通过；配置测试锁定 worker 名、backend、DO class/migration、KV 隔离、互指 URL 与 root dev/deploy/tail 路径。
- compat 合并前后均为 10/10 suites、34/34 tests、0 failed，规范化字节 SHA-256 均为 `787da06bddccd115537a7dc0c4c7a80ed820e1be718defa856f8e489b8f97caf`。
- OpenClaw Preview：Relay `177bccbf-f1c4-43f1-ba69-3b5114ae6221`，Registry `21f179b0-b432-4f8c-9787-22536a62c161`；产品冒烟 9/9 通过。首次冒烟暴露后台服务仍指旧全局 CLI、只启动 Production；用当前 3.0 CLI 重启 Clawket-owned LaunchAgent 后，Production + Preview 双 runtime 同时健康，重跑通过。
- Hermes Preview：新建隔离 KV `clawket-hermes-routes-preview`；Relay `031f41cc-e547-46a2-808b-3c99493ce3ff`，Registry `f8f800cf-025d-4d29-879c-f1167ad0f9fa`；Registry/register/claim/Relay/auth/sessions forwarding/bridge status 7/7 通过。
- M2a 暂时保留两个旧 Hermes workspace，故 LOC 高于基线；这是为了让机械等价审查仍可反向比较，M2b 完成安全增强后按删除清单移除。

## 决策记录（实现期间做出的、规格没写死的选择）

| 日期 | 决策 | 理由 |
|---|---|---|
| 2026-09-05 | compat 同时锁定已发布 npm Bridge gitHead、App/EAS 版本锚点与最新 pre-3.0 快照；内容相同的 6 个 pin 合并为 3 个唯一构建产物回放。 | 既覆盖真实发布来源，又避免重复构建同一闭包；等价性、canonical commit 与缓存文件均由 SHA-256 机器校验。 |
| 2026-09-05 | fixture 使用 pinned 源码提取的真实序列化/分派边界，发送到 4 个隔离的 Wrangler 服务与当前/历史 Bridge；不声称来自不可取得的历史 App 二进制抓包。 | 保留可重复、可审计的协议证据，同时不伪造缺失的发布历史。 |
| 2026-09-05 | Relay/Registry workspace deploy、根 deploy wrapper 与 Bridge publish 都执行 fail-closed compat 门禁；CI checkout 使用完整历史。 | 历史 Bridge 构建需要 pinned commit，且任何常规服务发布入口都不能绕过 `tests/compat`。 |
| 2026-09-05 | 重新解析两份 lockfile并仅用兼容性测试覆盖的 transitive overrides 清除 high/critical 告警。 | `npm audit --audit-level=high` 必须在根与 mobile lockfile 都能从干净安装通过；剩余为 root 1 low + 54 moderate、mobile 22 moderate。 |
| 2026-09-05 | Android native dependency patcher同时支持 workspace hoist 与 mobile standalone 布局，并对上游块变化 fail-closed。 | 首次干净 `npm ci` 暴露 mobile postinstall 早于根链接建立；修复后干净安装与 3 条路径回归全绿。 |
| 2026-09-05 | M2 的应用层帧上限按决策采用 8 MiB。 | 当前 Cloudflare Durable Objects 接收 WebSocket 消息上限为 32 MiB；名义 5 MiB 图片的实测 JSON 帧为 6,990,768 bytes，低于 8 MiB。 |
| 2026-09-05 | `@clawket/agent-protocol` 同时承载 3.0 契约与临时 legacy Gateway facade；Mobile 原文件只 re-export，M4 再删除 facade。 | M1 要求 App 行为零变化，同时先建立唯一能力矩阵；迁移期 facade 避免复制旧逻辑。 |
| 2026-09-05 | Management 子接口按方法可选并映射细粒度能力；`modelPerSession` 约束 model scope，`skillInstall` 约束 prompt，不虚构不存在的 Gateway 管理方法。 | capability 必须能独立降级；Hermes 只读 Agent 等组合不能靠整组存在性表达。 |
| 2026-09-05 | 协议包暂以 CommonJS package boundary 暴露 TypeScript 源给 Metro/Jest；Bridge 只允许 type-only import。 | 该组合同时通过 Mobile 独立安装、Jest/Metro 与 Bridge NodeNext typecheck；Node 若以后导入运行时值，必须先增加编译产物或 bundle。 |
| 2026-09-05 | 握手能力解析的已知集合包含既有 pong、secure-pairing 与三项 v2 常量，解析/序列化保留所有 sibling meta。 | 新增能力不能过滤现有声明；无 capabilities 的 v1 meta 需保持 JSON 字节形状不变。 |
| 2026-09-05 | `RELAY_BACKEND` 未设置时兼容旧 OpenClaw；显式值只接受 `openclaw` / `hermes`，其他值双 Worker/Registry fail-closed。 | 新变量没有非法值兼容负担；静默回退会让拼写错误的 health 假绿，并在业务流量到来后才因 binding 缺失失败。 |
| 2026-09-05 | Hermes Preview 使用新建且仅由 Hermes Relay/Registry 绑定的独立 KV；本地 account/resource 配置保持 gitignored。 | 满足 Preview/Production、OpenClaw/Hermes 基础设施隔离，同时不提交账户绑定值或密钥。 |

## 偏离记录（规格与实现不一致之处，最终报告汇总）

| 位置（文件 § 节） | 规格原文 | 实际做法 | 理由 | 影响 |
|---|---|---|---|---|
| `08-milestones.md` M0.4 | compat 必须先在基线代码上全绿。 | 在 OpenClaw 与 Hermes Relay 各删除一次 accept 后过早的 socket reconcile，再取得首次全绿。 | 基线实现会先把旧 peer 隐藏或以 4010 duplicate 关闭，使公开的 4001/4002 replacement 路径不可达；fixture 正确暴露了现存缺陷。 | 最小双后端修复恢复既有关闭码契约；其余 reconcile/rehydration 行为不变。 |
| `02-protocol-and-services.md` §7 | 2.1.0 / 2.1.1 / 2.1.2 都应找到线上已发布版本提交并录制。 | 2.1.0 使用 EAS shipped source，2.1.2 使用版本锚点并另记 d9c pre-3.0 wire；2.1.1 明确标为 `31a857…` inferred snapshot。 | 仓库、ref/tag、已检查 EAS 构建与 npm metadata 都没有可证明的精确 2.1.1 App source。 | provenance 缺口在 `tests/compat/PINNED.md` 可见；不会把 2.1.0 源码伪写成 2.1.1。 |
| `02-protocol-and-services.md` §7 | 从历史 App 真实流程录制 packet fixture，并在 worktree 构建老 Bridge。 | fixture 从 pinned 客户端的真实序列化/分派源码边界提取并经真实服务回放；历史 Bridge 使用从该 commit lock 精确裁剪的 Bridge-only closure 做 `npm ci` 与构建。 | 无可下载历史 App 二进制；历史 full-monorepo lock 的 Expo closure 已失配，完整 `npm ci` 在当时源码上不可复现。 | 协议、签名、scopes、未知控制事件与 3 个唯一 Bridge artifact 均有机器证明；不宣称二进制抓包或完整历史 App 构建。 |
| `02-protocol-and-services.md` §4.2 | 2.1.x 客户端有 5 MB 图片硬上限，可测“压缩后最大的图片”。 | 执行四个 pinned pipeline 后记录：JPEG 三次压缩均超 5 MiB 时仍返回 best candidate，因此不存在确定性最大值；冻结 1.5 MiB 与名义 5 MiB 的实际 wire bytes。 | 历史实现只在 PNG 快路使用 5 MiB 条件，没有最终 JPEG 拒绝。 | 1.5 MiB fixture 为 2,097,412-byte JSON；5 MiB 为 6,990,768 bytes；不冒充真机 compressor 上界。 |
| `02-protocol-and-services.md` §2 与 §4.2 | `relay.frame-limit.v2` 表中写 256 KB，安全口子写 8 MiB。 | 后续实现遵循 §4.2、`00-decisions.md` 与 M2 的 8 MiB。 | 256 KB 会直接破坏现有 base64 图片发送；8 MiB 高于名义 5 MiB 图片 wire 且低于平台 32 MiB。 | M2 的 capability 文案与实现统一为 8 MiB。 |
| `01-architecture.md` §3.4 | Management 示例把组内方法全部写成必选，并使用若干简化参数与返回类型；示例未列 config 写入与 exec approval resolve。 | 采用方法级 `Partial`，逐项沿用当前 `GatewayClient` 的分页、参数与返回类型，并补 `config.patch/set`、`approvals.resolveExec`。 | 原示例无法表达 Hermes 的只读 Agent、独立 cron create / heartbeat / pairRequests 等能力，也会丢失现有 UI 依赖的返回字段。 | 契约对现有行为保持可迁移兼容；适配器只暴露 capability 允许的方法，不使用抛错占位。 |
| `02-protocol-and-services.md` §3.1 | `principalIdPrefix` 写 OpenClaw 为 `null`；`ownerRole` 写 Hermes 为 `bridge`；单个 `pairingCode` key 表达邀请索引。 | Registry 保留真实 `gw_`；Hermes 的语义 owner 是 bridge 但 wire role 继续为 `gateway`；OpenClaw 邀请保留 4 类既有 key/route extension。 | 代码与 compat 表明示例字段不足或与已发布行为矛盾；机械合并不得改变 ID、wire role 和加密邀请失效语义。 | policy 比示例更精确，所有外部协议与存量 KV/DO 形状不变。 |
| `08-milestones.md` M2a 与 `02` §4.4 | Hermes 心跳在安全增强后应为 30 秒。 | M2a 先保留当前 production/本地配置的 5 秒，M2b 再改 30 秒。 | M2a 明确要求行为零变化，提前改动会污染机械等价证明。 | 最终 M2 行为仍按 30 秒决策；变更归属 M2b 并单独验证。 |

## HUMAN TODO（只有人能做的事）

| 编号 | 事项 | 怎么做 | 验证方法 | 状态 |
|---|---|---|---|---|
| HT-M0-1 | 真机验证代表性超大图片的 Expo 压缩输出与画质（非静态上界）。 | 在 iOS 与 Android 真机各选择一张大 JPEG/PNG，经 App 发送到 Preview，记录压缩后 decoded/base64/wire 大小与肉眼画质。 | 两端消息成功到达、预览可用，记录实际数值；不得把单次结果表述成 2.1.x 最大值。 | 待处理，不阻塞自动化里程碑 |

## 待人类确认

| 编号 | 问题 | 采取的保守做法 | 状态 |
|---|---|---|---|

## HUMAN CHECKPOINT 记录

| 编号 | 时间 | 需要人做的事 | 结果 |
|---|---|---|---|

## 证据

构建日志与测试报告放在本地 `docs/3.0/evidence/`（已加入 .gitignore），此处只记文件名与说明。不要求截图。

- `m0-required-compat-metrics.md`：干净安装、required/compat/LOC 结果与覆盖矩阵。
- `m0-audit-and-tooling.md`：双 lock audit、Wrangler/Expo 版本与帧大小证据。
- `m0-baseline-deviations.md`：基线 replacement bug、历史来源与图片上界偏离。
- `m1-contracts.md`：协议契约、真实消费者、覆盖率、compat 与 LOC 验证证据。
- `m2a-compat-equivalence.md`：机械合并前后规范化 compat 字节签名与计数。
- `m2a-compat-before.raw.json` / `m2a-compat-after.raw.json`：Vitest JSON 原始报告（本地忽略，不提交）。
