# 00 · 冻结的决策、非目标与硬约束

> 本文件是 3.0 的产品决策。结论不重新讨论；实现方式允许变通，边界见 `README.md` 的「偏离规则」。若发现某条决策与代码现实冲突或会造成明显更差的体验，按自己认为更好的方式实现，并写进 `PROGRESS.md` 的偏离记录，早上由人裁定。

## 1. 产品定位

| 项 | 决策 |
|---|---|
| 一句话 | Clawket 3.0 是「自托管 Agent 的会话控制塔」：一屏看清所有 Agent 在做什么，一步进入对话，需要时管住它。 |
| 支持的后端 | OpenClaw、Hermes、YouMind 精灵，以及 2026-09-11 用户授权新增的 `local-model`。本地模型先在独立 Preview 验证聊天、Relay、模型切换和图片；不扩展 Agent 工具能力。详见 [本地模型连接](15-local-model.md)。 |
| 平台 | iOS 与 Android 同步发布，一套 UI，无 Liquid Glass、无 SF Symbols、无 Material 涟漪。 |
| 版本号 | 3.0 既是项目代号也是发布版本号：App `3.0.0`（必须高于线上的 2.1.x，商店才视为升级）、`@p697/clawket` `3.0.0`、`bridge-runtime` 与 `bridge-core` `3.0.0`。线上老客户端以 PostHog 为准主要是 2.1.1 与 2.1.0，兼容目标是 2.1.0 / 2.1.1 / 2.1.2 三个版本。 |
| 与官方 OpenClaw App 的关系 | 不对抗，附着：官方 App 聊，Clawket 管。商店文案：「OpenClaw 与 Hermes 的手机控制塔——看清每个 Agent 在做什么，随时接管。」 |

## 2. 信息架构（方案 D「花名册」）

| 项 | 决策 |
|---|---|
| 底部 Tab | 没有。 |
| 首屏 | 花名册：每个连接里的每个 Agent 一行（头像、名字、最后一条预览、时间、未读/需要你徽标）。渠道会话默认不出现，用户在会话面板长按「置顶到花名册」后才作为带 📌 的行出现在该 Agent 下方。排序只看「最近一次有人参与的活动」（2026-09-16 负责人决定）：手动置顶的 Agent 在前，其余按主会话 / 直聊 / 群 / 渠道会话里最近的用户消息或面向用户的回复时间降序；未读与「需要你」只做徽标、不参与排序，子 Agent 与定时任务的后台运行不算活动。没有「已归档」。左上头像 → 账户设置；右上「搜索」（全局）与「+」（添加连接 / 新建 Agent）。 |
| 线程 | 点一行进入该 Agent 的唯一持续线程 = OpenClaw 的 `agent:<id>:main`；Hermes 与 YouMind 精灵各有对应的 main。头部胶囊：头像 + 名字，副标题「模型 · 上下文剩余 %」；运行中副标题临时变为「正在用 <tool>…」；离线时头像变灰、副标题「离线 · 重连中」。点胶囊弹会话面板；右上齿轮进 Agent 设置。运行中发送键变停止键。Cron 运行结果、子 Agent 运行、审批（exec / 插件 / 配对）都是线程里的卡片。 |
| 会话面板 | 底部弹层。顶部「分组 / 列表」分段。分组模式：按 Agent 分组（这台连接上的全部会话），当前 Agent 展开、其他折叠；组内按类型分节：主会话、渠道（按平台归组）、直聊与群、子 Agent（运行中在前，已完成折叠）、定时（按任务折叠）。列表模式：继承老 Sessions Board 的紧凑行（状态标签 · 类型标签 · 标题 · 时间），带搜索、活跃/最近/空闲摘要、类型 chip。长按行：置顶到花名册 / 重命名 / 重置 / 删除。Hermes 只有一个分组。 |
| Agent 设置（齿轮） | 顶行身份（名字、头像、人格、记忆文件）；Agent 组：模型、技能（已安装 / 发现，含 ClawHub 来源）、定时任务（含心跳）、文件、用量与费用；连接组（以连接名为标题）：连接状态、OpenClaw 管理（配置 / 权限 / 诊断 / 备份，Pro）、工具、渠道与设备（渠道 / 设备 / 节点）、日志（Pro）。能力为 false 的行不渲染。 |
| 账户设置（头像） | Pro 状态与横幅、连接列表（增删、环境标签）、外观（主题、强调色、聊天外观、App 图标）、语音、通知、帮助（含文档链接与 OpenClaw Releases）、社区、关于、开发者（Debug 模式、Preview 环境、设计系统）。 |
| 搜索 | 花名册右上「搜索」= 全局搜索：Agent、会话、消息（本机缓存）、收藏，跨连接。会话面板内搜索 = 本连接范围。打开一条消息详情是 Pro 门槛（沿用 `messageHistory`）。 |
| 首启引导 | 独立流程，不在设置页里：一屏说清前提（需要一台运行 OpenClaw 或 Hermes 的电脑）、一条命令、六位配对码输入；折叠的二维码扫描/上传；「还没有 Agent？」只链接 OpenClaw 与 Hermes 官方安装文档。第三个入口：YouMind 精灵（邮箱验证码登录）。 |
| 删除的页面 | Live、Console 首页与统计、Sessions Board、Agent & Session Board、Chat History 页面（能力并入搜索）、Chat 抽屉、「Agents & Gateways」弹层、设置里的连接段、Office、Discover 独立 Tab（并入技能）、Docs 页面（并入帮助）、全部 YouMind Board / 素材 / Profile / 跳页。 |

## 3. 未读与时效（第 0 档）

- 打开 App 只连当前活动连接。连上后，该连接内所有 Agent / 会话的未读靠 `sessions.list` 的 `updatedAt` 对比本地「已读水位线」计算。
- Agent 行未读 = 它任一非运行会话有未读；「需要你」（审批、Cron 失败、会话出错）用红色徽标，优先级高于普通未读。
- Cron 运行与子 Agent 运行不产生普通未读，只在失败或需要审批时产生「需要你」。
- 其他连接的行显示本地缓存的预览与「上次同步 x 前」，不显示未读；点进去即连接并刷新。
- 不做：多隧道并行、Relay 存活动摘要、远程推送。

## 4. 付费

| 项 | 决策 |
|---|---|
| 免费额度 | 1 个连接 + 1 个 Agent（main）。免费连接由用户指定（默认为首次以 3.0 启动时的活动连接），其他连接的行在花名册可见但带锁；免费连接里 main 之外的 Agent 也带锁；点开任一带锁行即付费墙；新建连接与新建 Agent 即付费墙。切换免费连接在账户设置里进行，每 24 小时最多一次。 |
| 宽限 | 升级到 3.0 前已有多个连接、或已在多 Agent 上发过消息的非 Pro 设备，给 14 天宽限（连接与 Agent 共用同一个宽限期），花名册顶部横幅提示；到期按上述规则上锁。宽限只发一次，标记存在设备 identity 旁，重装不重发。Pro 到期按同样规则上锁，恢复购买即解锁。 |
| Pro 内容 | 多连接、多 Agent、OpenClaw 管理（配置 / 权限 / 诊断 / 备份）、日志、文件编辑写入、消息详情、App 图标。 |
| 保持免费 | 花名册、会话面板（含列表模式）、聊天、技能浏览与安装、模型切换、Cron 查看与创建、Hermes 本身、YouMind 精灵聊天。 |
| 套餐 | 年付 $19.99 默认选中（显示折合 $1.67 / 月、省 44%）；终身作为锚，**3.0 上线时涨到 $49.99**，上线前两周旧价作「发布价」；月付 $2.99 折进「查看月付方案」。不做试用。价格用 App Store 自动换算，不手动定价。 |
| 付费墙形态 | 全屏原生模态，一屏放完：小关闭键与恢复购买、英雄图（五套：多连接、OpenClaw 管理、日志与文件、搜索、通用）、结果式标题、最多 4 条收益、一行评分与评论、两张方案卡、带价格的大按钮、法务小字。购买成功页内变成功态并自动完成被拦的动作，不弹系统 Alert。 |
| 触发规则 | 情境触发不限次数。自动弹出：非 Pro 用户在**每次冷启动后、活动连接第一次进入 ready 的那一刻**弹一次通用版（首次安装即「引导完成并连接成功、进入花名册」之后）。同一进程内的重连不算；从后台切回不算；启动时有待处理审批则先处理审批再弹；没有任何连接就绪就不弹。购买后所有入口消失。 |
| 实验 | RevenueCat Experiments 在 offering 层，通过 offering metadata 驱动客户端：`default_package`（annual / monthly）、`social_proof`（true / false）。终身价格已定为 $49.99，不做价格实验（要做需要第二个商店 SKU）。不引入 `react-native-purchases-ui`。 |

## 5. YouMind 精灵

- 登录只留邮箱验证码（`signInWithOTP` → `validateOTPToken`，`refreshToken` 续期）。
- 传输走直连：`POST /api/v1/sprite/ensureDefault`、`sessionLoad`（spriteId + limit + cursor）、`sessionPrompt`（流式 CompletionStreamChunk）、`abort`（spriteId + personaId）。首次进入线程且历史为空时发送 `WakeUp`（中文界面 `醒来吧`）触发开场。
- 内部契约按 ACP 命名（见 `01-architecture.md`），不调用 `/api/v1/sprite/acp/*`。
- 花名册显示精灵自己的名字与头像，副标题「YouMind」。
- 做：文本收发、流式、中止、历史分页、断流恢复。不做：Board、素材、跳页、模型切换、技能、Cron、附件、@ 引用、语音、积分、Pro 档案。
- 能力矩阵：`chat`、`abort`、`history` 为 true，其余 false。

## 6. Hermes

- 多会话进 3.0：会话列表、创建、重命名、重置、删除，走 Bridge 已有的 `sessions.*` 与原生会话读取。
- 补齐：中止（Bridge 用 AbortController 取消 `/v1/runs`）、附件（确认 PR #27 的转发在 App 侧放开）、Cron 创建（Bridge 已有 `hermes.cron.jobs.create`）。
- 不做：工具、渠道、节点、日志、配置写入。能力表继续为 false。
- Hermes 模型选择保持全局。

## 7. 连接层 v2 与服务端

- App 内四层：UI → 适配器 → 传输 → 连接注册表。UI 只认 `AgentAdapter` 与 `Capabilities`。
- 三个适配器：`OpenClawAdapter`、`HermesAdapter`、`YouMindSpriteAdapter`；三种传输：Relay WebSocket、直连 WebSocket、HTTPS 流。
- Relay Worker 与 Registry 各合成一套代码，部署三个实例：OpenClaw Production、OpenClaw Preview、Hermes。部署名、Durable Object 类名、KV、密钥保持各自不变。
- Bridge 拆成 `bridge-core` + `openclaw-bridge` + `hermes-bridge`；CLI 命令面不变。
- 协议 v2 只做加法：控制帧前缀 `__clawket_relay_control__:` 不变；新增行为只在对方声明了能力字符串时启用。
- 老客户端兼容期：3.0 发布后 90 天内 2.1.x 完整可用；之后 App 内强制升级提示；v1 代码路径在 90 天后才允许移除（不在本次范围）。

## 8. 视觉

- 向 Grok Bot 对齐的语言：白底、无导航栏、浮动圆形按钮与头像胶囊、无分割线无卡片边框、颜色只给头像、一种气泡、系统事件行、圆形「+」加胶囊输入框、只有 400 / 600 两种字重。
- 自有头像系统：圆角方块 + Agent 的 emoji 或首字母 + 状态环。不用「眼睛」。
- 强调色保留 6 种内置（iceBlue 默认、royalPurple、jadeGreen、sunsetOrange、oceanTeal、rosePink），每种重新调到新色板并通过对比度检查；删除无界面的「自定义强调色」代码。依据：已连接用户里 31% 改过强调色，74% 停在非默认色且五种备选色使用均匀；在相同发送量分层下，改过色的用户购买率高 3–4 个百分点、两月留存高 6–14 个百分点。强调色只用于发送键、选中态、链接、「查看中」、未读点、工作中状态环，因此不影响整体质感。
- 设置类页面用 `#F5F5F7` 底 + 白色分组卡；其他页面纯白。
- **文案预算**：每个界面默认只有两层字（主文字 + 一行灰字），行与卡片无描述性副标题，不用文字标签表达类型 / 状态 / 来源，设置行右侧只放一个值，空态与横幅一句话。字阶只有五档。规则与每屏预算见 `05-visual-system.md` §9，是 M5 的完成标准之一。
- **自绘导航与统一 Tab**：页面级返回、关闭、标题、Tab、弹层、确认框全部自绘，不用系统原生控件；组件从 youmind-mobile 移植（`05` §11），Tab 统一为全圆胶囊的 `Segmented`。
- `docs/3.0/mockups` 只是风格参照，尺寸以 token 表与移植组件为准。
- 全部 token、字阶、间距、组件配方见 `05-visual-system.md`。

## 9. 成本、安全、稳定性

| 项 | 决策 |
|---|---|
| 月度预算 | 目标 ≤ $30；$50 告警；$100 人工介入。 |
| 必须堵的口子 | ① `/ws` 在路由到 Durable Object 之前先验证 gatewayId / bridgeId 存在，不存在 404；② `/v1/pair/register` 用 Cloudflare Rate Limiting binding（或 Durable Object 计数器）按 IP 限速，未 claim 的注册 24 小时过期；③ WebSocket 消息应用层上限 8 MiB（覆盖现有 5 MB 图片的 base64，绝不低于平台上限），超限关闭并计数；④ Hermes 房间心跳改为能力协商，空闲 30 秒。 |
| WAF 与告警 | Cloudflare WAF：`/ws` 每 IP 30 次 / 分钟；`/v1/pair/register` 每 IP 10 次 / 小时；`/v1/pair/session/resolve` 每 IP 20 次 / 分钟；Registry 全站每 IP 300 次 / 分钟。Notifications：Workers 请求量、DO 请求量、KV 写入量三条阈值。（HT-1，由人配置，不阻塞） |
| 密钥 | 仓库不含任何密钥；`wrangler.local.toml`、`wrangler.preview.local.toml`、`.env.local`、keystore、`.p8`、`.pem` 永不提交；Preview 与 Production 的 secret 必须不同；开启 GitHub secret scanning 与 push protection（由人在 GitHub 设置）；`npm audit --audit-level=high` 进 CI。 |
| 隐私 | Relay 只转发不落盘；消息只在设备本地缓存；删除连接时清空该连接缓存。写进 README 与商店隐私标签。 |
| 稳定性 SLO | Relay 路径冷启动到 ready p50 < 2 s、p90 < 5 s；一小时会话内非预期断线 < 1 次；Bridge 离线时 3 秒内给出明确原因。 |
| 连接遥测 | `connect_attempt` / `connect_ready` / `connect_failed(reason)` / `reconnect(reason)`，属性含后端与传输。 |

## 10. 发布

- 顺序：Preview 测通 → Production 服务端 → 用 2.1.x 老 App 验证 → 提交内测 → 真人验收 → 双端正式发布。
- 实现者自己部署 Preview 并跑完验收清单；不得跳过 Preview 直接发 Production。
- 通宵运行无阻塞节点：只有人能做的事写进 `PROGRESS.md` 的 HUMAN TODO，运行终点是 Preview 验收清单完成；Production 与商店提交次日由人做。
- 发布后 48 小时盯连接遥测与崩溃率。

## 11. 非目标（3.0 不做）

- Grok Bot 或任何第四个后端；多 Agent 群聊；远程推送；Relay 侧活动摘要；试用；手动定价；macOS Catalyst 发布（脚本保留，不在验收范围）；Hermes 的工具 / 渠道 / 节点 / 日志；YouMind 的一切非聊天功能；v1 协议代码的删除。

## 12. 关键数据（PostHog 项目 337268，2026-03-10 → 09-04）

- 月活峰值 1,597（4 月），8 月 627；周活 856 → 111。
- 54% 的装机用户从未连上后端；这是首启引导必须重做的原因。
- 65% 的发送者会切换会话；切 21 次以上的 18% 用户贡献 71% 的发送。
- 已连接用户中 35% 碰过 Hermes；同时连 OpenClaw 与 Hermes 的用户留存 68%，人均发送 122 条。
- Hermes 用户人均发送只有 OpenClaw 的 22%；8 月 Hermes 用户人均保存 2.9 次连接配置。
- 付费：2,389 人看过付费墙，342 人点订阅（14%），180 人购买（点→买 53%）；多连接是最强触发点（53 单）；曝光越多购买率越高（1 次 1.1% → 11 次以上 19.7%）；52% 的买家在装机当天购买。
- Android 占 8 月用户 42%，但结账失败率 73%（iOS 58%），需单独排查 Google Play 配置。
- 中文区用户约 54%，英语区约 35%。

## 13. 术语

| 术语 | 含义 |
|---|---|
| 连接 Connection | 一台后端实例的接入配置：`backendKind`（openclaw / hermes / youmind）+ `transportKind`（relay / local / tailscale / cloudflare / custom / https）+ 凭据。 |
| Agent | 后端里的一个人格。OpenClaw 一个连接有多个；Hermes 与 YouMind 精灵一个连接一个。 |
| 会话 Session | Agent 下的一条对话。OpenClaw key 形如 `agent:<id>:main`、`agent:<id>:slack:channel:<id>`、`…:cron:…`、`…:subagent:…`。 |
| 主会话 main | Agent 的持续线程，花名册一行点进去的目标。 |
| 运行 Run | 一次 Cron 执行或一次子 Agent 执行；在线程里以卡片出现，不进花名册。 |
| 需要你 Attention | 审批请求、Cron 失败、会话错误、配对请求。 |
| 能力矩阵 Capabilities | 适配器声明的布尔能力表；UI 只按它显隐。 |
| 第 0 档 | 未读只在当前连接内本地计算的策略。 |
| HUMAN CHECKPOINT | 规格里允许实现者停下等人的唯一位置。 |
