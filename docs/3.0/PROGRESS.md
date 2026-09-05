# PROGRESS · Clawket 3.0 进度日志

> 实现者维护。每次开工先读；每完成一个里程碑更新。人类只读这一份文件了解进度。

## 当前状态

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
| `08-milestones.md` M0.4 | compat 必须先在基线代码上全绿。 | 在 OpenClaw 与 Hermes Relay 各删除一次 accept 后过早的 socket reconcile，再取得首次全绿。 | 基线实现会先把旧 peer 隐藏或以 4010 duplicate 关闭，使公开的 4001/4002 replacement 路径不可达；fixture 正确暴露了现存缺陷。 | 最小双后端修复恢复既有关闭码契约；其余 reconcile/rehydration 行为不变。 |
| `02-protocol-and-services.md` §7 | 2.1.0 / 2.1.1 / 2.1.2 都应找到线上已发布版本提交并录制。 | 2.1.0 使用 EAS shipped source，2.1.2 使用版本锚点并另记 d9c pre-3.0 wire；2.1.1 明确标为 `31a857…` inferred snapshot。 | 仓库、ref/tag、已检查 EAS 构建与 npm metadata 都没有可证明的精确 2.1.1 App source。 | provenance 缺口在 `tests/compat/PINNED.md` 可见；不会把 2.1.0 源码伪写成 2.1.1。 |
| `02-protocol-and-services.md` §7 | 从历史 App 真实流程录制 packet fixture，并在 worktree 构建老 Bridge。 | fixture 从 pinned 客户端的真实序列化/分派源码边界提取并经真实服务回放；历史 Bridge 使用从该 commit lock 精确裁剪的 Bridge-only closure 做 `npm ci` 与构建。 | 无可下载历史 App 二进制；历史 full-monorepo lock 的 Expo closure 已失配，完整 `npm ci` 在当时源码上不可复现。 | 协议、签名、scopes、未知控制事件与 3 个唯一 Bridge artifact 均有机器证明；不宣称二进制抓包或完整历史 App 构建。 |
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

## HUMAN TODO（只有人能做的事）

| 编号 | 事项 | 怎么做 | 验证方法 | 状态 |
|---|---|---|---|---|
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
