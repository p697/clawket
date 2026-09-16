# PROGRESS · Clawket 3.0 进度日志

> 实现者维护。每次开工先读；每完成一个里程碑更新。人类只读这一份文件了解进度。


## 付费墙文案与视觉重心（2026-09-16）

聊天优先续改：负责人选定通用标题「和你的 Agent，聊得更多」/「More conversations with your Agents」，同步全部 19 语言，完整聊天/任务记录移至第一条权益，其次连接与 Agent 数量、人格记忆、OpenClaw 管理。继续不显示副标题；连接等专用场景、免费聊天、购买与布局不变。验证：完整 `check:required` 通过（Mobile 278 套 / 2,811 测试，19 语言和文档检查通过）；未操作模拟器。

真机反馈续改：负责人认可整体效果，要求去掉通用版与权益重复的副标题。通用入口（顶部 Pro、设置、启动与 App 图标的通用展示）现在只有标题和四条权益；情境边界说明与购买状态提示保留。删除全部 19 个目录中的废弃副标题，释放高度继续分给猫头。完整 `check:required` 通过（Mobile 277 套 / 2,807 测试、19 语言与文档检查）；未操作模拟器。

负责人选定 A 版通用文案并授权完整落地，真机验收由负责人完成。通用版改为「在手机上，管理更多 Agent」，Agent 入口说明默认 Agent 的免费边界；文件编辑独立于日志标题，管理与日志明确 OpenClaw 范围，搜索与用量去掉过度承诺。简繁中文与英文完整修订；新标题和 Agent 按钮补齐 19 个语言目录。保留套餐、购买/恢复、会员管理和续接语义。

布局将原先价格卡上方的弹性空白移入猫头区域，权益到价格固定 32 pt；所有内容继续在同一滚动容器中，保留大字号换行及现有减少动态效果支持。偏离旧 §2 的固定英雄图/三条权益/价格按钮方案属于负责人明确授权的展示细节，已同步付费墙规格、Mobile AGENTS 与设计指南。

验证：完整 `npm run check:required` 通过（Mobile 2,806 测试、189 个 UI 源文件、19 语言严格检查与文档门禁）；付费墙定向 3 套 / 70 测试通过，覆盖中文各入口、购买回调、会员与大字号，类型与设计检查通过。未启动模拟器、操作真机、刷新配对或部署；真实视觉效果由负责人通过 HT-PAYWALL-COPY-0916 反馈。

## 花名册排序改为「只看有人参与的最近活动」（2026-09-16）

- 负责人反馈 Agent 列表顺序「换来换去、没有逻辑」。核对代码：花名册分两层排序，`aggregateRoster` 按 attention > 未读 > 全会话 `lastActivityAt`，`buildRosterRows` 再按 置顶 > attention > 未读 > **主会话 `updatedAt`** 重排，最终生效的是后者；未读 = `主会话.updatedAt > 本地水位线`。而 OpenClaw 的 `updatedAt` 是 session 记录的最后写入时间，心跳轮询、模型切换、run 准备 / 收尾、用量投影都会推高它；OpenClaw 自己刻意区分了 `lastInteractionAt` / `lastActivityAt`（心跳与内部事件 run 明确跳过，`session-store.ts` 注释原文 "so heartbeat/internal-event runs do not re-flag sessions unread"），官方 UI 的 unread 用的是这两个字段，Clawket 的 `SessionInfo` 没建模它们。本机实证：`~/.openclaw/openclaw.json` 配 `heartbeat.every: 2h`；`codex-operator` 主会话 40 次 `[OpenClaw heartbeat poll]`，`updatedAt` 停在最后一次心跳而两个活动字段皆空 → 每次心跳 Agent 跳顶并标未读。另三处放大「随机感」：只有活动连接 + `live` 才享有未读 / attention 置顶权，适配器一离开 `ready` 来源翻成 `cache` 权重清零、恢复再回来；打开某个 Agent 即消未读、掉到所有未读 Agent 之下；两层对「活跃」口径不同（全会话 vs 主会话）。
- 负责人判断并决定：界面是聊天列表的形态（头像 / 名字 / 预览 / 时间 / 未读数），用户带的是聊天列表预期——顺序 = 最后一条消息时间、置顶 = 手动；PostHog 2.0 近 60 天约 1,129 人打开 App、`agent_save_tapped` 仅 14 人、`gateway_connect_saved` 135 人，列表通常 1–4 行，优先级排序省不了找的时间，只让位置变。新规则：**Agent 级手动置顶 > 最近一次有人参与的活动时间降序**，同一连接相邻、连接组也按最近活动；未读 / 需要你只做徽标；「有人参与」= 主会话 / 直聊 / 群 / 渠道会话（子 Agent 与 cron 是后台工作，不计入）。
- 实现：`@clawket/agent-protocol` 增加可选 `SessionDescriptor.lastActivityAt`（`null` = 从未有人参与；未设置 = 退回 `updatedAt`）、`sessionActivityAt()` 与 `HUMAN_SESSION_KINDS`，分支覆盖 100%。OpenClaw 适配器 `resolveOpenClawActivityAt` = `max(lastInteractionAt, lastActivityAt)`，整张列表都不带这两个字段（2026-07 前的 Gateway）才回退 `updatedAt`；Hermes 取 `updated_ts`（Bridge 不会为 housekeeping 写它）；YouMind / 本地模型沿用回退。`roster-cache` 归一化透传并校验该字段（旧缓存无字段 = 未知，下次在线刷新即补齐），`compareAgentSummaries` / `compareConnectionGroups` 只剩活动时间 + 名字 / 创建时间；`buildRosterRows` 删掉第二个比较器，只把置顶 Agent 提到组首；`unread-watermarks` 的未读判定、`lastActivityAt` 汇总与 `markOpened` / `markPromptSucceeded` / `markManyRead` 全部改用活动时钟，汇总只数 `HUMAN_SESSION_KINDS`；花名册行右侧时间、置顶会话行、搜索结果时间、Thread 已读水位线同源（`SessionInfo` 与 `mapAdapterSessionPatch` 透传 `lastActivityAt`），心跳不再触发重复 markRead。缓存态与在线态顺序由此天然一致，无需再保留上一次顺序。
- 验证：`agent-protocol` Vitest 30 tests（新增 `descriptors.test.ts`）；Mobile `tsc` 无错；Mobile Jest 277 suites / 2,794 tests 通过，其中新增 / 改写：`roster-cache`（人参与活动排序、心跳只推 `updatedAt` 不动位置不标未读、子 Agent / cron 不计入、live 与 cache 同序、缓存往返含 `null` 与畸形值拒绝）、`unread-watermarks`（活动时钟判未读、汇总只数人参与会话、Gateway 时钟超前时以活动时间落水位）、Roster `model`（置顶提升 + 沿用注册表顺序、cache 与 live 同序、置顶会话行时间）、`gateway-adapters.recorded`（当前 Gateway 心跳会话 → `null`、cron 输出计入、v1 列表回退 `updatedAt`、Hermes 镜像 `updatedAt`）、`ThreadScreen`（housekeeping 推 `updatedAt` 不重复标已读）、`adapterChatMapping`。`00` §首屏、`04` §2、`apps/mobile/AGENTS.md`、`packages/agent-protocol/AGENTS.md` 同步；偏离表 `[UX-2026-09-16-roster-order]`。未开模拟器；真机验收见 HT-ROSTER-ORDER-0916。

## 更新公告与更新日志恢复（2026-09-16）

- 负责人反馈更新日志页只剩 3.0.0 两条付费墙文案、看不懂逻辑，2.0 历史丢失。核对：M5 重写 `releases.ts` 时因视觉系统禁用 emoji 图标整体删掉了 1.1.0 → 2.1.0 共 9 版 21 条；`ThreadScreen` 只在 Debug 下加载公告且 `announcementVisible` 永远为 false，`shouldShow…` / `markShown…` 无调用方；06 决定的「3.0 + Pro 介绍页」`showThreePointZeroIntro` 有实现和测试但无任何页面调用；M6 接的启动付费墙在 09-11 检查点已移除。结论：升级到 3.0 的用户什么都看不到。PostHog（真机）：近 30 天活跃约 550，2.1.1 / 2.1.0 各 326 / 208；升到 2.1.1 的来源里 27 来自 2.0.0、14 来自 1.7.0，跨版跳升普遍；4 月 10 天发 4 版是「打扰」的真实来源；2.0 公告与日志页都没有埋点。2.1.2（08-27 仅改版本号）没有真机升级记录，未收录。
- 负责人决定：公告优先于启动付费墙、废掉 3.0 介绍页、不把「旧页面去哪了」写进公告而是讲「全新升级」、弹层要好看并放大会动的猫头。实现：`releases.ts` 恢复全部历史（含 2.1.1 静默修复、修正 2.1.0 日期为 04-17、emoji → 有界 Lucide 词表、动作只剩 `none` / `open_url` / `open_paywall`）；3.0.0 改为英雄文案「Meet Clawket 3.0 / 全新的体验、界面与产品」+ 五条（所有 Agent 一屏看全 / 会话面板 / 全局搜索 / OpenClaw 与 Hermes 并肩 / 全新视觉）；负责人看过第一版后要求：删掉末尾 Pro 条目、「全新首页花名册」改名、每条描述压到中文一行且小学生能懂，已按此改写 6 键 × 19 语言；`app-update-announcement.ts` 新增「上次公告版本」基线：跳版合并最多 3 版、2.x 升级只弹当前版、全新安装（初始化时无连接）只写基线不弹、显示即打标、存储失败不阻塞启动；弹层移到根层 `AppUpdateAnnouncementSheet`（92% 单档、148pt `curious` Companion、display 标题、条目列表、footer Continue），由 `resolveStartupNavigation` 的 `show_update_announcement` 在花名册渲染 + ready + 审批扫描新鲜后触发并消耗 `launchPaywallShownThisProcess`，付费墙 / 外链在 `onAfterClose` 续做；开发者分组 Debug 下新增「预览更新公告」；更新日志页恢复全部版本，条目不可点。删除 `showThreePointZeroIntro` / `threePointZeroIntro` 模式、`THREE_POINT_ZERO_INTRO_CONTENT`、`onCompleteIntro`、`paywall_launch_*` 事件与 6 个介绍页 `common` 键；Thread 内的死公告状态机一并移除。新增埋点 `app_update_announcement_shown / closed / entry_tapped`、`release_notes_opened`（`version` 规范化为 `x.y.z`，否则 `other`）。i18n：`chat` 新增 53 键 × 19 语言（6 种沿用 2.0 译文、13 种新译），`config` 新增 1 键；`DYNAMIC_KEY_ORIGINS` 登记 7 处动态调用；`releases.test.ts` 校验每个文案键在 19 种语言都存在。
- 验证：`releases` / 服务 / 弹层 / 条目列表 / 启动决策 / 付费墙 / 账户设置 / Thread / 埋点 26 个套件 226 tests 通过；mobile `tsc` 无错；完整 `npm run check:required` 通过：Mobile 277 suites / 2,778 tests、全部 workspace 类型与自含测试、`check:ui-style` 189 文件、19 语言严格 i18n（1,298 keys / 24,662 translations，missing / removable 均 0）、docs 检查。未开模拟器、未部署、未动配对；效果由负责人真机验收（HT-WHATSNEW-0916）。

## 杀进程后工具回复重复（2026-09-16）

- 负责人反馈仍重复后明确授权模拟器。通过已连接 Metro 的手机只读读取目标缓存，确认两条正文完全一致，但旧副本 ID 与时间均晚 4,622ms，且 `historyMessageId` 指回自身 `h_` ID；这不是上一轮覆盖的“仅显示时间改变”。把这两条实际缓存放入 iPhone 17 模拟器后重现双气泡，补充同用户轮次、精确正文、60 秒有界兼容后，真实 Lucy 历史加载消除副本并写回单份缓存。
- 另在真实 `chat.history` 发现工具轮次含导入分段与 `cli-assistant:<sendKey>` 累计全文两个表示；仅 OpenClaw 在确认同一用户发送键、完整 CLI 分段已覆盖全部文本时省略累计副本，保留工具顺序与 usage，不省略增量文本、附件或不完整页。协调在缓存合并后执行，Hermes 不受该规则影响。相关回归 7 suites / 203 tests、v1 兼容 39 tests 通过。模拟器修复后连续两次杀进程重进，AX 均确认目标回复 1 条、旧副本 0 条、重复累计全文 0 条；持久化缓存同样确认清理完成。未向 Lucy 主会话发送测试消息，未清空缓存、更新配对或修改后端。新版 Device Hub 的滚动工具报 `noWindowsAvailable`，手动翻页未完成，翻页保护仅有自动化验证。
- 本轮 Mobile 类型检查首次通过；`check:required` 随后停在同时改动的 roster-cache / ThreadScreen 未读字段测试（275 suites 通过、2 suites 失败）；复查这两套和适配器共 86 tests 已通过。最终类型复查又被并行修改中 `gateway-adapters.recorded.test.ts` 的 `updatedAt` 参数与新时间字段类型不符阻断，不能记为全仓门禁通过。证据目录 `evidence/history-restart-simulator/`；私有会话/缓存样本仅留在被 Git 忽略的证据文件中。
- 只读检查本地 OpenClaw main session SQLite transcript：截图对应的 12:47 助手正文仅有一个记录；未修改会话、发送测试消息或读取认证表。没有手机缓存，不能证明当次缓存的具体 ID，但已在测试中复现客户端两条重复路径：`stream_segment_` 未被旧去重识别；历史 `h_` ID 搭配保留的流式展示时间，超过两秒后与原始记录并存。
- UI 和持久化缓存保留 `historyMessageId`，独立于展示 ID/时间；旧缓存通过确切历史投影 ID 或有界一对一匹配兼容。已知不同用户轮次不互相确认；保留旧 Gateway 分页相对 ID 的缓存来源，向上翻页也不恢复已确认副本。未改变连接、重连、发送及工具协议。
- 修正上一轮前台刷新回归测试：显式模拟失焦→聚焦，配合目前“首次挂载不重复刷新”的实现，不改变生产策略。相关 7 suites / 198 tests、v1 兼容 39 tests、Relay/Bridge 自包含测试、设计/i18n/文档检查通过。`check:required` 被同时修改中的更新公告页面/服务类型错误阻断；单独 `test:required` 的 Mobile 结果为 271 suites 通过、4 suites / 14 tests 失败，位于 SupportScreens、Paywall/model、app-update-announcement、AccountSettings/section-model，不能记为全仓门禁通过。日志在 `evidence/history-restart/`；真机验收见 HT-HISTORY-RESTART-0916。

## 帮助中心内容修正（2026-09-16）

- 按负责人核查结果修正帮助中心：OpenClaw 更新改为 `openclaw update`；LAN / Tailnet 配置补 `gateway.mode=local`、显式关闭 Serve 和准确 `allowedOrigins`，保留 Serve loopback；示例要求合并现有配置、替换地址及强令牌，并用带 URL 的 `pair local --backend openclaw` 生成 QR。
- 配对补齐 OpenClaw / Hermes、主机 Node.js / npm 前提及码 / QR 步骤。新增双后端 Bridge `status` / `doctor` / `logs --follow` / `start` 排障；区分 Relay 与直连端口、配置与 SecretRef；断线指向当前连接页的重连 / 恢复和主机 Bridge 重启，失效配对码指向重新配对。13 条新文案同步全部 19 语言，移除对应失效键。
- 验证：帮助中心 SupportScreens 11 tests 通过（含 3 种 JSON 配置及命令复制）；19 语言严格检查通过；设计系统检查通过；`check:docs` 6 对说明文件及 5 tests 通过。`check:required` 全仓类型检查通过，但停在 Mobile 测试：274 套通过、1 套失败（2761 tests 通过、1 失败）。失败为 `useChatController.queue.test.ts:341` 的前台历史刷新时序测试，单独重跑同样失败（37 通过 / 1 失败）；不属于本次修改的帮助逻辑，仍需另行修复，不能记为全仓门禁通过。未执行配对、更新或重启命令，未改动运行中的连接。
- npm 发布顺序由负责人把控：先发布 npm，再发布 App；本次不改发布配置、不发布。

## 工具分段收尾与首发消息保留（2026-09-16）

- 负责人反馈：一次首发用户消息消失，后续发送顺滑；工具调用间的文本在流式结束后闪动并合成一条。已确认客户端 `run_finished` 会清掉流式分段，历史协调还会把同一轮多条助手消息替换成单条 final；这不是 UI 必须遵循的 Gateway 协议行为。
- 完成、失败与中止时把已显示文本段及工具原子转入 history，保留各行身份、顺序和内容。文本段记录其前置工具数量，修正多工具间按数组下标交错的问题；累计 final 仅去掉明确重复的顺序前缀。同一用户轮次内协调 stale/split/aggregate 历史，更新工具结果但不折叠段落，保留额外服务器内容；历史中的文本先于同条记录内的工具。旧刷新回调不再清掉新 run。
- 对偶发消失无法证明真机那次的唯一原因，但重现并修复两处风险：首轮服务端 hydration 不能连同旧缓存一起清除刚发消息；旧的同文消息或显式冲突的发送键不能被当成本次回执。延迟缓存恢复也保留期间新添的本地消息。
- `npm run check:required` 通过：Mobile 275 suites / 2,757 tests，含 OpenClaw/Hermes 批量 chunk→多工具→累计 final→历史的顺序/身份断言，首轮 hydration、重复短句、迟到刷新回归；类型、各 workspace 协议/自包含测试、设计、i18n、文档门禁通过，收尾清理后类型检查再次通过。证据目录 `evidence/turn-continuity/`，实现记录见 `16-composer-upgrade.md`。未启动模拟器、操作手机、修改外部 Gateway/Hermes 源码或部署。


## 档案页头部两处细节：后端进头像角标、去掉重复的连接名（2026-09-16）

- 负责人真机截图：名字「Lucy」下面又一行「lucy · OpenClaw」（连接名与 Agent 名同名、后端专门占一行不值），「身份」卡下面还有一个「lucy」分节标题。两处按负责人的 (c) 方案处理：后端改为头像右下角 24pt 圆角标（`surfaceFloating` 底、2pt `canvasGrouped` 描边、`PlatformMark` 官方图标 20pt；OpenClaw 龙虾 / Hermes 官方 App 图标 / 本地模型显示器图标；无障碍名为后端名；Pro 锁定的 Agent 仍只显示锁角标），灰字只在有心跳（`Active {{age}}`，去掉后端前缀）或 YouMind 邮箱时渲染，其余情况整行不渲染；连接组分节标题删除，连接组直接跟在身份卡后。
- 代码：`model.ts` `identity.detail` 改为可选（只承载后端给的账号信息）、新增 `identity.backend`，`AgentSettingsGroupDescriptor` 去掉 `title`；`AgentSettingsScreen.tsx` 新增 `agent-settings-backend-mark`，`SettingsSection` 不再渲染标题。`04-app-screens.md` §5、偏离表 `[UX-2026-09-16-hero]`、`apps/mobile/AGENTS.md`、`design-system.md` 同步。
- 验证：AgentSettings 4 个套件 59 tests 通过（模型、深 / 浅渲染、分栏），`tsc` 无本页错误。按负责人要求未开模拟器；效果图（现状 / OpenClaw / Hermes 三机 + 角标 2× 放大 + 心跳变体）发在 https://claude.ai/code/artifact/a0b08418-5d2b-40c0-8c3f-94d824784e3e ，真机验收与「Hermes 角标裁圆 / 角标 24pt 还是 20pt / 单 Agent 心跳灰字去留」三个点留给负责人。
- 同日负责人看过效果后追加两点。(1) Hero 再压一点：头像上方减 8pt、名字下方减 4pt（`profileHero` 改为 `paddingTop: Space.sm` / `paddingBottom: Space.md`）。(2) OpenClaw 管理菜单「配置 / 权限 / 诊断结果」三个入口用户看不懂、没有点进去的欲望：2.x 数据里这个 hub 有 1,919 人（Settings 用户的 48%），查看配置 710 人、一键修复权限 311 人、创建备份 71 人、恢复 9 人，都靠 2.0 的「标题 + 一句说明」行；3.0 改成一张 comfortable 卡四行，每行图标 + 标题 + 一行 caption 说明（`OpenClaw config` / `Permissions` / `Diagnostics` / `Back up OpenClaw config`，中文「OpenClaw 配置 / 权限 / 状态诊断 / 备份 OpenClaw 配置」，说明文案见 `04` §5 表；负责人看过第一版后要求再简化——「把用户当小学生或初中生」，四句改成「查看和修改 OpenClaw 的全部设置 / 看 Agent 能不能上网、执行命令，一键修好 / 给 OpenClaw 做个体检，有问题自动修 / 存一份在手机上，改坏了能还原」），行尾只放免费拿到的数字：本屏收到的待处理执行审批（红点 + 数），最新还原点距今（`backups.list()` 是本机存储，菜单与离线都可读；`loadTab` 对 backups 不再要求在线）。不在菜单上读配置 / 权限 / doctor。5 键 × 19 语言（`config`），zh-Hans / zh-Hant / ja / ko / de 的 `Diagnostics` 从「诊断结果」改为「状态诊断」（2.0 命名）；`i18n-prune` 注册表加 `OpenClawManageScreen.tsx` 的 `formatted.key`。`OpenClawManageScreen` 13 tests（新增菜单文案与本地值用例）、`i18n:check` strict、`check:ui-style` 190 文件通过。效果图更新到同一 artifact。

## 模型页重做：找回 2.0 的模型管理，去掉空壳 Tab（2026-09-16）

- 负责人截图指出 3.0 模型页「模型 / 提供方」两个 Tab 点了没变化、点模型只见勾号不知含义、2.0 的管理功能全丢。核对代码：迁移表写的是「`ModelsScreen.tsx` 迁移到 `AgentSettings/Models`」而非删除，PROGRESS 也没有偏离记录，属于迁移只做了一半；「提供方」Tab 与「模型」Tab 渲染同一份分组，只把勾号换成多数模型没有的成本价格；OpenClaw 下 `getSelection()` 不带 sessionKey 读的是 `agents.defaults.model`，点行却 `sessions.patch` 写主会话，重进页面勾号回跳。
- 依据 2.x PostHog（2026-03-10 起）：模型页 904 人；白名单开关 201 人、保存主模型 / 备用 / 思考等级 156 人（112 人配过备用、116 人设过思考）、删除 79 人、新增 51 人、成本编辑 16 人。前四项保留并放回一级，成本编辑降级到详情弹层，Provider 增删（2.0 也不支持）继续指向配置编辑器。
- 协议：`Capabilities.modelManage`（可选精化，OpenClaw true，Hermes / YouMind / local-model false，缺省失败关闭）；`ModelsOperations` 加性新增 `getCatalog / saveCatalog / addModel / inspectDeletion / deleteModel / setCost` 与 `ModelCatalogState` 等类型；mock 适配器补默认实现，vitest 25 tests、分支覆盖 100%。
- OpenClaw 适配器：`utils/model-catalog.ts` 合并 `models.list` 目录与 `config.get`（显式 provider、配置模型、成本覆盖、白名单、默认值），`buildModelCatalogPatch` 把默认值与白名单合成一次 `config.patch`（空备用写 `null` 以真正清空；有白名单时自动把主模型与备用加入）；加模型 / 成本 / 删除复用 2.0 留下的 `model-cost-config.ts`、`model-config-delete.ts`（此前是死代码）。Hermes 与 local-model 不改：仍只有全局 `setSelection`。
- Mobile：`ModelsSection` 删除，改为独立页 `ModelsScreen` + `ModelDetailSheet` / `ModelProviderSheet` / `FallbackModelsSheet`，结构见 `04-app-screens.md` §5「模型页」。页面读写统一为 Agent 默认模型作用域；输入框选择器仍是会话作用域。`section-model.ts` 里 `models` 的三条描述符行从不渲染，本次未动。
- 文案 42 键 × 19 语言（`settings`），`i18n-prune --strict` 通过；`check:ui-style` 190 文件通过；`tsc` 通过。测试：`models-model` 8、`ModelsScreen` 7、`model-catalog` 4、适配器目录用例 1、`AgentSettingsSectionScreen` / `section-model` 改为 mock `ModelsScreen`。同时段另一会话在改 Usage 页，`AgentSettingsSections.test.tsx` 的两个 usage 用例失败与本次无关。
- 按负责人要求未启动模拟器与真机；真机验收记 HT-MODELS-0916。留给负责人的两个点：目录行未放 24pt 厂商图标（沿用「颜色只在头像上」）；成本编辑保留在弹层还是砍掉。
- 真机发现：删掉一个备用模型后 Save 被 Gateway 拒绝——`config.patch` 对缩短或删除已有数组要求在 `replacePaths` 里点名该路径（OpenClaw `docs/gateway/configuration.md`，2026.6 起）。修复：`buildModelCatalogPatch` 返回 `{ patch, replacePaths }`，只在当前配置已有 `agents.defaults.model.fallbacks` 数组且本次改写它时附带 `['agents.defaults.model.fallbacks']`；`GatewayClient.patchConfig` 新增可选第三参数，未传时请求体与旧版完全一致。模型列表 `models.providers.*.models[]` 走 Gateway 的 ID 合并，不需要 consent；删除模型仍用 `config.set` 整份替换。补 `model-catalog` 1 例、适配器 1 断言。
- 同日负责人追加：模型页要进付费墙。新增 `ProFeature` `modelManage`（付费墙 hero `manage`，标题「决定你的 Agent 用哪些模型」，动作「管理模型」，2 键 × 19 语言 `common`），`ModelsScreen` 用一个 `requirePro(write)` 包住所有写动作：开关、换默认 / 当前模型（选到不同模型才拦）、备用增删排序、思考等级、加模型、成本、删除；免费用户看到的是真实数据和可用的控件，点到写的那步弹墙，continuation 原地续做，开关不假动。聊天输入框的会话级切换保持免费，与 `00` 的「模型切换保持免费」以此为界，记入偏离记录。`ModelsScreen` 新增 2 个免费用户用例（OpenClaw 三处拦截 + 续做后保存；Hermes 选回原值不拦、选新值拦）。

## 付费墙改为最后一步拦截：OpenClaw 管理与运行日志（2026-09-16）

- 负责人截图指出 OpenClaw 管理 → 权限页对免费用户只剩一条「此智能体需要 Pro / 查看 Pro」横幅，四个分段都是如此；「日志」行在主页就被锁住、名字也没有付费吸引力。对照 2.0：权限 / 诊断页是进入即 `requirePro` 退回，备份页列表可见只拦恢复，日志页用 `expo-blur` 的 `ProBlurOverlay` 盖住整列。3.0 重建时这些都退化成了横幅。
- 新增共享 `components/pro/ProGate`：真实内容降透明置于向页面底色渐隐的 SVG 遮罩下（不引入 `expo-blur` 等原生模糊依赖，设计系统也禁止产品 chrome 用 live blur），遮罩内容不可点、不进无障碍树；下方锁形图标 + 一句功能说明 + 命名功能的解锁按钮。3 项组件测试覆盖无遮罩、遮罩隐藏语义、深色与自定义底色。
- OpenClaw 管理免费用户改为预览模式（`preview = !isPro && !permissionDenied`）：四个分段照常加载真实数据；配置展开 key 时 JSON 在遮罩下、编辑弹墙；权限三项状态可读，详情行 / 规则组（遮罩）/ Repair Now 弹墙；诊断免费运行，摘要与前 2 项可读，其余项遮罩且标题写数量，详情 / 尝试修复弹墙；备份列表免费，创建与恢复确认弹墙。所有被拦动作带 continuation，购买 / 恢复后原地续做（含恢复确认表里的具体备份）。锁定 Agent（`permissionDenied`）仍整页走 `agents` 门，原横幅只保留给这一情形。
- 日志：主页行与页标题由「日志」改为「OpenClaw 运行日志」（`logs` 能力只有 OpenClaw 为真，Hermes / YouMind 不显示此行），行不再上锁；页内免费用户看最新 3 条，后 4 条在遮罩下，非 Pro 不做 2 秒轮询，刷新按钮可用，解锁按钮走 `logs` 付费墙。
- 文案 13 键 × 19 语言（`config` 9 键、`settings` 4 键），`i18n:check` 严格通过；`check:ui-style`（184 文件）、`check:docs` 通过；`tsc` 在改动文件无错误。规则写入 `apps/mobile/AGENTS.md`「Agent management navigation」、`docs/design-system.md`（`ProGate` 原语与 OpenClaw management 段）、`04-app-screens.md` §5 与 `06-paywall-and-growth.md` §3「最后一步拦截」。
- 测试：`OpenClawManageScreen` 新增免费预览用例（四分段加载、遮罩、各拦截点与续做），`LogsSection` 新增免费 3 条 + 遮罩 + 不轮询与空日志仍显示门两例，`model` / `section-model` / `AgentSettingsScreen` 旧的「日志行上锁」断言改为进入页面；Mobile 完整套件 271 suites / 2,704 tests 通过。按负责人要求未操作模拟器与真机，视觉与真实购买续做验收记 HT-PAYWALL-0916。
- 负责人真机复看后的两处细节（2026-09-16 同日）：分段加载中的 Companion 由贴在页头下改为视口居中（ScrollView 内容 `flexGrow: 1`；Roster / Thread 本已居中，其余页面用骨架不受影响）；「备份」入口与页标题改为「备份 OpenClaw 配置」，页首加一段带 Archive 图标的说明（备份存在手机上、一键恢复），按钮改「创建备份」，空态改「还没有还原点，改配置前先创建一个。」，`Backups` / `No backups yet` 两个旧键从 19 语言删除，新增 4 键。
- 未做（留给负责人决定）：真高斯模糊需要重新引入 `expo-blur` 原生依赖并按 `engineering-baseline.md` 走 prebuild / pod / 双端构建，本次用无依赖遮罩替代；其他付费墙触点（连接、Agent、搜索详情、文件保存、技能源码保存、Session 预览）本次只审阅未改动，建议见本次会话报告。

## 身份页真实写入核对：emoji 走 Agent 记录、气质多行、头像不再编辑（2026-09-16）

- 核对 OpenClaw Gateway（`src/gateway/server-methods/agents.ts`、`gateway/assistant-identity.ts`、`agents/identity-file.ts`）：`agents.update` 接受 `name` / `emoji` / `avatar`，写入 `agents.list[].identity` 并把这几项按行合并回 IDENTITY.md；解析身份时配置记录优先于 IDENTITY.md；`vibe` 没有记录字段，只存在于 IDENTITY.md（随工作区引导文件进入系统提示）。
- 发现并修复：App 之前只把 emoji 写进 IDENTITY.md、`agents.update` 不带 emoji——当记录里已有 emoji（如新建 Agent 时填过）时手机改 emoji 无效，且同次改名会让 Gateway 用旧 emoji 覆盖刚写的文件行。现在 name / emoji 一起走 `agents.update`（`AgentPatch` 加性新增 `emoji`），emoji 不再依赖 `fileEdit`。名字原本就正确；vibe 原本就正确落到 IDENTITY.md。
- IDENTITY.md 写入从「整文件按模板重生成」改为按行合并（`mergeAgentIdentityMarkdown`，对齐 Gateway 自己的 merge）：保留 Creature、Theme、Avatar 行与用户/Agent 写的其他文字；只有文件缺失时才生成模板；清空 vibe 会删掉该行。
- 气质改为多行 `FormTextInput`；IDENTITY.md 字段是单行，保存时把换行/连续空白折成一个空格。头像行从手机端删除（只预览；它是桌面工作区路径或 URL），App 不再向 `agents.update` 发送 `avatar`；19 个 locale 删除孤立 `settings:Avatar`。
- 已知 OpenClaw 限制：`agents.update` 把空 emoji 当作「不改」，所以手机清空 emoji 只会删掉 IDENTITY.md 的行，配置记录里的旧 emoji 仍会生效。
- 验证：identity-model 4 tests、IdentityScreen 8 tests、utils 全绿；`mobile:typecheck`、`check:design-system`、`i18n-prune --strict`、`check:docs` 在改动时通过。同时段工作树里其他会话的改动使 `AgentSettingsScreen.test.tsx`（logs Pro 门）与 `gateway-adapters.recorded.test.ts` 的 tsc 报错，与本次改动无关。未操作模拟器、手机或线上服务；负责人真机验收见 HT-IDENTITY-0916。

## 发消息到回复结束的视觉连续性（2026-09-16）

- 负责人真机反馈即时发送已有改善，但气泡宽高突变、消失重现。代码定位：待发态没有时间/状态占位且带独立说明与降透明；派发时插入元信息与时间分隔；入场缩放/淡入；列表复用重播动画；历史/最终回复更换列表 key；首个网络 chunk 到达但 pacer 尚未输出时思考占位提前消失。
- 待发、派发、确认采用同一布局：本地创建时间、原图片预览与尺寸、固定状态图标槽；排队仍位于列表尾部。`renderKey` 独立于后端 ID，只按确切 ID 或双侧唯一的 role/idempotencyKey 保留；等待、流式、结束回复与工具段保持各自身份。元信息提前留位，去掉气泡缩放、整条淡入与派发后的第二次滚动；会话级已播放记录防列表回收重播，测量 cell 不消费动画。
- 连接探测、重连、单次 prompt、失败暂停及模糊回执不自动重发策略保持。OpenClaw/Hermes controller 回归验证同一消息的时间/身份/滚动请求稳定，以及回复从等待到结束的身份连续；React 组件测试检查原生节点保留、空 paced text 仍显示思考、减少动态效果及 cell 重挂载。
- `npm run check:required` 通过，含 Mobile 275 suites / 2,747 tests、各 workspace 类型/协议/自包含测试、190 个 UI 文件设计检查、i18n 与文档检查；随后对回执身份双侧唯一性补充复核。日志：`evidence/send-motion/`。本轮未启动模拟器、安装构建、改配对或部署；原生帧时序与实际手感仍需负责人手机验收，见 HT-SEND-MOTION-0916。实现说明在 `16-composer-upgrade.md`。

## 发送即时反馈与连接保护解耦（2026-09-16）

- 已确认 OpenClaw / Hermes 共用发送预检，本地与 Relay / Tailscale / Cloudflare / custom 均在本地气泡出现前等待网络查询、必要的 health 探测与图片处理。1.5 秒快速探测失败还会进入至少 8 秒的重连等待；这解释了点击后不跟手，但不是实际网络故障的根因证明。
- 点击发送现在同步进入原有按连接/会话隔离的 outbox，立即清空本次输入并显示发送中气泡；预检、重连、8 MiB 帧保护、真实回执与不确定发送恢复保持原路径。预检/附件读取失败保留可编辑/重试气泡；请求发出后丢回执不自动重放。稳定消息 ID 避免同一气泡重复进入；后续草稿与附件不会被旧操作覆盖。
- 补齐等待期间切会话、换 adapter、卸载页面、删除待发消息、恢复时发现已有运行的保护；不引入并发 prompt。现有 outbox 仅内存跨页面保留，不声称杀 App 后持久离线投递。调研与取舍见 `16-composer-upgrade.md` 的即时反馈章节。
- 验证：最终 `test:required` 全绿（Mobile 271 suites / 2,704 tests，含 21 项新增发送回归；协议 25 tests / 100% coverage、Relay Shared 34、Registry 41、Worker 127、Bridge Core 39、Runtime 214、CLI 66、脚本 59）。183 UI 源文件设计门禁、19 locales / 22,705 translations、`check:docs` 与本次文件 `diff --check` 通过。`check:required` 的类型阶段仍被已有模型配置测试 `gateway-adapters.recorded.test.ts:249,265` 两处类型推断错误阻断；最终独立 Mobile typecheck 复核仍仅这两处，未修改该并行工作、未声称全仓类型全绿。全树 `metrics:loc` 已运行，数字含其他未提交工作，不作本次增量。
- 本轮没有启动模拟器、操作手机、改变配对、安装构建或部署服务。负责人真机验收见 HT-SEND-0916。命令日志在忽略目录 `docs/3.0/evidence/send-feedback/`；一次并行检查碰到设计检查临时目录清理与 Jest 扫描竞态，待设计检查结束后串行重跑 `test:required` 已通过。

## 用量页改版：图表回到 3.0 视觉、范围切换不再串数（2026-09-16）

- 负责人反馈：3.0 用量页退化成五组纯列表，量级不可读、费用为 $0 时仍铺四行 `$0.0000` 明细；切换今天 / 7D / 30D 没有任何加载反馈，连点后最终停在哪个数字取决于网络而不是最后点的档位。根因：每个返回都直接 `setState`，没有序号保护、缓存与骨架。PostHog（项目 337268，近 180 天 `$screen`）：2.0 Usage 5,193 次 / 1,241 人，是控制台子页里按人数第一（Files 989、Models 862），月人均 2–4 次。方案页 https://claude.ai/code/artifact/e98e83d3-2788-4739-a7fa-5847a7d62cdc，负责人按全部建议拍板（纯墨色图表、今天档显示近 7 天并高亮今天、恢复工具榜、海报入口移到页头分享）。
- 页面：英雄卡（主数字 + 次数字 + 四段 `SegmentBar` 构成条）、2×2 指标卡（消息 / 工具调用 / 会话 / 缓存命中）、`UsageBarChart` 趋势（今天档「近 7 天」默认选中今天，点柱子切换）、模型与工具 `ShareRow` 榜（前 5，带占比条；无工具调用时整卡不渲染）。删除每日日期列表、零值费用明细与页尾按钮，海报改从页头右侧 `Share` 打开。图表全部墨色（界面主题 `accent` 已是 `ink`），不新增 token；`resolveUsageMeasure` 只在 `cost` 能力为真、口径不是 unknown / included 且费用大于 0 时以美元领头，否则以 Token 领头。
- 加载：新 `useUsageDashboard`：以 adapter / Agent / 范围 / 起止日期为键的内存缓存（60 秒内不重复请求，更久静默刷新），屏幕只显示当前键的数据，另一范围的迟到响应只进缓存；未缓存范围立即显示同形骨架（柱数按范围）；首屏落地后顺带取 7D 作趋势上下文，再按作用域一次性预取其余范围；失败保留旧数据 + Retry `Banner`，无旧数据才显示错误；内容交叉淡入 200 ms、柱子 320 ms 从基线长起，减弱动效静止。两个后端共用同一份 `management.usage` 契约，费用内容按 `cost` 能力显隐，无后端分支。埋点新增 `usage_range_changed{ range, cached }`。
- 付费（同日第二轮，负责人要求「差点就看到」的蒙层而不是拦在入口）：今天档完整免费；7D / 30D 可切入，真实数据照常加载并渲染在 `ProGate` 六行蒙层之下（英雄卡与指标卡数字若隐若现、不可点、无障碍隐藏），锁 + 「看整周、整月的用量」+ 一句说明 + 全宽墨色「解锁用量趋势」按钮以 `usage` 原因弹付费墙；今天档趋势图里点过去几天的柱子也直接弹墙；购买后随 `isPro` 即时揭开。付费墙 `usage` 原因从通用文案改为专属：标题「看清每一个 token 花在哪」、副标题「7 天与 30 天的用量、费用与趋势属于 Pro」、按钮动作「查看用量趋势」、收益首条「7 天 / 30 天用量与费用趋势」（新增 `usage` 收益类别与 `ChartColumnIncreasing` 图标）。`usage_range_changed` 增加 `locked`。分段控件不加锁标、不禁用。
- 文案：新增 `Cache hit`、`Last 7 days`，付费墙 4 键（common）与蒙层 3 键（settings），19 locales；删除不再引用的 `Cost Breakdown` / `Daily Usage` / `Top Models`。文档：`04-app-screens.md` §5 新增「用量页」、`07-analytics.md`、Mobile `AGENTS.md` 与 `docs/design-system.md`。
- 验证：新增 `useUsageDashboard.test`（乱序返回不串数、预取一次、失败保留旧值、离线不请求）、`charts.test`（构成条 / 占比行 / 柱图点选）、usage-model 5 项与分栏 2 项；Mobile 全量 274 suites / 2,729 tests 通过；`tsc` 无错误；`check:design-system`（190 UI 文件）、`i18n:check`（strict，19 locales）、`check:docs` 通过；第一轮 `npm run check:required` exit 0（含全部 workspace 类型检查、Mobile 274 suites / 2,729 tests、Relay / Bridge 必需测试、190 UI 文件设计门禁、strict 19-locale 文案与文档检查）。第二轮（Pro 蒙层）后：`tsc` 无错误、Mobile 全量 274 suites / 2,735 tests、`check:design-system`（190 UI 文件）、`i18n:check`（strict，1,247 keys）、`check:docs` 通过；但重跑 `check:required` 在 `packages/bridge-runtime` 的 Hermes 套件上变红（10 文件 / 47 项，全部因为本机 `/usr/bin/python3` 在本轮期间开始返回「You have not agreed to the Xcode license agreements」，账本脚本无法启动；第一轮同一套件 27 文件全绿，本轮未改任何 Bridge 代码），属机器环境问题，记 HT-ENV-0916，接受许可后需重跑门禁再谈发布。未开模拟器、未提交；真机视觉验收留给负责人（HT-UX-0916 追加用量页：英雄卡 / 趋势图 / 骨架切换 / 深色）。

## 连接状态不再占布局：页头胶囊取代顶部横幅（2026-09-16）

- 用户反馈：任意页面压后台再切回，顶部都会先出现一块灰色「Offline · reconnecting / Reconnecting…」横幅把内容顶下去、再消失；要求不改变高度、更简洁优雅。调研结论：各页各自内联 `Banner`（Roster、Thread、Agent 主页与分栏、账户设置、搜索、消息详情、Session Panel、Cron 编辑器），除 Roster/Thread 外都不区分 20 秒恢复窗口，于是每次回前台都直接弹「离线 + 重连」。
- 新增共享 `ConnectionStatusPill`（`inline` 40pt `surface` 胶囊 / `floating` 浮起胶囊）：重连中呼吸文字无动作；离线 `WifiOff`、错误红色 `CircleAlert` 但底色保持中性；一个 600 动作词，整颗胶囊即 44pt 点击区；淡入淡出并尊重减弱动效。连接状态一律进页头：Roster 用空置的页头中央（窄位只放图标 + 动作词，完整状态进无障碍标签）；Thread 保留 `HeaderPill` 副标题，时间线顶部悬浮只带动作的胶囊（错误态带文案）；标题页由标题让位给胶囊、状态消失后标题回来；搜索与 Session Panel 没有可让位的标题槽，用内联胶囊领起列表。产品横幅（宽限、Pro、不支持、Bridge 升级、发送失败详情）保留 `Banner`；Logs/Tools/Channels 保留各自原位离线文案。
- 给 Agent 主页/分栏、搜索、消息详情、Session Panel、Cron 编辑器补传 runtime `recovering`，恢复窗口内统一显示安静的「Reconnecting…」，只有持续离线或连接错误才出现动作词。`ScreenHeader` / `AccountSettingsPageHeader` / Agent 页头新增 `status` 槽。
- 验证：Mobile 完整套件 269 suites / 2,661 tests 通过（含新增 `ConnectionStatusPill.test.tsx` 10 项与各页头状态回归）；`tsc` 无错误；`check:design-system`（182 UI 文件）、`i18n:check`、`check:docs` 通过。未操作模拟器，未提交；真机视觉验收记 HT-UX-0916。

## 身份与文件的编辑入口合一（2026-09-16）

- 问题：Agent 资料页下「个性与记忆」→ 身份页（资料 / 我的信息 / 人格 / 记忆）与「Files」→ 文件页两处都能编辑 SOUL.md / MEMORY.md / USER.md，且两套弹窗交互不同。来源是 `00-decisions.md` §2 把「人格、记忆文件」写进身份行的同时又保留了「文件」行。调研：OpenClaw 自家 Control UI 把 identity 字段放 Overview、文件只在 Files 面板，服务端 `agents.files.list` 刻意剔除 IDENTITY.md；2.0 Agent Detail 也只有名字 / emoji / vibe / My Info，「Memory」格子直接开文件列表；Hermes 只暴露 MEMORY.md / USER.md、`agentEdit=false`，旧身份页的「人格：未设置」是保存必失败的死路。2.x PostHog（2026-03-10 起）：Files 1,019 人、File Editor 612 人、Agent Detail 528 人、Agent User Info 243 人；612 名 File Editor 用户里 247 人从未进过 Agent Detail。
- 负责人决定：文件页是 SOUL / MEMORY / USER / AGENTS 的唯一编辑处；身份页只保留非文件的资料（名字 / emoji / vibe / 头像）与新建 / 删除智能体；「我的信息」结构化表单去掉。
- Mobile：`IdentitySection` 改为独立原生栈页 `IdentityScreen`（对齐 Cron 编辑器：`ScreenHeader` + ghost Save、`KeyboardAwareScrollView` 内联表单、头像预览随 emoji 草稿变化、`usePreventRemove` + `ConfirmationModal` 脏确认、写入后再放行导航；花名册刷新重建描述符不重置草稿）；`identity-model` 只读 agents.list + IDENTITY.md；删除 `utils/agent-user-profile.ts`；Profile 行改为「Identity」并按 `agentEdit || agentCreate` 显隐（Hermes 不渲染）；section-model 去掉 `identity.persona-memory` 行。文件页补齐原身份页独有的能力：`missing` 文件在可编辑时尾值「Create」并可直接创建（原来只有身份页能在 MEMORY.md 不存在时写入），不可编辑时保持「Missing」禁用；埋点 `identity_file_activity` 改名为 `agent_file_activity` 并移到文件页，`document` 为 agents / soul / identity / user / bootstrap / memory / other 有界枚举。文件页弹窗交互本身未改（负责人认为其体验更好），Skills 的 SKILL.md 弹层仍是 93% Markdown 样式，是否统一留给负责人决定。
- 文档：`04-app-screens.md` §5 新增身份页 / 文件页段落，`07-analytics.md` 新增 `agent_file_activity`，Mobile `AGENTS.md` 与 `docs/design-system.md` 的 Identity 段落改写；i18n 清理 10 个孤立 key（19 locales）。
- 验证：`IdentityScreen` 8 tests、identity-model 3、AgentSettingsSections 24、AgentSettingsSectionScreen / model / section-model 32、analytics events 全绿；`i18n-prune --strict`（19 locales，1,182 keys）、`check:design-system`（182 UI 文件）、`check:docs` 通过；最终 `npm run check:required` exit 0（Mobile 269 suites / 2,669 tests）。未提交、未部署；真机视觉验收留给负责人。

## 夜间反馈续查：连接竞态、旧工具缓存与空闲成本（2026-09-15）

- 已继续实际复现/修复，而非把剩余问题留作测试结论。Hermes 历史只传当前页的已确认工具 ID 映射，App 按角色/名称/ID 清理旧缓存副本；模拟器 H8/H9/H10 均恢复为一张已完成工具卡。
- Hermes 云状态查询增加 10 秒期限、取消与 socket 归属保护；旧查询不能关闭新连接，旧本地 socket 迟到帧不能进入新 Relay。失败/取消/重连有针对性回归，不增加重试。
- 明确零客户端时不再向云端转发周期 tick/health；保留实际消息、响应、本地健康与传输 ping/pong，兼容未知客户端数量的旧服务端。实测空闲 2 分钟 8 次 pong、无断线，云端无消费者丢弃事件从此前 10 条/分钟降至 0；仍保留已有状态探测。
- 新增真实 H11（35 秒工具 + 切 Lucy）、A4（Lucy 实际回复）、H12（QA Relay 重启后发送 + 冷启动）、H13（空闲后发送）；均各一条消息/结果。A4 发现的时间戳覆盖正文已用原消息截图修复验证。
- 本轮最终 check:required 全绿（Mobile 268 suites / 2662 tests，Bridge Runtime 27 files / 214 tests），compat 5 files / 39 tests；未跳过失败项。候选 CLI 本地安装并重启现有服务，Hermes 已由服务恢复为全局安装包；无云端部署或 npm 发布。
- 09:30 的多路共享网络中断尚未定位到具体上游，不能归咎手机或声称永不掉线。复杂工具的截断参数识别、原生附件选择器仍有覆盖缺口；不签署全量发布就绪。详情与最终验证/安装状态见 [续查记录](overnight-qa-2026-09-15.md#follow-up-investigation-and-fixes--0942-onward-jst)。

## 延迟夜间双后端实测与 Hermes 运行恢复（2026-09-15）

- 按用户要求延迟开工，实际 00:51–02:12 JST 操作模拟器；首条聊天 01:03。16 条实际消息（Lucy 6、Hermes 10）、2 张合成图片、6 次真实工具执行。覆盖切后端/Session、后台约 3 分钟、锁屏约 5 分钟、运行中杀 App、草稿、手动暂停跨冷启动、Hermes QA Relay 重启及 50 秒受控停顿。不是双真机或全网络认证。逐项证据见 [nightly report](overnight-qa-2026-09-15.md)。
- 修复三个明确问题：首次照片授权前先完整关闭 Add sheet，避免遮住 iOS limited picker；Hermes history 补现有协议的运行快照，防止运行中返回丢失工作态/停止按钮；运行中历史先以唯一名称/完整参数/时间匹配工具 ID，防止完成时新增卡片且旧卡持续转圈。保持取消/终止竞态保护，不加轮询或重试、不修改外部 Hermes。
- 真正复测：两图用户消息经切换/冷启动/重连仍一条；两次有意相同文字仍两条；停顿发送失败保留草稿、不自动重放，恢复后手动发送只一条；Hermes H10 在运行中返回、结束、App/Bridge 重启后都只有同一张完成工具卡。旧 QA H8/H9 的重复缓存未做猜测删除。
- 最终 check:required 全绿（Mobile 268 suites / 2659 tests；Bridge Runtime 27 files / 211 tests），test:compat 5 files / 39 tests。中间严格历史包测试因新增 idle 字段失败，显式增加该字段断言、保留历史 fixture 后全量重跑通过。
- 本机已安装候选 CLI，本地 Hermes Bridge 使用新包；未发布 npm 或部署云端。恢复普通 Metro，停止临时 HTTP/inspector 和模拟器 App，保留配对，暂停本轮 heartbeat。旧全局包有临时备份。
- 仍有边界：本地日志见 owner 1006/心跳超时后恢复，原因未隔离，不声称断线消失；文件选择器和 limited-picker 完整原生操作被 CUA AX/坐标问题阻挡，未标通过；不据此签署发布就绪。

## 权限与诊断等待反馈、管理列表一致性（2026-09-14）

- 本地 Bridge 日志中最近诊断请求均返回：约 13.4 / 14.0 秒、3 项检查；较早请求约 14.4 秒、4 项检查。证明本机命令仍可执行，不代表已验证真机收包。保留 Diagnostics，未修改 OpenClaw 或连接/Relay。
- 管理读取补 35 秒 UI 截止（协议原有 30 秒超时保留），同 adapter/section 去重；诊断首次及重新运行都显示明确 Companion 进度。迟到结果无法覆盖失败/重试；超时显示错误并允许手动重试，不自动循环。
- 无审批时隐藏 Pending Requests 整块；有真实 exec approval 时保留审批和过期判断。诊断原始报告移入 Details，保留结果、修复确认与付费门槛。
- Agent Profile 管理项、权限与管理入口复用账户设置 comfortable 行高与中性圆角图标；日志入口保留，回归其加载/过滤/分页等现有测试。视觉验收仍由用户真机完成，不占用其连接。
- 验证：check:required 全部通过（Mobile 268 suites / 2,657 tests、workspace 类型与自包含测试、设计/i18n/docs 门禁）；最终图标统一后再次通过 mobile typecheck 和管理/日志专项 17 tests。未提交或部署；真机收包和视觉由用户验收。

## OpenClaw 管理入口与配置浏览优化（2026-09-14）

- 用户明确授权取消 Advanced management 层级，研究 2.0 后优化管理交互。对比 d9c1ada 的 OpenClawConfigScreen：恢复按功能进入详情的导航方式，未搬用旧 Gateway 上下文或自动恢复当前协议未暴露的更新/重启操作。
- Profile 直接列出受能力和付费约束的管理项；OpenClaw 管理以完整宽度图标行展示四个功能，避免多语言 Tab 截断。仅进入选定栏目才加载，返回保留已加载结果；配置按顶层键折叠浏览，详细报告用 93% 可滚动 Sheet。
- 保留配置 hash 写入、二次确认、权限审批、诊断/修复、备份/恢复及 Pro 门槛；不触碰 OpenClaw/Hermes 连接或服务端。视觉验收按用户约定交给真机，不连接模拟器。
- 验证：required 中全部 workspace typecheck、自包含测试、Mobile 268 suites / 2,653 tests、181 个 UI 文件设计门禁通过；i18n 首次发现删除入口留下的孤立翻译 key，已同步清理 19 locales 并重跑 i18n strict 与 docs 全绿。最终管理页专项 17 tests 通过，git diff --check 通过。未提交、未部署、未操作设备连接。

## 本地模型引导：告知支持的模型服务（2026-09-14）

- 问题：Preview「Local model」配对步骤只给一条命令，未说明需先运行 llama.cpp / Ollama 等服务；CLI 在无服务时只输出 `fetch failed`；「No agent yet?」把 local-model 链到仓库根目录。用户决定不换电脑图标、不加问号。
- Mobile：步骤 01 复用 `SegmentedTabs` 槽位改为 llama.cpp / Ollama / Other 三选一，命令与一行灰字随之变化（Ollama 自动带 `--engine ollama --base-url http://127.0.0.1:11434`，Other 带 `--engine openai-compatible --base-url http://127.0.0.1:1234`）；「No agent yet?」不再列出 local-model（`ONBOARDING_WEBSITE_URLS` 收窄类型）；`bridge_offline` 的「See how to start it」改指 15-local-model.md。6 个 config key 加到 19 个 locale。
- CLI：`discoverLocalModelEndpoints` 抽为可测函数；连接拒绝/超时/非 OpenAI 兼容/空模型列表/未知引擎均给出含地址与 `--base-url`/`--engine` 建议的错误，新增 3 项单测。
- 验证：Onboarding 5 suites / 43 tests、CLI 10 files / 66 tests、`i18n:check`（19 locales × 4 namespaces、1,192 keys）、design-system 与 docs 门禁通过；本次改动的 Mobile/CLI typecheck 在改动时点通过。完整 Mobile 套件 266/268 suites（2,642/2,646 tests）通过，2 个失败（`AgentSettingsSections`、`analytics/events` 的 `identity_file_activity`）来自同时进行的 Identity 工作树改动，与本项无关；同一原因（`IdentitySection.tsx` 的 `AgentDescriptor.backendKind`）使 `check:required` 停在 Mobile typecheck，待该工作收口后重跑。本机 Ollama 用手机生成参数实测发现 3 模型、health 通过且 vision 识别正确；无服务时终端实际输出新的引导文案。用户真机确认效果后授权 README：中英 README 各新增「本地模型聊天（预览）」特性条目、「连接本地模型（预览）」小节（App 内开启路径、从源码运行的命令、三种服务的参数表、链接 15-local-model.md）和前置要求一行，行数保持对齐；`check:docs` 通过。核实 npm `@p697/clawket@0.7.0` 不含 `local-model`，App 内展示的 `npx @p697/clawket pair --backend local-model --preview` 需等新版 CLI 发布后才可用，记入 HT-LM-0914。

## 真机 Air 连接与带图消息重复（2026-09-14 夜间）

- 现场只读查手机运行态（重启前）、本地 Bridge/SQLite、Gateway 历史及 Preview 云日志；未操作模拟器、改配对或重启服务。Air 未开代理时对 Preview 两域名超时，用户开启代理后确认恢复；不能将 client socket 数量等同物理手机数量。
- 电脑重启附近有本机代理拒绝连接，13:00:30–32 UTC 的 channel/Production/Preview owner 心跳同时超时，云端确认 owner 丢失和恢复；此段证明电脑到 Relay 中断，未进一步证明是代理/上游/边缘中的哪一环。未通过加大心跳阈值或额外重试掩盖故障。
- 确认「你看 + 两张图」只持久化一次。修复 OpenClaw `:user` 事件标识与本地发送标识不一致导致恢复重复：仅识别本 App 生成的 key，保留精确身份匹配的附件，修复此前 OpenClaw 缓存后缀；不按相同文字吞并显式不同 key，不改 Hermes/外部 key。
- 修复 Roster 手动 Reconnect 误激活 iOS 原生下拉刷新造成大块顶部留白；独立使用 runtime reconnect 并合并连续点击。实际视觉由用户真机验收。
- 专项 4 suites / 105 tests 通过（新增缺陷回归先红后绿）；完整 `check:required` 全绿（Mobile 266 suites / 2,621 tests、Bridge Runtime 208 项及全部类型/设计/文档门禁）。本轮是 Mobile 修复，无服务端/Bridge 发布。连接恢复有用户与日志证据，修复后的双真机带图体验仍待用户验证，不能视为发布认证。
- 昨晚的单模拟器交替长测未覆盖「两台手机不同代理 + 电脑重启 + 带图发送中断后恢复」组合，测试时长不能替代场景覆盖。现场时间线与边界见 [连接排障记录](20-connection-diagnostics.md#september-14-device-specific-reachability-and-image-echo-recovery)。

## 发布前跨版本兼容性检查（2026-09-14）

- 只读核对 Production/Preview 版本及 npm latest=0.7.0，导出实际线上四个 Worker，在本地 Wrangler/workerd 跑升级/混合/代码回退矩阵。OpenClaw/Hermes × 旧/新 Bridge × 五阶段，共 20 阶段通过；存量凭据与新版写入配对记录在旧代码下仍可使用。不是云端跨 DO 迁移回滚验证，也不是旧 App 二进制签字。
- 修复新 App 连接旧 OpenClaw Bridge 的握手：顶层 meta 违反 Gateway 闭合 schema，改为已有 `params.caps`；新 Bridge 兼容两种请求，旧能力缺失保持 legacy。实际 Gateway 校验器确认，回归先红后绿；缓存 v2 的显式 schema 拒绝也保留一次兼容恢复，不放宽网络/鉴权失败。
- 验证：compat 5 文件 / 39 项；Mobile 专项 168 项；required 全绿（Mobile 266 suites / 2,614 tests、Runtime 208）；真实 Worker/adapter 集成 8 通过 / local-model 公网项 1 未执行；显式外部 Hermes 集成 36 项；Bridge 构建及包来源验证通过。
- 待发布闭环：Production OpenClaw 两服务缺六位码 `PAIRING_TICKET_SECRET`；新增 Registry DO 后不能直接回滚到旧线上版本，须先准备迁移兼容恢复产物；真实已发布 2.x App 抽验为 HT-COMPAT-0914。本轮未部署、发布 npm、操作模拟器、重启实际 Bridge 或改变用户配对。完整版本、矩阵、命令与边界见 [发布兼容性报告](release-compatibility-2026-09-14.md)。

## Lucy 实际工具调用补测（2026-09-14 03:04–03:18 JST）

- 用户要求实际搜索与约五分钟一次性任务。模拟器发送，原始 CLI 工具记录确认 web_search 返回 6 条结果、automations 成功创建任务；03:10:30 触发、约 7 秒完成并自删，App 会话面板可打开任务子会话并看到提醒。实际间隔 4 分 37 秒，无外部频道投递。
- 修复 Mobile 漏解析 CLI 合并历史内嵌工具结果：逐块保留调用/结果/错误及工具 ID，普通 Hermes toolResult 路径不变。实际详情已显示完成及真实返回 JSON。4 suites / 81 tests 通过；最新 required/typecheck 被并行定时任务编辑页面的类型调整阻断，不宣称全量通过。未部署云端。
- 同时记录未解决的合并历史耗时、聚合回复重复与任务原始提示词展示问题；完整证据和边界见 [实测记录](overnight-qa-2026-09-14.md#lucy-real-tool-follow-up--03040318-jst)。

## 双后端夜间模拟器实测（2026-09-14）

- 用户明确授权本轮模拟器实测。00:08 开始构建/准备，Lucy 00:35、Hermes 00:40 首次成功聊天；交替覆盖主聊天、OpenClaw 独立会话、生成中回列表、切连接、键盘/长草稿、5 分钟及 6 分 41 秒锁屏恢复、工具调用/详情和本地 API 故障恢复。详细证据与未覆盖边界见 [实测记录](overnight-qa-2026-09-14.md)。
- 修复 Hermes 工具秒/毫秒混用导致 1970 年分组、实时/native 工具 ID 不一致导致重复卡片；最新真实调用只有一张卡片，输入、输出及 1.2 秒耗时均复核。修复 Hermes 自有 API 子进程退出后不会恢复，实测退出→就绪 31.394 秒、仅一次启动；保留有界退避，不替换外部或仍存活的 API。
- 修复 Hermes 用户停止只断本地 SSE 的问题，增加真正的上游停止请求与失败保护；修复消息动画 render 阶段写 shared value、RTL 图标 forwardRef 警告、全局 CLI symlink 导致 doctor 漏检。服务端未部署，外部 Hermes 源码未改，已有其他工作保留。
- 最终实测：Lucy 约 66 分钟、Hermes 约 65 分钟交替观察；90 秒工具任务实际停止后，Hermes API 确认 cancelled、后续聊天正常。新工具卡片跨 Bridge 重启仍只有一张。完整 required 全绿（Mobile 262 suites / 2,580 tests）、compat 36/36、docs 与 diff 检查通过；本机全局 CLI 已安装新版，未发布 npm/云端/TestFlight。不得将本机 Debug 模拟器通过等同于所有网络或商店 Release 可发布。

## 已付费会员更换方案与终身买断（2026-09-14）

- 用户授权完整实现并操作商店、RevenueCat、PostHog 后台。设置 → Clawket Pro → 会员卡现在允许已付费用户打开付费墙；当前方案标记并锁定，可切月/年或买断。自动功能门禁仍直接放行 Pro。
- 以实际 catalog 修正购买：iOS lifetime 为 `.buyout`；Android 月/年为同一商品的 `monthly` / `yearly` base plan，采用商店允许的 WITHOUT_PRORATION；跨商品采用 DEFERRED。下单前刷新权益，防止重复买、跨商店误换及错误提前授予权益；保留历史终身升级保护。
- 买断单独支付，明确不会取消原订阅；购买前提示、购买后保留管理订阅入口及完成页。方案变更提交单独埋点，不作为已实现收入；取消/pending/未确认权益均不假报成功。19 种语言同步。
- 后台：RevenueCat `default` offering 三包及同一 entitlement 已核对；Play 实时通知已启用并覆盖一次性商品，现有 Pub/Sub 无需改权限。两次测试均抵达 RevenueCat（最后 2026-09-13 15:44 UTC）。PostHog 确认 Clawket / Default project `337268`，新增事件无需预注册。Apple 同等级调整已由负责人保存并独立确认，两方案均为 Level 1；切换至已登录且有付款权限的 Lucy 账号后，确认 Play 告警对应新加坡税务信息缺失，已打开填写入口交给负责人；没有证据表明该税务提醒已阻止客户购买。
- Apple 服务端通知已通过 RevenueCat 自动应用；独立回读 App Store，Production / Sandbox 均指向本 App 的 RevenueCat 接收地址。Apple 实际通知投递仍需 Sandbox 验收；未记录地址中的私密路径。
- 验证：`npm run check:required` 全绿，Mobile 261 suites / 2,578 tests、173 个 UI 源文件、19 locales / 21,413 translations、全部 workspace 类型/自包含测试与文档门禁。未提交、未部署、未安装新构建、未执行真实扣款；原生购买验收仍待负责人。细节与后台证据见 [Pro plan management](../../apps/mobile/docs/pro-plan-management.md)。

## 多语言扩展到 19 种语言与 RTL（2026-09-12）

- 用户授权：先清理无用 i18n key，再把支持语言扩展到与 YouMind Mobile 相同的 19 种，并为阿拉伯语做 RTL 适配；工程规则以 `apps/mobile/docs/localization.md` 为准。
- Key 清理：`i18n-prune` 改为按词法作用域解析 `useTranslation` 绑定并支持命名空间数组，误报的 23 条 MISSING 消失；新增 `DYNAMIC_KEY_ORIGINS` 登记 4 处运行时选 key 的调用点（reply-failure、ChatColorPicker、console-heartbeat、AgentSettings model），命名空间不再被整体保护。实际删除 32 个源码未引用的 key（付费墙旧文案、Design System 示例、旧配对文案等），补上 1 个真正缺失的 key（`config` 的“All local data for this connection will be removed.”，此前六种语言都显示英文）。`npm run i18n:check` 从 `--catalog-only` 升级为 `--strict`，进入 `check:required`。
- 基础工程：`src/i18n/supported-locales.js` 成为唯一语言列表来源（运行时、`plugins/with-locales.js`、门禁共用）；`language.ts` 新增 BCP-47 设备标签解析（zh-Hant/TW/HK/MO、pt-PT 与葡语区、es-419 与美洲西语区）；`app.json` 注册 19 种 `CFBundleLocalizations` 与 expo-localization `supportedLocales`（Android locale_config）并开启 `supportsRTL`；门禁校验 `app.json` 与共享列表一致、插值 token 与英文一致、非英文目录与英文相同比例 ≤ 40%。
- RTL：`AppLanguageProvider.syncLayoutDirection` 在方向变化时 `I18nManager.forceRTL` + `reloadAppAsync`；`NavigationContainer` 传入 `direction`；新增 `components/ui/DirectionalIcon`，24 个文件的返回/前进 chevron 与箭头改为镜像版本；图片翻页手势与 Companion 动画保持物理方向。语言选择弹层改为固定 snap point + 可滚动。
- 翻译：13 个新语言（zh-Hant、fr、it、es-419、pt-BR、pt-PT、ru、uk、tr、vi、th、hi、ar）× 4 命名空间 × 1,107 key 全部人工翻译并校对；zh-Hant 以 zh-Hans 为底经 OpenCC 转换后按台湾用语逐项修订（設定/檔案/連線/權限/唯讀/QR Code 等）；es-419 与 pt-PT 分别基于 es 与 pt-BR 做地区化修订。顺带补译 ja/ko/de/es 中 18 条一直是英文的 YouMind 登录与权限状态文案。与 YouMind Mobile 重叠的 ~270 个 key 做了逐条对照，差异均为风格选择。
- 验证：`i18n-prune --strict` 19 locales × 4 namespaces、1,107 keys / 21,033 translations、missing/removable/registry_errors 均为 0；`npm run check:required` 全绿（2026-09-12）：全部 workspace typecheck、Mobile 258 suites / 2,518 tests、Relay/Bridge 测试、170 个 UI 源文件的 design-system 检查、i18n strict 与 docs 检查。未提交、未部署。真机 RTL 与 13 种新语言的视觉走查、商店元数据属人类工作（HT-I18N-1/2）。

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

| 2026-09-12 | 新增 locale 采用最短 BCP-47 代码（`fr`、`ru`、`uk`、`vi`、`th`、`hi`、`it`、`tr`、`ar`，仅 `zh-Hant`、`es-419`、`pt-BR`、`pt-PT` 带区域/文字），不照搬 YouMind Mobile 的 `fr-FR`/`ru-RU` 等混合写法。 | 语言集合与 YouMind 一致即可；短代码与 iOS `.lproj`、Android `b+` 资源限定符和 i18next 规范化都兼容，也避免同一语言两套代码。 |
| 2026-09-12 | RTL ↔ LTR 切换允许一次 `reloadAppAsync`；LTR 之间切换保持原有热更新。 | `I18nManager` 方向是进程级原生状态，不重载无法生效；与 YouMind Mobile 做法一致，且仅阿拉伯语触发。 |
| 2026-09-12 | 门禁把“非英文目录中与英文相同的值超过 40%”视为未翻译并拒绝。 | 现有六种语言最高约 11%；40% 能挡住整目录复制英文的占位文件，又不会误伤品牌/技术词。 |
## 偏离记录（规格与实现不一致之处，最终报告汇总）

| 位置（文件 § 节） | 规格原文 | 实际做法 | 理由 | 影响 |
|---|---|---|---|---|
| `[UX-2026-09-16-whatsnew] 06-paywall-and-growth.md` §3 历史用户 / `07-analytics.md` | 升级到 3.0 的首次启动用「3.0 + Pro」介绍页（付费墙布局）替代当次更新公告；`paywall_launch_shown / closed` 统计自动弹出。 | 介绍页删除，改为根层更新公告弹层（大号 curious Companion + 版本英雄文案 + 五条一行文案，不放 Pro 条目——负责人看过首版后去掉），跳版合并、静默版不弹、全新安装不弹；事件改为 `app_update_announcement_*` 与 `release_notes_opened`。 | 负责人 2026-09-16 决定：介绍页从未被任何页面调用，公告一条路径覆盖首发与后续所有版本；同一次启动只弹一个模态。 | 06 §3 与 07 事件表已同步改写；`launchPaywallShownThisProcess` 语义扩展为「本进程启动机会已消耗」。 |
| `[PAY-2026-09-16-models] 00-decisions.md` §付费 | 「保持免费：…模型切换…」 | 模型页（默认 / 当前模型、白名单开关、备用、思考等级、加删模型、成本）全部走 `modelManage` 付费墙；聊天输入框的会话级切换仍免费。 | 负责人 2026-09-16 明确要求给模型页管理动作加付费墙以提高转化；实现者把「模型切换保持免费」收窄为输入框切换。 | 免费用户仍可浏览完整目录与真实默认值；每个写动作带 continuation。若负责人希望输入框切换也收费，需再改 `useChatModelPicker`。 |
| `[UX-2026-09-16-models] 10-migration-map.md` / `04-app-screens.md` §5 | `ModelsScreen.tsx` 迁移为 `AgentSettings/Models`；`00` 只说「模型切换保持免费」。 | 迁移补完：模型页恢复 2.0 的默认 / 备用 / 思考等级、白名单开关、加模型、删模型、成本覆盖，去掉「模型 / 提供方」Tab，改为独立 `ModelsScreen` 页 + 三个弹层；协议加 `modelManage` 精化。 | M5 只迁了「选一个模型」，负责人 2026-09-16 指出功能丢失且页面不可理解；2.x 埋点显示这些功能有 51–201 名用户。 | 仅 OpenClaw 获得管理能力；Hermes / local-model 保持全局选择。成本编辑降级为弹层次要行，Provider 增删仍指向配置编辑器。 |
| `04` §5 / Cron 编辑与文案预算 | 设置行只有标题/尾值，Cron 使用三字段弹层。 | 负责人 2026-09-14 批准：无卡片时间摘要与行内开关，原生栈新建/编辑页，模板和可视化时间引导。 | 恢复 2.0 降低使用门槛的能力，并修复把时区显示文本写回表达式的问题。 | 仅 Mobile 和追加能力元数据；保留双后端、心跳和高级配置，不改连接或调度服务。 |
| `04` §5 / `05` 文案预算 | 技能已安装/发现分段；设置列表只有名称与尾值。 | 负责人 2026-09-13 确认高保真方案：发现收进 Compass 入口，已安装行加一行用途与直接开关、88pt 最小高度，缺失项单独说明。 | 直接理解和管理技能，减少进入详情操作；开启状态与可用性分开。 | 保留双后端能力、发现来源、聊天安装和卸载；不改协议与连接。 |
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
| `[COMPAT-0914] 01/02` 能力声明 | 客户端 connect 顶层 meta。 | 改为既有 `params.caps`；Bridge 同时接收预发布 meta。 | 旧 Bridge 不剥离 meta，实际 Gateway 闭合 schema 拒绝该请求；caps 经实际 validator 与历史 Bridge 验证合法。 | 不加往返/重试，保持 v1 无协商响应原字节及 Hermes 路径；39 项回放通过。 |
| `[M5-1] 04-app-screens.md` §0 / `08-milestones.md` M5 | 每页都实现加载、空、错误、离线、无权限五态。 | Onboarding 按其页面专属规格实现默认表单、连接中、错误、离线与 Debug Preview；不制造独立 empty / permission 页面。 | “没有连接”正是必须显示配对表单的默认态，不是空内容；`04` §8 又明确 Paywall 在 Onboarding 期间永不出现，无权限态会与冻结产品流程冲突。 | 其他六个页面仍覆盖完整五态；Onboarding 的每个可达状态和成功导航均有渲染/路由测试，不减少用户可执行动作。 |
| `[M6-1] 08-milestones.md` M6.2 / `06-paywall-and-growth.md` §2 | 付费墙实现“五套英雄图”。 | 按同节触发映射表实现 `connections`、`agents`、`manage`、`logsFiles`、`search`、`generic` 六套独立 hero。 | 映射表有六个互不等价的用户情境；合并任意一项会让表内触发点失去对应视觉。 | 只扩大 hero 枚举到规格已逐项定义的六项，不增加新触发点、文案或产品能力。 |
| `[M6-2] 06-paywall-and-growth.md` §1 | 宽限标记随设备 identity 保存，重装不重置。 | 同一安装生命周期内由 SecureStore 严格一次性；不声称 Android 卸载后仍能保留，因为卸载会删除该应用的 SecureStore 数据。 | 跨卸载绝对保证需要新增服务端账户/稳定设备标识，超出规格范围并扩大隐私面；本地实现无法诚实满足。 | iOS/Android 卸载重装行为列入真机 HUMAN TODO；未新增跟踪后端，恢复购买仍可恢复 Pro。 |
| `[M7-1] 10-migration-map.md` §文档 | Relay/Registry 文档写成“`RELAY_BACKEND` 与三实例部署说明”。 | 文档按实际拓扑写成 OpenClaw/Hermes × Production/Preview 四个隔离服务对，两个 source workspace 共部署 8 个 Worker service。 | `08-milestones.md` 已锁定一套代码四个实例，现有 Wrangler 配置也明确有四个 backend/environment 组合；“三实例”会遗漏 Hermes Preview 或混淆 Registry/Relay。 | 只修正文档计数，不改变已部署资源、环境身份或产品协议。 |
| `[M8-1] 09-release-and-acceptance.md` §3.2 | 置顶会话行要求“带 📌”；`05` / `09` 同时禁止 emoji 充当界面图标。 | 使用视觉系统规定的 Lucide `Pin` 图标，保留置顶语义与位置。 | 字面 emoji 与全局视觉护栏冲突；Lucide 是同义、可主题化且可审计的既定组件。 | 只改变图标实现，不改变功能、顺序、可访问性标签或验收语义。 |
| `[M8-2] 09-release-and-acceptance.md` §3.3 pairing approval | 验收文案可读成所有 `PAIRING_REQUIRED` 都进入同一审批映射。 | 把当前客户端自配对握手与连接级 owner pair approval 拆开；前者只认精确 request ID，后者由连接级 store 维护。 | 别人的审批结果不能误满足当前客户端握手；迟到事件、刷新竞态与失败重试也需要独立生命周期。 | 旧 wire 与 owner 审批 UI 不变；提高双后端重连和审批安全性。 |
| `[M8-3] 09-release-and-acceptance.md` §1 隐私标签 | 诊断/使用数据写作“不关联身份”。 | 商店草案按更保守的 linked 口径申报 Device ID、RevenueCat purchase 与 YouMind identity/content。 | 实际 PostHog 使用 `identify(deviceId)`，同时接入 RevenueCat 与 YouMind；不能用窄口径掩盖 SDK 的真实关联。 | 不改变 Relay 不持久化消息、本地 cache 与删除清理承诺；公开政策和最终商店标签须同步更新。 |
| `[UX-2026-09-07] 05-visual-system.md` bubble recipe | 用户气泡直接使用透明 `accentSoft`。 | 先将 tint 合成到 canvas，再应用材质透明度；solid 为不透明浅/深底。 | 用户报告 soft 深紫底黑字；旧解析丢弃 tint alpha，且直接透明底受壁纸影响。 | 保留六色与三种材质存储标识，所有后端共用修正；648 组正文对比度回归。 |
| `[UX-2026-09-16-identity] 00-decisions.md` §2 Agent 设置 / `04-app-screens.md` §5 | 顶行身份（名字、头像、人格、记忆文件）；Agent 组另有「文件」。 | 身份页只保留名字 / emoji / vibe / 头像与新建 / 删除智能体；SOUL / MEMORY / USER / AGENTS 只在文件页编辑（含创建缺失文件）；「我的信息」表单删除。 | 同一文件两处编辑器互相覆盖且交互不一致；OpenClaw Control UI 与 2.0 都只在 Files 编辑这些文件；Hermes 无 SOUL.md 使身份页出现死路；2.x 数据显示原文编辑器触达（612 人）高于结构化身份编辑（528 / 243 人）。负责人 2026-09-16 决定。 | 不改后端、协议或能力矩阵；埋点 `identity_file_activity` 改名 `agent_file_activity`（3.0 未发布）；Skills SKILL.md 弹层与文件页弹层样式仍不同，待负责人裁定。 |
| `[UX-2026-09-11-profile] 04-app-screens.md` §5 / `05-visual-system.md` §9 | Agent 设置 = 44pt 身份行 + 「行标题 + 尾值」两档字；卡片下不放小字。 | 档案页改为「数字卡 + 行」：头部右侧墨色圆按钮 = 继续聊天，两张 hero 卡（Cron jobs、Cost today）+ 三块计数格（Models / Skills / Files），卡右侧允许一个 `caption` 数字小字（红色失败数、灰色 tokens）。 | 负责人 2026-09-11 依据 2.0 控制台埋点（定时任务 hero 人均点 6.2 次、费用 3.3 次、用量页触达最广且付费用户超配）要求把数据放回一级；小字是数字不是句子。 | 本页用到 title / secondary / caption 三档（`check-ui-style` ≤ 3 仍通过）；行仍是两档；其他页面不变。 |
| `[UX-2026-09-11-profile] 04-app-screens.md` §5 身份行 | 灰字 = 连接名 · 后端。 | OpenClaw 有心跳时灰字 = `后端 · Active {{age}}`；否则退回连接名 · 后端。（2026-09-16 再改：后端进头像角标，灰字只剩 `Active {{age}}` / YouMind 邮箱，无信息时整行不渲染，见下一条。） | 2.0 心跳数字 482 人反复点；连接名与分节标题重复。 | 新增协议只读操作 `cron.heartbeat.last()`（可选），OpenClaw 转调 Gateway `last-heartbeat`；Hermes 不声明，行为不变。 |
| `[UX-2026-09-11-profile] 04-app-screens.md` §5 命名 | 「定时任务」英文 `Scheduled tasks`。 | 全部改回 2.0 的 `Cron jobs` / `New cron job`（中文仍是定时任务）。 | 负责人要求与 2.0 用户心智一致。 | 六语言 `common` / `config` 键改名；无其他页面引用。 |
| `[UX-2026-09-14-sprite] 00-decisions.md` §首启引导 / `04-app-screens.md` §4 第 5、6 行与「+」菜单 | 引导页第三个入口「YouMind 精灵」；「还没有 Agent？」含 YouMind 键；「+」菜单说明「连接 OpenClaw、Hermes 或 YouMind 精灵」。 | 负责人 2026-09-14 要求隐藏全部 YouMind 精灵入口：三处都由 `apps/mobile/src/config/features.ts` 的 `YOUMIND_SPRITE_ENTRY_VISIBLE=false` 关闭，「+」菜单说明改为「连接 OpenClaw 或 Hermes」（19 语言新增键）。 | 只隐藏入口，不删功能：适配器、邮箱验证码登录、翻译、既有 YouMind 连接与测试全部保留，翻回标志即恢复。 | 新用户无法新建 YouMind 连接；已有连接继续工作。测试覆盖隐藏态与标志开启态。 |
| `[UX-2026-09-14-profile-cost] 04-app-screens.md` §5 数字卡 | Cost today 右侧灰色「{{value}} tokens」小字。 | 去掉 tokens 小字，费用卡只显示美元数；tokens 仅保留在无美元数时的「Tokens today」退化态。 | 负责人 2026-09-14 依据真机截图：用量稍大（`$0.xx` + `863.8K tokens`）时小字与金额抢同一张 hero 卡的宽度，两者都被省略号截断。 | `model.ts` usage 卡不再产出 `detail`，`AgentSettingsStatDetail.key` 收窄为 `{{count}} failed`；19 语言 `settings` 删除 `{{value}} tokens` 键；Cron 卡的红色失败数与锁位不变。 |
| `[UX-2026-09-16-hero] 04-app-screens.md` §5 Hero / 行 | 名字下一行灰字 `连接名 · 后端`（有心跳时 `后端 · Active {{age}}`）；连接组分节标题 = 连接名。 | 后端改为头像右下角 24pt 圆角标（`PlatformMark` 官方图标 20pt，`surfaceFloating` 底 + 2pt `canvasGrouped` 描边；Pro 锁定时锁角标占位）；灰字只在有心跳（`Active {{age}}`，不带后端前缀）或 YouMind 邮箱时渲染，否则无第二行；连接组不再有分节标题。 | 负责人 2026-09-16 真机截图：Agent 名「Lucy」下又出现连接名「lucy」，同名重复；后端专门占一行不值；「身份」下再来一个「lucy」小标题很怪。 | 只改档案页头部与分组标题；`identity.detail` 改为可选、新增 `identity.backend`、`AgentSettingsGroupDescriptor` 去掉 `title`。Hermes 角标是该图标唯一被裁成圆的位置（只裁掉它自带的白色安全区），已写入 `apps/mobile/docs/design-system.md`。 |
| `[UX-2026-09-16-memory] 04-app-screens.md` §5 数字卡 | 第二排第三块计数格叫 Files（文件）。 | 计数格与其分栏页标题改名 Memory（记忆），19 种语言同步；`files` 路由、埋点名 `Files`、`FilesSection` 组件与文件页内文案不变。 | 负责人 2026-09-16 要求：该页承载的是 SOUL / MEMORY / USER 等记忆文件，「文件」对用户不表意。 | 只改标签与翻译，不改能力矩阵、路由或后端。 |
| `[UX-2026-09-16-roster-order] 00-decisions.md` §首屏 / `04-app-screens.md` §2 第 4 行 | 花名册「按最近活动排序」；04 细化为「需要你 > 有未读 > 最近活动时间」。 | 改为「Agent 级手动置顶 > 最近一次有人参与的活动时间」，未读 / 需要你只做徽标；活动时间取 OpenClaw `max(lastInteractionAt, lastActivityAt)` / Hermes `updated_ts`，只数主会话 / 直聊 / 群 / 渠道会话。 | 负责人 2026-09-16 判断：聊天列表形态带来的是「最后消息时间 + 手动置顶」预期；未读 / attention 是瞬态排序键，导致行在用户没动时上下跳；2.0 数据显示列表通常 1–4 行，徽标一眼可见；原实现用的 `updatedAt` 会被心跳推高，制造假未读与假置顶。 | 协议加可选 `lastActivityAt` 与 `sessionActivityAt` / `HUMAN_SESSION_KINDS`；两层排序合成一层；未读水位线、行时间、搜索、Thread 已读同一时钟；老 Gateway 列表整体无活动字段时回退 `updatedAt`。 |

## HUMAN TODO（只有人能做的事）

| 编号 | 事项 | 怎么做 | 验证方法 | 状态 |
|---|---|---|---|---|
| HT-PAYWALL-COPY-0916 | 付费墙文案与留白真机验收 | 负责人查看通用、锁定 Agent、文件编辑和日志入口；检查猫头区域、标题换行、权益到价格 32 pt 距离，并用大字号展开月付查看滚动。 | A 版通用文案与情境标题清楚，文字区靠近价格，长文案和购买按钮均可完整访问。 | 待负责人反馈；不操作模拟器 |
| HT-ROSTER-ORDER-0916 | 花名册排序真机验收 | 装新构建后打开花名册：只与 A 聊一句，确认 A 到顶且时间是刚刚；等一次心跳（`heartbeat.every`，本机 2h）或让某个没聊过的 Agent 跑一次 cron / 子 Agent，确认它不上浮、不出未读点；压后台 ≥1 分钟回前台重连，确认顺序在重连前后不变；OpenClaw 与 Hermes 两个连接各做一遍，切换活动连接后顺序也不变。 | 顺序只随「人参与的消息」变；心跳 / 重连 / 切换连接 / 打开会话都不改变顺序；红点与「需要你」仍在行上。 | 待验收 |
| HT-WHATSNEW-0916 | 更新公告弹层与更新日志真机验收 | 在有连接的设备上装新构建冷启动（模拟 2.x 升级：设备上不能已有 `clawket.appUpdateAnnouncementLastVersion.v1`），花名册连接就绪后应弹「Meet Clawket 3.0」；看猫头动效、浅 / 深色、中文每条描述是否一行、Continue；再冷启动一次不应再弹。账户设置 → 关于 → 高级设置开 Debug 后用「预览更新公告」反复看；账户设置 → 帮助 → 更新日志核对 11 个版本与日期。 | 弹层只出现一次、无叠层、Reduce Motion 下猫头静止；`app_update_announcement_shown/closed` 在 PostHog 诊断里各一条。 | 待处理 |
| HT-MODELS-0916 | 模型页真机验收（OpenClaw + Hermes） | OpenClaw：改默认模型 / 加备用 / 改思考等级 / 关一个开关 → Save → 确认重启；Provider 弹层加一个模型；详情弹层删一个未被引用的模型、给显式 provider 的模型改成本。Hermes：点行 → 「Set as current model」。 | Gateway `config.get` 里 `agents.defaults.model`、`agents.defaults.models`、`models.providers.*` 与页面一致；输入框模型选择器不受影响；Hermes `model.get` 变化 | 待处理 |
| HT-PAYWALL-0916 | 最后一步付费墙真机验收 | 用非 Pro 账号进 OpenClaw 管理四个分段与「OpenClaw 运行日志」：看遮罩渐隐在浅 / 深色下是否若隐若现、文案是否有付费冲动；再用 Sandbox 账号在配置编辑、权限修复、诊断修复、备份创建 / 恢复确认、日志解锁各处购买一次，确认原动作在付费墙关闭后自动续做 | 遮罩下内容不可点、读屏不读；每个拦截点弹出对应 hero 的付费墙（`manage` / `logsFiles`）；购买后无需重进页面即解锁并完成原动作；PostHog `paywall_viewed` 的 `blocked_feature` 分布覆盖五个 manage/logs 值 | 待处理；若遮罩效果不够，再决定是否引入 `expo-blur` |
| HT-IDENTITY-0916 | 真机验收身份页真实写入 | 连上 OpenClaw：改名、改 emoji、在多行气质框输入长文本并保存；再新建一个带 emoji 的 Agent 后只改它的 emoji 保存 | 电脑上 `openclaw.json` 的 `agents.list[].identity` 出现新 name / emoji，工作区 `IDENTITY.md` 的 Name / Emoji / Vibe 行更新且其余内容未丢；花名册与聊天页头显示新 emoji；头像行不再出现、气质框可多行显示 | 待验收 |
| HT-TURN-CONTINUITY-0916 | 真机复验首发与工具分段 | 首次进入/后台恢复后发送；OpenClaw 与 Hermes 各运行一次多段文字和多次工具调用，等回复结束并稍等历史刷新 | 用户消息不消失；工具前后段落保持原位，结束与刷新不合并、不闪；工具状态正常收尾 | 待负责人实测；单次消失未取得真机事件记录 |
| HT-HISTORY-RESTART-0916 | 工具回复冷启动去重 | 使用新代码进入截图会话，联网历史加载完成后杀进程重进两次并向上翻页；OpenClaw/Hermes 各复验带工具的新回复 | 同一回复只有一份，不同轮次的同文回复仍保留；工具与正文顺序正常 | 待负责人手机实测；未启动模拟器 |
| HT-SEND-MOTION-0916 | 真机验收发送/回复连续性 | OpenClaw 与 Hermes：短句、恰好换行的长句、图片；慢回复、发送后下一条草稿、弱网恢复；滚离底部再回来 | 气泡确认前后不缩放、不变暗、不消失重现；回复从思考到正文及结束无空白闪帧；无重复发送，失败气泡仍能手动重试 | 待负责人手机实测；单元测试不等同于原生帧率验收 |
| HT-SEND-0916 | 真机验收发送即时反馈 | 分别在 OpenClaw / Hermes 发送文字、图片；空闲后首发、后台恢复后发送、发送后立即输入下一条；弱网/断网恢复后重试暂停气泡；覆盖现有本地与隧道连接 | 点击即清空本次输入并出现原位待发气泡；失败仍可编辑/重试；下一条草稿不消失；无重复发送、跨会话消息或同时运行；区分发送中/已确认/未确认 | 待负责人实测；本轮不启动模拟器，不改变配对或服务 |
| HT-UX-0916 | 真机验收连接状态胶囊 | 在 Roster、Thread、Agent 主页/分栏、账户设置、搜索、Session Panel 各停留后压后台 ≥1 分钟再切回；再断开电脑 Bridge 超过 20 秒；浅/深色各看一遍 | 回前台时页面内容不位移；Roster 页头中央先出现呼吸的「Reconnecting…」再淡出；持续离线时 Roster 只有「⊘ Reconnect」、标题页标题让位给「Offline · reconnecting  Reconnect」并在恢复后回来；Thread 副标题写离线、时间线顶部悬浮「Reconnect」可点；德语等长文案在 375pt 宽机型不撞到左右按钮 | 待处理；本轮仅自动化验证 |
| HT-USAGE-0916 | 真机验收用量页改版与 Pro 蒙层 | 用免费账号：切到 7D / 30D 看蒙层是否「若隐若现」、按钮是否显眼、点后是否弹用量付费墙；今天档点过去日期的柱子是否弹墙；购买 / 恢复后蒙层是否立即消失。再用 Pro 账号：Agent 主页 → 用量：看今天 / 7D / 30D 三档，快速连点三下看最终数字与档位是否一致；断网后再切档看 Retry 横幅是否保留旧数据；浅 / 深色各看一遍；OpenClaw 与 Hermes 各一台；点页头分享出海报 | 英雄卡主数字与 Agent 主页 Cost today 口径一致；切到未缓存档位立即出同形骨架、无旧数字残留；趋势图今天柱为墨色、其余灰、点柱子切换选中值；费用为 $0 或 unknown 时以 Token 领头且无四行 $0 明细；工具调用为 0 时无工具卡 | 待处理；本轮仅自动化验证 |
| HT-ENV-0916 | 接受 Xcode 许可后重跑必需门禁 | 在终端执行 `sudo xcodebuild -license accept`，然后从仓库根目录 `npm run check:required` | `/usr/bin/python3 --version` 正常输出版本号；`packages/bridge-runtime` 的 27 个测试文件全绿；`check:required` exit 0 | 待处理；2026-09-16 下午本机 `/usr/bin/python3` 开始要求接受许可，导致 Hermes 账本相关 47 项测试无法启动 Python，与代码改动无关 |
| HT-QA-0915 | 原生附件与真实网络补验 | 真机选择一张 limited-library 图片及一个文件发送；Wi-Fi/蜂窝/代理对照，保留失败时间 | 附件不丢、无重复气泡、权限窗口无遮挡，跨网络恢复可解释 | 图片双发/冷启动已模拟器通过；文件 picker 和 limited-picker 完成受自动化能力限制，网络原因仍需对照 |
| HT-LM-0914 | 发布包含 `local-model` 的 bridge CLI 到 npm | 决定发布版本后按既有发布流程 `npm publish` `@p697/clawket`；发布前 `npm run test:compat` 必须全绿 | `npm pack @p697/clawket@latest` 解包后 `dist/index.js` 含 `local-model`；在干净机器上 `npx @p697/clawket pair --backend local-model --preview` 打出六位码 | 待处理。当前 latest=0.7.0 不含该命令，App Preview 的本地模型步骤展示的 npx 命令在发布前只能改用仓库内 `node apps/bridge-cli/dist/index.js local-model pair --preview`（README 已按此写） |
| HT-COMPAT-0914 | 已发布 2.x App 跨版本抽验 | 保留真实旧包与存量配对，先在隔离候选服务、再在 Production 小范围按 09 §2 验证双后端聊天/流式/停止/附件/会话、重新配对、锁屏恢复；记录具体 App 版本与构建 | 旧包与新服务/新 Bridge 可用；协议回放不替代原生签字 | 39 项协议回放、20 阶段真实 Worker/Bridge 混合测试通过；旧二进制/真机待验收，2.1.1 provenance 不完整 |
| HT-PRO-0914-1 | Apple 月/年方案调整为同一服务等级 | App Store Connect → Clawket → Clawket Pro 订阅组 → Edit → Edit Level，将月付和年付合到一个 Level 并保存 | 列表不再是 Monthly Level 1 / Yearly Level 2；Sandbox 变更按同等级不同周期规则处理 | 已完成；负责人保存后，2026-09-14 独立打开后台确认两者均为 Level 1，状态 Approved；原生购买验收另见 HT-PRO-0914-3 |
| HT-PRO-0914-2 | Google 新加坡税务信息提醒 | 使用有付款权限的 Lucy 账号进入商家支付资料 → 税务中心 → 新加坡，按实际税务身份处理；不记录税务文件或支付资料 ID | 按 Google 当前政策核对信息与提醒；客户购买验收单独执行 HT-PRO-0914-3 | 已定位个人表单，UEN 可选；未代填或提交。官方说明新加坡免税相关税务居民信息状态目前不限制账户、不影响付款或预扣税，因此不列为紧急上线阻塞；个人身份不能单独决定免税资格，参见 pro-plan-management.md 的官方来源 |
| HT-PRO-0914-3 | 月/年切换与买断原生验收 | 按 `apps/mobile/docs/pro-plan-management.md` 用 Sandbox / license tester 覆盖双向换周期、买断后停原订阅、取消、pending、恢复、续费与退款，双后端连接均验收 | 确认商店当前/下期价格日期、实际 entitlement 与 PostHog 新事件；用户停掉原订阅后不再续费，订阅到期不抹去买断 | 自动门禁全绿；未操作模拟器或真实付费账户 |
| HT-CRON-0914 | 定时任务真机视觉验收 | 双后端验证列表开关、新建模板/四类时间、编辑保存/取消、原生日期选择、运行记录；浅深色、大字体、阿拉伯语 | 内容清晰且控件不重叠；保存失败保留草稿；时区说明真实；返回保持列表位置 | 自动检查及双平台 JS 打包通过，待负责人真机验收；未操作模拟器、配对或线上任务 |
| HT-SKILLS-0913 | 技能页真机视觉验收 | 双后端查看长名称、用途、开关、缺配置状态；浅/深色、大字体、阿拉伯语；发现返回、详情滚动、安装后进入聊天 | 符合确认的 88pt 列表原型；开关与详情点击独立、切换不跳行、文字不覆盖控件 | 自动交互验证通过；待负责人真机验收，不操作模拟器、不改配对 |
| HT-NET-0912 | Windows local-model owner 断线根因 | 提供运行 Bridge 的终端末尾错误及进程是否存活；不含配对码/凭据 | 对齐 2026-09-11 18:37:20 UTC owner 断线及恢复后的 cloud owner/health | 待主机信息；Mac 已恢复，未假定 Windows 同因 |
| HT-I18N-1 | 真机验收 13 种新语言与阿拉伯语 RTL。 | `npm run mobile:sync:native` 重新生成 iOS `.lproj` 与 Android `locale_config.xml` 后做 Release 构建；阿拉伯语冷启动、账户设置里在 ar 与 LTR 语言间来回切换（预期各重载一次）、根/栈导航、花名册与会话面板行、线程气泡与输入框、设置弹层；其余 12 种语言至少走欢迎/配对/花名册/线程/设置五页，关注长文案截断（de/ru/uk/fr 最长）。 | 无 chevron 方向错误、无手势反向、无被截断的按钮文案；发现的文案问题直接改对应 locale JSON 并重跑 `npm run i18n:check`。 | 待处理；本轮仅自动门禁，未做模拟器/真机走查 |
| HT-I18N-2 | 为 13 种新语言准备商店元数据。 | App Store Connect 与 Google Play 各新增对应本地化（es-419 在 Apple 选 Spanish (Mexico)），名称、副标题、描述、关键词、截图与订阅商品本地化；商店文案不从 App 翻译 JSON 生成。 | 两商店本地化列表与 `apps/mobile/docs/localization.md` 的 19 种一致。 | 待处理；不阻塞代码合入 |
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


### 2026-09-12 Preview overnight connection investigation (in progress)

- Confirmed cloud owner loss for Mac OpenClaw and Windows local-model; phone sockets authenticate but have no Bridge route. Mac direct DNS/TCP fails, existing proxy path succeeds. Windows host cause pending terminal logs.
- Added explicit Relay-only HTTP(S) proxy support and 15-second cloud handshake deadline across Bridge runtimes. No global DNS/proxy mutation or simulator takeover.
- Added local-model missing-owner retry floors (30/60/120s), preserved offline error classification, and prevented repeated connect calls from bypassing backoff.
- Full required gate passed; final targeted runtime 190 tests and mobile transport/local-model 18 tests passed; v1 replay 36 passed. CLI package boundary check passed. Mac installed Relay proxy fix and scoped launchd environment; Preview connected at 00:18:43 UTC on attempt 1 (~1.1s), authenticated Relay health evidence followed at 00:18:53. Production also recovered. Installed package/config backups remain under `/tmp/*network-fix-0912*`. No simulator or client takeover; TestFlight has not received mobile changes.
- Cloudflare Workers adaptive metrics at 00:20 UTC over the preceding hour returned 3 OpenClaw Preview and 25 local-model Preview requests, zero Worker errors. This is not a complete DO/KV billing audit. Windows local process remains unverified; no completion claim for that host.


### 2026-09-12 main-session article request failure

- Gateway accepted the main-session turn, but Claude CLI returned HTTP 403 after ~10s. Same logged-in account/model succeeded through existing proxy and failed direct.
- Configured OpenClaw managed service HTTP(S) proxy with loopback bypass and backed up its plist; restarted service. Verified actual Gateway replies in an isolated diagnostic session: Sonnet 10.7s, explicit Opus 8.7s. No external channel delivery, no automatic replay of the user's request.
- App reply-error classification no longer prescribes login for an ambiguous HTTP 403; original sanitized details remain. TestFlight delivery-indicator behavior remains owner-tested, not claimed fixed.

### 2026-09-13 — Preview main-session reentry investigation

Correlated phone screenshots, local Bridge/Gateway, read-only main-session history and Cloudflare Preview telemetry. Confirmed nested history activity was ignored, exact imported CLI resume context defeated optimistic reconciliation, and malformed assistant tool prose came from the Gateway history itself. Separately confirmed Mac Production/Preview owner heartbeat loss around 13:30 UTC with owner recovery at 13:30:37; original run completed locally at 13:33:29. Network segment cause remains unproven.

Implemented optional scoped live history snapshots with late-event guards, route reentry activity/text restoration and session-scoped abort hint; preserved legacy/Hermes history handling. Exact resume envelope removal precedes optimistic merge. Malformed imported tool prose retains raw unverified input with unknown status; ordinary code examples remain visible. Thread no longer promotes roster-only request failure to connection error. Added bounded timeout diagnostics and ignored stale socket pongs, without extra cloud polling or changed retry cadence. Validation in progress; owner performs device visual acceptance. No live service deployment/restart or simulator connection.

Validation: full `check:required` passed (Mobile 258 suites / 2,529 tests; protocol 100% branch coverage; design/localization/docs gates). A follow-up live log read identified five retries of one expired channel at 13:36 UTC; the added HTTP-409 retirement path passed the final Bridge suite (193 tests), including fresh-client recovery and unchanged owner HTTP retry. Cloud Workers adaptive metrics for Preview 13:25–13:50 UTC reported 19 invocations/subrequests and zero Worker errors; this is not a complete DO/KV bill or proof of packet delivery. No build was installed on the phone and no live Bridge package was replaced.

### 2026-09-13 — Connection removal completion

Removed the network-idle wait from committed connection deletion so an unreachable fallback adapter cannot strand Profile on its missing-record skeleton. All manual removal entrypoints now reset to Roster or Onboarding from the current runtime snapshot; removed roster groups and scoped stale errors are discarded. Durable storage failure still preserves the connection and local cleanup failures remain reported. Device acceptance remains owner-performed.

Validation: connection coordinator 49 tests, Mobile typecheck, docs checks and v1 compatibility 36 tests passed. Built and verified the CLI tarball, installed it globally, and restarted the existing launchd job without rewriting its proxy configuration. Preview and Production Relay health confirmed in local logs. Refreshed a Preview-only secure six-digit invitation at owner request; no pairing secret recorded here. App build remains owner-run.

### 2026-09-13 — Send entrance cadence and roster work phases

Added a 240ms view-only gap after local message submission, preserving immediate send/stream handling, latest buffered reply, original history, route scope, cancellation controls and reduced-motion behavior. Connection-owned backend-neutral run phases now survive leaving Thread; Roster shows thinking/tool/working labels in place of stale previews, restores previews on completion, and clears live phases on disconnect/switch. Phase changes publish once rather than per streamed token; no new requests, polling, or cloud cost. Automated verification in progress; owner performs device acceptance.

Validation: final targeted 7 suites / 158 tests passed, including controller send lifecycle, connection-owned work after chat exit, phase deduplication, terminal/history cleanup, roster connection isolation, delayed fast replies and reduced motion; Mobile typecheck and docs checks passed. Full required run reached 258 passing Mobile suites / 2,535 passing tests but stopped on three unrelated current-worktree style expectations (logical divider margin and added comfortable settings-row size); those files were preserved. No simulator, service restart, pairing refresh or cloud deployment for this milestone.


### 2026-09-13 — Account Settings quality pass

Owner requested a first implementation across Settings and descendants, replacing the generic Pro sparkle. Added the static Companion membership card, separated common preferences from support, moved language alongside appearance, and applied a scoped comfortable grouped-row recipe (64-point minimum, 22-point radius, 32-point icon slots, neutral glyphs, RTL-aware inset hairlines). Membership, preference sheets, chat appearance, support/release history, connection list and detail share the treatment. Selected preferences expose state and guard duplicate saves; long row copy grows. Existing Agent/other row density, backend capabilities, lifecycle actions, confirmation flows, and draft/Save semantics are retained. Deviation from 05 §4/5’s default 52/14 metrics is explicitly requested by the owner and limited to this surface family.

Validation: final `npm run check:required` passes (Mobile 260 suites / 2,540 tests; all workspace typechecks, protocol/Relay/Bridge checks, 172 UI sources, strict 19-locale catalogs and docs). Updated the exact token/divider expectations and added selection/concurrent-save coverage. One intermediate full run hit the pre-existing reply entrance timer test; the final full run passed without changing that hook or test. `git diff --check` passes. Local light/dark/home/appearance study: `docs/3.0/evidence/settings-refinement/preview.png`; it is a layout preview, not a native screenshot. Physical-device acceptance remains owner-performed. No simulator, pairing refresh, build install, service restart or deployment.

### 2026-09-13 — Owner timing adjustment

Increased the shared local-send reply presentation gap from 240ms to 500ms at owner request; network sending remains immediate. Updated the existing timer boundary regression to 499ms + 1ms.

Owner follow-up: increased the same presentation gap to 1000ms; network sending remains immediate. Timer boundary regression updated to 999ms + 1ms.


### 2026-09-13 — Skills management: approved inline-switch design

Owner approved the interactive design and requested full implementation. Removed the Installed/Discover segmented control; a capability/operation-gated Compass header action pushes discovery through the existing native stack, preserving installed search/scroll. Installed skills use white canvas, flat search, total/enabled counts and borderless 88pt-minimum rows with name, one-line description, independent neutral switch and detail disclosure. Missing requirements remain distinct from enabled state; Always on and read-only adapters do not expose an editable switch. Detail is scrollable, shows status/source/requirements, and retains capability-gated uninstall.

Writes keep native controls mounted and rows alphabetically stable, block duplicate requests, preserve the previous value on failure, keep acknowledged writes when refresh fails, and discard stale Agent/adapter completions. Focus return quietly reloads status. Installation enters the selected Agent chat after successful request and sheet dismissal; closing the pending detail cancels deferred navigation. Uninstall confirmation follows sheet dismissal. All 19 locales gain 10 translated keys; two obsolete Enable/Disable button keys are removed. Product spec, Mobile instructions and design guide updated. No backend, transport, deployed service, pairing or native dependencies changed.

Validation: initial full `check:required` passed (Mobile 260 suites / 2,555 tests, all workspace types, protocol/runtime suites, design-system, strict 19-locale and documentation gates). Final focused UI/model/shared-search regression run passed 63 tests, including both OpenClaw and Hermes switches, failed writes/refresh, offline cache, scope changes, discovery races and dismiss-before-install-completion; final Mobile typecheck passed. Final complete `check:required` rerun passed with Mobile 260 suites / 2,559 tests, all workspace types/tests, design-system, 19-locale strict checks and docs checks. Native visual acceptance remains HT-SKILLS-0913; no simulator/device operated, release installed or service deployed.


### 2026-09-13 PR #32 stability review fixes

- Stop waits for child exit; Start waits through stopping owners and confirms the new supervisor. Added real-process concurrent and sequential Stop/Start regression.
- Installer allocates fresh snapshot directories and checks CLI startup before activation. Windows-only failure-injection test preserves active/rollback manifests across repeated failed installs.
- CLI tests now isolate both HOME and USERPROFILE: native Windows homedir ignored the previous HOME-only fixture, breaking Hermes watchdog CI. Production Hermes behavior is unchanged.
- Local validation: full `check:required`, Bridge 292 tests, supervisor 3 real-process/diagnostic tests, and v1 replay 36 tests passed. Windows CI also passed the previously failing Hermes watchdog and new supervisor/installation-failure checks on the implementation commit; final PR-head CI remains the merge gate. No live service restart or cloud deployment for this review.

- Final-head Windows rerun exposed a PowerShell cold-start timeout in the new missing-path ACL regression. Bounded the subprocess at 10 seconds and its test at 20 seconds; permission assertions remain fail-closed.

### 2026-09-14 — Session Panel row polish: one size down, 6-point signal dot

Owner reviewed the merged Session Panel on device and found it noisy: too much text, too large, and the 12-point unread dot too heavy. Styles only, no behavior or model change. Rows now sit one tier below the roster (the 40-point tile sets the scale): `secondary` 600 title with the `caption` `inkTertiary` time on the same line, `caption` preview (ink when unread) with the unread / attention dot on the same line, the dot reduced to `StatusSize.dot` (6 points — its first consumer). Chip and Subagents counts move to `inkTertiary`; the Subagents chevron drops to `IconSize.sm`; skeleton lines follow the new line heights. Docs 04 §4, 05 copy budget and Mobile AGENTS updated to the new tiers.

Validation: SessionPanel suites (30 tests, dot-size assertions added), `check:ui-style` (178 files; panel still at three `FontSize` tiers) and `check:docs` pass. No device was operated; the before/after was shown as a mock, real-device acceptance remains with the owner. Not committed.

### 2026-09-14 — Cron management: approved guided creation and full-page editing

Implemented the owner-approved design: borderless schedule/next-run rows with independent switches; native-stack create/edit pages; eight templates, daily/weekly multi-select/workday/weekend/interval/once controls and native date/time input; structured schedule validation and next-three-run estimates. Thread drafts enter the form directly. Existing custom expressions, timezone, interval anchor, stagger, payload and delivery metadata survive unrelated edits. Croner 10.0.1 is a pure-JS dependency used without callbacks/timers, matching the OpenClaw scheduler; portable five-field validation applies to new/changed rules only.

Optional central `cronTimeZone` / `cronAdvanced` capabilities gate actual support. Hermes shares the core guide but keeps Agent timezone, whole-minute interval precision and enabled creation. Runs load independently and page without hiding jobs or drafts; notification delivery is distinct from execution status. Native back gestures protect dirty edits; scoped caches, synchronous write locks and late-completion guards preserve acknowledged writes and avoid cross-Agent updates. Existing heartbeat controls remain available. Added 62 translated keys across all 19 locales; removed four obsolete freeform-editor/action keys. Updated Mobile/protocol instructions, product specification and design recipe.

Validation: `npm run check:required` passed, including all workspace typechecks, protocol coverage, Mobile 265 suites / 2,609 tests, Relay/Bridge required tests, 178 UI source checks, strict 19-locale catalog validation (1,185 keys / 22,515 translations; no missing or removable keys), and documentation checks. iOS and Android production JS/Hermes-bytecode exports both succeeded; these are not native builds or device acceptance. Fixed the existing Jest `remend` mapping to resolve both workspace-local and hoisted dependency layouts after installation. `metrics:loc` passed (whole dirty working tree: 109,899 non-test TS/TSX lines, 76,588 test lines, 325 test files; not a task-specific delta). No native dependency change, simulator/device operation, service restart, pairing refresh or deployment; native visual acceptance is HT-CRON-0914.

### 2026-09-14 — Add sheet: `Attach N photos` unreachable at the resting detent

Owner reported on device that picking recent photos in the Thread Add sheet showed the pick badges but no way to confirm. Root cause: the sheet rests on fixed 62% / 92% detents and gorhom lays the content container out for the tallest detent, so the inline footer at the bottom of the body sat below the fold at 62% (only visible after dragging the sheet up). Fix: `Sheet` gains a `footer` slot rendered through gorhom's `BottomSheetFooterContainer` / `BottomSheetFooter` (pinned to the visible bottom edge at every detent, safe-area padded, canvas surface); it is rendered inside the `accessibilityViewIsModal` view through a stable context-fed component so VoiceOver reaches it and label changes never remount it, and the body shrinks by the footer's measured height so the last row is never covered at the top detent. `ThreadAddSheet` moves the ink `Attach N photos` button into that slot with a one-time rise on selection (persistent shared value; reduced motion snaps). Mobile AGENTS and design-system docs record the slot.

Validation: new `Sheet` footer suite (2), Add sheet suite (6, footer-slot assertion added), Thread / ui / chat suites 33 / 316, mobile `tsc` and `check:design-system` (178 files) pass. No device operated; visual acceptance remains with the owner. Not committed.

### 2026-09-14 — Paywall: member layout, no dead `Current plan` button

Owner reviewed the member paywall on device with a lifetime test account: three plan cards were stacked flush against a disabled `Current plan` button, and the owned card was dimmed like the locked ones. Root causes in `PaywallScreen`: the member branch forced monthly visible and dropped the `View monthly plan` link that had been the only spacing between plans and checkout (footer gap is 4 points), the owned plan reused the generic locked opacity, and the checkout button rendered even when the selection was the plan already owned. Confirmed the unsubscribed view is unchanged (annual + lifetime side by side, monthly behind the disclosure link) and that plan changes keep their semantics: monthly members open on `Change to annual`, annual members on `Buy lifetime`, lifetime owners on the owned plan.

Changes: `PaywallPlanCard` gained a `current` state (locked, `surface` fill, never dimmed; the accent outline stays with the selected card). Members now see the owned card plus only the plans they can still move to, so a lifetime owner sees one row-layout card; the full locked catalog remains the fallback when the owned plan cannot be matched. A selection that is the owned plan renders no checkout button or billing caption — `Manage subscription` is the only action — while failure and renewal notices still render. The checkout block keeps a 12-point top margin whenever the disclosure link is absent and `Manage subscription` sits 12 points below it. Compact two-up cards now require exactly two cards.

Validation: `PaywallScreen` suite 35 tests (4 new: lifetime owner, hidden locked alternatives with failure notice, unmatched-plan fallback, owned-card styling and spacing), paywall/pro suites 63 tests, mobile `check:design-system` (180 files) pass; the only `tsc` error is the unrelated in-progress `OnboardingScreen` change from another session. Rules recorded in `apps/mobile/AGENTS.md`, `docs/design-system.md` and `docs/pro-plan-management.md`. No purchase, connection, simulator or deployment was touched; device acceptance remains with the owner.

### 2026-09-14 — Identity long-document recovery

Owner approved retaining core editing after the six-month PostHog investigation (project 337268, Mar 14–Sep 14, Asia/Shanghai): File Editor 4,689 views / 610 users; coreFileEditing paywall 339 / 172 users, subscribe 15 / 12, purchase-success 8 / 8. No save-success instrumentation existed; attribution also includes skill editing and does not independently certify non-sandbox revenue. Legacy skill source editing existed; current SkillsSection has no source editor, recorded as a separate migration gap rather than widening this patch.

Identity now uses a bounded 93% document sheet, integrated scroll, selectable Markdown, header Edit and pinned save actions. Source is preserved, failed drafts remain editable, dirty cancel confirms, duplicate file writes and stale paywall continuations are guarded. Added bounded privacy-safe edit/save-result telemetry. No native dependencies, services, pairing or device operation changed; owner performs visual/keyboard acceptance. Validation: complete `check:required` passed (workspace types/tests, 180 UI files, strict localization and docs); final Identity/analytics 2 suites / 40 tests and design-system checks passed. The initial concurrent build attempt hit transient dist cleanup contention; the subsequent complete gate passed. Final targeted regressions cover long raw-source preservation, failed drafts, dirty cancel, Pro continuation and telemetry privacy.


### 2026-09-14 — Identity device feedback: truncated Edit and floating footer

Owner screenshots exposed two defects missed by the mocked regression suite: a padded text Button was squeezed into SheetHeader's 44-point icon slot, truncating Edit; the keyboard-following save footer also left an undesirable floating action area. Identity now uses existing FloatingButton Pencil/Check header actions for read/edit, Close with dirty confirmation, and a stationary error notice above the scrolling document. Removed the Identity footer entirely; shared Sheet/footer consumers are unchanged. This supersedes the initial footer recipe above. No device operated; owner verifies native keyboard behavior. Targeted 29 tests, mobile typecheck, complete design-system checks and documentation checks passed.

### 2026-09-14 — Thread: multi-image messages rendered as one album

Owner reported on device that a six-image message showed only three cropped thumbnails, no way to scroll, and a clipped first tile. Root cause: the 3.0 `ThreadView` rewrite replaced the 2.0 Telegram-style image grid with a stub gallery (`slice(0, 3)` of 88-point squares plus an inline `N attachments` row in the same flex row, one Pressable opening the viewer at index 0); the row overflowed the screen and `alignSelf: 'flex-end'` pushed the overflow off the left edge. The data layer (`imageMetas`, history image cache, `useImageDimensions`) was intact.

Delivered: `components/chat/attachmentAlbumLayout.ts` (pure geometry: single image at its own aspect, rows of at most three split by aspect with the fuller rows last, clamped row heights, 3-point gaps, corrupted sizes treated as squares) and `MessageAttachmentAlbum` (album clipped at the bubble radius, 76% of the row content width, per-tile `imagebutton` labelled `Photo N of M`, taps open the viewer at that index, long press forwards to the row actions). `ThreadView` / `ThreadScreen` pass the tapped index through `onOpenAttachments(message, index)` (clamped in the screen); `ThreadCopy.formatPhotoPosition` and the `chat` key `Photo {{index}} of {{count}}` were added to all 19 locales. Nothing about sending, caching or backends changed; OpenClaw and Hermes share the renderer.

Validation: 10 layout tests, 5 album component tests (including lazy size resolution and a failed lookup), ThreadView/ThreadScreen suites updated (six-image album geometry, single-photo aspect, tapped index, long press), chat component suites 13 / 147 tests green; `check:ui-style` (180 files) and strict localization pass; `tsc` reports only the pre-existing in-progress `Onboarding` `local-model` errors from another session. Simulator (iPhone 17, Metro debug build): seeded the local image cache for the owner's six-screenshot message and confirmed the 3×2 album in dark and light mode, viewer opening at `5 / 6` from the fifth tile, and long press lifting bubble plus album into the actions overlay. Noted separately: the Gateway history for that message carries no image blocks or truncation marker, so a second device shows the text only — a pre-existing cross-device limitation of the sender-side image cache, not changed here.


### 2026-09-14 — Restore paid skill source editing

Owner requested restoring the 2.0 skill editor and confirming Memory monetization. Identity still gates USER/SOUL/MEMORY saves through coreFileEditing. Installed Skills now open default SKILL.md through the retained backend-neutral skills.get/content-update adapter contract; no generic file writes or backend/source changes. Details dismiss before source presentation. Both backends share selectable Markdown, Pencil/Check header controls, dirty close, retained failed drafts, write lock and stale continuation checks. The backend editable/binary flags gate changes independently of Pro. Ancillary linked-file editing is not advertised by the key-only write contract. Validation: complete check:required passed (Mobile 268 suites / 2,652 tests, workspace types/runtime tests, 181 UI sources, localization and docs). Targeted section/source/Pro regression: 46 tests passed for both backends, protected content and failed drafts. metrics:loc: whole dirty tree 110,565 production lines / 77,476 test lines / 329 test files, not a task delta; the added document component is consumer-backed. Owner performs device acceptance; no simulator, pairing or service deployment.

