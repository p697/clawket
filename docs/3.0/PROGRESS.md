# PROGRESS · Clawket 3.0 进度日志

> 实现者维护。每次开工先读；每完成一个里程碑更新。人类只读这一份文件了解进度。

## Windows local-model 隔夜恢复（2026-09-12）

- 先保留现场：无 Bridge 进程、Windows Update 多次计划重启、无自动启动入口；时钟跳变 496 秒，不能精确断言第一次 1006 的原因。持续离线原因与当前网络证据见 [Windows 恢复记录](21-windows-local-model-recovery.md)。
- 增加独立 Windows 登录启动与单实例守护、退避/IPC 清理、脱敏持久日志和重连就绪超时；仅 local-model，不改 Production 或 Mac 侧代理/手机退避工作。
- 原配对恢复；三次重复启动保持单实例；停止释放资源；公网 owner lease HTTP 409 后约 61 秒自动恢复，实际模型请求成功。物理睡眠/重启、隔夜与真机端到端复验仍需记录，不能等同于本地 socket 实测。
- required 全绿（Mobile 256 suites / 2,482 tests）、compat 36/36、包验证与真实模型恢复测试通过；加强 ACL 断言后 4 项复验通过。最终修复版已安装运行、配对哈希不变；详细结果见恢复记录。交付 PR，不做正式发布。

## 本地模型连接扩展（2026-09-11）

- 用户授权新增 local-model 后端，分支 `feat/local-model-bridge`；交付仅 PR，禁止正式生产发布。
- 已实现独立 Preview 六位码/QR、实际 Mobile adapter、流式聊天、持久历史、取消、全局模型切换和实时图片能力；Windows 构建及 Python/路径测试适配。
- 公网 Preview 真实 Flash-Next → Qwen vision → Flash-Next 测试两轮通过；原 8080 服务已恢复。详情、命令和限制见 [本地模型连接](15-local-model.md)。
- Windows Android arm64 调试 APK 构建通过（532 Gradle tasks）；compat 36/36、真实 Worker 集成通过。`npm run check:required` 全绿；打包验证通过；两个 lockfile 的 audit 均无 high/critical。真机与 macOS 运行尚不作为已验收。未发布 Production/npm/商店。

### PR #30 稳定性复核

- 确认并修复 Relay challenge 误触发、握手失败立即重连、45 秒心跳窗口与冷加载健康检查的问题；未更改已有 OpenClaw/Hermes 握手策略。
- 新增回归测试在旧代码上失败、修复后通过；Node engines 更正为 >=20.3.0。公网 95 秒空闲无断线/无新建 socket 后读取历史通过；完整 required、36 项 compat、真实 Worker 集成、打包验证与新增直连测试均通过。

## 当前状态

- 2026-09-06 体验复核：用户真机反馈未通过；当前进入研究/设计讨论，M8 自动完成不代表可发布。用户授权推翻旧工程、产品与 UI 决策，以实际体验为准；保留安全和兼容性约束。见 [体验复核与方向建议](11-experience-review.md)。
- 本轮进展：iPhone 17 模拟器构建/安装/首启成功；真实 OpenClaw 报文与当前代码复现主会话别名导致 loading；记录弹层上下文、设置阻塞、配对和 Hermes 命令缺失问题。未修改产品实现；三后端 App 内聊天、Release 性能与完整页面验收尚未完成。
- 当前里程碑：M8 Preview 自动验收已完成；Production、商店与真机验收待人
- 集成分支：`release/3.0`
- 实现提交：`2d640eb`（M8 release gaps）、`dea5c67`（i18n strict 静态闭包）
- Preview：四个隔离服务已部署并健康；每次上传前 compat 35/35，Production 未改动
- 自动验收：`09-release-and-acceptance.md` 的 55 行均已完成自动可做部分，或明确标记无安全本地替代；混合项仍保留真机、控制台或视觉部分
- 发布物：3.0.0 tarball 已验证、全局安装并重启；workspace、tarball、global bundle 字节一致
- 最近一次全绿：2026-09-05，exact gate、Mobile 228 suites / 2,051 tests、compat 5 files / 35 tests、Relay integration 4 files / 7 tests、140 UI / 571 token sources、5,952 条翻译、iOS/Android clean build 全绿
- 未完成：Production 发布、npm 正式发布、商店提交、真机验收及提交前/发布后 48 小时观察
- 偏离：自配对握手与 owner 审批拆分；规格中的 📌 使用 Lucide Pin；隐私标签按实际身份关联采取更保守口径
- 首要风险：公开法务/支持页面仍是旧 OpenClaw-only 与“无分析”口径；须在商店提交前更新
- 后续风险：Hermes Production 首次合一部署与 2.1.2 回滚链、商店购买/权限/附件矩阵仍需真人闭环

## 基线（M0 填写）

| 指标 | 基线 | 最新 | 差值 |
|---|---|---|---|
| 非测试代码行数（apps + packages，ts/tsx） | 124147 | 101256 | -22891（M8 验收缺口增加 1,091 行后仍低于基线；未删测试或压缩排版） |
| 测试代码行数 | 36018 | 67730 | +31712（新增协议、迁移、审批、身份竞态、状态与组件回归；不删测试凑指标） |
| 测试文件数 | 186 | 275 | +89 |
| Markdown 文档数（包含 docs/3.0） | 53 | 49 | -4 |
| `git diff --shortstat <baseline>..dea5c67` | — | 978 files changed, 135228 insertions(+), 127991 deletions(-) | +7237 净 diff 行；文件移动与新增测试会按删除/新增计，按同口径 LOC 的非测试代码实际低于基线 22891 行 |

基线提交：`db20f7d0f9b25d094a1e3aa9c83a27c362d2fc7d`

## 里程碑

| 里程碑 | 状态 | 完成日期 | 验证结果 | 提交 |
|---|---|---|---|---|
| M0 基线与护栏 | 已完成 | 2026-09-05 | 干净 `npm ci`；required 全绿；compat 5 files / 34 tests；双 lock audit 0 high/critical；LOC 已记录 | `717f265bd3ca15fcbed4207c653c6c56e920bd6d` |
| M1 契约与包骨架 | 已完成 | 2026-09-05 | required 全绿；协议包 3 files / 23 tests、四项覆盖率 100%；Mobile 162 suites / 1361 tests；compat 5 files / 34 tests；Android Metro 与 Bridge/CLI bundle 验证通过 | `ef8ae596d031d891a4263fa4a3c04d192f8658a1` |
| M2 Relay / Registry 合一与安全口子 | 已完成 | 2026-09-05 | M2a compat 字节等价；M2b required、35 compat、4 integration、20 配置 dry-run；四 Preview 服务部署成功，OpenClaw 9/9、Hermes 7/7 | M2a `f0ac6d2f676e6a9ade4f4dfb23d3c748f832c9fd`；M2b `4d4f9f88f344e8a91038cc678300d1e5be26369c` |
| M3 Bridge 拆分与 Hermes 多会话 | 已完成 | 2026-09-05 | exact gate：Core 39、Runtime 183、CLI 61、compat 35；required 全绿；真实 tarball 3 文件并全局安装 3.0.0；Preview OpenClaw 9/9、Hermes 7/7 | `c3c8b2f`、`de1db3f`、`60e37d4`、`80412f6`、`f9ea12e`、`8198dfa`、`d5ec51e` |
| M4 App 连接层 v2 | 已完成 | 2026-09-05 | typecheck；Mobile 211/1824；required；三适配器 integration 3/3；compat 35/35；iOS/Android fresh build | `3d50124`…`e0e830d`；收口 `f97c52a` |
| M5 App 界面 | 已完成 | 2026-09-05 | typecheck；Mobile 211/1824；设计门禁 153 UI / 566 token sources；i18n 6×4；iOS/Android fresh build | `6384b57`…`f97c52a` |
| M6 付费墙、额度与埋点 | 已完成 | 2026-09-05 | Mobile 225/1997；required、compat 35/35、integration 7/7；RevenueCat mock 四路径；156 UI / 591 token sources；iOS/Android fresh build | `a6c563db4108f016bc16a74a1624cbc8ae70bd15` |
| M7 减法收尾 | 已完成 | 2026-09-05 | exact gate 全绿；Mobile 225/1998、Runtime 186、compat 35/35、integration 7/7；Knip 全量审计；Expo Doctor 20/20；CLI publish dry-run；双端 clean build；LOC/Markdown 均低于基线 | `24b78685d023023a2e7146c877d4942bdd5ce49e` |
| M8 发布 | 已完成（Preview 自动部分） | 2026-09-05 | `09` 清单 55/55 行已完成自动可做部分或标记无安全本地替代；四 Preview 服务健康；OpenClaw 9/9、Hermes 7/7；compat 35/35；最终 exact gate、strict i18n 与双端 clean build 全绿 | `2d640eb`、`dea5c67` |

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

## M2b 完成证据

- `npm run check:required && npm run test:compat && npm run relay:test:integration` 最终 exit 0：协议包 23 项且四类覆盖率 100%；shared 32、Registry 39、Worker 103、Bridge core 39、Bridge runtime required 88、CLI 53；compat 5 files / 35 tests；真实双 Wrangler integration 4/4。
- 20 份 tracked/ignored Wrangler 配置全部 `deploy --dry-run` 通过；Registry 的 SQLite `PairRegisterRateLimiter` 在并发下严格接受每 IP 固定小时内前 10 次并拒绝第 11 次，未 claim / 已 claim TTL 分别为 24 小时 / 365 天。
- `/ws` 在 `idFromName` 前查 backend-specific KV；两个线上 Preview Relay 对未知 principal 均返回 `404 UNKNOWN_GATEWAY`。只缓存 60 秒正命中且上限 10,000，避免 KV 传播时新注册 principal 被负缓存隐藏。
- Relay、Bridge、App 统一 8 MiB：精确边界与 6,990,768-byte 历史图片帧可用，超限得到 1009 / 稳定 `frame_too_large` 信号；真实 Node `ws` 回归确认 Hermes local Bridge 不崩溃并完成连接清理。
- Hermes heartbeat 为 30 秒；仅有 open client 时发 Bridge ping；pending ping 把 alarm 提前到 12 秒 watchdog deadline，pong 后恢复 30 秒 cadence；client pong 仍只对声明 `relay.client-pong.v1` 的客户端生效。
- Preview 部署：OpenClaw Relay `39a5e4d9-741e-4288-ad36-804e304f80e6`、Registry `5d8dd4d0-9c91-48e1-865a-58dd3b19fe72`；Hermes Relay `f2a19ea3-2311-48f5-95e1-a564aad2c81e`、Registry `c98f214d-b149-44ca-8a8f-2d555aca4e9d`。每个 deploy wrapper 都先重跑 35/35 compat。
- OpenClaw Preview 产品冒烟 9/9，Hermes Preview 冒烟 7/7；两边 health 均声明 `relay.frame-limit.v2`。本地 `.env.local` 不含五个 `CLAWKET_PREVIEW_*`，故规格里的条件式 `preview-openclaw-e2e.mjs` 不适用。
- 删除清单中的 `apps/hermes-relay-worker` 与 `apps/hermes-relay-registry` 已删除，lockfile 不再含旧 workspace；忽略的构建物与悬空 symlink 可从系统废纸篓 `clawket-m2b-obsolete.Z64XbR` 恢复。
- `apps/` 非测试代码从基线 111,495 降至 109,885（-1,610）；仓库总非测试代码为 125,005（较基线 +858），增长来自 M1 新协议包与 M2 的 Relay/Bridge/App 安全边界，不为凑数字删除测试或仍成立的文档。

## M3 完成证据

- Bridge 目录已按后端与职责拆分：OpenClaw 入口为 `openclaw/runtime.ts`，Relay 生命周期集中在 `relay-session.ts`；Hermes 进入 `hermes/`，旧 `runtime.ts`、`hermes.ts`、`hermes-relay.ts` 及单体测试均删除且无 shim。Hermes 最大实现文件为 1,120 行，全部实现与测试文件低于 1,200 行。
- Bridge capability 已在握手、成功响应和健康接口声明；OpenClaw 为 `bridge.capabilities.v2`，Hermes 同时声明 `bridge.capabilities.v2`、`hermes.multi-session.v2`。CLI `status` / `doctor` 显示实际探测能力，命令面仍为 19 行。
- Hermes 支持合并 Bridge / 原生只读会话的列表、创建、重命名、reset ID 轮换、删除、无缺口 keyset 分页历史、AbortController 中止、PR #27 图片体、严格 cron create 参数校验。reset/delete/stop 会取消尚未完成的 `/v1/runs` 启动，Bridge 重启后续聊会从 native + local 合并历史重建上下文。
- 原生格式依据为官方 Hermes checkout `/Users/lucy/Desktop/op/hermes-agent` 的 `research/clawket-hermes-integration` commit `7d426e6536910c5fedb7cd4a9a9010527b264de1`；全程只读且 worktree 干净。SessionDB 用 SQLite URI `mode=ro` + `query_only`，checksum 回归证明读取不修改数据库。
- 录制报文 fixture 覆盖多会话 CRUD/分页与附件/中止，并经过真实本地 WebSocket Bridge 边界；同时间戳重复内容在并发 native 落盘后旧 cursor 仍稳定，跨 Bridge 重启的 `conversation_history` 不丢历史也不重复当前 turn。
- `npm run bridge:typecheck && npm run bridge:test && npm run test:compat` 最终 exit 0：Core 39、Runtime broad 183、CLI 61、compat 5 files / 35 tests；`npm run check:required` 同样 exit 0，Runtime CI-safe 子集 147/147。
- `npm pack` 生成只有 `LICENSE`、`dist/index.js`、`package.json` 的 3.0.0 tarball，SHA-256 `a62befe37eaddb4b4134b349003644422b8f8eb565544c6d265a3958cf739fc0`；47 个输入的 provenance 会让陈旧 bundle fail-closed。tarball 已本机全局安装，workspace / tarball / global dist 字节一致，并重启 Clawket LaunchAgent。
- 最终安装后，OpenClaw `status` 显示 `pairing.secure-short-code.v2, bridge.capabilities.v2`；OpenClaw Preview 产品冒烟 9/9、Hermes Preview 冒烟 7/7。正式 npm publish 记为 `HT-M3-1`。
- 仓库非测试代码 125,705 行，较基线 +1,558、较 M2 +700；增加来自 capability 契约、Hermes 完整多会话与发布物 provenance。测试增加到 40,848 行 / 210 文件；不通过删测试、合并文件或压缩排版凑指标，M7 再以死代码扫描做安全减法。

## M4 完成证据

- `apps/mobile/src/connection/` 已成为唯一连接边界：三种 transport、OpenClaw / Hermes / YouMind Sprite 三适配器、单活 coordinator、连接注册表、未读水位线、花名册缓存、配对 facade 与运行诊断均集中于此。`backendKind` 分派在该目录外为 0；页面对 adapter / registry / pairing / protocol / transport 子模块和已删 `services/gateway*`、`services/youmind*` 的直接 import 均为 0。
- 旧 `gateway.ts`、`gateway-relay.ts`、`gateway-shared.ts`、`gateway-backend-operations.ts`、`gateway-backends.ts`、`youmind.ts` 与迁移清单中的 Hermes/YouMind Gateway 服务已删除。`useChatController` 只消费 `AgentAdapter`/`SessionUpdate`，OpenClaw 与 Hermes 共用 wire 生命周期但保持 backend 与 transport 身份分离。
- coordinator 严格保证同一时刻只有活动连接拥有在线 adapter；普通切换、快速竞态、adapter factory 失败、teardown 异常、过期 hydration、健康证据重置退避与连接级缓存清除均有回归。连接删除只清该连接的凭据、cache generation、花名册、未读与 session preferences。
- OpenClaw operator/node device token 按连接与角色隔离，bootstrap 返回多角色时分别持久化；Node 不回退读取 operator token。二维码、六位码、链接与 YouMind OTP 都经 backend-aware facade 进入同一保存/激活路径，官方 Production/Preview 做环境校验，自托管 Registry 保持可用。
- Bridge 运行信息不再把 OpenClaw Gateway `server.version` 冒充为 Bridge 版本：OpenClaw 仅在 Relay 双方协商 `bridge.capabilities.v2` 后读取 CLI `bridgeVersion`；Direct/v1/失败响应未知。Hermes 从 health 读取并在断线/重连清空。CLI 已把真实 3.0 包版本注入 OpenClaw 与 Hermes 全部 service/detached 路径；Runtime 150/150、CLI 61/61、compat 35/35。
- 最终门槛：`npm run check:required` exit 0；Mobile 211 suites / 1,824 tests；协议 24 项且四类覆盖率 100%；Registry 41、Relay 103、Bridge Core 39、Runtime required 150、CLI 61；三适配器 Node integration 3/3。`git diff --check` 与严格 i18n（6 locales、4 namespaces、1,018 keys / 6,108 translations）全绿。
- `npm run mobile:sync:native` 后，Android arm64-v8a Debug 为 555 tasks、`BUILD SUCCESSFUL`；iPhone 17 Pro / iOS 26.5 模拟器用独立 DerivedData 构建 152 targets、`BUILD SUCCEEDED`。未做模拟器截图；生成缓存验证后已删除。
- `connection/` 最终为 11,877 行 / 40 个非测试 TS/TSX 文件，超过 5,000 软目标 6,877 行。组成：adapters 3,797、pairing 1,261、protocol 2,470、registry 1,836、transports 1,165、根协调/恢复/诊断 1,348；完整 wire、迁移回滚、安全配对、三后端和运行诊断不能靠合并文件、压缩排版或删测试安全降到 5,000，M7 仅删除经死代码扫描证明无消费者的部分。
- 仓库非测试代码当前 99,361 行，较基线减少 24,786；测试 61,451 行 / 258 文件，Markdown 56 份。详细本地日志见 `m4-mobile-connection.md`。

## M5 完成证据

- App 只保留一个 `native-stack` 根栈，所有 route `headerShown: false`，页面自绘返回/关闭/标题；bottom tab、drawer route 与旧 Chat/Config/Console/Discover/Live/Profile 屏幕实现全部删除。Onboarding、Roster、Thread、SessionPanel、AgentSettings、AccountSettings、Search 已接真实 adapter/coordinator；能力不支持时由 descriptor/capability 隐藏或锁定，不靠运行时请求失败。
- 线程保留完整运行时：消息与本地 cache 对账、附件/中文组合输入、模型/思考、工具详情、审批、日期分隔、子 Agent 与 Cron 卡片、切会话交叉更新。失败 Cron 的状态词使用 `bad`，日志动作依 `logs` Pro 门槛；锁定动作已在 M6 接通付费墙续做。
- `10-migration-map.md` 中 M5 要删除的屏幕、组件、服务与导航文件均不存在，页面对被删服务引用为 0。`IconButton`、`CircleButton`、`ModalSheet`、零消费者 ChatComposer/ChatHeader/SessionSidebar/AgentsModal 已删除；`SegmentedTabs` 因 SessionPanel、Search 与设置子页仍有真实消费者而保留。

### M5 页面状态矩阵

| 页面 | 加载 | 空 | 错误 | 离线 | 无权限 | 自动证据 |
|---|---|---|---|---|---|---|
| Onboarding | 通过 | 不适用 | 通过 | 通过 | 不适用 | `OnboardingScreen.test.tsx`、`OnboardingRoute.test.tsx`；见偏离 M5-1 |
| Roster | 通过 | 通过 | 通过且保留缓存 | 通过且保留缓存 | 通过 | `RosterScreen.test.tsx`、`model.test.ts` |
| Thread | 通过 | 通过 | 通过且保留消息 | 通过且输入禁发 | 通过 | `ThreadView.test.tsx`、`ThreadScreen.test.tsx`、`model.test.ts` |
| SessionPanel | 通过 | 通过 | 通过且保留缓存 | 通过且保留缓存 | 通过 | `SessionPanel.test.tsx`、`model.test.ts` |
| AgentSettings | 通过 | 通过 | 通过 | 通过 | 通过 | `AgentSettingsScreen*.test.tsx` 与各 section/model test |
| AccountSettings | 通过 | 通过 | 通过 | 通过 | 通过 | `AccountSettingsScreen*.test.tsx` 与 section/model test |
| Search | 通过 | 通过 | 通过 | 通过 | 通过 | `SearchView.test.tsx`、`SearchScreen.test.tsx`、`model.test.ts` |

Onboarding 的页面专属状态为默认表单、连接中、offline/error 与 Debug Preview；其成功路径保存连接、回花名册、等待 ready 后打开 main thread。其余页面的五态由页面 state resolver、共享状态壳与组件渲染测试共同覆盖。

### M5a · `05` §11 组件核对

| §11 项 | Clawket 落点 | 核对结果 |
|---|---|---|
| 44 圆形按钮 | `FloatingButton.tsx` | 44/22 token、quiet/pressed/badge、方向返回与 reduce-motion 测试通过 |
| 页面头部 | `ScreenHeader.tsx` + 页面浮动头部 | 对称 44 槽、内容拥有、根栈无系统 header |
| Segmented | `SegmentedTabs.tsx` | full/sm/text、圆轨与选中抬升；保留真实消费者 |
| Sheet 套件 | `Sheet.tsx`、`AdaptiveBottomSheetModal`、`SheetHeader/Backdrop/ThemedFullWindowOverlay` | phone 动态高度、iPad 居中、统一 chrome 与 320 ms/reduce-motion 测试通过 |
| 居中确认 | `ConfirmationModal.tsx` | 删除/重置/深链确认均不用系统 `Alert` |
| 搜索输入 | `SearchInput.tsx` | 44 高胶囊、sheet mode、组合输入安全 |
| 文本输入 | `CompositionSafe*`、`PasteCapableTextInput`、`FormTextInput` | 中文 composition、底部弹层、图片粘贴与并发队列回归通过 |
| 主题阴影 | `createThemedShadowStyle` | 浅色 shadow / 深色发丝线集中生成，业务无手写浮层阴影 |
| 主/次按钮 | `Button.tsx` | md 44、sm、主次/禁用/loading 状态测试通过 |
| 状态页 | `EmptyState`、`LoadingState`、`Skeleton`、`Banner` | 页面一句话 + 单动作，加载使用骨架；页面五态测试见上表 |
| 样式护栏 | `check-ui-style.mjs` + baseline/selftest | 扫描 153 UI、566 token sources、44 checker outcomes；缺失/损坏输入 fail-closed |

同时完成 Clawket 配方组件 `AgentAvatar`、`HeaderPill`、`RosterRow`、`Bubble`、`SystemEventRow`、`RunCard`、`ApprovalCard`、`Composer`、`SettingsGroup/Row`；浅/深 token、状态、尺寸、间距、圆角与 reduce-motion 由 `RosterPrimitives` / `ThreadPrimitives` / `NavigationPrimitives` 等渲染测试锁定。

### M5b · `05` §9 文案预算

| 页面 | 默认字阶 / 层级 | 描述性副标题 | 装饰性标签 | 自检结论与证据 |
|---|---|---|---|---|
| Onboarding | `display + secondary` | 仅规格允许的一行引导正文；选择行无 | 仅 Debug 环境的功能性 Preview 标记 | 通过；根屏源码只含 2 个 FontSize，渲染测试覆盖命令/表单/状态文案 |
| Roster | 名字 `body` + 预览/时间 `secondary/caption` 两层角色 | 无 | 仅未读数字 / Pro 锁 | 通过；`RosterRow` token 与无边框测试，缓存/锁定/置顶渲染覆盖 |
| Thread | 正文 `body` + 事件/时间 `caption` | 仅负责人指定的 HeaderPill 模型/上下文行 | 无；状态词属于运行结果 | 通过；根视图只含 2 个 FontSize，卡片无描述第三行 |
| SessionPanel | 标题 `body` + 时间 `caption` | 无 | Agent/会话类型用分组或图标 | 通过；`secondary` 只用于规格允许的分组标题，筛选最多 3 个 |
| AgentSettings | 行标题 `body` + 尾值 `secondary` | 仅身份卡一行 | 锁用图标、注意用红点 | 通过；根页标题 `title` 为规格例外，SettingsRow 只接一个尾值 |
| AccountSettings | 行标题 `body` + 尾值 `secondary` | 无 | 环境/Pro 只在功能位置显示 | 通过；根页标题 `title` 为规格例外，描述符不会生成解释句 |
| Search | 结果标题 `body` + 时间/命中 `secondary/caption` 两层角色 | 无 | 类型只用分节/图标 | 通过；三种 token 对应标题与同层辅助信息，空/错误均一句话单动作 |

静态门禁逐文件限制业务 screen 的 `FontSize.*` 种类不超过 3，并在 70 个 screen 文件上全绿；列表边框、emoji 图标、硬编码颜色与删除 token 债只能下降。M5 收口时 baseline 为 5 文件 / 9 项；M6 当前债为列表边框 2/2、emoji 图标 2/2、screen 字阶 0/0，且 1 个 file/rule pair 优于 baseline。

- i18n 已从 `console.json` 迁到 `settings.json`，6 locales × 4 namespaces 的 1,018 keys / 6,108 translations 完全一致；strict 扫描 355 源文件，missing/removable 均 0，7 个动态 `thinking_*` key 显式保留，5 项损坏输入 selftest 全绿。
- 最终 `npm run mobile:typecheck && npm run mobile:test && npm run mobile:check:design-system` 与仓库 `check:required` 全绿；Mobile 211 suites / 1,824 tests。Android arm64-v8a Debug 与 iPhone 17 Pro / iOS 26.5 模拟器 fresh build 均成功，未做截图。
- `apps/mobile/src/screens` 从基线 49,092 行降至 22,843 行 / 70 个非测试文件，减少 26,249 行，超过 12,000 目标；未删除测试、合并文件或压缩排版。详细本地日志见 `m5-mobile-ui.md`。

## M6 完成证据

- 免费额度固定为 1 个连接与该连接的 `main` Agent；非 Pro 每 24 小时至多切换一次免费连接。首次 3.0 启动的合资格旧用户获本地一次性 14 天宽限；Pro 或宽限到期会由计时器与前台刷新立即按同一规则重新上锁，SecureStore 缺失或损坏时 fail-closed。
- entitlement 快照以 revision 与串行 latest-write-wins 持久化；RevenueCat refresh/listener 不得覆盖更新状态，购买与恢复 single-flight。全屏付费墙的购买、恢复、取消、pending、store error 与 offering unavailable 均有 mock 回归。
- 规格触发表实际列出的六个 hero 均为独立 code-drawn composition；所有情境入口、3.0 历史用户介绍页、连接就绪每进程一次例外、审批优先与购买/恢复成功后续做被拦动作都有渲染或状态机测试。
- RevenueCat 使用动态价格与 metadata 决定默认 annual/monthly 和 social proof；package 顺序 annual → lifetime → monthly。Release 构建缺 RevenueCat/PostHog 配置或启用测试解锁时 fail-closed；App Store 与 Play 后台及真机步骤记入 HUMAN TODO。
- `07-analytics.md` 全事件表、超级属性、最近 20 条诊断与逐事件属性白名单已落地；废弃事件生产调用为 0。重连原因覆盖 `socket_close`、`probe_failed`、`foreground`、`tick_timeout`、`seq_gap`；adapter factory 注入重连与 Sprite greeting 遥测以保持 Node integration 可执行。
- 自动评分改为首次成功发送后的第 3 次后续冷启动；持久化 pending 状态不会阻断消息发送。
- 最终门槛：`check:required` exit 0；协议 24 且四项覆盖率 100%；Mobile 225 suites / 1,997 tests；Registry 41、Relay 103、Bridge Core 39、Runtime required 150、CLI 61；compat 35/35；Relay integration 7/7；i18n 6×4、1,058 keys / 6,348 translations；设计门禁扫描 156 UI / 591 token sources。
- Android arm64-v8a Debug 最终原命令 555 actionable tasks、`BUILD SUCCESSFUL`，APK SHA-256 `b790961e521ed32994e4f28bf6674e5de51cd4934545ac079e12283a0c5917d7`；iOS simulator Debug 为 152-target graph、`BUILD SUCCEEDED`。未启动模拟器、未截图；隔离 iOS DerivedData 验证后已删除。
- M6 非测试代码较 M5 增加 3,957 行，来自 entitlement、付费墙、analytics 与启动/续做接线；仓库 103,318 行仍较基线少 20,829。测试为 65,722 行 / 272 文件，Markdown 56 份；未删测试、合并文件或压缩排版，指定文档减法归 M7。详细本地日志见 `m6-paywall-entitlement-analytics.md`。

## M7 完成证据

- 删除 25 个经消费者扫描、类型检查和全量测试共同证明不可达的 Mobile 生产文件（3,037 行）；Bridge 删除 3 个零消费者 helper，并把 7 个实现内部类型/常量收回模块内。未删除测试文件，协议、页面渲染、双后端连接和 Bridge broad suite 均全绿。
- i18n 删除 73 个不可达 logical key / 438 条翻译；strict 最终为 6 locales × 4 namespaces、985 keys / 5,910 translations、missing/removable 均 0，7 个动态 `thinking_` key 有显式保留依据。旧 Live/Console announcement route 命中为 0。
- 按迁移图删除 9 份重复或过时文档，新增合一后 Relay/Registry 工作区 README；根双语 README、三层 `AGENTS.md` 与 `docs/relay/*` 已按当前四个隔离服务对更新。删除断言检查 917 个当前文件、50 个精确路径、16 个路径模式，违规 0；6/6 `CLAUDE.md` 仍是相对 symlink。
- 移除 14 个无直接消费者的 Mobile 依赖；`expo-system-ui` 作为 `userInterfaceStyle=automatic` 的实际原生消费者新增。每次 manifest 变化都执行 native sync、Android arm64 Debug 与 iOS Simulator build，15 轮均 exit 0；最终 clean prebuild 后 Android 532 tasks 成功，iOS clean build exit 0。
- Mobile Knip 的依赖、devDependency、unresolved 与 cycle 均为 0。剩余报告逐项有理由：3 个字符串加载的 Expo config plugin、1 个被报告两次但原生明确禁用的 `expo-updates` 误报、公共 barrel/组件契约与测试 seam 的 220 value / 275 type exports、3 个仍有旧 Gateway barrel 消费者的兼容别名。仅删除 export modifier 不减少 LOC，未把公共契约误判成死实现。
- Packages/CLI Knip 的 files/exports/types/unlisted/unresolved 可行动项为 0。仅保留 bundle external 的 `tweetnacl`/`ws`、动态调用的 `tsup`，以及平台命令 `ipconfig`/`reg`/`crontab`。Expo Doctor 1.20.4 为 20/20；两 lock dry-run 一致，root 为 1 low / 47 moderate、Mobile 为 20 moderate，均 0 high/critical。
- 最终原样执行 `npm run check:required && npm run test && npm run test:compat && npm run metrics:loc` 全绿：Protocol 24 且四项覆盖率 100%；Mobile 225/1,998；Registry 41、Relay 103、Bridge Core 39、Runtime broad 186、CLI 61；compat 35/35。额外 Relay/adapters integration 7/7，CLI 3 文件发布包、4 runtime boundaries、17 modules、47 provenance inputs 验证及 `npm publish --dry-run` 通过。
- 非测试代码 100,165 行，较 M0 基线减少 23,982；测试 65,722 行 / 272 文件；Markdown 49 份，较基线少 4。没有通过删测试、合并文件、压缩排版或删除仍成立的文档凑数。详细本地日志见 `m7-subtraction.md`。

## M8 完成证据

- `2d640eb` 收齐 Preview 验收缺口：缓存花名册以 `syncedAt` 标记且不传播过期未读/attention/working；置顶会话行显示 owning Agent 头像、Lucide Pin 与类型 overlay，并在取消置顶后消失；远程头像、相对时间、YouMind 公共身份、临时 compaction 行、200 ms 会话交叉淡入与 reduce-motion 均有回归。线程身份按 connection + Agent 隔离，连接级 pair approval 有稳定合并、tombstone、并发刷新保护、失败重试与低敏错误，且不写历史或 cache。`dea5c67` 把花名册相对时间改为可静态审计的 literal-key 分派，使 strict i18n 门禁全绿。
- 四个 Preview 服务按 Registry → Relay、OpenClaw → Hermes 顺序部署；每次 wrapper 上传前都先通过 compat 35/35。当前版本：OpenClaw Registry `c3bb9e6a-5c83-4192-9e73-659c5726c853`、Relay `c3bcb3a8-34d3-4027-a9cc-bc0a667c7d30`；Hermes Registry `3d311407-e7bc-4575-b01e-ddd789412b30`、Relay `644f98f0-31e1-4584-981d-96f766f741f4`。上一版本已记录为反向回滚锚点；Production bindings 与流量均未触碰。
- 四个 health 均为 200；OpenClaw 产品冒烟 9/9、Hermes 7/7。未知 OpenClaw/Hermes principal 在线返回 `404 UNKNOWN_GATEWAY`，单元/集成测试证明在 `idFromName` 前拒绝；Hermes 固定小时公开 IP 限速精确在第 11 次返回 429。1,572,975-byte 帧进入在线 Relay/Bridge 队列，9 MiB binary 以 1009 / `frame_too_large` 关闭；因未挂真实 Gateway，不把前者声称为附件端到端交付。
- 从 M8 源码构建 `/tmp/clawket-m8-final-pack.seousx/p697-clawket-3.0.0.tgz`：3 个文件、110.1 kB packed / 512.7 kB unpacked，npm shasum `787d8e16d3389b9c0e3790070132d3f42b49656d`，tarball SHA-256 `0c3b38f20d2c56db382ee1b384d1e44e601c8c65d01bbc456b458560c7ed352f`。workspace / tarball / global 的 `dist/index.js` 都是 `bad7f48bec0c91d8de15b29b4fb262de2084d4db7d3d0bc68c8df7357cee0da6`；全局安装、`clawket restart`、doctor/status 均健康，正式 npm publish 留给 `HT-M3-1`。
- 最终原样执行 `npm run check:required && npm run test && npm run test:compat && npm run metrics:loc` 全绿：Protocol 3 files / 24 tests 且报告内覆盖率 100%；Mobile 228/2,051；Relay Shared 2/34、Registry 4/41、Relay Worker 5/103；Bridge Core 6/39、Runtime broad 20/186、CLI 8/61；compat 5/35；required Node checks 55。额外 Relay/adapters integration 4 files / 7 tests 全绿。
- i18n strict 扫描 343 个源文件：6 locales × 4 namespaces、992 keys / 5,952 translations、referenced 985、unused 7、removable 0、retained 7、dynamic protected 0、missing 0；7 个保留项均是显式 `thinking_*` prefix。设计门禁扫描 140 UI / 571 token sources / 44 selftest outcomes；设计文档锁定 11 个组件、10 个 token family、18 个颜色与 6 个例外。
- `mobile:sync:native` clean prebuild 与 Pods 成功。Android arm64-v8a Debug 为 532 actionable tasks（503 executed / 29 up-to-date）、`BUILD SUCCESSFUL`；iOS Simulator Debug 为 148-target graph、`CLEAN SUCCEEDED`、`BUILD SUCCEEDED`。未启动模拟器、未截图；生成缓存验证后已删除。
- Mobile Knip 没有 unused dependency/devDependency、unresolved 或 cycle；剩余项仅为 3 个字符串加载的 Expo plugin、禁用的 `expo-updates` 误报及公共 contract/test seam。Packages/CLI Knip 只保留 bundle externals `tweetnacl`/`ws`、动态 `tsup` 和系统命令。Expo Doctor 1.20.4 为 20/20；root audit 为 1 low / 47 moderate / 0 high / 0 critical，Mobile 为 20 moderate / 0 high / 0 critical。
- `09-release-and-acceptance.md` 共 55 行：55/55 行均已完成自动可做部分，或对 Android license tester 等项目明确记录无安全本地替代；其中 48 行仍有真机、控制台或视觉部分，7 行无需人类补验。最终 LOC 为非测试 101,256、测试 67,730 / 275 文件、Markdown 49；相对 M0 非测试 -22,891、测试 +31,712、测试文件 +89、Markdown -4。增长来自验收缺口及审批/身份竞态回归，没有删除测试、合并文件、压缩排版或删除仍成立文档凑数。详细本地日志见 `m8-preview-release.md`。

### M8 商店文案草案

| 字段 | English | 简体中文 |
|---|---|---|
| App name | Clawket | Clawket |
| Apple subtitle | AI agent control tower | OpenClaw 与 Hermes 的手机控制塔 |
| Google short description | See, chat with, and manage your OpenClaw and Hermes agents from your phone. | 在手机上查看、对话并管理你的 OpenClaw 与 Hermes Agent。 |
| Promotional text | See what every agent is doing and take control when it matters. Clawket brings OpenClaw and Hermes together on your phone, with chat for YouMind Sprite. | 一屏看清每个 Agent 在做什么，需要时随时接管。Clawket 把你电脑上的 OpenClaw 与 Hermes 带到手机，并支持 YouMind 精灵聊天。 |
| Keywords | OpenClaw,Hermes,AI agents,agent manager,remote chat,self-hosted,automation | OpenClaw,Hermes,AI Agent,智能体,远程管理,会话,自动化,自托管 |

English full description:

```text
See what every agent is doing and take control when it matters. Connect OpenClaw or Hermes running on your own computer to chat and manage sessions, schedules, skills, and models. The official OpenClaw app is for chat; Clawket is for control.

Clawket is a mobile session control tower for self-hosted AI agents.

• See agents, live status, conversation previews, unread activity, and items that need attention.
• Chat in persistent threads and switch, rename, reset, or delete sessions.
• Manage supported models, skills, scheduled tasks, files, devices, approvals, and logs.
• Pair through Clawket Relay, or connect over your local network, Tailscale, or a custom endpoint.
• Sign in with email to chat with your YouMind Sprite.

Free includes one connection and its main agent. Clawket Pro unlocks multiple connections and agents, plus OpenClaw management, logs, file editing, message search details, and alternate app icons. Choose an annual, lifetime, or monthly plan; localized prices are shown in the app. No free trial.

Privacy by design:
• Clawket message caches stay on your device.
• Clawket Relay forwards live traffic and does not persist message content.
• Removing a connection clears its local message cache.

Feature availability depends on the connected backend. YouMind Sprite supports chat only.
```

简体中文完整描述：

```text
看清每个 Agent 在做什么，随时接管。连接你自己电脑上的 OpenClaw 或 Hermes，聊天、管理会话、定时任务、技能与模型；官方 OpenClaw App 用来聊，Clawket 用来管。

Clawket 是自托管 Agent 的手机会话控制塔。

• 一屏查看 Agent 状态、对话预览、未读和待处理事项
• 在持续线程中聊天，切换、重命名、重置或删除会话
• 按后端能力管理模型、技能、定时任务、文件、设备、审批与日志
• 默认通过 Clawket Relay 配对，也可使用局域网、Tailscale 或自定义端点直连
• 使用邮箱登录，与 YouMind 精灵聊天

免费版包含 1 个连接和该连接的 main Agent。Clawket Pro 解锁多个连接与 Agent，以及 OpenClaw 管理、日志、文件编辑、消息搜索详情和更多 App 图标。可选年付、终身或月付方案；本地化价格以 App 内显示为准，不提供试用。

隐私优先：
• Clawket 的消息缓存只保存在你的设备上
• Clawket Relay 只转发实时流量，不持久化消息内容
• 删除连接会清除该连接的本地消息缓存

具体能力取决于所连接的后端；YouMind 精灵仅支持聊天。
```

What’s New (English):

```text
Clawket 3.0 is rebuilt around a unified agent roster and persistent threads. It adds Hermes multi-session support, YouMind Sprite chat, six-digit Relay pairing, capability-aware settings, global search, a new Pro plan, and a redesigned visual system. Connection recovery and OpenClaw/Hermes compatibility are strengthened throughout.
```

更新说明（简体中文）：

```text
Clawket 3.0 围绕统一 Agent 花名册与持续线程重构：新增 Hermes 多会话、YouMind 精灵聊天、六位 Relay 配对、按能力显示的设置、全局搜索、新 Pro 方案和全新视觉系统，并全面增强 OpenClaw 与 Hermes 的连接恢复和兼容性。
```

### M8 商店隐私标签保守草案

| 数据类型 | 用途 | 关联身份 | Tracking | 备注 |
|---|---|---|---|---|
| Email Address | App Functionality | Yes | No | YouMind 登录与私有 Agent Settings |
| User ID | App Functionality | Yes | No | 账户/后端身份 |
| Device ID | Analytics | Yes | No | PostHog `identify(deviceId)` |
| Purchase History | App Functionality + Analytics | Yes | No | RevenueCat entitlement 与购买事件 |
| Product Interaction / Other Usage | Analytics | Yes | No | 白名单事件，不含消息正文或凭据 |
| Performance / Other Diagnostics | Analytics | Yes | No | 连接与错误诊断 |
| Other User Content | App Functionality | Yes | No | YouMind 消息及用户主动发往 Agent 的内容 |
| Location、Photos/Videos、Audio、Files/Documents | 待商店提交前确认 | 待确认 | No | 原生权限及附件可能发送给用户选择的 Agent，见 `HT-M8-4` |
| Payment Info | Not collected | No | No | 由 App Store / Play 处理，Clawket 不直接收集 |

不声明“全部传输加密”：custom/direct 连接仍允许用户配置 `http/ws`。全局 Tracking 申报为 No；最终标签须与两商店实际构建、SDK 控制台和公开隐私政策一起由人复核。

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
| 2026-09-05 | 注册限速采用每个 SHA-256 IP hash 一个 SQLite Durable Object 的固定一小时窗口，关键计数持久化并由 alarm 清理。 | 当前 Workers Rate Limiting binding 的 `period` 只允许 10 或 60 秒且按 Cloudflare location 独立计数，无法表达精确的 10 次/小时；持久化 DO 在实例回收后仍不会重置计数。 |
| 2026-09-05 | Relay 的 60 秒 pairing existence cache 只缓存正命中，负命中每次重查 KV；缓存 key 含 backend 且总量上限 10,000。 | 安全收益来自未知 ID 不创建 DO；负缓存会在 Registry 写入到该 Relay location 可见前制造新的错误拒绝，且无助于限制随机 ID 的 Map 增长。 |
| 2026-09-05 | Hermes 30 秒 heartbeat 与 12 秒 Bridge watchdog 共用 alarm，但有 pending ping 时按更早的 watchdog deadline 调度；pong 立即恢复 30 秒 cadence。 | 单纯把 heartbeat 配置从 5 秒改成 30 秒会把 12 秒 watchdog 延迟到约 30 秒；若 pong 后不重排，则 cadence 又会永久退化成 12 秒。 |
| 2026-09-05 | OpenClaw Bridge 私下消费 App `connect.start` 顶层 capability meta，在转发到 closed-schema Gateway 前剥离；只有请求精确声明 `bridge.capabilities.v2` 且成功响应匹配 id 时才注入能力。 | 官方 OpenClaw Gateway 不接受未知顶层字段；这样既完成双方协商，又让 v1 请求/失败响应保持字节等价，不把 Bridge 私有协议泄漏给 Gateway。 |
| 2026-09-05 | Hermes Bridge 只持久化会话 key、当前 backing session id、标题与更新时间；消息继续由内存增量和 Hermes 原生只读 SessionDB 合并，reset 轮换新的 `clawket-hermes:<key>:<uuid>` backing id。 | 不复制或修改 Hermes 消息存储，符合消息只在设备与原生后端的隐私边界；轮换 id 让 reset/delete 不需要在原生数据库写 tombstone。 |
| 2026-09-05 | `chat.history` 用 session-bound keyset cursor；重复消息以稳定 local occurrence 标识并用原生 row id 作排序锚点，cursor 同时校验 timestamp 与 boundary id。 | 仅按 timestamp 会在相同时间戳和并发落盘时跳页；依赖动态 unmatched native 数又会使旧 cursor 漂移。当前方案有公开 dispatch 回归覆盖 `i4 → i3`。 |
| 2026-09-05 | CLI bundle 内写入 47 个实际构建输入与 registry define 的 SHA-256 provenance，package verify 精确要求新 runtime 边界且拒绝旧边界。 | 单看 tar manifest 无法发现源码已变而 `dist` 陈旧；provenance 让真实 pack / publish 在这种情况下 fail-closed，同时不把环境密钥写入摘要输入或 bundle。 |
| 2026-09-05 | 设置页的 Bridge 版本只认正在运行的 CLI 显式发布值：OpenClaw 走协商后的 Relay connect response，Hermes 走 health；Gateway `server.version` 永不代替。 | Gateway 与 Bridge 是两个独立运行物，旧实现把 Gateway 版本贴成 Bridge 版本会产生错误诊断；Direct OpenClaw 根本不存在 Bridge。 |
| 2026-09-05 | OpenClaw 安全配对下发的 device token 按连接与角色共同隔离，Node sidecar 不回退到旧 operator token。 | 同一 device 的 node/operator scope 不等价；共用旧 key 会互相覆盖或在一方失效清理时破坏另一条路径。 |
| 2026-09-05 | RevenueCat 以 customer-specific `offerings.current` 为权威；显式非默认 offering ID 可覆盖，`pro` 与旧配置 ID 仅作兼容 fallback。 | 让后台变体与 metadata 实验即时生效，同时保留现有自定义部署与迁移中的 offering 配置。 |
| 2026-09-05 | entitlement 使用本地绝对到期计时、前台刷新、revision 串行持久化与购买/恢复 single-flight。 | 过期 Pro 必须无需重启即降级，且异步 hydration、listener、refresh 与结账结果不能互相覆盖较新状态。 |
| 2026-09-05 | adapter factory 注入 reconnect 与 Sprite greeting telemetry，adapter 不在运行时 import React Native/PostHog analytics。 | 三种 adapter 的 Node integration 必须可直接执行；遥测失败也不得改变连接或 greeting 的业务结果。 |
| 2026-09-05 | Mobile 保留与根目录同版本的实体 `react-native@0.83.10` 副本，不改成 symlink。 | Catalyst 构建会原地修补 Mobile 的 `jsi.h`；symlink 会污染 hoisted React Native 并扩大到 Android、iOS 与其他 workspace。Expo Doctor 与双端 autolink 均只解析 Mobile 副本。 |
| 2026-09-05 | `expo-modules-core` 降为 Expo 的传递依赖并由 workspace setup 显式链接；应用从 `expo` 公共入口取得 optional native API。 | 消除不必要的 direct dependency，同时保持干净 hoist、原生 autolink 与可选 app-icon/speech module 可用；独立 fixture 回归已进入 required gate。 |
| 2026-09-05 | 保留 Knip 无法静态识别的字符串 Expo plugins、CLI externals/系统命令及公共 barrel contracts；每类都记录消费者或运行边界。 | 这些不是零消费者实现；盲删会破坏 prebuild、发布包运行时、平台生命周期或组件契约。只移除 `export` modifier 也不降低代码量。 |

## 偏离记录（规格与实现不一致之处，最终报告汇总）

| 位置（文件 § 节） | 规格原文 | 实际做法 | 理由 | 影响 |
|---|---|---|---|---|
| `[EX-1] 00-decisions.md` §1–2 / 05-visual-system.md | 控制塔定位、首启配置单页、设置长列表、模型/上下文常驻顶栏。 | 按用户后续明确授权以聊天为中心，采用欢迎/配对两步、五类设置、Agent 资料、高级管理、共享连接页及稳定顶栏。具体交互和保留能力见 `11-experience-review.md`。 | 用户要求完整推翻不妥旧决策并直接落地，强调手感、品质和设计。 | 不增加后端、不删除管理能力、不改付费额度；需要重新完成 Release UI 与性能验收，旧 M8 验收不适用于本修订。 |
| `08-milestones.md` M0.4 | compat 必须先在基线代码上全绿。 | 在 OpenClaw 与 Hermes Relay 各删除一次 accept 后过早的 socket reconcile，再取得首次全绿。 | 基线实现会先把旧 peer 隐藏或以 4010 duplicate 关闭，使公开的 4001/4002 replacement 路径不可达；fixture 正确暴露了现存缺陷。 | 最小双后端修复恢复既有关闭码契约；其余 reconcile/rehydration 行为不变。 |
| `02-protocol-and-services.md` §7 | 2.1.0 / 2.1.1 / 2.1.2 都应找到线上已发布版本提交并录制。 | 2.1.0 使用 EAS shipped source，2.1.2 使用版本锚点并另记 d9c pre-3.0 wire；2.1.1 明确标为 `31a857…` inferred snapshot。 | 仓库、ref/tag、已检查 EAS 构建与 npm metadata 都没有可证明的精确 2.1.1 App source。 | provenance 缺口在 `tests/compat/PINNED.md` 可见；不会把 2.1.0 源码伪写成 2.1.1。 |
| `02-protocol-and-services.md` §7 | 从历史 App 真实流程录制 packet fixture，并在 worktree 构建老 Bridge。 | fixture 从 pinned 客户端的真实序列化/分派源码边界提取并经真实服务回放；历史 Bridge 使用从该 commit lock 精确裁剪的 Bridge-only closure 做 `npm ci` 与构建。 | 无可下载历史 App 二进制；历史 full-monorepo lock 的 Expo closure 已失配，完整 `npm ci` 在当时源码上不可复现。 | 协议、签名、scopes、未知控制事件与 3 个唯一 Bridge artifact 均有机器证明；不宣称二进制抓包或完整历史 App 构建。 |
| `05-visual-system.md` §4 线程 / §5 `Bubble` | 气泡最大宽 82%，助手与用户同一规格。 | 助手回复最大宽 92%，用户保持 82%。 | 负责人 2026-09-11 反馈助手消息偏窄；回复是段落，需要阅读宽度。 | 仅 Thread 与外观预览的助手气泡；用户气泡不变。 |
| `04-app-screens.md` §4 输入区 | 「+」只放附件、技能、提示词。 | Add 弹层新增最近照片条、「命令」「创建定时任务」「工具」三行；新增 `slashCommands` 能力位；Android 不申请宽泛相册权限；「提示词」功能整体删除；行高 48（不是 52）。 | 负责人 2026-09-11 要求对标并超过 youmind-mobile 的 Add 弹层，并把 2.0 有、3.0 隐藏的「/」入口放回来；09-12 决定思考等级只留输入框、提示词无埋点无使用证据即删、行高与图标框按 youmind-mobile（44）再放宽到 48；Google Play 照片权限政策下 Android 只走系统 Photo Picker。 | 仅 Thread Add 弹层、Cron 页 create 入口与 `CommandsSheet`；YouMind 精灵仍无「+」；本地已保存的提示词数据留在 AsyncStorage 不再读取。 |
| `05-visual-system.md` §1 第 7 条 / §6 动效 | 不用三个跳动的点；新消息仅淡入上移 4。 | 发送后立即出现共享 `streaming` id 的回复占位气泡，内部活动文案按 Skeleton 呼吸节奏（1.2 s）呼吸，不用点；用户消息弹簧入场（16 点上移 + 0.92 缩放），回复晚 60 ms 上升 8 点。 | 负责人 2026-09-11 要求强化等待回馈与发送动效。 | 仅运行中且无文本时呼吸；减动效改为纯淡入。 |
| `04-app-screens.md` §3 时间线 | 助手气泡带名字/模型标签（旧实现）。 | 时间线不再显示模型名；时间进入气泡内（用户消息附送达勾号）；头像/名字签名行默认关闭，可在聊天外观中开启；「显示模型名」开关移除。 | 负责人 2026-09-11 明确要求去掉模型名、改为时间。 | `showModelUsage` 存储键与埋点字段保留原值待后续清理。 |
| `05-visual-system.md` §1 第 7 条 / §5 `HeaderPill` `AgentAvatar` | 不用三个跳动的点；运行中副标题写「思考中…」，头像用静态活动徽标。 | 线程头部运行中改为三点依次跳动（`TypingDots`），不再写文字；头部头像不显示活动徽标；花名册头像徽标暂留。 | 负责人 2026-09-11 真机反馈：头部与气泡重复「Thinking」，徽标看不懂。 | 仅线程头部；减动效静止；花名册徽标待负责人判断。 |
| `04-app-screens.md` §3 输入区 | 占位「向 {name} 提问」/ `Ask {name}`。 | 占位改为 Telegram 式一个词：`Message` / 「输入消息」，不带 Agent 名。 | 负责人 2026-09-12 认为带名字太复杂。 | 六语言同步；`Ask {{name}}` 键删除。 |
| `02-protocol-and-services.md` §4.2 | 2.1.x 客户端有 5 MB 图片硬上限，可测“压缩后最大的图片”。 | 执行四个 pinned pipeline 后记录：JPEG 三次压缩均超 5 MiB 时仍返回 best candidate，因此不存在确定性最大值；冻结 1.5 MiB 与名义 5 MiB 的实际 wire bytes。 | 历史实现只在 PNG 快路使用 5 MiB 条件，没有最终 JPEG 拒绝。 | 1.5 MiB fixture 为 2,097,412-byte JSON；5 MiB 为 6,990,768 bytes；不冒充真机 compressor 上界。 |
| `02-protocol-and-services.md` §2 与 §4.2 | `relay.frame-limit.v2` 表中写 256 KB，安全口子写 8 MiB。 | 后续实现遵循 §4.2、`00-decisions.md` 与 M2 的 8 MiB。 | 256 KB 会直接破坏现有 base64 图片发送；8 MiB 高于名义 5 MiB 图片 wire 且低于平台 32 MiB。 | M2 的 capability 文案与实现统一为 8 MiB。 |
| `01-architecture.md` §3.4 | Management 示例把组内方法全部写成必选，并使用若干简化参数与返回类型；示例未列 config 写入与 exec approval resolve。 | 采用方法级 `Partial`，逐项沿用当前 `GatewayClient` 的分页、参数与返回类型，并补 `config.patch/set`、`approvals.resolveExec`。 | 原示例无法表达 Hermes 的只读 Agent、独立 cron create / heartbeat / pairRequests 等能力，也会丢失现有 UI 依赖的返回字段。 | 契约对现有行为保持可迁移兼容；适配器只暴露 capability 允许的方法，不使用抛错占位。 |
| `02-protocol-and-services.md` §3.1 | `principalIdPrefix` 写 OpenClaw 为 `null`；`ownerRole` 写 Hermes 为 `bridge`；单个 `pairingCode` key 表达邀请索引。 | Registry 保留真实 `gw_`；Hermes 的语义 owner 是 bridge 但 wire role 继续为 `gateway`；OpenClaw 邀请保留 4 类既有 key/route extension。 | 代码与 compat 表明示例字段不足或与已发布行为矛盾；机械合并不得改变 ID、wire role 和加密邀请失效语义。 | policy 比示例更精确，所有外部协议与存量 KV/DO 形状不变。 |
| `08-milestones.md` M2a 与 `02` §4.4 | Hermes 心跳在安全增强后应为 30 秒。 | M2a 先保留当前 production/本地配置的 5 秒，M2b 再改 30 秒。 | M2a 明确要求行为零变化，提前改动会污染机械等价证明。 | 最终 M2 行为仍按 30 秒决策；变更归属 M2b 并单独验证。 |
| `02-protocol-and-services.md` §4.3 | 优先用 `{ limit: 10, period: 3600 }` Rate Limiting binding；fallback DO 使用内存计数和 alarm。 | 使用按 IP hash 分片的 SQLite `PairRegisterRateLimiter` DO；计数和窗口起点先持久化，alarm 到期删除。 | Wrangler 4.129 schema与 Cloudflare 当前文档只允许 10/60 秒 period，且 binding 计数按 location 隔离；内存计数会在 DO 回收时提前归零。 | 每个 Registry 实例新增独立 DO binding/migration；实现能严格保持一小时固定窗，不存或记录原始 IP。 |
| `02-protocol-and-services.md` §4.2 | Bridge 侧同样以应用层检查关闭超限帧，公开 reason 为 `frame_too_large`。 | Node `ws` 接收端保留 `maxPayload=8 MiB` 硬上限；库在 `message` 前发送 reason 为空的 1009，Bridge 消费其 error 并归一记录内部 `frame_too_large`。显式发送检查仍使用完整 reason。 | `ws` 发出 `WS_ERR_UNSUPPORTED_MESSAGE_LENGTH` 时 socket 已是 `CLOSING`，公开 API 无法改写 close frame；提高 `maxPayload` 才能自定义 reason，但会先把超限内容读入内存，削弱安全边界。 | 对端仍得到标准 1009，Bridge 不崩溃且 telemetry 有稳定码；Relay Durable Object 与 App 的公开/本地错误保持规格行为。 |
| `02-protocol-and-services.md` §2、§6.2 | Bridge 在转发 `connect` 前附加 capability meta。 | App 把 capability 放在 `connect.start` 顶层私有 meta；Bridge 消费并剥离后再发给 OpenClaw Gateway，仅在成功响应回 App 时注入协商结果。 | 当前官方 Gateway 的 connect schema 是 closed，透传未知顶层 `meta` 会使握手失败；把它塞进现有 Gateway meta 也会污染签名/设备契约。 | 新 App / 新 Bridge 能协商；v1 请求与失败响应字节不变，Gateway 不需要同步升级。M4 对无 meta 的旧 Bridge 做一次性降级重试。 |
| `02-protocol-and-services.md` §6.3 | `chat.abort` 后发名为 `chatAborted` 的事件。 | Bridge 保留现有统一 raw envelope：`event: 'chat'`、`payload.state: 'aborted'`；M4 adapter 将它归一成契约事件 `chatAborted`。 | OpenClaw/Hermes Bridge wire 原本以 `chat` state 表达生命周期，新增第二种 wire event 会分叉兼容路径。 | 产品层仍收到精确 `chatAborted`；老 App 忽略或按原 chat state 处理，compat 维持全绿。 |
| `02-protocol-and-services.md` §6.3 | 原生会话只读、Bridge 会话可写，但未规定同 key 冲突。 | legacy `main` 首次发送会创建独立 Bridge-owned main backing session，并在列表中遮住同 key 原生 main；发送前原生 main 仍只读可见。 | v1 App 固定向 `main` 发送且不会先调 `sessions.create`；若因原生同 key 而拒绝，会破坏老 App Hermes 聊天。 | 只对保留 key `main` 特判且有回归锁定；其他 native key 永不建影子，仍严格只读。 |
| `[M5-1] 04-app-screens.md` §0 / `08-milestones.md` M5 | 每页都实现加载、空、错误、离线、无权限五态。 | Onboarding 按其页面专属规格实现默认表单、连接中、错误、离线与 Debug Preview；不制造独立 empty / permission 页面。 | “没有连接”正是必须显示配对表单的默认态，不是空内容；`04` §8 又明确 Paywall 在 Onboarding 期间永不出现，无权限态会与冻结产品流程冲突。 | 其他六个页面仍覆盖完整五态；Onboarding 的每个可达状态和成功导航均有渲染/路由测试，不减少用户可执行动作。 |
| `[M6-1] 08-milestones.md` M6.2 / `06-paywall-and-growth.md` §2 | 付费墙实现“五套英雄图”。 | 按同节触发映射表实现 `connections`、`agents`、`manage`、`logsFiles`、`search`、`generic` 六套独立 hero。 | 映射表有六个互不等价的用户情境；合并任意一项会让表内触发点失去对应视觉。 | 只扩大 hero 枚举到规格已逐项定义的六项，不增加新触发点、文案或产品能力。 |
| `[M6-2] 06-paywall-and-growth.md` §1 | 宽限标记随设备 identity 保存，重装不重置。 | 同一安装生命周期内由 SecureStore 严格一次性；不声称 Android 卸载后仍能保留，因为卸载会删除该应用的 SecureStore 数据。 | 跨卸载绝对保证需要新增服务端账户/稳定设备标识，超出规格范围并扩大隐私面；本地实现无法诚实满足。 | iOS/Android 卸载重装行为列入真机 HUMAN TODO；未新增跟踪后端，恢复购买仍可恢复 Pro。 |
| `[M7-1] 10-migration-map.md` §文档 | Relay/Registry 文档写成“`RELAY_BACKEND` 与三实例部署说明”。 | 文档按实际拓扑写成 OpenClaw/Hermes × Production/Preview 四个隔离服务对，两个 source workspace 共部署 8 个 Worker service。 | `08-milestones.md` 已锁定一套代码四个实例，现有 Wrangler 配置也明确有四个 backend/environment 组合；“三实例”会遗漏 Hermes Preview 或混淆 Registry/Relay。 | 只修正文档计数，不改变已部署资源、环境身份或产品协议。 |
| `[M8-1] 09-release-and-acceptance.md` §3.2 | 置顶会话行要求“带 📌”；`05` / `09` 同时禁止 emoji 充当界面图标。 | 使用视觉系统规定的 Lucide `Pin` 图标，保留置顶语义与位置。 | 字面 emoji 与全局视觉护栏冲突；Lucide 是同义、可主题化且可审计的既定组件。 | 只改变图标实现，不改变功能、顺序、可访问性标签或验收语义。 |
| `[M8-2] 09-release-and-acceptance.md` §3.3 pairing approval | 验收文案可读成所有 `PAIRING_REQUIRED` 都进入同一审批映射。 | 把当前客户端自配对握手与连接级 owner pair approval 拆开；前者只认精确 request ID，后者由连接级 store 维护。 | 别人的审批结果不能误满足当前客户端握手；迟到事件、刷新竞态与失败重试也需要独立生命周期。 | 旧 wire 与 owner 审批 UI 不变；提高双后端重连和审批安全性。 |
| `[M8-3] 09-release-and-acceptance.md` §1 隐私标签 | 诊断/使用数据写作“不关联身份”。 | 商店草案按更保守的 linked 口径申报 Device ID、RevenueCat purchase 与 YouMind identity/content。 | 实际 PostHog 使用 `identify(deviceId)`，同时接入 RevenueCat 与 YouMind；不能用窄口径掩盖 SDK 的真实关联。 | 不改变 Relay 不持久化消息、本地 cache 与删除清理承诺；公开政策和最终商店标签须同步更新。 |
| `[UX-2026-09-07] 05-visual-system.md` bubble recipe | 用户气泡直接使用透明 `accentSoft`。 | 先将 tint 合成到 canvas，再应用材质透明度；solid 为不透明浅/深底。 | 用户报告 soft 深紫底黑字；旧解析丢弃 tint alpha，且直接透明底受壁纸影响。 | 保留六色与三种材质存储标识，所有后端共用修正；648 组正文对比度回归。 |
| `[UX-2026-09-11-profile] 04-app-screens.md` §5 / `05-visual-system.md` §9 | Agent 设置 = 44pt 身份行 + 「行标题 + 尾值」两档字；卡片下不放小字。 | 档案页改为「数字卡 + 行」：头部右侧墨色圆按钮 = 继续聊天，两张 hero 卡（Cron jobs、Cost today）+ 三块计数格（Models / Skills / Files），卡右侧允许一个 `caption` 数字小字（红色失败数、灰色 tokens）。 | 负责人 2026-09-11 依据 2.0 控制台埋点（定时任务 hero 人均点 6.2 次、费用 3.3 次、用量页触达最广且付费用户超配）要求把数据放回一级；小字是数字不是句子。 | 本页用到 title / secondary / caption 三档（`check-ui-style` ≤ 3 仍通过）；行仍是两档；其他页面不变。 |
| `[UX-2026-09-11-profile] 04-app-screens.md` §5 身份行 | 灰字 = 连接名 · 后端。 | OpenClaw 有心跳时灰字 = `后端 · Active {{age}}`；否则退回连接名 · 后端。 | 2.0 心跳数字 482 人反复点；连接名与分节标题重复。 | 新增协议只读操作 `cron.heartbeat.last()`（可选），OpenClaw 转调 Gateway `last-heartbeat`；Hermes 不声明，行为不变。 |
| `[UX-2026-09-11-profile] 04-app-screens.md` §5 命名 | 「定时任务」英文 `Scheduled tasks`。 | 全部改回 2.0 的 `Cron jobs` / `New cron job`（中文仍是定时任务）。 | 负责人要求与 2.0 用户心智一致。 | 六语言 `common` / `config` 键改名；无其他页面引用。 |

## HUMAN TODO（只有人能做的事）

| 编号 | 事项 | 怎么做 | 验证方法 | 状态 |
|---|---|---|---|---|
| HT-LM-WIN-1 | 实际 Windows 睡眠/唤醒、重启登录和隔夜复验 | 在可手动唤醒时测试 S0 睡眠、重启并登录，再用现有 TestFlight 连接发送消息；保留 supervisor.jsonl 时间 | 仅一个 owner、恢复耗时与实际模型回复均通过 | 待验证；自动化已覆盖独立启动、重复启动、停止和受控 socket 中断，未冒充物理睡眠测试 |
| HT-AUTH-1 | 真机验收新版 YouMind OTP 与键盘 | 用自己的邮箱走六位码自动填充、粘贴、错误后重试、切后台后重发倒计时，覆盖 iOS/Android 与浅深模式 | 无重复请求、键盘不遮挡、六格与输入一致；无需改动已有连接 | 待处理；本轮 native 已看到邮箱页，之后 CUA 返回 noWindowsAvailable，未发送验证码 |
| HT-EX-1 | 解锁 Mac 以继续模拟器验收 | 本次 CUA 明确返回 Mac locked，自动解锁不可用；已通过当前任务请求解锁 | Release 模拟器可继续由 CUA 操作 | 已于 2026-09-06 17:37 恢复操作，本轮继续完成管理/外观页面走查和用量、诊断修复；当前不再以锁屏作为阻塞。拖动手势的自动化结果不可靠，真机滚动验收仍需保留 |
| HT-UX-1 | 临时解除模拟器系统弹窗自动化障碍。 | 在模拟器 Safari 的“在 Clawket 中打开此页？”点“打开”。AX 只暴露 sheet，坐标点击返回 noWindowsAvailable；已发异步请求。 | App 打开设置，随后继续配对与页面实测。 | 待处理；代码诊断和方向草图继续进行，非产品权限审批 |
| HT-M0-1 | 真机验证代表性超大图片的 Expo 压缩输出与画质（非静态上界）。 | 在 iOS 与 Android 真机各选择一张大 JPEG/PNG，经 App 发送到 Preview，记录压缩后 decoded/base64/wire 大小与肉眼画质。 | 两端消息成功到达、预览可用，记录实际数值；不得把单次结果表述成 2.1.x 最大值。 | 待处理，不阻塞自动化里程碑 |
| HT-M2-1 | 在 Cloudflare Production zone 配置 WAF 限速与账户告警；Preview `workers.dev` 不可配 WAF，继续依赖代码层限速。 | `clawket.ai` 每个 zone 建四条规则：① `ws-connect`：path=`/ws` 且 host 为 relay/hermes-relay，30 次/分钟/IP，Block 60 秒；② `pair-register`：path=`/v1/pair/register`，10 次/小时/IP，Block 1 小时；③ `pair-resolve`：path contains `/v1/pair/session`，20 次/分钟/IP，Block 60 秒；④ `registry-global`：host 为 registry/hermes-registry，300 次/分钟/IP，Managed Challenge。账户通知：Workers 请求量 2,000,000/日、DO 请求量 500,000/日、KV 写入 50,000/日，收件邮箱 + Discord webhook；预算目标 ≤ $30/月，$50 告警，$100 人工介入。 | Cloudflare 控制台逐条核对表达式、阈值、动作和通知收件人；保存规则/告警截图或导出记录。 | 待处理，不阻塞 Preview 自动化验收 |
| HT-M3-1 | 正式发布 npm `@p697/clawket@3.0.0`。 | 在最终 release commit 的干净 checkout 登录有权限的 npm 账户，确认 `npm run check:required` 与 `npm run test:compat` 全绿后执行 `npm run bridge:publish`；不要手改版本，也不要绕过 prepublish 门禁。 | `npm view @p697/clawket@3.0.0 version dist.integrity gitHead` 与本地 release commit / pack integrity 对齐；在另一临时目录全局安装并确认 `clawket status` 显示 3.0.0。 | 待处理；M3 已用真实 tarball 全局安装并完成 Preview 自动化，不阻塞后续里程碑 |
| HT-M6-1（HT-3） | 配置 App Store、Play 与 RevenueCat 的三商品和付费墙实验。 | 激活 monthly / annual / lifetime，lifetime 定为 $49.99 且不设试用；三者映射同一 Pro entitlement，offering package 顺序 annual / lifetime / monthly；建立 `default_package` 与 `social_proof` 两组 metadata 变体并选择 current offering。 | RevenueCat customer-specific current offering 返回三包与预期 metadata；两商店本地化价格、订阅组、地区和 entitlement 映射一致。 | 待处理，不阻塞自动化里程碑 |
| HT-M6-2 | 完成 Android 结账后台与真机排查。 | 配置 Release EAS RevenueCat/PostHog 环境，上传 Play 测试轨道，用 license tester 走购买、恢复、取消、pending 与国家/币种可用性，并查看 `reason` 分布。 | 三商品有效、测试账号能购买/恢复；`ITEM_UNAVAILABLE`、`cancelled`、`pending` 与其他 store error 能按文档归因。 | 待处理；本地 fail-closed 配置、文档与 Debug 构建已完成 |
| HT-M6-3 | 完成 iOS Sandbox/TestFlight 结账验收。 | 配置 App Store Connect 与 RevenueCat 后，在真机分别购买月/年/终身并验证恢复、取消、pending/Ask to Buy 与到期。 | entitlement、动态价格、默认包、续做动作和本地到期降级均符合记录。 | 待处理，不阻塞 Preview 自动化验收 |
| HT-M6-4 | 真机验证 PostHog 事件与看板。 | 在 iOS/Android 各执行配对、连接、付费墙、结账、聊天、审批、重连；检查最近事件并建立 `07` §5 四组看板。 | 事件名、白名单属性、super properties、失败 reason 与五类 reconnect reason 正确，且无消息正文、token 或凭据。 | 待处理，不阻塞自动化里程碑 |
| HT-M6-5 | 验证两端卸载重装后的 entitlement、免费连接与宽限行为。 | 分别在 iOS/Android 真机记录安装前状态，卸载重装、重新配对并恢复购买；观察 SecureStore/Keychain 的平台差异。 | Pro 可由商店恢复；免费连接重新确定；明确记录宽限是否被平台保留或重发，并据结果决定是否需要另立隐私评审的后端方案。 | 待处理；已记录 M6-2 偏离 |
| HT-M8-1 | iOS / Android 真机完成 `09-release-and-acceptance.md` 的 Preview 人类部分。 | 用 Preview 配置覆盖 OpenClaw 六位码/QR/direct/Tailscale、Hermes Relay/local/旧 Bridge 提示、YouMind OTP、附件、审批、缓存花名册、减动效、主题/语言、权限与真实后端会话；逐行记录结果，不做模拟器截图替代。 | 两端 48 个含 HUMAN 部分的清单行均有真机/视觉结果；失败必须修复并重跑对应自动门禁。 | 待处理；不阻塞已完成的 Preview 自动部分 |
| HT-M8-2 | 更新公开隐私政策、条款、支持页与首页。 | 在 `clawket.ai` 补 Hermes、YouMind、Relay、本地 cache、PostHog、RevenueCat 与联系方式；移除 Office 和旧“无分析/无第三方”口径，并与上方保守隐私标签对齐。 | 公开页面、App 内链接与商店申报一致，无 OpenClaw-only、Office 或否认实际 SDK 的陈述。 | 待处理；商店提交前 P0 |
| HT-M8-3 | 按已记录回滚锚点完成 Production 四服务、2.1.2 回放、回滚演练与 npm 正式发布。 | 先保存四个 Production 当前 version，再从 Registry 到 Relay、OpenClaw 到 Hermes 逐项执行仓库 wrapper；每次上传必须 compat 35/35。用真实 2.1.2 App 验证旧协议并反向演练回滚；npm 步骤沿用 `HT-M3-1`，WAF/告警沿用 `HT-M2-1`。 | 四个 Production health/冒烟正常，2.1.2 可用，回滚能恢复锚点，npm metadata/integrity/gitHead 对齐最终 release commit。 | 待处理；Production 未触碰 |
| HT-M8-4 | 完成 TestFlight / Play、商店元数据、截图、隐私标签、商品与原生权限矩阵。 | 使用上方中英文草案，配置后台商品/entitlement、权限说明与隐私标签；在商店分发构建验证相机、照片、音频、文件、通知、语音、图标，以及月/年/终身购买、恢复、取消和 pending。 | 两商店控制台、分发构建与公开政策一致；真实价格/权限/购买矩阵全绿，截图由真机生成并人工审核。 | 待处理；不阻塞 Preview 自动部分 |
| HT-M8-5 | 正式提交前稳定运行 48 小时，并在发布后监控 48 小时。 | Preview 真机验收与 Production 发布后分别观察错误、重连、Relay/DO/KV 用量、结账失败、崩溃和支持渠道；只在无发布阻断问题时提交/继续放量。 | 两个 48 小时窗口有时间戳记录；异常有处置与回滚结论。 | 待处理 |
| HT-UX-3 | 真机验收 Add 弹层与 iOS 相册权限文案。 | `npm run mobile:sync:native` 让 `app.json` 的 `photosPermission` 新文案进入生成的 `Info.plist`；在干净安装上：未授权 → 点「照片」看系统弹窗（全部 / 选择照片 / 不允许）三种结果；授权后不关弹层直接换成照片条，拒绝则退回系统选择器；已授权 → 最近照片条、多选序号、「附加 N 张」进附件栏、「全部照片」进系统相册；HEIC 与 iCloud 未下载照片；浅/深色；Hermes 连接下无「工具」行；YouMind 精灵无「+」；「命令」弹层可下滑/点遮罩关闭，`/reset` 先确认。 | 弹层高度与留白符合负责人预期；照片条打开不掉帧；附加后的图片能正常发送到 OpenClaw 与 Hermes。 | 待处理；本轮仅自动化验证，未操作模拟器 |
| HT-UX-2 | 真机验收长按消息的 Telegram 式聚焦菜单。 | 在 iOS/Android、浅/深色、有无壁纸下分别长按用户与助手消息：贴底消息、超过一屏的长回复、流式输出中的回复、键盘打开时长按；逐项点复制/收藏/取消收藏/分享，并用点遮罩、Android 返回键关闭。 | 克隆消息与原消息像素对齐、菜单贴气泡边缘且不出安全区；关闭时克隆落回真实行（键盘收起后也不跳）；复制/收藏行内确认后自动关闭；分享在遮罩消失后才弹出海报。Android 上若坐标偏移，需核对 `statusBarTranslucent` 与 edge-to-edge 窗口。 | 待处理；本轮仅自动化验证，未操作模拟器 |

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
- `m2b-security-preview.md`：安全边界、门禁计数、20 份配置 dry-run、四服务 Preview 版本、双后端冒烟、删除与 LOC 证据。
- `m3-bridge-hermes-preview.md`：Bridge/Hermes 拆分、官方 Hermes 只读依据、协议与 required 门禁、真实 tarball/全局安装及双 Preview 冒烟证据。
- `m4-mobile-connection.md`：连接边界、凭据与缓存清理、真实 Bridge 版本语义、三适配器 integration、compat、双端 fresh build 与 LOC 说明。
- `m5-mobile-ui.md`：页面状态、视觉/文案门禁、自绘组件、i18n、删除清单、双端 fresh build 与 screens LOC 证据。
- `m6-paywall-entitlement-analytics.md`：免费额度、宽限与竞态、付费墙触发/续做、RevenueCat、埋点白名单、Android 排查、双端 fresh build 与 LOC 证据。
- `m7-subtraction.md`：删除清单、依赖逐项双端构建、Knip 剩余项理由、Expo Doctor、发布包 dry-run、双 lock audit 与最终 LOC 证据。
- `m8-preview-release.md`：四个 Preview 版本与回滚锚点、线上探针、Bridge 发布物、55 项 AUTO/HUMAN 分流、最终门禁与双端构建。


## Experience refinement — 2026-09-06 (in progress)

The owner explicitly authorized revising previous product/engineering decisions and requested complete implementation plus simulator/live-backend acceptance. This supersedes the earlier research-only scope and visual-test deferral. Work remains in progress; previous M8 green gates do not certify this revision.

- Real OpenClaw Preview: Lucy received a respectful QA message and replied `Received.`; two-agent session isolation, sheet presentation, canonical session keys, history reconciliation, and connection lifecycle fixes are under live regression.
- Preview Relay tail confirmed `inactive_client_message_dropped` after Durable Object rehydration. WebSocket recovery omitted active-client routing. Persist the route marker on socket attachments, restore unambiguous full clients, and preserve markers across handshake updates. No message body/credential persistence added. Both backend policies have memory-discard tests.
- Latest Hermes installed into a separate external directory (existing legacy source unchanged). Real mobile Hermes replied `Hermes connected.`; YouMind email OTP login and persisted `YouMind connected.` reply passed. Complete streaming/abort/lifecycle acceptance remains pending.
- Current automated checkpoint: Relay 112 tests and v1 compatibility 35 tests pass. Additional chat/draft/cache/YouMind/native permissions regressions added. Clean native sync, Android Debug and iOS Release arm64 builds passed. Full required gate is being rerun after final revisions; Release performance and full UI matrix remain pending. Do not call the refinement complete.
- Native crash during testing: concurrent Expo permission requester registration corrupted NSMapTable. Both install entry points now apply a fail-closed synchronization patch. Source/CLI discovery and authenticated Hermes readiness are shared, with no automatic replacement of a gateway rejecting credentials.
- Current evidence and explicit owner-authorized product deviations are recorded in `11-experience-review.md`. Local QA Pro override is restricted to simulator testing; Production services and store distribution remain untouched.

### Refinement automated checkpoint (2026-09-06)

`npm run check:required` passes: Mobile 228 suites / 2,073 tests; Relay room 112 tests; Bridge Runtime 17 files / 155 tests; Bridge CLI 61 tests; six locales / four namespaces / 6,102 translations; design-system and documentation checks pass. Separate v1 compatibility replay passes 35 tests. Latest iOS Release build includes the current JS revision and is installed. A prior build with the native crash fix survived 10 consecutive cold launches after three seconds each; this verifies process survival only, not UI readiness or frame timing. Android Debug native build also passed. Mac unlock remains required for the unfinished interactive acceptance matrix. Agent advanced-sheet navigation now waits for dismissal; advanced connection details preserve the selected connection scope, with focused regressions included in the final gate.

### Design-language review (owner-requested scope change)

The Mac is unlocked and native visual inspection has resumed. The owner asked to review a shared design language and connection example before broader rollout. `12-design-language-review.md` records the proposed recipes and actual visual checks. The gallery is now reachable, connection selection and pairing are separate, and both reuse canonical opt-in primitives. The broad functional/visual acceptance remains incomplete; this scoped review does not close it. The final required gate passes 228 Mobile suites / 2,075 tests and 6,264 translations. The final palette-grid layout has an additional focused gallery and design-system check. Shared sheet opening/closing was also inspected in the Release simulator.

### Design-language feedback iteration



Chinese placeholder tracking follow-up: reproduced a wide search placeholder with normal entered text, including after returning from pairing. Locale copy contains no spaces; ordinary search styles omit tracking, while pairing uses 4 pt. All three composition-safe hosts now explicitly default tracking to zero before caller overrides. The Release simulator replay of pairing → gallery → type → clear keeps the placeholder compact while preserving pairing tracking. Focused 4 suites / 27 tests pass; full required gate and native build are recorded with this iteration's evidence.

Follow-up optical fixes: replaced Hermes' framed website logo with official app artwork, preserving its built-in safe area without double clipping. iOS single-line FormTextInput now uses natural font metrics; multiline/Android keep explicit leading. Actual 3× screenshots show both sample glyph bounds moved from +2 pt below center to centered; light/dark, mixed text, placeholder, and caret were inspected. Focused 3 suites / 19 tests, typecheck, design-system checks, and Release build pass. Final required gate also passes: 228 Mobile suites / 2,081 tests.

Implemented the owner's six-point feedback in the shared gallery/onboarding recipes: official bundled platform marks; compact segment inset; quiet correction and connectivity feedback; neutral native Switch without false boot/remount; explicit plain/quiet/primary icon families with a legible disabled circle. Scope remains the review surfaces, not full-app migration. Required gate passes (Mobile 228 suites / 2,080 tests); final targeted regression passes 5 suites / 51 tests. Release simulator checks and asset provenance are recorded in `12-design-language-review.md`.

### Owner approval and rollout scope

The owner approved the reference language and authorized full rollout. `13-design-rollout.md` records the accepted rules, per-surface pending work, global appearance versus chat-theme consolidation, and the deferred personalization backlog. Custom/preset backgrounds and richer bubble materials are follow-up ideas; existing chat-appearance foundations must be preserved and revalidated. No new design-direction confirmation is needed. Full-app migration and the original live-backend/performance acceptance are still pending, not closed by this approval.

### Full design rollout — implementation in progress

The reviewed language now drives shared defaults and conversation-only color. Native visual/route checks are exposing issues beyond static screenshots: help/community entry wiring, About return depth, a translation-dispatch miss, old preview chrome, inert new-thread appearance preferences, and pairing-failure recovery. See `13-design-rollout.md` for implemented scope and actual screenshot coverage. The first full gate identified old visual expectations; those are being updated to assert the approved recipes while preserving behavior coverage. Final required gate and live three-backend / all-page acceptance are pending. An unsigned Release persistence failure is under investigation; it must not be misreported as a successful connection test.


### Rollout native checkpoint

Signed Simulator Release (`CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=-`) resolved the QA-only missing Keychain identity; three real connection records and preferences returned. YouMind history and a new Chinese send/reply passed; profile, lifecycle page, pause dialog, and paused state were inspected. Mac locked during cold-start verification, so interactive acceptance remains open and the simulator's YouMind connection is currently paused. Code fixes include honest cancelled-pairing feedback, awaited wallpaper persistence with old-image preservation, actual message model labels, and accessible assistant text. Updated required gate/build results will be recorded after completion; no full-app visual certification yet.


### Rollout automated checkpoint (current revision)

`npm run check:required` passes: Mobile 228 suites / 2,092 tests; shared protocol 24 tests; Registry 34; Relay shared 41, rooms 112, service 39; Bridge Runtime 155 and CLI 61. Design-system checks verify 148 UI source files, 11 documented primitives, and six locales / 6,318 translations. Signed iOS Simulator Release builds and installs successfully; Android current JS/Hermes bundle export succeeds. Android arm64 Debug build also passes (532 tasks, 46 seconds) after recovering from disk exhaustion and restarting its stale Gradle daemon. Complete visual/functional acceptance remains open in `13-design-rollout.md`; Mac unlock is the current interactive blocker, not an approval checkpoint.

### Tool activity and disappearing chat — implementation and acceptance in progress

The owner approved the recommended tool-row/group design and authorized fixing both UI and chat regressions together. `14-tool-activity-and-chat-reconciliation.md` records scope and the reproduced defect: old cached tools with missing timestamps and repeated IDs were appended after fresh chat during reconciliation. The Lucy test send/reply remained in the source/cache but moved out of the latest viewport. Compact tool rows, stable groups, rail-free scheduled events, and the merge correction are implemented. Native Release and full required gates are running; do not mark complete until real send/refresh/reopen and visual checks pass.

### Tool activity automated checkpoint

Compact tool/group UI and scheduled-event styles are implemented. Live Lucy reproduction confirmed both cached-tool ordering and a separate Cron refresh loop that cleared/reinserted cards on ordinary chat state changes. Latest code also prevents streamed final replies from resurfacing as duplicates through older cache pages. `check:required` passes (Mobile 229 suites / 2,101 tests, 149 UI source files, 6,324 translations); v1 compatibility passes 35 tests. Signed Release builds/installs; two real Lucy sends and replies, recovered messages, group expansion and detail access were inspected before lock. Mac locked after final Cron fix was installed; final streaming/cron, dark-mode, and Hermes visual acceptance await unlock. The existing local-only QA Pro override is enabled in the simulator build, with production untouched. Full evidence/limits: `14-tool-activity-and-chat-reconciliation.md`.

### 2026-09-06 — Thread expansion and secondary-navigation acceptance

Implemented route-authoritative task history, retained mounted Thread state across secondary navigation, chronological virtualized layout with explicit bottom-follow suspension during expansion, task-specific header identity, and recorded-result fallback for Cron runs without transcript/session. No backend capability or wire contract change. Detailed decisions and evidence: `14-tool-activity-and-chat-reconciliation.md`, `evidence/thread-navigation/`.

Validation: `check:required` passed (229 Mobile suites / 2,104 tests plus workspace/design/i18n gates); `test:compat` passed 35; `check:docs` passed after instruction update; signed iOS Release built and installed. Native Lucy: respectful two-call read-only test and final reply, cold re-entry, light/dark expansion with fixed header position and no delayed bottom jump, diary result sheet, tool detail sheet, task result header, and return preserving the original date/card position. Simulator input shortcut restored to its original Escape setting.

Remaining integration issue discovered during cross-backend acceptance: saved `Hermes QA` Relay connection reports `Hermes health frame timed out`. CLI status confirms managed Hermes Bridge and Relay processes running; `/health` confirms local Hermes API reachable and relay logs show successful local health probes. No live Hermes send/navigation pass is claimed. OpenClaw reactivated successfully afterward. Backend-neutral route-history regression covers both OpenClaw and Hermes contracts. This connection issue requires separate relay-path diagnosis; it is not a missing human approval.

## Chat owner acceptance — in progress, 2026-09-06

New feedback: Add-sheet dismissal/stacking, model picker failures, empty subtitle baseline, history hierarchy, and Hermes Relay stability. Implemented shared white sheet surfaces, stable backdrop component identity, deferred Add action handoffs, compact attachment tiles, context-only header secondary text and actual composer model labels. Flattened main/channel history headings and added credential-free server-host diagnostics. OpenClaw model selection now uses supported sessions/config APIs; Hermes keeps global scope. Connection-level retries no longer create transcript entries.

Native Release verified so far: OpenClaw catalog loads and actual model appears; Add → Prompts → inline editor → cancel → close works; history white background and main/channel hierarchy inspected. Hermes cold-start/history and one live send/reply passed after restoring its old isolated QA Preview runtime. Further acceptance remains active; these are not a full-project completion claim.

Hermes diagnosis found three independent defects: (1) app saved the isolated Preview route while only the Production runtime was running; restored `/tmp/clawket-qa-hermes-preview.mjs` using the existing private pairing file, without changing Production pairing; (2) a client attaching after the persistent Bridge socket cannot depend on the initial health event, so Hermes Relay now actively requests fresh Bridge health; (3) Worker tail captured `client_pong_timeout`, with both tick interval and expiry configured at 30 seconds. The shared runtime now clamps expiry to at least three heartbeat intervals, preserving capability-gated legacy behavior. Dual-backend delayed-first-tick and dead-client regressions pass. Hermes Preview only deployed version `1801183a-e546-45fe-8bb2-b3a705001fe6` after 35/35 compat replay and dry-run; no Production deployment.

Real model-selection testing additionally found official Hermes `parse_model_flags` now returns a five-tuple. Bridge accepts the needed leading fields across three/five tuples, with executable Python fixture tests. Subprocess failures no longer expose full inline scripts to clients. Current Clawket-owned local Hermes Bridge restarted from rebuilt CLI to verify this path. External Hermes source remains unmodified.

Checkpoint gates before the final Bridge changes: 229 Mobile suites / 2,107 tests, required gate, 35 compat replays, 114 Relay tests, signed Simulator Release passed. Final gate and sustained native verification still running; record screenshots and final results before marking this owner goal complete.

### Chat owner acceptance — delivered checkpoint

Final signed Release installed; `check:required` passes 229 Mobile suites / 2,109 tests plus all workspace/design/i18n gates; separate v1 replay 35/35 and final docs check pass. Native OpenClaw current-model selection, independent session creation/send/reply, system photo/file cancellation, Add→Prompts/editor and Add→Skills/back, repeated sheet open/close, and light/dark visuals passed. Creation additionally no longer waits on roster refresh, suppresses duplicate requests, surfaces errors, and replaces raw keys with “New session.” Hermes Flash→Pro→Flash, two replies, persistence after cold start, and a nine-minute Preview liveness window with zero prunes passed. Detailed evidence, exact deployment boundary, and device-only limits: `15-chat-owner-acceptance.md`. This closes the reported owner chat iteration; it does not assert that every screen or long-duration real-device network scenario has been accepted.

### Roster state and feature review — delivered, 2026-09-06

Replaced avatar perimeter rotation with a shared stationary activity badge; roster unread is canonical-main-only and uses an honest dot, with persistent focused-history acknowledgement. Replaced the composer model icon and reduced its leading inset by 4 points. Clarified voice-language/reply-alert labels in six locales. Native Lucy/Operator independent unread clearing, cold-launch persistence, a later real Lucy update, real working state, light/dark avatar variants, composer, and settings were inspected; evidence and limitations are in `15-chat-owner-acceptance.md` and `evidence/roster-state-acceptance/`.

Required gate passed 229 Mobile suites / 2,115 tests plus workspace checks; subsequent gallery changes passed TypeScript, 26 focused tests, UI-style and i18n checks. Latest signed Simulator Release installed. No backend/transport deployment changes. Correct Clawket PostHog project 337268 yielded 30-day Skills and voice usage; Prompt usage is unknown because it is uninstrumented. Recommendations and exact counts are documented; no saved prompts were deleted. Reply alerts are local completion notifications, not durable remote push; simulator notification permission was declined during inspection, so notification delivery is not certified.

### Composer refinement — delivered iteration, 2026-09-06

Owner-authorized composer recipe upgrade: third-visual-line expansion, five-line compact cap, one native input across full-screen editing, shared 40-point action geometry / 44-point targets, integrated attachment tray, attachment-only send, and six-locale editor controls. Native acceptance caught and corrected Fabric height measurement, mode-change focus loss, expanded flex residue, and existing draft text retaining black ink after dark-mode changes. Pending drafts flush on scope departure; clear cancels stale saves; foreground recovery preserves editing focus. The timeline follows keyboard resizing only when already following the bottom.

Final `check:required` passed (229 Mobile suites / 2,121 tests, 150 UI sources, workspace/design/i18n/docs gates). Signed iPhone 17 Simulator Release built and installed. Actual Chinese wrapping, four-line expansion/collapse with keyboard retained, seven-line full-screen editing, Pinyin candidates surviving expansion, light/dark visuals, and independent Lucy send/reply plus cold re-entry were inspected. Evidence and keyboard recording: `evidence/composer-upgrade/`; implementation and limits: `16-composer-upgrade.md`. Testing text was cleared, original keyboard language and light appearance restored. Android arm64 Debug native build and Android bundle export passed; no Android emulator exists on this host, so Android keyboard motion remains device acceptance. The saved Hermes QA Preview health timeout prevented a fresh live Hermes send; no transport changes or full three-backend certification are claimed in this UI iteration.


### Tool details and continued global regression — implementation complete, native acceptance pending, 2026-09-06

Reworked tool-detail hierarchy, readable identity, single-line duration, section copy feedback, bounded JSON/output rendering, and optional execution metadata using the canonical Sheet language. Signed Simulator Release built and installed. Native Hermes send/reply and profile inspection preceded a reproducible Skills ImportError: fixed current/legacy helper compatibility inside Clawket and verified 58 live skills. Converted the shared Hermes Python runner to bounded cancellable asynchronous execution, preserving serialized configuration changes and responsive health. Concurrent live local Bridge probe: model catalog 978 ms, skills 144 ms, health 2 ms. Existing Relay runtimes automatically reattached after restarting only the Clawket-owned local Bridge; no Production deploy.

Required gate passed 230 Mobile suites / 2,126 tests plus workspace checks; v1 compatibility passed 35 tests. Final runtime typecheck, 164 self-contained tests, and all 200 Runtime tests including installed-Hermes integration passed; final Bridge build passed and existing Relay clients reattached after restart. Mac locked during the page walk; automatic unlock failed and owner unlock was requested. Full current-build OpenClaw/Hermes/YouMind lifecycle and every-page visual certification remain open. Exact changes, evidence and limits: `17-tool-details-and-global-regression.md`.


### Continued native regression — 2026-09-06, second lock checkpoint

Resumed Simulator QA and installed the latest signed Release. Native tool details passed light/dark, copy and metadata inspection. Fixed orphaned historical tool running states without inventing success/output, removed duplicate/internal skill-detail rows, and made Continue chat reuse the prior matching Thread. Hermes skills now shows 58 entries; latest-build skill detail and navigation return were visually verified. Required gate passed 230 Mobile suites / 2,128 tests; final navigation change passed TypeScript and two focused tests; signed build/install and docs gate passed.

Real OpenClaw independent-session reply and manual reconnect passed. Hermes recovered automatically after restoring its exited isolated QA Preview process; live replies, pause/resume, background recovery and latest-build cold-start history passed. YouMind reply, manual reconnect and retained history passed. No Production deploy or pairing change. Screenshots and precise scope: `17-tool-details-and-global-regression.md`. Mac locked again around 17:30; remaining all-page visuals, long tool payload native review and prolonged/device connection scenarios remain open. Do not count the second tool-request reply as tool-execution evidence: no tool row appeared.


### Third native walkthrough — 2026-09-06

Confirmed OpenClaw reconnect retained the independent conversation and replies. Inspected management, file/cron, global appearance and help surfaces. Fixed missing execution timestamps, cramped schedule/timezone layout, centered long execution text and raw millisecond duration; localized standard tool profile/group labels with searchable translated groups. Required gate passed 230 Mobile suites / 2,129 tests, 151 UI sources and 6,510 translations; signed Release installed and schedule/run layouts visually checked. Additional focused 22 suites / 133 tests and TypeScript pass. Native CUA dragging also misbehaved in an ordinary list, so no App gesture regression is inferred and the experimental gesture override was reverted without installation. Exact page evidence and remaining limits: `17-tool-details-and-global-regression.md`.


### Usage and diagnostics failures found during native acceptance — 2026-09-06

Fixed ownerless OpenClaw usage/cost requests, token totals overwritten by billing totals, literal management translation keys, and current doctor findings discarded by a legacy checks-only parser. Hermes keeps its original single-Agent wire query. Native Lucy and Operator usage now load distinct counts; diagnostic causes and repair hints are visible. Installed latest signed Release. Built Bridge and passed 35 compatibility cases before updating the existing local service launcher to this checkout; both service environments retained pairing and reconnected. No cloud deploy/publication or external Agent source changes.

Final required gate passes 230 Mobile suites / 2,133 tests; Runtime 166 self-contained tests, compatibility 35 tests. Evidence and precise native limitations remain in `17-tool-details-and-global-regression.md`.

### Final native reply checkpoint — 2026-09-06

Latest installed Release retained Hermes and YouMind histories and received fresh replies from both after the local Bridge update. Hermes usage also loads successfully. Saved final YouMind reply and Hermes usage screenshots; OpenClaw post-reconnect history and owner-scoped usage had already passed in this walkthrough. Documentation and diff checks pass. Real-device weak-network/long-idle behavior, Android keyboard motion, reliable native drag inspection and remaining per-page visual ledger are still unverified; do not label this full global acceptance. See document 17 for exact evidence.


### Hermes timeout reported by owner — 2026-09-06 18:45

Reopened connection stability investigation after owner immediately saw `first_health_timeout`. Earlier replies certify only their request windows. Local health continued while cloud traffic was absent before Relay 1006 recovery; added independent matched cloud ping/pong detection, cleanup and stale-frame isolation inside Hermes Relay. Original network cause remains unproven; real idle/re-entry acceptance is ongoing. Exact findings and limits: document 17.


Hermes timeout follow-up: updated local Bridge and existing QA Preview runtime; final required gate passed (230 Mobile suites / 2,133 tests; Runtime 169 tests), 35 compatibility cases and Bridge build passed. Native three-minute no-client idle produced 12 cloud pongs; foreground re-entry completed fresh health/history and a new “Idle reconnect confirmed.” reply without a timeout banner. Saved screenshot/timing evidence in document 17. This verifies the bounded scenario, not the original network root cause or long-idle stability.


### Companion A brand rollout — 2026-09-06

Owner approved A (asymmetric ears, capsule eyes, no cheek mark). Implemented shared vector/runtime identity, real-state first-load UI, foreground/reduced-motion lifecycle, cached-chat preservation and generated native launcher/splash variants. Welcome and roster use the shared character. Required gate passed (231 Mobile suites / 2,135 tests); iOS Release and Android arm64 Debug builds passed. Final iOS build installed with data preserved; launcher, light/dark loading, offline pose and fresh-install welcome visually inspected. Three backend chat-entry/history checks passed. Physical-device motion, Android visuals and long-idle stability remain outside this bounded acceptance. Evidence and native preview entry: document 18.

### Header avatar corner refinement — 2026-09-06

Owner requested resolving the avatar/capsule corner conflict. Shared header-avatar variant now uses a circular silhouette; capsule layout remains unchanged. Signed iOS Release installed and Lucy header screenshot inspected (`/tmp/clawket-header-radius.png`). Required gate passed: 231 Mobile suites / 2,135 tests. No connection logic changed.

### Circular Agent identity — 2026-09-06

Owner approved circular Agent avatars across surfaces. Shared roster/header/settings/sheet variants, message image avatars and profile loading placeholders now use the circular silhouette; platform marks and unrelated controls retain their shapes. Signed iOS Release installed with existing data preserved. Roster and Profile screenshots inspected (`/tmp/clawket-avatar-roster.png`, `/tmp/clawket-avatar-profile.png`). Required gate passed, including 231 Mobile suites / 2,135 tests. No transport or chat lifecycle changes.

### Session entry icon — 2026-09-06

Replaced the shared Thread History icon with MessagesSquare to represent conversation selection. Button dimensions, capability gates and action are unchanged. Signed iOS Release installed; Lucy header visually inspected and Session Panel opened successfully. Codex route hit the existing membership gate, so its individual native screen was not inspected. Required gate passed (231 Mobile suites / 2,140 tests).

### Timeline return-to-bottom — 2026-09-06

Implemented the owner-requested bottom-right return action in the shared chronological Thread timeline. A 44-point ArrowDown floating surface clears the composer, uses shared light/dark chrome and press feedback, and fades/translates over 200 ms (translation and animated scrolling disabled for reduced motion). Reveal beyond 88 points and dismiss within 16 points to avoid edge flicker. Hidden controls are excluded from touches/accessibility. Drag/momentum and content/viewport measurements keep visibility current, including expanded tool groups. Native return scrolling suppresses competing streaming/layout snaps until completion, then aligns with any appended content; a new drag interrupts it. Session changes reset viewport intent. Tool expansion continues to suspend following. Six locales and the Mobile instruction/design guide are synchronized; no backend/transport changes.

Validation: ThreadView 29 tests pass, including five new cases for light/dark hysteresis, momentum completion, interruption/session reset, streaming/layout suppression and reduced motion, plus expanded-content regression coverage. TypeScript and design-system checks pass. Final `npm run check:required` passed on the content-height refinement: 231 Mobile suites / 2,140 tests plus all workspace, design, i18n and documentation gates. Signed iPhone 17 Simulator Release rebuilt and installed with existing data preserved. Native light/dark overlay visuals, expansion preserving reading position, button click reaching the newest message, and dismissal at the bottom passed. Automated CUA drag/wheel attempts did not move the native list; no continuous-gesture smoothness certification is claimed. External Simulator activity interrupted keyboard acceptance; keyboard-in-view and Android/device gesture acceptance remain unverified. The test switched Simulator appearance to dark; external activity prevented restoring it without taking over the active UI. No test messages were sent.

### Session panel height — 2026-09-06

Owner requested 96% default height; changed the Session Panel fixed snap point from 85% to 96%, retaining the shared top safe-area inset. Signed iOS Release installed and expanded panel screenshot inspected (`/tmp/clawket-session-height-96.png`). Required gate passed (231 Mobile suites / 2,140 tests).

Session panel height follow-up: owner selected 92% instead of 96%. Updated fixed snap point; signed iOS Release installed and native panel inspected. Required gate passed (231 Mobile suites / 2,140 tests).

Session panel height final adjustment: owner selected 93%. Updated fixed snap point; signed iOS Release installed and panel visually inspected. Required gate passed (231 Mobile suites / 2,140 tests).

### Final-turn stale tool activity fix — 2026-09-06

Fixed history reconciliation ignoring explicit inactive run metadata on the latest user turn. Missing tool results become unknown; active/unspecified runs and true success/error results remain intact. Focused history tests: 39 passed, with six new OpenClaw/Hermes cases. Required gate passed (231 Mobile suites / 2,146 tests); compatibility replay 35 passed. Signed iOS Release installed with data preserved. Exact owner-reported five-call group and children verified as no longer running, with final reply retained; screenshot `/tmp/clawket-tools-settled.png`. OpenClaw external source/store remained read-only.


### App language preference — 2026-09-07

Owner requested a missing App language control. Account Settings now exposes a direct App language row and the shared preference sheet with system, English, Simplified Chinese, Japanese, Korean, German and Spanish choices. Autonyms remain recognizable in any selected UI locale. The choice persists separately from speech recognition and updates i18next without remounting navigation or connections; system mode re-resolves on foreground. Save failures remain visible in the sheet. Root memoized settings labels also refresh with locale changes. This is an owner-authorized addition to the settings specification, with no backend/transport change.

Focused validation passed 3 suites / 14 tests for the entry, picker, independent voice preference, save failures, restored preference, system foreground updates and locale fallback. Mobile TypeScript, UI source/token scan, six-locale catalog and docs checks passed. Full required gate, full Mobile tests and fixture-writing selftests were blocked by host disk ENOSPC (required gate retried twice). Native build/installation and visual/device acceptance were not performed for this language change.


### YouMind sign-in and conversation theme review — 2026-09-07

Owner requested a substantial login upgrade and diagnosis of unreadable soft bubbles. Replaced the nested gray login card with a canvas form and one keyboard-aware scrolling region. Added six visual OTP cells backed by one native composition-safe field, paste/autofill metadata, automatic verification using the completed value, synchronous request guards, manual retry, and deadline-based resend cooldown. Kept six-locale copy and inline errors. Reference YouMind Mobile remained read-only; no hero artwork copied.

Diagnosed lost alpha in soft/glass: 10%/16% accent tint was overwritten with material opacity. Shared resolver now composites a stable tint backing before opacity, including opaque solid surfaces on wallpaper. Current defaults remain system/iceBlue/solid; saved appearance preferences need no reset. Body contrast regression covers 648 combinations. No backend/transport/credential changes.

Native signed Release built and installed with existing simulator data intact. A separate empty `Clawket Auth QA` simulator was used because adding a connection on the original hits Pro gating. Inspected the new email page, caught and fixed missing translated guidance. CUA subsequently returned `noWindowsAvailable`; keyboard, OTP-page visuals and real delivery/autofill remain unverified. Final recovered required gate passed: 233 Mobile suites / 2,159 tests plus workspace checks. The final numeric-input normalization refinement passed TypeScript and 5 focused suites / 32 tests. The fresh QA simulator was deleted after disk exhaustion; original simulator data remained intact. Final incremental native build hit another task’s shared Xcode database lock; it was not interrupted, and final translation/input refinements are not claimed as newly installed. Findings and further unification priorities: `19-auth-and-theme-review.md`.

### Roster primary add action — 2026-09-07

Owner-authorized placement deviation from the top-right add entry: a persistent 64-point bottom-right ink circle, 32-point plus, shared light/dark chrome and reduced-motion-aware press feedback. Safe-area spacing and list clearance preserve access to the last Agent. Existing add menu and subscription gates are unchanged. Required gate passed (233 Mobile suites / 2,159 tests plus workspace/design/i18n/docs checks); focused Roster suite passed 10 tests including light/dark placement, clearance and existing gated actions. Simulator UI access timed out twice; native visual acceptance is not claimed. Signed iOS Simulator Release build passed and installed with existing data preserved. Native visual acceptance remains unverified because Simulator UI access timed out.

### Physical-device Preview pairing latency investigation — 2026-09-07

Owner enabled Debug Mode and successfully paired, reporting 30–60s delay. Bridge logs confirm 46.621s from first client demand (00:59:53.518 JST) to recovered authentication (01:00:40.139). Initial bootstrap authentication succeeded at 00:59:58.117 in 34ms, then the client disconnected. Replacement Gateway sockets opened at 01:00:00.291 and 01:00:16.523 but received no connect request; OpenClaw logs independently report handshake timeouts at 01:00:15.293 and 01:00:31.524. Preview Relay heartbeat timed out at 01:00:38.187; full reconnect led to device-token authentication in 24ms. sessions.list and chat.history each took 71ms afterwards; models.list 1480ms. Production also had a nearby Relay heartbeat timeout. This locates the delay in post-pair transport/handshake recovery, but does not establish whether the initiating cause was App lifecycle, stale Relay routing or network loss. Phone retained console had no handshake timing evidence. No service deployment or connection mutation performed. Evidence: `/tmp/clawket-slow-pair-logs.json`, OpenClaw `/tmp/openclaw/openclaw-2026-09-07.log`.

### Model manufacturer artwork — 2026-09-07

Owner requested replacing the composer Layers2 icon with locally bundled manufacturer artwork from YouMind Mobile. Added shared ModelIcon for the composer and picker rows with nine unchanged assets (23,384 bytes): OpenAI, Anthropic, Google, DeepSeek, Qwen, xAI, Moonshot, MiniMax and Zhipu. Recognizable model families take priority over routing providers, including nested OpenRouter and Bedrock identifiers. Exact provider aliases or unambiguous namespace/display-name evidence handle opaque deployments; aggregators, arbitrary aliases, ambiguous evidence and unavailable brands use theme-aware Orbit. Original artwork backing/colors remain intact in light/dark. This is an owner-authorized brand-artwork exception to the previous fixed Lucide recipe. Provenance and durable Mobile rules are updated.

Validation: required gate passed, including 234 Mobile suites / 2,194 tests, workspace typechecks/tests, design-system, i18n and docs checks. New cases cover mapping/fallback boundaries, conflicting weak evidence, asset updates on selection, light/dark rendering and capability gating. All nine assets verified byte-for-byte against the read-only YouMind source. No backend, transport or selection-scope behavior changed; existing OpenClaw session and Hermes global selection tests pass. Native build/install and simulator visual acceptance were not performed for this change.

### Model picker sizing refinement — 2026-09-07

Owner requested slightly larger model icons, a taller initial sheet and tighter model spacing. Shared manufacturer/fallback icons now use 24 points (previously 20); the sheet starts at 68% (previously 58%) and still expands to 92%. Model rows use 44-point minimum targets (previously 52), with vertical padding reduced from 12 to 8 points and a matching 24-point icon slot. Large text can still grow rows. Updated the durable design recipe and narrow compact-row instruction exception. Selection, capabilities and backend behavior are unchanged. Required gate passed, including 234 Mobile suites / 2,194 tests and workspace, design-system, i18n and documentation checks. Native visual acceptance has not been performed for this refinement.

### Chat timeline time grouping — 2026-09-07

Owner requested YouMind-style time markers. Replaced daily-only Thread separators with the read-only YouMind Mobile reference's three-minute adjacent-item inactivity rule, plus local-day boundaries. The first valid timed item gets a marker; continuous conversation does not add periodic markers, and system/invalid timestamps do not reset the interval. Timed tool and run rows participate in the shared timeline; source order, tool expansion and message-based keys remain stable. Removed the calendar icon in favor of centered caption text with a canvas backing for wallpaper readability. Localized labels use 24-hour time today, yesterday, recent weekdays, month/day and years for older history; future dates remain explicit. Calendar arithmetic avoids DST elapsed-day errors; the mounted Thread refreshes date labels across midnight and language changes. No backend/transport changes.

Validation: focused Thread/model/time tests passed 3 suites / 62 tests, including six locales, light/dark, midnight refresh, exact interval boundaries, invalid timestamps, stable keys, pagination and tool expansion. Mobile TypeScript passed. Full `npm run check:required` passed, including 235 Mobile suites / 2,215 tests and all workspace, design-system, i18n and documentation gates. Native build/install and visual/device acceptance were not performed for this change.

### Native chat timestamp crash correction — 2026-09-07

Owner's device screenshot identified a render crash at `new Intl.RelativeTimeFormat` when formatting yesterday. The earlier Node-based gate did not establish native Intl availability. Removed that constructor and cache entirely; Thread supplies the existing common-namespace `Yesterday` translation to the pure timeline formatter. A caller without a translated label gets an explicit calendar date. Added six-locale regression coverage with `Intl.RelativeTimeFormat` explicitly undefined, exercising both formatting and timeline construction. Existing rendered midnight/language-switch coverage now uses the actual translation catalogs. No native dependency or transport changes.

Focused validation passed 3 suites / 63 tests. Full `npm run check:required` passed, including 235 Mobile suites / 2,216 tests plus workspace, design, i18n and documentation gates. The fix has not been verified on the owner's physical device.

### Preview pairing recovery and connection diagnostics — 2026-09-07

Implemented fresh-challenge reauthentication in Mobile (duplicates ignored, pending old requests rejected, deadlines retained); bounded stage telemetry uses the existing analytics whitelist and never blocks authentication. Bridge now recycles the Relay owner after eight seconds without a connect following a forwarded challenge; bootstrap issuance suspends the timer, request/disposal cancel it, and obsolete socket events are ignored. Demand timing resets when the last client leaves. Relay logs use per-socket server-generated diagnostic UUIDs, preserved in attachments, with malformed markers rejected and raw identity/credential redaction retained. Triage runbook: `20-connection-diagnostics.md`.

Required gate passed (235 Mobile suites / 2,215 tests plus all workspace/design/docs checks); legacy compatibility passed 35 tests. Additional slow-bootstrap watchdog regression passed in the 55-test Bridge suite. Loopback real-WebSocket lost-challenge injection recovered in 8.059 seconds without repeated local Gateway retries. Preview Relay deployed version `abc624c5-df9e-4963-92a5-1170c376b8ca`; Production/Hermes cloud deployments untouched. Managed local service switched from global package to the rebuilt repository CLI with pairing state intact. Existing Preview client reauthenticated in approximately 366 ms from Bridge demand (15 ms authentication).

Real Preview isolated-room tests against installed OpenClaw completed bootstrap / operator handoff / reconnect: 4,238 / 1,046 / 816 ms; repeated under native build load: 7,388 / 1,412 / 1,242 ms. These are desktop socket measurements, not physical-phone scan-to-ready times. Cloudflare live tail verified matching diagnostic UUID across socket-open, challenge delivery, connect forwarding, response delivery and socket-close. Evidence files: `/tmp/clawket-preview-isolated-latency-qa.log`, `/tmp/clawket-preview-isolated-latency-repeat.log`, `/tmp/clawket-pair-latency-cloud-tail.jsonl`. Test runtimes were stopped; QA credentials are confined to a mode-600 temporary file.

Residual investigation: an additional test client joining the owner's already-active room received no challenge before a 20-second test timeout. Isolated-room tests deliberately avoid that competing-client case; this turn does not certify multi-device concurrent challenge allocation. The initial isolated QA script also used an incorrectly capitalized device family in its signature; corrected to Mobile's `iphone` before the successful measurements. Do not attribute that script rejection to the App. Native build and final gate status to follow below.

### Chat timeline spacing refinement — 2026-09-07

Owner requested moderately more breathing room. Shared user/assistant message rows now use 8-point vertical padding instead of 4, giving adjacent messages a 16-point gap. Time markers after existing content use 24-point top padding instead of 12 while keeping 12 below; the first marker retains 12 above. Tool/system activity, bubble interiors and attachment spacing remain compact. Shared tokens and durable Mobile spacing rules are synchronized. No timestamp grouping, backend or transport behavior changed.

Validation: `npm run check:required` passed, including Mobile tests and workspace typechecks/tests, design-system, i18n and documentation checks. Native visual/device acceptance was not performed for this spacing refinement.

Final verification: required gate passed again (235 Mobile suites / 2,216 tests and all workspace/design/documentation checks). Final Bridge build succeeded and managed service restarted to load the measured-duration watchdog log refinement. Signed iOS Simulator Release build succeeded and installed on the existing iPhone 17 simulator with data preserved. No physical-phone package install or phone scan-to-ready measurement is claimed. CLI status confirms managed OpenClaw service running and Hermes bridge reachable/relay runtime running. Cloud tail was stopped after verifying correlated events. No Production or Hermes cloud deployment was performed.

### Chat spacing second adjustment — 2026-09-07

Owner requested one more small increase. User/assistant rows now use 12-point top and 8-point bottom padding, increasing adjacent-message gaps from 16 to 20 points. Noninitial time separators add a 4-point top margin to the existing 24-point top padding (28 points total); first-marker and bottom spacing remain unchanged. Uses existing spacing tokens. Required gate passed (235 Mobile suites / 2,216 tests plus workspace, design, i18n and docs checks); native visual acceptance not performed for this refinement.

### Chat spacing third adjustment — 2026-09-07

Owner requested a more visibly relaxed layout. User/assistant rows now use 16-point top and 12-point bottom padding (28-point adjacent-message gap, previously 20). Noninitial time markers use 32-point top padding and 8-point top margin (40 total, previously 28). Initial-marker, tool/system and bubble-internal spacing remain unchanged. Existing tokens and Mobile spacing documentation are synchronized. Required gate passed (235 Mobile suites / 2,216 tests plus workspace, design, i18n and docs checks); native visual acceptance not performed for this refinement.

### Composer model icon size correction — 2026-09-07

Owner clarified that only picker-sheet artwork should be enlarged. Added the shared ModelIcon compact variant and applied it to the composer: manufacturer artwork and Orbit fallback return to 20 points. Picker artwork stays 24 points; its 68% initial height and compact row spacing remain intact. Updated the durable Mobile recipe. Workspace typechecks and all 235 Mobile suites / 2,216 tests passed; design-system, i18n, documentation and diff checks passed. Required gate is blocked by the unrelated Bridge runtime test `negotiates independent client runtimes and retires only the disconnected channel` (expected closeCalls 1, received 0); a repeat runtime run reproduced it. No Bridge code was changed for this UI correction. Native visual acceptance was not performed.

### 2026-09-07 — Timed simulator connection regression and fixes

- Reproduced Lucy timeout at roughly 17 s with another client already authenticated. Implemented negotiated `bridge.client-sockets.v1`: independent raw-frame Relay channels/local Gateway runtimes per full-client socket incarnation, attachment-based routing after hibernation, owner authentication, bounded lifecycle cleanup, and unchanged legacy/Hermes policies. Preview Relay final version `1a63c35f-8791-43ab-9d15-f36be5070c1c`; managed local CLI rebuilt/restarted. No Production or Hermes cloud deployment.
- Real shared Preview room: simulator remained connected while a second QA client completed bootstrap (5.121 s), operator handoff (1.225 s), and reconnect (1.271 s). Three simulator OpenClaw reconnects reached visible Online in 2.845/3.685/3.894 s; final installed package 3.480 s. UI measurements include automation/AX observation overhead. Initial loading observation was an upper bound and is not reported as exact handshake latency. Background return retained usable state, and Lucy user/reply history survived navigation, reconnect and installation.
- Hermes first exposed a dead temporary QA Bridge, then a more serious mobile lifecycle bug: disposal rejected an in-flight health probe whose catch reconnected the retired adapter, causing `client_socket_replaced` every 1–2 s. Guard probe settlement by epoch, handshake generation, transport identity and disposal state. Both backends covered. Earlier short Online observations are not stability acceptance.
- Installed signed simulator Release with the fix. Hermes explicit resume 2.356 s; subsequent reconnects 1.922/2.549/2.046 s, including after background return. Actual send/reply succeeded (`Hermes OK`), history retained, and cloud tail showed zero replacement-loop events after 17:12 UTC through the final observation. Supervised the isolated Hermes QA runtime with `com.clawket.qa.hermes-preview`; config/script/logs are under `~/.clawket/qa/`, separate from managed Production state.
- Also corrected paused chat entry: show Connection paused + Resume instead of indefinite connecting; native screenshot inspected and Resume restored Lucy history successfully.
- Validation: required gate passed (235 mobile suites / 2220 tests plus workspace gates); targeted paused Thread tests 30 passed after the final UI adjustment; Relay 121 tests; protocol client 118 tests; compatibility replay 36 passed including a real Wrangler two-client channel/reconnect test; signed Release builds installed. Logs: `/tmp/channel-probe-final-required.log`, `/tmp/channel-preview-final-deploy.log`, `/tmp/probe-final-tests.log`, `/tmp/paused-thread-tests.log`, `/tmp/channel-final-ios-build.log`. Diagnostics runbook: `20-connection-diagnostics.md`.
- Separate observed latency: Lucy's GPT-6 astra reply took about 244 s after the request entered the local Agent (16:58:56→17:03:00 UTC); OpenClaw recorded one attempt, no timeout/retry/failover. Connection recovery is verified; this model/backend response latency is not claimed resolved and should not be described as a fast end-to-end chat pass. Hermes reply was normal. No model configuration or external Agent source was changed.

### 2026-09-07 — Quiet foreground connection recovery

- Replaced premature probe-failure presentation with a coordinator-owned 20-second foreground recovery window, shared by OpenClaw and Hermes. Adapter retry transitions do not extend the deadline; background suspension does not consume it. Healthy handshake/probe evidence clears recovery; pause, disposal and scope switches cancel it. Transient errors stay internal during recovery, while explicit pairing/authentication action remains distinguishable. Transport readiness remains authoritative.
- Thread shows localized “Reconnecting…” in the existing header subtitle and preserves the mounted timeline, draft and input; Send waits for readiness. Roster uses the shared neutral status. Sustained failure exposes the existing error/retry UI. No offline message queue or automatic resend was introduced.
- Signed iOS Simulator Release installed and visually inspected: Hermes background return while its isolated QA service was stopped retained history, draft and focus without a red banner; restoring the service cleared the subtitle and enabled Send. A longer Hermes outage showed only recovery at 14 s and real error/retry at the later 31 s observation; recovery cleared the error automatically, and an actual send returned “Recovery UX verified.”
- OpenClaw live Bridge interruption and a separate background-return interruption retained visible history, draft and software keyboard; the composer stayed above the keyboard, and service recovery enabled Send without replacing chat with loading. Roster recovery status was also screenshot-reviewed. All temporarily stopped Clawket-owned services were restored. Native checks used dark mode; light/dark recovery rendering is covered by tests. Simulator Lock/Sleep actions did not provide reliable locked-device evidence; prolonged real-device suspension and Android remain device acceptance, not claimed tested.
- Validation: required gate passed (236 Mobile suites / 2,230 tests plus workspace, design, six-locale and docs gates), compatibility replay 36 passed, signed Release build succeeded. Evidence logs: `/tmp/recovery-required.log`, `/tmp/recovery-compat.log`, `/tmp/recovery-ios-build.log`; CUA screenshots reviewed in-task. No cloud deployment or external Agent source changes.


### Claude login recovery and actionable reply errors — 2026-09-11

Local OpenClaw logs match the phone's 16:03/16:04 JST failures (logs are +08:00): claude-cli/claude-opus-5 rejected the main-session turn after OAuth refresh failed. This was a model-authentication failure after the Preview transport was connected, not evidence of a Relay connection failure. After the owner completed Claude login, synchronized authentication with `openclaw models auth login --agent main --provider anthropic --method cli`. Kept the existing model and profiles. A real Gateway main-session turn returned `Login recovery verified.` in 9,938 ms using claude-cli/claude-opus-5; no external channel delivery was requested. No pairing refresh or cloud deployment.

Mobile previously retained the backend error through protocol/adapter processing but replaced it with generic text in the chat controller. It now classifies authentication, quota and rate-limit failures and exposes bounded, credential-redacted backend details in shared ReplyFailureSheet, with selectable/copyable diagnostics and six-locale summaries. Unknown failures preserve details too; neither connection recovery nor message replay is triggered by these model failures. Added a synthetic gallery example without invalidating real credentials. Incident triage is recorded in `20-connection-diagnostics.md`.

Validation: focused controller, Thread, diagnostic and adapter suites passed 98 tests; workspace typechecks passed. Design-system, six-locale catalogs, docs and 36 compatibility replay tests passed. The full required gate stopped at one unrelated existing theme-token expectation: `theme.test.ts` omits `companionCuriosity` from its expected Motion object (237 suites passed, one failed; 2,243 tests passed, one failed). This is not a green full gate. Native rebuild was discontinued following the owner's testing preference; no new simulator installation or visual acceptance is claimed.

Owner workflow update: physical-device visual acceptance belongs to the owner by default. Do not operate/connect the simulator for visual QA unless explicitly requested. This supersedes earlier blanket screenshot requirements; automated checks and log investigation continue. Persisted in Mobile AGENTS and the design-system document. Multiple independent OpenClaw clients are supported by the negotiated channel design, but current deployment/credential behavior must be verified before promising concurrent device use. Never refresh shared pairing solely for QA. JS Fast Refresh availability depends on the phone's development-server connection; standalone/native updates are not automatically delivered.

### 2026-09-11 — Session panel simplification

Owner approved removing the All / Needs you / Working quick-filter row. Removed its UI, transient state, filtering branches and unused visibility threshold/API. Grouped/List, search, kind filtering, and per-session activity/attention indicators remain. This supersedes the earlier conditional quick-filter recipe; fewer controls leave more room for sessions. Native visual acceptance remains with the owner per current workflow.

Validation: all 25 SessionPanel tests pass, along with repository typechecks, design-system, i18n and documentation checks. The full required gate encountered the pre-existing theme token expectation mismatch (`companionCuriosity`); the initial session-filter assertion was updated for the intentionally retained completed sessions and passed on targeted rerun.

### 2026-09-11 — Remove Session Panel creation entrypoints

Owner requested removing new-session creation to reduce confusion. Removed the Agent-header plus and empty-state creation action, along with panel creation callbacks, async state and adapter invocation. Existing session browsing, switching and management remain. Backend adapter capabilities are unchanged.

Validation: SessionPanel's 25 tests, mobile TypeScript, design-system and repository documentation checks pass. No simulator/device visual acceptance is claimed. The previously recorded unrelated theme-token full-gate failure remains outside this change.

### 2026-09-11 — Dictation feedback restored in the 3.0 composer

Owner reported that iOS dictation felt unresponsive and offered no way to stop. Comparison with 2.0 (`main`) showed the hook and native module are identical; the regression was entirely in the 3.0 `Composer`, which had no voice state, no placeholder change, no haptic, and hid the mic behind `!hasContent` so the first transcript replaced it with a disabled Send. The trailing slot now stays a stop-dictation control (`bad` surface, `onAccent` Square, busy while authorizing) for the whole lifetime, backed by a microphone-level halo driven through a Reanimated shared value instead of 20 Hz React state, with "Preparing voice input…"/"Listening…" placeholders in six locales, a locked draft during dictation, and light-impact haptics on both taps. No idle loop; reduced motion keeps a static rim. Hook, ThreadView, ThreadScreen and copy contracts carry `voiceState`/`voiceLevel`; the rule lives in `apps/mobile/AGENTS.md` and `docs/design-system.md`.

Validation: mobile TypeScript, `check:ui-style` (160 files), six-locale catalog check (1,104 keys), design-system docs and repository docs checks pass. Focused suites pass for `Composer` primitives, `useChatVoiceInput`, controller contract/adapter events and `ThreadScreen`; a pre-existing `ThreadView` favorites long-press assertion fails identically with this change reverted and is unrelated. Device visual acceptance remains with the owner; no simulator run was performed.

### 2026-09-11 — Roster add sheet as a choice sheet

Owner reported the Roster “+” sheet (two bare settings-style text rows) was hard to understand and to tap, while adding a connection is the product's strongest paid entry. Replaced the rows with the Onboarding `ChoiceRow` recipe: icon tile, title, one-line description, and a trailing chevron or Pro lock. “Add Connection” now reads “Connect OpenClaw, Hermes or YouMind Sprite” and shows the lock when the free tier already holds its connection (`addConnectionLocked`, wired from the existing `canAddSettingsConnection`); “New Agent” names the active connection (“Create another agent on {connection}”) and shows the lock for non-Pro users. Tap handling, paywall routing, dismissal ordering, single-action shortcut, and backend capability gating are unchanged. `ChoiceRow` gained `locked` and a combined accessibility label; six-locale copy added in `config`.

Validation: Roster, Onboarding and primitives suites pass (55 tests, including new locked-row and unlabeled-connection cases); mobile TypeScript, UI-style (160 files), six-locale catalog, and docs checks pass. Native visual acceptance remains with the owner per current workflow.

### 2026-09-11 — Non-main sessions become a Pro preview

Owner approved the proposed full rollout of non-main session preview. Main chat remains complete. Other conversations show the latest two body messages and pending approvals, with a stable read-only window and a quiet decorative history gate. Added `sessionHistory` contextual paywall, in-place entitlement unlock, current grace support, main-chat return, source-free preview analytics, and six-language copy. Search results retain discovery but omit gated non-main message/favorite excerpts. No backend protocol, pairing, source history, quota entitlement or service deployment changed. Detailed contract: `21-session-preview-pro.md`.

Validation: 203 focused tests passed across policy, Thread, Search, contextual paywall, analytics and controller contracts; the final short-label/responsive-footer adjustment passed all 64 Thread container/view tests. Mobile typecheck, six-language i18n, design-system and documentation checks pass. The full required gate reached 240 passing mobile suites / 2,293 passing tests and the existing `theme.test.ts` Motion expectation mismatch (`companionCuriosity`), so the full gate remains red; no unrelated theme edits were made. Native visual and real RevenueCat sandbox purchase/restore acceptance were not performed. Main-chat return now pops to an existing main route (retaining its scroll position) or replaces a directly opened preview; small widths/large fonts stack the footer actions instead of truncating labels.

### 2026-09-11 — Dictation glow made visible; accent instead of red

Owner device check: the stop control worked but the level ring barely moved (as in 2.0) and the red read as an alert. Root cause is the native `min(rms × 5.5, 1)` linear level, which lands at 0.05–0.4 for ordinary speech and was mapped onto a narrow scale range. Added `services/speech/speechLevel.ts`, a pure, tested processor that converts the emitted level to decibels against an adaptive noise floor and decaying recent peak with a gate and a fast-attack/slow-release envelope, so soft and loud speakers both fill the 0–1 meter and pauses dip; the hook feeds it into the shared value and resets it per dictation. No native change, so the owner's dev build updates through Fast Refresh. The control now uses the conversation accent from `useConversationTheme` with an `onAccent` Square, and the glow is two accent discs (quick inner 1.04→1.32, lazy outer 1.08→1.5 capped at 60 points) plus a 1.05 surface breath; reduced motion keeps static rims.

Validation: 8 processor tests, Composer/ThreadView/hook regressions updated (22 suites / 282 tests across Thread, UI primitives and controller contracts), mobile TypeScript and `check:ui-style` (161 files) pass. Tuning constants were chosen from typical iPhone speech RMS, not measured on the owner's device; visual/level acceptance remains with the owner.

### 2026-09-11 — Telegram-style long-press message actions

Owner asked to replace the message-actions bottom sheet with the YouMind Mobile long-press pattern and to exceed it. Long-pressing a user or assistant message now measures the row in window coordinates, fires a light haptic, dismisses the keyboard, and opens a transparent `Modal` that dims the thread under the shared scrim while a clone of the message block (identity chrome dropped, bottom-aligned so it covers the original from the first frame) lifts above it. A capsule action bar drops below the bubble edge: one horizontal row of equal 80-point icon-over-caption cells (Copy / Favorite / Share; queued messages show Send now / Edit / Remove / Copy) on an `overlay` surface with `Radius.full`, rounded `surface` press highlights and no dividers — deliberately not YouMind's vertical list. Favorite is a toggle: the filled star carries the state, the visible label stays short, and assistive technology hears Unfavorite. `messageActionsLayout.ts` is a pure, unit-tested engine: the clone moves only as far as the menu needs, a reply taller than the remaining space is capped and scrolls internally with the pressed content kept stationary, and the menu stays inside the side margins. Improvements over the reference: no `expo-blur` dependency and no spring presets (all motion uses `Motion` durations with ease-out and honors reduced motion); the clone is visible immediately rather than after a measurement frame; a streaming reply grows the clone downward; Copy and Favorite confirm inline in their own cell (`good` Copied / Favorited / Removed) and close on their own instead of needing a second dismiss; the favorite confirmation is corrected from the recorded outcome and never claims an unrecorded favorite; Share hands off only after the close animation so the poster modal cannot race the dismissing overlay; closing re-measures the live row (guarded against FlashList row reuse and detached nodes) and returns the clone to it or fades in place; assistive technology reaches the menu through a `longpress` accessibility action. `ThreadView` owns the selection and renders the clone through the shared `ThreadMessageRowContent`; `ThreadScreen` passes stable `messageActions`, and the old `ThreadMessageActionsSheet` is deleted. Copy for Unfavorite / Favorited / Removed was added in six locales; rules live in `apps/mobile/AGENTS.md` and `docs/design-system.md`. The owner then asked for a form distinct from YouMind; the vertical list was replaced by the capsule bar in the same day, and the concurrently added queued-message actions were folded into the same cells.

Validation: new layout (9), overlay (17, including the queued-message cases) and ThreadView tests pass alongside the Thread, primitives and favorites suites; mobile TypeScript, `check:ui-style` (161 files), six-locale catalog (1,115 keys), design-system docs and repository docs checks pass. The full required gate reached 241 passing mobile suites / 2,305 tests and stopped only at the pre-existing `theme.test.ts` Motion `companionCuriosity` expectation that is failing on the current dirty tree without this change; Relay/Bridge workspaces were not touched. Device visual acceptance remains with the owner (HT-UX-2); no simulator was operated.

### 2026-09-11 — Preview cold-load blank page

Owner screenshot exposed a state/projection mismatch: cached raw messages made the thread `ready`, while the Pro preview withheld every message until network history completed. The blank list therefore suppressed the companion loader. Preview now projects same-session cached content immediately (while still waiting for entitlement resolution), and Thread state is derived from actually visible messages/cards rather than hidden raw content. Cold cache, tool-only pending history, entitlement loading and cross-session transitions retain the companion Loading state; the footer says Loading history instead of claiming latest messages are visible. Completed tool-only histories can show their history gate instead of an empty timeline. This removes an unnecessary network wait for cached previews; actual backend network latency has not been measured in this change.

Validation: 84 targeted tests pass, including both backend cache-first previews, no-cache/tool-only/entitlement/scope loading states and companion/footer rendering. Mobile typecheck, design-system and documentation checks pass. Required gate: 241 mobile suites / 2,312 tests pass; the existing theme Motion expectation mismatch is the sole failure. No simulator interaction or live network timing is claimed.

### 2026-09-11 — Paywall research and four HTML design studies

Owner requested research and 3–5 high-fidelity visual alternatives before native implementation. Reviewed the current feature-driven paywall hero, benefit assembly, social-proof metadata, annual/lifetime/monthly ordering and default-package fallback. Created `mockups/paywall-studies/index.html` with four independent directions: Lumen (silver/graphite companion), Atelier (warm paper/terracotta), Prism (ice-blue glass) and Perspective (contextual conversation cards). The companion geometry is reused from the approved brand source; artwork is original SVG/CSS with no external image dependency. A cited research page distinguishes RevenueCat/Mojo/Headspace evidence, Apple subscription requirements, brand references and Clawket-specific hypotheses. Screenshot prices remain prototype fixtures; no RevenueCat offering or product price was changed.

All studies support four entry contexts, annual/lifetime selection, monthly disclosure, accurate plan-specific billing copy, close/reopen and explicitly simulated purchase/restore actions. Social proof is omitted; annual uses “Recommended” rather than an unqualified “Best value.” Small screens keep checkout visible while the introduction scrolls. Original React Native implementation, backend services, paywall triggers and entitlements are untouched.

Validation: 32 browser scenarios (4 designs × 4 contexts × 2 sizes) passed with no JavaScript errors; selection, billing, monthly reset, close/restore, context switching, comparison, research navigation, normal animation and reduced motion checked. Captured and visually reviewed all four directions, then adjusted footer space, header centering, compact layout and conversation illustration spacing. Screenshots and browser report are in `mockups/paywall-studies/qa/`; repository docs checks pass (6 instruction pairs, 4 validator tests). These are browser prototype checks, not native device, real purchase or conversion results. Design selection remains with the owner before any native rollout.

### 2026-09-11 — Paywall billing line spacing

Owner reported the renewal/cancellation note occupying two lines on device. Removed the explicit newline in `formatBilling` and compacted Chinese annual/monthly renewal copy, preserving the 13-point caption, live store price, renewal disclosure and store-specific cancellation text. The note now flows as one sentence; narrow screens, long translations and accessibility text sizes may still wrap naturally without truncation or forced font shrinking. Paywall screen tests and six-locale catalog checks pass. Physical-device layout acceptance remains with the owner.

### 2026-09-11 — Lumen paywall native rollout and copy draft

Owner selected study A and asked to revisit 2.0 benefits. Verified the five legacy benefits directly from `main` (multiple OpenClaws; backup/diagnosis/repair; permissions; personality/memory; history search/logs). Implemented the selected silver Companion and graphite presentation in the existing native PaywallScreen with a scoped semantic theme; shared buttons and plan cards inherit it without changing application preferences. Removed social proof and omitted the English artwork caption. Generic copy is an explicit first draft (“More possibilities with your Agents” / “Take your AI world with you”), with four contextual benefits including personality/memory. Six locale catalogs updated. Context IDs, live RevenueCat pricing, package defaults, ownership locks, purchase/restore lifecycle, continuation routing and all connection paths remain unchanged. Lifetime billing now correctly states one-time purchase; annual/monthly show real renewal prices. Compact annual/lifetime cards fall back to rows for narrow widths or enlarged text. Hero motion is transform-only and pauses in background/reduced-motion/success.

Validation: 84 targeted tests pass across paywall, subscription service and animation lifecycle. Mobile typecheck, design-system checks (162 UI files) and six-language catalog checks pass. Full required gate: 242 mobile suites / 2,315 tests pass, with the sole failure still the pre-existing `theme.test.ts` Motion expectation missing `companionCuriosity`; unrelated theme work was preserved. This rollout is JavaScript/SVG only: no native dependency, backend/service deployment or actual purchase was performed. Native appearance and final copy remain for owner device review under the current no-simulator workflow.

### 2026-09-11 — Seamless silver Companion and curiosity motion

Owner identified a dark sliver/highlight crack below the left ear and requested more personality in the paywall hero. Replaced independently shaded body parts with one opaque silhouette mask over a single silver gradient, and removed the detached ear-root highlight. Ear roots overlap the face inside the mask, including during motion. Extracted the existing welcome choreography unchanged into `src/brand/companion-motion.ts`; welcome retains its public exports and behavior. The Lumen cat reuses all seven curiosity tracks with reduced head/ear rotation: sideways/upward glances, occasional widened eyes, alternating ear flicks, three blink moments including a double blink per 9.6-second loop. Only the head floats; the native orbit/halo remain steady. All eight native tracks reset/cancel on background, reduced motion, success and unmount. Updated the HTML A artwork with the same continuous material and matching curiosity sequence for review; browser-hidden previews pause their CSS animations.

Validation: 39 focused tests pass across welcome animation, paywall lifecycle and screen/model behavior, including concurrent mask identity/material coverage and success-time cancellation. Typechecks, design-system and docs checks pass. Reviewed the browser artwork screenshots with open/closing eyes and glancing/tilted head; no detached crack remains and browser console reports no warnings/errors. Browser evidence is not native rendering acceptance; native motion/appearance remains for owner device review. Required gate: 242 mobile suites / 2,316 tests pass; only the previously recorded theme `Motion.companionCuriosity` expectation fails. No simulator, new native dependency, connection change, purchase or deployment was involved.

### 2026-09-11 — Paywall benefit icon and Agent wording

Owner requested a non-robot icon for “More Agents, unlimited connections” and broader wording for the management benefit. Replaced its sparkle with the shared Lucide Infinity icon, keeping the existing icon size/color/stroke recipe. Renamed the management benefit to “Configure, back up and diagnose your Agents” / “配置、备份与诊断你的 Agent” across the six catalogs and typed paywall copy model. This is presentation wording only; backend capability gates and entitlement behavior are unchanged.

Validation: all 30 paywall screen/model tests, mobile typecheck and six-locale catalog checks pass; native visual acceptance remains with the owner.

### 2026-09-11 — Paywall billing breathing room

Owner requested a little more separation under the primary purchase button. Added `Space.xs` top margin to the billing caption, increasing its gap from 4 to 8 points without changing other footer spacing. UI-style validation and diff whitespace checks pass; device visual review remains with the owner.

### 2026-09-11 — Queued messages while the Agent is replying

Owner asked for a “queued message” capability shared by OpenClaw, Hermes and YouMind Sprite. Investigation: the OpenClaw Gateway (2026.9.1) accepts `chat.send` mid-run and resolves it through its queue mode (`steer` by default), but the Clawket-owned Hermes bridge and the YouMind adapter do not serialize a second prompt per session (Hermes would start a concurrent `/v1/runs`; YouMind throws). Decision (implementation detail, recorded): one App-side outbox in the shared chat runtime for all three backends, no backend branch and no wire-contract change. A message sent while `isSending` joins a per-connection/session queue (`src/chat/messageQueue.ts`, module store so leaving and re-entering a Thread keeps composed messages and attachments); the head is delivered through the existing send preflight only when the session is idle again, history is loaded and the post-reply history refresh has settled, so a queued send never races the reply refresh. The queued bubble keeps its optimistic `usr_` id and settles in place once history adopts it. Stop, a reply failure, a failed send or a failed delivery preflight put the queue on hold (“Paused”); sending anything new, promoting an item (“Send now”) or enqueueing resumes it. Queue capacity is 10; the composer Send is disabled at capacity. Composer: during a run with a draft, Stop becomes a secondary circle and the primary Send (“Send after this reply”) appears beside it; without a draft Stop stays primary. Timeline: queued bubbles render at 72% opacity below everything else with a Clock/Pause caption (Queued / Sending… / Paused); a plain tap or long-press lifts the Telegram-style menu with Send now (paused + idle only), Edit (returns text and attachments to the composer), Remove and Copy; edit/remove lock while a delivery preflight is in flight. Connection removal drops that connection’s queues. Analytics: `chat_message_queued`, `chat_queued_message_delivered`, `chat_queued_message_edited/removed`, `chat_queue_held` (spec `07-analytics.md` updated; no message text). Six locale catalogs updated. OpenClaw steering (“inject into the active run”) is intentionally not exposed; it remains a possible later `queueMode` option, and delivery still requires the Thread to be mounted (recorded as a follow-up: a connection-level outbox could deliver from the roster).

Validation: 14 new controller tests cover all three backends (queue → deliver in order, refresh wait, abort/error/preflight holds, Send now, edit with attachments, remove, capacity, remount, read-only), 11 queue model/store tests, plus overlay, ThreadView, Composer, analytics-contract and connection-removal cases; 51 affected suites / 515 tests pass; the required gate reports 245 mobile suites / 2,350 tests with the sole failure still the pre-existing `theme.test.ts` Motion `companionCuriosity` expectation (unrelated theme work preserved), plus protocol 100% coverage, Relay 39 + 176 and Bridge 61 tests, mobile typecheck, six-locale catalog check, design-system check (162 UI files) and docs check. No simulator or device run was performed; the composer transition, dim settle and caption remain for owner device review.


### 2026-09-11 — HTML paywall typography and centered benefit block study

Owner requested larger text and a more balanced benefit layout, with an HTML trial first. Updated study A to current approved copy/icons and removed its obsolete English artwork caption. Added a reversible “original layout illustration / centered group” comparison using the same four benefits: proposed body text is 17 rather than 15, 24 line height, 14-point row gaps, and a content-width block centered in the phone with internal left alignment. Subtitle is 16; supporting purchase typography is more readable. Other study directions remain available. Short standalone screens reduce hero space before reducing type; checkout stays fixed while content can scroll. No React Native implementation changed in this iteration.

Validation: browser screenshots reviewed for the 393×852 study and 375×812 standalone; measured equal benefit-block side insets (~71 points at 393), four single-line rows and full content fit at 375 after tuning hero height. At 320×667, text has no horizontal overflow and the content scrolls; purchase stays visible even when monthly is expanded. Layout switch and browser console checks passed; JavaScript syntax checks pass. This is a visual proposal for owner review, not native/device acceptance.

### 2026-09-11 — Native paywall typography and multilingual layout

Owner approved the centered HTML typography study and explicitly requested language coverage. Implemented `PaywallBenefits` with intrinsic-width centering, a full-width cap, 17/24 body typography, shared-grid 16-point row gaps, complete wrapping labels and icons aligned to the scaled first line. Subtitle/brand now use the shared 17-point body token; prices use the 20-point title token. Retained localized prices and all purchase semantics. Compact plan titles now keep intrinsic copy height instead of a zero flex basis; row plans and price labels may wrap. Restore text is constrained to its header slot. Shared Button gained an opt-in multiline label used by the paywall CTA, leaving other consumers unchanged. Normal screens keep checkout fixed; below 740 points or font scale >=1.2, content and checkout scroll together to keep all controls reachable. Hero size uses the accepted shorter-screen recipe.

Confirmed supported locales directly from registration: en, zh-Hans, de, es, ja and ko; French is not currently registered and a French system locale falls back to English. No new locale was implied or added. Validation: 125 targeted paywall/purchase/shared-primitive tests pass, including all six real catalogs at 320×667 / 1.5 font scale, untruncated translated benefit/CTA/restore copy, scroll fallback and mounted language switching. Mobile typecheck, design-system (163 UI files), six-language catalog and documentation checks pass. The required gate reports 244 passing mobile suites / 2,356 passing tests and only the previously recorded theme Motion expectation mismatch. These are code/render-contract checks, not native pixel measurements; physical-device visual review remains with the owner, who plans to test English. No simulator, connection, native dependency, purchase or deployment was touched.

### 2026-09-11 — English-first paywall copy and intrinsic checkout repair

Owner's English device screenshot exposed verbose copy and native compact-plan title/price overlap missed by the previous render-contract tests. Rewrote English marketing copy around “More with your AI.” / “Your AI world, in your pocket.” and four concise benefits; shortened contextual English headings too. Restore has a short visible localized label and retains its full accessibility label. Renewal copy keeps live total/period, auto-renewal and anytime cancellation; store-specific instructions remain in the accessibility hint. Annual recommendation is “Our pick,” without popularity or savings claims.

Removed the compact title block's inherited flex shorthand and the compact card's column wrapping; title/price/detail blocks keep intrinsic, nonshrinking heights. Recommendation pills share the title baseline. Both the native screen and HTML A now use a single natural vertical scroll with bottom-aligned checkout when content fits, so longer translations cannot disappear behind a fixed footer. Artwork yields some height before typography does. No forced single-line truncation or font shrinking. Added six-language preview selection using a snapshot of actual app catalog strings; other design studies remain available.

Validation: 95 focused paywall/model/purchase/restore tests pass, including six-language compact-layout regressions and concise English billing. Mobile typecheck, design-system and locale gates pass. Browser review at 320×667, 375×812 and 393×852 across all six locales (18 cases) shows no text overflow or overlapping plan title/price rectangles, with at least 32 CSS pixels between benefits and plans. English title, all benefits and billing are single-line at 375/393 widths; English/Chinese/German screenshots reviewed. Full required gate: 244 mobile suites / 2,363 tests pass; the sole failure is the previously recorded unrelated theme Motion expectation missing companionCuriosity. These browser measurements and render-contract tests do not certify native Yoga pixels. Physical-device acceptance remains with the owner; no simulator, live purchase, connection changes or deployment performed.

### 2026-09-11 — Approved Agent headline

Owner selected “Your agents, elevated.” for the generic English paywall heading. Synced the native English catalog, HTML A catalog snapshot, existing heading regression and design guide; retained the subtitle and other languages. Paywall screen tests pass (30 tests); the refreshed 393-point HTML preview renders the heading on one line at the existing 28-point size. Native device delivery/appearance is not claimed.

### 2026-09-11 — Remove prototype context tags

Owner requested removing the small context tag on the paywall artwork. Confirmed native Lumen already contains no such tag; removed the HTML hero wrapper's appended scene mark and its unused styling. Context-specific titles, subtitles and benefit priorities remain in both the App and preview. Browser-checked all four A entry contexts: distinct titles remain and scene-mark count is zero; reviewed the current German Agent-entry screenshot. JavaScript syntax check passes. No native code or purchase behavior changed.

### 2026-09-11 — Slack session stuck on Loading history

Owner reported Lucy → YouMind #dev staying on Loading history through Preview. Read-only Cloudflare telemetry near the incident showed an attached Gateway and live client routes without pending handshakes; local Gateway logs also showed successful nearby history responses. More decisively, the owner's already-connected Metro runtime showed this exact Slack session had parsed 23 history records into 21 UI messages, with historyLoaded=true and connection ready, while the Thread still rendered loading with zero visible messages. RevenueCat had a resolved subscription snapshot but isLoading remained true. Its customer-info listener invalidated the initial refresh request without clearing loading, preventing that stale request's finally block from doing so. The session-preview gate then incorrectly treated unresolved billing as unresolved history.

Fixed the authoritative subscription listener to settle loading while preserving purchase/restore ownership and stale-response protection. Scoped free session previews now render their safe two-message projection independently of subscription lookup; confirmed Pro unlocks the same mounted thread without connection activation. Sending and pagination restrictions remain intact. Added privacy-filtered thread_load_state transition telemetry separating history, subscription and target-session readiness; no message content or raw session/connection IDs are emitted. Updated the session-preview contract and connection diagnostics runbook with this incident and read-only cloud/phone investigation boundaries.

Validation: reproduced all four new race/preview regressions before the fix; afterward 57 targeted tests pass, including free/Pro subscription races, both OpenClaw/Hermes previews and telemetry privacy/deduplication. Repository typechecks and protocol coverage passed in check:required; the mobile suite reports 244 passing suites / 2,366 passing tests, with only the previously recorded unrelated Motion companionCuriosity expectation failing. Design-system and six-locale checks pass separately. Read-only phone inspection after Fast Refresh confirms subscription loading cleared; the session was no longer mounted, so rendered chat acceptance is not claimed. No simulator, pairing change, Gateway restart or deployment was performed; physical-device acceptance remains with the owner.

### 2026-09-11 — Fast Refresh socket replacement storm and stale-peer guards

Owner reported repeated ready/reconnecting transitions and an ambiguous send failure with `replaced_by_new_client_socket`. Historical Preview Worker logs confirmed dense replacement events (128 returned in a four-minute incident window); read-only inspection of the existing phone Metro runtime found two coordinator listeners in the shared connection store. The module-local singleton had been reevaluated by Fast Refresh without retiring its predecessor. Both owners continued using the same device identity. The preceding analytics edit could trigger this dependency reevaluation; no simulator or live test client was connected during that investigation.

Added process-wide default-runtime ownership. Replacing a module's default permanently retires the previous coordinator: synchronously detach sockets, maintenance timers and store listeners, invalidate pending lifecycle work and refuse subsequent start calls from stale React effects. Ordinary stop/start semantics remain reusable. Owner saved any drafts and fully quit/reopened the phone once to clear unregistered instances created before this safeguard. At 21:05:54 JST the phone reconnected; subsequent read-only checks showed exactly one listener, the current process owner, ready and recovering=false. Before deployment, a 12:06–12:08:45 UTC cloud window contained only healthy heartbeat/rehydration events and no replacements or disconnects.

Reviewed the Relay socket handoff path, hibernation reconstruction and Bridge child-runtime lifecycle. Added guards that discard buffered frames from superseded owner/client/pairing/channel sockets before routing, rate-limit accounting or liveness updates. Reproduced and fixed a separate Hermes late-owner-close bug that reset the new owner's heartbeat watchdog. Existing late-client close already preserves the replacement mapping; added both-policy tests for that contract after rehydration. Updated older message-handler fixtures to await constructor rehydration and register their live peers before dispatch, matching Durable Object blockConcurrencyWhile semantics; assertions remain intact. Enhanced Relay telemetry with owner/channel/client kind, close code, socket age, secondary-channel close events, and validated current/previous diagnostic UUIDs for replacements; no peer close text, identity or credentials are logged.

Validation: all 46 coordinator tests pass, including retirement/timer cleanup/stale-effect restart cases for OpenClaw and Hermes. Relay/shared/registry: 34 + 41 + 127 tests pass; Bridge/core/CLI: 39 + 176 + 61 tests pass, including loopback lost-challenge recovery. All 36 v1 compatibility replay tests passed again through the deployment script. Repository typechecks and protocol coverage pass; full required gate reaches 244 passing mobile suites / 2,368 passing tests, with only the previously recorded unrelated Motion companionCuriosity expectation failure. Separate design-system, six-locale, docs and whitespace checks pass.

Deployed only clawket-relay-preview, version 8c863a2c-5cf9-4391-9eae-e437704300f2, using its isolated Preview KV and Durable Object configuration. No Registry, Production, Hermes service deployment, pairing reset or local Gateway restart. Post-deploy cloud telemetry confirms the new version, completed handshakes, healthy heartbeat/rehydration and no recurring replacements; phone remained ready with one owner. This validates the observed incident and targeted handoff cases, not a blanket certification of every network condition or a new live Hermes phone test. Runbook: 20-connection-diagnostics.md, “Repeated replacement after Fast Refresh.”

### 2026-09-11 — Conversation quality upgrade: send motion, reply placeholder, delivery glyphs, keyboard drag, attachment tray

Owner asked for a chat that feels like messaging a person and beats YouMind Mobile / Telegram: no per-reply model label (time instead), a send animation, a drag-to-dismiss keyboard gesture, a strong "received and thinking" state with Telegram-style delivery checks, wider replies with the timeline avatar removable, and a higher-quality attachment tray without the stray top line. Research (typing indicators cut perceived wait by 20–40% and prime the reader; iMessage/Telegram both animate the sent bubble from the composer and keep the "someone is typing" object; AI chats are expected to stream and expose lifecycle state next to the content) confirmed the direction: make the reply bubble exist from the moment of sending and let the user's own bubble report its delivery.

Delivered: `ThreadView` inserts a reply placeholder under the live stream id (`streaming`) whenever a run has produced no text, so thinking → streaming → settled reply is one row that never remounts; `ThinkingIndicator` breathes the live activity label (`Thinking…` / `Using exec…`) inside it in message typography on the Skeleton cadence and the markdown fades in when it replaces the thinking state. `MessageEntrance` plays a duration-based spring (16-point rise, 0.92 scale) for the user's sent row and a delayed 8-point rise for replies; `useThreadMessageEntrance` + `getTailEntranceMessageIds` arm entrances only for rows appearing at the newest end after mount (≤3 per update) and suppress history paging, optimistic→server and streaming→final id swaps and bulk reconciliation. `useChatController` now exposes `unconfirmedMessageIds` (optimistic ids until `prompt()` resolves/rejects) and `runAcknowledged` (set when the run is reported, reset per submit/session/scope); `resolveUserMessageStatus` turns them plus later Agent activity into sending / sent / delivered, rendered by `MessageMeta` as clock / check / accent double-check next to the 24-hour time inside the user bubble (an invisible tail on the last line reserves the space, Telegram style) or as a row under attachment-only sends; replies show the time at their bottom-right after streaming. Per-message model labels are gone, the Chat Appearance "Show Model Name" row is removed (stored preference and analytics field reported unchanged), the timeline Agent signature is opt-in (`getShowAgentAvatar` now reads `'1'` only, bootstrap default false) and reply bubbles use 92% width. The compact `Composer` captures a mostly vertical one-finger downward drag while focused (`shouldCaptureComposerKeyboardDismiss`, 10-point threshold, never over a scrollable draft) and dismisses the keyboard; the timeline keeps native interactive dismissal. `PendingImageBar` is rebuilt: no border line, 56-point rounded tiles on the composer surface, ink corner remove badge inside the 44-point target, quiet add tile, fade/layout transitions. Timeline rows are memoized so streaming chunks re-render only the changing row. Six locales gained `Sent` / `Delivered`; `Show Model Name` and the unused preview `GPT-5.4` keys were pruned. Rules recorded in `apps/mobile/AGENTS.md` and `docs/design-system.md`; deviations added to the table above (assistant width, breathing placeholder, time instead of model label).

Validation: new pure tests for delivery status (7), tail entrance (9) and the keyboard-dismiss gesture (3); ThreadView gained placeholder, delivery-glyph, entrance-arming and identity tests; PendingImageBar, ThreadPrimitives, ChatAppearanceScreen and storage tests updated. 23 affected suites / 318 tests pass; the full mobile suite reports 247 passing suites / 2,391 passing tests with the single pre-existing `theme.test.ts` Motion `companionCuriosity` expectation (another session's dirty-tree change, untouched here) as the only failure, which also stops `npm run check:required` at the mobile test step after all four workspace typechecks and protocol coverage pass; the remaining gate steps were run individually and pass: `check:design-system` (166 UI files, app config, docs), six-locale catalog check and repository `check:docs`. No simulator or device was operated: spring feel, meta baseline alignment inside the bubble, the Android overlay behavior of the invisible tail, and the composer drag on a physical keyboard remain for owner device review (HT-UX-2). The `showModelUsage` storage key and analytics field are a recorded cleanup follow-up.

### 2026-09-11 — Thread header: lifting dots instead of a second "Thinking…", no avatar badge

Owner device feedback on the conversation upgrade: the header repeated the bubble's "Thinking…", and the avatar's lower-right activity badge (three static bars) was unreadable. The Thread `HeaderPill` now takes `working`: while a run is active the subtitle slot renders the new `TypingDots` primitive (three 4-point `inkSecondary` dots, 4-point gap, each lifting 2 points and brightening 0.32→1 in turn over the 1.2 s avatar working cadence with a 320 ms bounce, driven by one shared progress value; static at rest opacity under reduced motion, `progressbar` busy for assistive technology) with the existing 120 ms subtitle fade, and the header avatar no longer maps a run to the `working` badge. Reconnecting still shows text. The reply bubble keeps the live activity label. This mirrors the Clawket 2.0 header dots and the YouMind Mobile `TypingDots` cadence without their text. Roster rows still show the stationary working badge; owner to decide whether it goes too. Deviation recorded (05 §1 "no three bouncing dots").

Validation: HeaderPill working test (light/dark) and ThreadView placeholder test extended; Thread, primitives, chat and component suites pass; mobile TypeScript, `check:ui-style`, design-system docs and repository docs checks pass. Device feel remains with the owner.

### 2026-09-11 — Stability review: uncertain sends, pause preferences, channel approvals, foreground probes

Confirmed and narrowly addressed all four review findings. A rejected prompt acknowledgement now retains one connection/session-scoped uncertain bubble instead of a sent check plus an auto-restored composer draft. Late failures pause the captured source queue and cannot change another conversation's draft/banner. The in-memory recovery record survives navigation/remount, backend idempotency evidence settles it, connection removal clears it, and the existing chat cache retains the uncertainty flag. This is not a durable automatic outbox: no implicit retry or claim that transport rejection proves backend rejection. Healthy foreground probes keep ready presentation; actual probe failure still starts bounded recovery for both OpenClaw and Hermes. Corrupt pause preferences salvage valid string IDs or fall back to an empty set without overwriting storage on read failure. Negotiated OpenClaw client-channel approval/rejection refuses a missing child instead of opening the owner's unhandshaken Gateway; connected-child and legacy routing remain tested.

Validation: 110 initial targeted mobile assertions passed; final send/navigation/cache subset 81 passed after adding source-session and cache recovery cases. Repository typechecks and protocol coverage passed. Full mobile run: 249 suites / 2,406 assertions passed, with the existing unrelated `theme.test.ts` Motion `companionCuriosity` expectation as the sole failure (the later cache assertion passes in the targeted run). Thus `check:required` is not green. Remaining relevant checks ran separately and passed: Relay shared/Registry/Worker 202 tests; Bridge core 39, runtime 178, CLI 61; v1 compatibility 36; design-system, six-locale catalogs, repository docs, and diff whitespace checks. Bridge was built through its self-contained test command; no live runtime restart, cloud deployment, simulator operation or device connection takeover occurred. Mobile JS can reach the owner's attached development client; the running Bridge needs its next managed restart to adopt the approval guard. Native visual acceptance remains with the owner.

### 2026-09-11 — GitHub backup checkpoint

Owner requested a commit/push and PR checkpoint for the accumulated 3.0 work. Verified GitHub's default branch is `main` (no `master` target); `release/3.0` contains 80 prior commits ahead of it with no missing main commits. Included the pending implementation, assets, design studies and acceptance documentation in one additional checkpoint. Updated the exact Motion token expectation to include the already implemented `companionCuriosity: 9600`; no animation behavior changed.

Validation now passes `npm run check:required` in full and `npm run test:compat` (36 assertions). The separate CI dependency audit remains a merge blocker: root `npm audit --audit-level=high` reports three high entries in the `sharp` → `miniflare` → `wrangler` development-tool dependency chain, plus lower-severity findings; the separate mobile audit passes the high threshold (20 moderate entries). No forced dependency upgrade was included in this backup. Open a draft PR to `main`, retain the release branch remotely, and defer merge until dependency remediation and review. No deployment or live connection restart is part of this checkpoint.

### 2026-09-11 — Owner-approved main merge and toolchain remediation

Owner explicitly approved merging PR #29 into `main`, superseding the draft-only checkpoint above. Updated root Wrangler from 4.129.0 to 4.131.0 and its supported Miniflare/workerd chain; `sharp` now resolves to patched 0.35.4 throughout the root dependency tree. Reviewed lockfile version changes: only this toolchain/native image dependency family changed, with redundant nested copies deduplicated. Mobile framework dependencies and service configurations are unchanged.

Both audit commands now pass `--audit-level=high`: root has 0 high/critical findings (50 moderate, 1 low remain); the separate mobile lockfile has 20 moderate findings. v1 replay passes all 36 assertions with the updated toolchain. Run the full required gate and GitHub checks on this commit before merge; no production deployment or runtime restart is included.

### 2026-09-11 — Agent profile: stat cards from the 2.0 console, header chat button, heartbeat line

Owner asked for a profile page that keeps the 3.0 restraint but brings back what 2.0's console data said people actually used. PostHog (project 337268, 2026-03-10 → 09-11) showed the Cron Jobs hero card was the most re-tapped entry (6.2 taps per tapping user), Cost Today the third (3.3), the Usage page the widest-reach sub-page (1,277 users; 78% of buyers vs 60% of senders), and Models / Skills / Memory counts at 3.3–4.9 taps per user, while 3.0 had hidden Usage in the Advanced sheet and had no heartbeat value at all. Three canvas directions were reviewed and merged into one (canvas "Clawket Agent Profile 方案", page 合稿): B's top-right chat button, C's card form, Cron jobs first, 2.0 naming, and tokens instead of a daily bar chart because only today's cost is reliably readable.

Delivered: `AgentSettingsScreen` header gains a trailing ink `FloatingButton` (`agent-profile-chat`) and the hero loses its pill; the hero subtitle becomes `<backend> · Active <age>` when `cron.heartbeat.last()` returns a timestamp (new optional read on `CronOperations.heartbeat` in `@clawket/agent-protocol`, OpenClaw adapter calls Gateway `last-heartbeat` via `gateway.fetchLastHeartbeat()` and normalizes with `parseLastHeartbeat`; Hermes declares nothing), otherwise the previous `label · backend` line. `model.ts` now emits `stats` (Cron jobs + Cost today heroes, Models / Skills / Files tiles, capability-gated, `placement` hero/tile) and a single connection group whose rows carry `placement` primary/advanced; the cost card degrades to "Tokens today" when `costPresentation.mode === 'unknown'` and every missing number renders `—`. `load-summary.ts` reads `models.list`, `agents.files.list`, `cron.heartbeat.last`, counts cron failures and keeps `totals.totalTokens` from the same `usage.cost(today)` call (`getSelection` is no longer fetched). Cards are `SettingsGroup` + `SettingsRow layout="column"` with `title` tabular numbers, `secondary` labels and a `caption` detail (red `{{count}} failed`, grey `{{value}} tokens`); permission-locked cards show a lock in the detail slot. `Scheduled tasks` / `New scheduled task` keys were renamed to `Cron jobs` / `New cron job` in all six locales; five new `settings` keys (`Cost today`, `Tokens today`, `Active {{age}}`, `{{count}} failed`, `{{value}} tokens`). Spec §5, rollout table, `apps/mobile/AGENTS.md` and the deviation table were updated.

Validation: 22 AgentSettings suites / 139 tests pass (model, loader, deep and shallow screen renders incl. dark mode, permission lock, tokens fallback, heartbeat line); `console-heartbeat` gained parse/age tests; gateway-client legacy parity, recorded adapters and adapter index suites pass (138); agent-protocol mock suite passes (14) and the package typechecks; `check:ui-style` (167 files, profile screen at exactly three `FontSize` members), six-locale `i18n:check` and `check:docs` pass. Mobile `tsc` currently fails only in `src/screens/SessionPanel/*`, another session's in-flight session-panel work, so `check:required` is not green from this change alone. No device or simulator was operated: card proportions, the tabular numerals and the heartbeat age on a real Gateway remain for owner device review.

### 2026-09-11 — Session Panel merged design: Agent pill, channel chips, roster-style rows

Owner found the 3.0 Session Panel too plain (status dot + title + time made five `YouMind #dev` rows indistinguishable) and asked for the 2.0 sidebar's strengths without its look. Three directions were drafted on a Claude Design canvas (roster language / channel navigation / activity feed); the owner chose a merge: direction A's rows, direction B's header Agent pill and channel chips. Implemented as approved. The sheet title slot is now an Agent pill (28-point avatar, name, chevron only with several Agents) that opens a floating Agent menu inside the sheet (avatar 32, name, session count, check on the current one); switching only re-scopes the panel, never the Thread, and every opening returns to the conversation's Agent with `All`. Below it one horizontal chip row: `All n`, one chip per channel busiest-first with counts, then Direct & groups / Subagents / Scheduled when present; a lone main chat shows no chips. Rows reuse the roster vocabulary: 40-point tile (Agent avatar for the main chat, `surface` circle with a monochrome Lucide platform glyph via the new `resolveSessionChannelIcon` for channels, kind icon otherwise, stationary working badge), `body` 600 title with a pin glyph when pinned, one `secondary` preview line from the already-fetched `SessionDescriptor.preview` (ink when unread), `caption` time and a 12-point ink unread / `bad` attention dot. Main first, pinned next, then activity; finished sub-agent runs fold into one trailing `Subagents` row that selects the Subagents chip. The Grouped/List switch, per-Agent group headers, channel section titles and the status-word summary are gone; search, long-press actions (pin now reads Unpin when pinned), confirmations, rename and all page states remain. Supporting changes: `RosterAgentSummary.unreadSessionKeys` (row-level unread from the existing watermarks; the roster badge still counts only the main chat), `AgentAvatar` `panel` size + exported `AvatarWorkingBadge`, `Sheet`/`SheetHeader` `titleContent`, `pinnedSessionKeys` passed from App, analytics `session_panel_opened{session_count}` / `session_panel_filter_changed{filter}` / `session_panel_agent_switched{session_count}` replacing the mode events, six-locale `Switch Agent` added and six obsolete panel keys removed. Deviation recorded against 05 §9 (chip cap of three; preview line added to the panel budget) — both owner decisions today; 04 §4, 05, 07, Mobile AGENTS and design-system docs updated.

Validation: SessionPanel view/model suites rewritten (30 tests: pill, chips, Agent menu, filtering, search, markers, actions, rename, states, dark tiers); channel icon, roster-cache and analytics suites extended. `npm run check:required` passes in full (all four workspace typechecks, protocol coverage, mobile 252 suites / 2,453 tests, relay and bridge required tests, design-system, six-locale catalogs, repository docs). No simulator or device was operated; visual acceptance of row height, chip strip, Agent menu placement and dark mode remains with the owner. Not committed.

Owner device feedback (same evening): with a short filtered list the horizontal chip `ScrollView` grew to fill the sheet (its default `flexGrow: 1`) and stretched every chip into a tall capsule; the strip now has `flexGrow: 0` with fixed 36-point chips and the list owns `flex: 1`. The top also read as crowded, so the chip strip carries 12-point top and bottom padding and the list 4 more, giving 16 points between header and chips and between chips and the first row. Panel suites (30), mobile typecheck and `check:ui-style` pass; device look remains with the owner.

### 2026-09-11 — Streaming reply cascade: enriched-markdown 1.0.2, word pacer, no cursor

Owner device feedback: while the Agent replied, a black `▍` rectangle blinked under the bubble — a literal glyph animated with an infinite Reanimated loop, rendered as a block sibling of the native markdown view so it landed on its own line, and in tension with the "no other looping animation" rule. youmind-mobile's stream reads far smoother because it (1) paces socket bursts into word-sized increments before they reach the native view, (2) repairs open markdown with `remend`, and (3) lets the native tail fade-in do the only animating, with a patch that keeps successive tails fading in parallel.

Delivered: `react-native-enriched-markdown` moved from the 2026-03-25 0.5.0 nightly tarball to the exact 1.0.2 stable (the same renderer; the JS API is a superset, and both lockfiles change only that entry). The upstream Expo config plugin is gone, so feature flags live in the `enriched-markdown` block of the root and Mobile manifests — `enableMath: false` in both, so the 47 MB RaTeX framework is neither downloaded nor linked; code highlighting stays on the default set. New `scripts/patch-enriched-markdown-tail-fade.mjs` (wired into both postinstall entry points, fail-closed on upstream drift, idempotent, with a corrupted-input test) replaces the iOS `ENRMTailFadeInAnimator.m` with a parallel-fade version (250 ms quadratic ease-out per tail under one display link, colors re-snapshotted after each text replacement, Reduce Motion honored); Android's animator already overlaps spans upstream. `src/chat/streamTextPacer.ts` + `useSmoothedStreamText.ts` (ported from youmind-mobile, pure TS, deterministic clock) reveal text at the estimated arrival rate on word boundaries — `Intl.Segmenter` with a CJK per-character fallback, 10-character hold-back, 33 ms tick, publish decimation for long messages, snap on regenerate/recovery, reduced motion bypasses the pacer. `AssistantBubble` feeds `remend(pacedText)` to the native view with `streamingAnimation` on while animating, drops the cursor entirely, and shows the clock meta once the pacer drains. `HeaderPill` insets `TypingDots` by `Space.xs` (owner: the dots sat too far left). Jest maps `remend` (ESM-only `import` export condition) to its dist file and lowers it with Babel.

Validation: ported pacer/hook suites (deterministic timing, CJK cuts, snap thresholds, publish stride, reduced motion) and the patch script test pass; ThreadView asserts the repaired streaming markdown, no cursor node, and the settled row; full mobile Jest 2436/2448 with the only failures in `SessionPanel` suites that another session is editing concurrently (their `model.ts`/`index.ts` are dirty in the tree and were not touched here); mobile TypeScript clean outside those same in-progress files; `expo install --check` up to date; `check:design-system` and `check:docs` pass; clean `expo prebuild`, `pod install` (Podfile.lock: `ReactNativeEnrichedMarkdown (1.0.2)`, RaTeX skipped as configured), and an arm64 iOS simulator Debug build succeed with the patched animator compiling without warnings; Android Debug assemble (Homebrew command-line SDK, `ANDROID_HOME` exported explicitly) succeeds and produces `app-debug.apk`. The Mac was at 100% disk (≈1 GB free) during native builds — builds were run one platform at a time with a scratch DerivedData path. Device feel of the cascade remains with the owner.

### 2026-09-11 — Delivery glyphs in tertiary ink

Owner found the accent double-check on the accent-tinted bubble ugly. `MessageMeta` now keeps every delivery glyph (clock, check, double check) in `inkTertiary` with a 1.75 stroke, the same tone as the time, so state is carried by the glyph alone and the bubble holds one quiet color; the uncertain-send alert keeps `warn`. This also matches the visual principle that accent appears only on the send key, selection, links and unread dots. Thread/primitives suites and the UI-style check pass; device look remains with the owner.

### 2026-09-11 — Thread Add sheet: recent photos, expandable grid, hidden 2.0 entries restored

Owner asked for the Add sheet to match and beat youmind-mobile's `AddToChatSheet` (recent-photo strip after authorization, inline permission request, taller sheet with bottom breathing room), a better Skills glyph, and a review of what else belongs there. Research: youmind-mobile's sheet (1,800 lines) contributes the strip, the tiles→strip permission flow, deferred media loading with skeletons and two detents; its YouMind files / official skills / connectors / computer toggle do not apply. In 3.0 the thinking-level picker (`controller.openThinkPicker` + `ThinkingLevelPickerModal`) and the 2.0 "/" command button (`controller.openSlashMenu`) were still wired but had no UI entry; Tools quick toggles had moved to Agent settings. Owner chose: Thinking level, Commands, Schedule a task and Tools rows; iOS-only recent photos with Android on the system Photo Picker (Google Play photo policy, same as youmind-mobile's Play build). A Telegram-style drag-up grid was built first and then removed at the owner's request (2026-09-12) to stay consistent with youmind-mobile: the strip plus `All photos` is the whole photo surface.

Delivered: `ThreadAddSheet` rewritten on fixed detents 62% / 92% with `BottomSheetScrollView`; new `services/recent-photos.ts` (permission normalization incl. iOS limited access, newest-first `MediaLibrary` page resolved to local files in a first batch of 4 then chunks of 6, cloud-only assets skipped) and `hooks/useRecentPhotos.ts` (module cache for instant second open, 320 ms first-open delay behind the rise animation, quiet refresh, in-flight cancellation on close, inline `request()`); `threadAddSheetSelection.ts` ordered multi-select with pick numbers and clamped strip tile sizing; `useChatImagePicker.attachLocalImages` re-encodes picks as JPEG 0.8 + base64 (HEIC → JPEG) into the existing pending pipeline; header right becomes a quiet `Images` FloatingButton (All photos). Rows: Choose File (strip mode), Skills (`Puzzle`), Prompts, Commands (`SquareSlash`), Thinking level with the current value (`Brain`), Schedule a task (`CalendarClock` → `AgentSettingsSection` `action: 'create-cron'` + `cronPrompt`, `CronSection` `openCreateOnMount` / `initialPrompt`), Tools (`SlidersHorizontal`). `@clawket/agent-protocol` gains `slashCommands` (OpenClaw / Hermes true, YouMind false) so the Commands row is capability-gated instead of a backend check; the "+" now shows whenever any entry is available. Analytics `chat_add_menu_opened{backend, photo_access}` and `chat_add_menu_action{backend, action, count}` close the "Prompts usage unknown" gap from `15-chat-owner-acceptance.md`. Ten `chat` keys added to six locales; `app.json` `photosPermission` now covers reading recent photos (native `Info.plist` regenerates on prebuild). Spec 04 §4, 01 §3.2, 07, Mobile AGENTS, design-system docs and the deviation table updated.

Validation: new suites for the service (7), hook (5), selection helpers (4), picker hook (2) and sheet (5, incl. inline permission fallback, ordered selection/attach-after-dismiss, unsupported backend); ThreadScreen gains an OpenClaw / Hermes / YouMind gating test; Cron section gains open-on-mount + prefilled prompt; agent-protocol Vitest (24) passes. Mobile `tsc`, full mobile Jest (256 suites / 2,478 tests), `check:design-system` (168 files) pass. No simulator or device was operated; device acceptance is HT-UX-3.

### 2026-09-12 — Add sheet follow-up: YouMind metrics, Commands as a sheet, Prompts removed

Owner device feedback on the first cut: row glyphs looked indented against the strip; the gap between Choose File and Skills read as a hole; the Commands entry opened the old inline autocomplete popup, which could not be dismissed without choosing (the 2.0 "forced" mode kept the full list open while typing); Thinking level duplicates the composer chip; and Prompts should go unless data shows use. PostHog project 337268 has never carried a prompt event (`read-data-schema` event list, 2026-09-12), so usage is unmeasured; per the owner's rule the feature is removed rather than re-instrumented.

Delivered: sheet metrics now follow youmind-mobile's `AddToChatSheet` — 16-point content inset under the header close button, tiles the same height as strip tiles with `secondary` regular labels, rows 44 points with a 36-point centered ink glyph box (no row padding, so glyphs share the tiles' left edge), chevrons — raised to a 48-point pitch the same day after the owner found 44 slightly cramped — and hairline `SettingsDivider`s between media / compose rows / agent rows. Thinking level row removed. Commands now opens the new `CommandsSheet` (canonical `Sheet`, 68% / 92%, `BottomSheetFlatList` of description-titled rows with the `/command` value) which runs `onSelectSlashCommand` after dismissal and confirms `reset` / `restart` / `kill` through `ConfirmationModal`; the controller's forced slash-menu state (`openSlashMenu` / `slashMenuForced`) is deleted, and the typed `/` autocomplete popup is restyled borderless (no hairline frame or row dividers, 44-point rows, shared `useSlashCommandDescriptions`). `PromptPickerModal`, its test, the user-prompt storage API (`SavedPrompt`, `getUserPrompts` / `setUserPrompts` / seeded / peek keys) and nine prompt-only `chat` keys are removed from all six locales; stored snippets stay in AsyncStorage unread. Analytics `chat_add_menu_action.action` drops `prompts` / `thinking`. Spec 04 §4, 07, Mobile AGENTS, design-system docs and the deviation table updated.

Validation: `CommandsSheet` suite (3: deferred select, destructive confirm/cancel, dismiss without action), Add sheet suite (5, incl. divider groups), ThreadScreen commands-sheet wiring; Thread / chat / components suites 55 / 544 pass; mobile `tsc`, `check:design-system` (169 files) and six-locale `i18n:check` pass. Device look remains with the owner (HT-UX-3).

### 2026-09-12 — Review fixes: Hermes command catalog, heartbeat attribution, deferred-action wedge

Owner forwarded a review; every point was verified against source before changing anything. (1) `packages/bridge-runtime/src/hermes/stream-mapping.ts` interprets only `/model` `/think` `/reasoning` `/fast`, so the Hermes `slashCommands` bit is now `false` — the Commands row and `CommandsSheet` appear for OpenClaw only; the typed `/` autocomplete keeps its pre-existing behavior. (2) OpenClaw `getLastHeartbeatEvent()` is a Gateway-global singleton with no `agentId`, and `skipped` (`alerts-disabled`, `no-route`, busy, preempted) events are emitted before the Agent runs while `failed` may be: `parseLastHeartbeat` now accepts only `sent` / `ok-empty` / `ok-token` (payloads without a status keep the legacy path), and the profile hero shows `Active …` only when the connection has one Agent (`agentCount` from the roster group flows App → `AgentSettingsRuntimeScreen` → `buildAgentSettingsModel`). (3) `ThreadAddSheet.run` now refuses to queue when the sheet is no longer visible, so a permission fallback resolving after a session-switch close cannot leave `pendingAction` set and wedge later taps. (4) `onSelectSlashCommand` takes a `source`; the sheet reports `commands_sheet` instead of `slash_suggestions`. (5) `CronSection` seeds the Thread draft only into the editor opened on arrival; later "New cron job" taps start blank. Regression tests added for each; AgentSettings / Thread / chat suites 76 / 685, protocol Vitest 24, mobile `tsc` pass.

### 2026-09-11 — Delivery meta in the bubble's own hue

Owner: the full-accent double check was ugly, but plain gray felt flat and the state deserves color. `MessageMeta` gained `tone`: inside the user bubble the time and glyph are both the accent at 62% container opacity over `accentSoft`, i.e. a softened mid tone of the bubble's own hue (Telegram's outgoing-tick treatment), in both light and dark accents; reply bubbles keep tertiary ink and an uncertain send keeps `warn`. Suites and UI-style check pass; device look remains with the owner.

### 2026-09-12 — Composer placeholder: "Message"

Owner asked for the Telegram placeholder instead of "Ask Lucy". `ThreadCopy.formatAsk` became a plain `placeholder` resolved from the existing `Message...` chat key, whose six values are now the messenger word without an ellipsis (`Message`, `输入消息`, `メッセージ`, `메시지`, `Nachricht`, `Mensaje`); the appearance preview shares it and `Ask {{name}}` is removed. Thread suites (147 tests), six-locale catalog and UI-style checks pass.
