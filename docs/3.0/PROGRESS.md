# PROGRESS · Clawket 3.0 进度日志

## iPad 配对键盘修复（2026-09-20，负责人真机确认恢复）

- 负责人在 USB 连接的 iPad Pro 11 / iPadOS 26.4.2 反馈：无外接键盘，配对框聚焦但软键盘不出现；其他 App 正常，切换回来后键盘出现但遮挡输入。
- iPad 关闭 KeyboardProvider 默认隐藏 UITextField 预热（针对首次 responder 时序风险，尚未确认是根因）；配对页改用 RN 原生 ScrollView keyboard inset / 焦点避让，同时禁用原 controller padding 与 reveal 滚动，避免两套避让共同调整。iPhone / Android、两后端配对协议未改。
- 回归：Onboarding / 路由 / reveal / composition-safe 输入共 4 suites、39 tests 通过，新增 iPad OpenClaw 数字码和 Hermes 字母码输入提交覆盖；Mobile typecheck、设计系统、docs 通过。iPad mini / iPadOS 27 模拟器实际点击屏幕数字键输入 123456，连接按钮启用；横屏再聚焦，键盘出现且配对框移到键盘上方。未用无效测试码发起配对。该模拟器曾因虚拟硬件键盘抑制软键盘，已通过 Device Hub 关闭模拟硬件键盘；这不能解释无外接键盘的真机报告。
- 第一轮真机冷启动复测仍失败，排除“关闭预热即可修复”的假设。第二轮 iPad 改用完整 ASCII 键盘 + Go，绕开 iPadOS 26 浮动 numberPad；格式/长度校验与手机数字键盘不变。模拟器冷启动首次点击已显示完整键盘并把输入框滚到键盘上方；最终相关 39 tests 与 typecheck 通过。当前物理 iPad 已连到本仓库 Metro，JS 改动无需重编译，第二轮负责人在同一台真机反馈“现在好了”，本次配对键盘故障确认恢复；不扩大为其他 iPad 验收项全部通过。Device Hub 真机屏幕共享要求 iPadOS 27，无法在此 26.4.2 设备上代替负责人观察；LLDB 连接未能完成有效检查，未据此作根因结论。


## 发布前审查跟进（2026-09-20，负责人授权修复）

- 负责人决定：非主会话付费墙维持现状；语音交给负责 Agent，本轮不修改。生产/服务端尚未发布是已知状态。
- 恢复本机配置备份删除：可离线使用、不收费，确认后删除，失败保留条目和重试；可选适配器方法兼容旧实现。恢复技能关联文件入口：共享文档页打开 scripts/references 等文件，只读且保留主文档编辑边界；OpenClaw Bridge 补有范围/大小/数量限制的辅助文件读取，拒绝越界、符号链接、隐藏/未列出路径。
- Cron mock 的 model 字符串 / null / 缺省分支补回归，协议包 100% 分支覆盖率恢复。
- PostHog 实查：明确新建仅 3.0.0 的 4 次 / 3 标识；2.x 无独立埋点，切换不能当新建。保持入口现状，见 [查询记录](session-creation-analytics-2026-09-20.md)。
- 已准备双后端固定 Registry 恢复包、完整性检查、损坏输入回归及六阶段本地发布矩阵；配对写入保留安全边界，旧验证路由用于应急降级。执行说明见 [恢复操作单](registry-recovery-runbook.md)。没有发布生产或执行云端迁移；首次云端迁移仍须专用隔离资源演练，不能将本地结果写作云端签字。
- 最终验证：协议分支覆盖率 100%；Mobile 302 suites / 3,102 tests 全过（此前 Cron 用例本轮首次全量仍失败、定向与最终全量通过，保留不稳定记录）；Relay/shared/Registry 202、Bridge 344、v1 39 全过；恢复矩阵 4 组合 × 6 阶段共 24 阶段及持久限速断言通过；恢复工具 3 项、双生产配置 dry-run、全工作区 typecheck、设计系统与 docs 均通过。最终 `check:required` 仅止于既有 5 个未使用翻译键，missing=0；未清理其他任务的翻译改动，不能宣称发布门禁全绿。日志与唯一可用恢复目录 `registry-recovery-safe` 均归档于 `evidence/pre-release-audit-2026-09-20/`。


## 发布前产品保全与连接审查（2026-09-20）

- 完成对当前工作区、已发 2.1.0 源码与改造前快照的研究；结论见 [审查报告](pre-release-audit-2026-09-20.md)。未修改业务代码、部署、重启用户服务或购买。用量/付费证据引用既有 PostHog 调研，本轮没有重新查询分析库。
- 确认待处理：非主会话 Pro 预览的旧用户宽限只识别多连接/非主 Agent，主 Agent 渠道会话与单连接 Hermes 其他会话没有过渡（实际纯函数复现）；备份删除漏迁移；技能辅助文件浏览仍缺；App 新建会话为明确删减，建议结合聊天定位复核。最近已恢复的 Usage、Files/SKILL.md 编辑、模型/渠道管理、发现与收藏均不再列为未修复遗漏。
- 本轮重新验证：v1 39、Relay/shared/Registry 202、Bridge 343、集成 8、Speech 20 全通过；Production snapshot × 双后端/新旧 Bridge 的 4 组合/20 阶段通过，线上版本 ID 与 09-16 导出快照一致。Bridge 构建/包验证和设计系统通过。required 在协议分支覆盖率 99.54% 失败；独立 Mobile 3,096/3,098（CronEditorScreen 两失败，该套独立复跑 20/20）；i18n missing=0 但五个 unused key 阻断。没有把定向绿灯写成全仓通过。
- 云端只读确认 Production 仍是旧服务，OpenClaw 双服务缺 PAIRING_TICKET_SECRET，npm latest 仍 0.7.0；当前账号语音只有 Preview。首次 Registry DO 迁移前向恢复、生产语音/隐私披露、真实旧包/商店权益及双设备真机验收仍需关闭。较早 Android Gradle 失败已有更新成功日志，未当成当前失败重复上报。证据归档 `evidence/pre-release-audit-2026-09-20/`。

## iPad 自适应工作区（2026-09-20，实现与自动验证完成）

- 负责人批准双栏 / 窄窗单栏方案并授权模拟器与本机双后端测试；范围见 `23-ipad.md`。复用花名册和原导航，窗口变化不卸载聊天；阅读宽度、图片宽度、设置页与小窗口弹层同步适配。iPad 四方向 / 多任务与手机竖屏隔离。未发布或提交。
- 自动验证：相关 8 suites / 163 tests、Mobile typecheck、设计系统（200 UI 文件）、文档检查、v1 兼容 5 suites / 39 tests 通过；iOS Simulator Debug 与 Android arm64 Debug 构建成功。Mobile 全量 301/302 suites、3097/3098 tests 通过，唯一失败仍为开工前已记录的 CronEditorScreen 页面期望；required 仍由既有协议包 mock.ts 分支覆盖率 99.54%（要求 100%）阻断，不能宣称全仓门禁全绿。
- 真实后端：本机 OpenClaw authenticated Gateway CLI、Hermes Local Bridge WebSocket → Hermes API，分别在独立测试会话收到 `IPAD_OPENCLAW_OK` / `IPAD_HERMES_OK`；关闭并新建请求连接后可读取测试历史。另在 iPad Pro 11 M5 / iPadOS 27 模拟器 App 连接 OpenClaw，经 App 自带 deep-link 确认发送并看到 `IPAD_APP_OPENCLAW_OK`。Hermes 尚未完成 App 内发收验收，不能以 Bridge 测试替代。
- 模拟器 UI 已检查：横屏双栏、侧栏收起/展开、竖屏单栏/花名册遮罩抽屉、居中会话面板、设置限宽与返回、浅/深色。聊天组件挂载和草稿跨宽度保持由自动回归覆盖；真实输入法、外接键盘、系统分屏及后台恢复尚未验收。Device Hub 的坐标/键盘自动化报 `noWindowsAvailable`，可访问文本输入报 `unknownType`，因此未把链接发送说成输入框发送通过。真机项见 HT-IPAD-0920。
- 开发机日志与脱敏结果归档：`~/.config/clawket/ipad-validation/20260920/`。iOS 模拟器构建安装在本机测试模拟器，未改动用户真机或 Hermes 外部源码。

## 连接选择页开源说明（2026-09-19）

- 负责人最终文案：「本项目开源」「Clawket 不会在服务器保存你的数据」，19 种语言同步。
- 四个连接选项下方新增简洁的开源、隐私说明及 GitHub 仓库链接；复用公共仓库地址、主题与文字按钮，19 种语言同步。只改选择态 UI，连接与配对行为不变。
- 按负责人要求，界面验收直接交给负责人，不做模拟器或真机验收。

## 语音启动与连击修复、整个输入区长按（2026-09-19）

- 负责人真机反馈准备状态偶发退回、连击一段时间无法启动，要求整个输入区长按并参考以撒图鉴的提示。代码定位：原手势在 `onPressIn` 就开启录音，`onPress` 未标记点击结束，`onPressOut` 的下一轮清理会在 touch-end 缺席/晚到时取消；取消立即显示 idle，但 active 仍等待旧 identity/连接请求返回，后续点击被吞。迟到 finally 还可能覆盖新状态。
- 修复：麦克风 tap 在 onPress 才启动，长按在阈值达到时启动，点击完成显式结束手势，准备中重复点击不取消。取消等待原生 start/stop/audio-mode 清理后立即释放 active，不等网络；每次清理只执行一次且只改变自己拥有的状态。保留本机原生 teardown 的互斥，避免旧录音清理停止新录音。
- UI：整个空白或未聚焦的紧凑输入区作为稳定长按目标，点按打字；有文字且聚焦/展开后恢复原生选字/粘贴。原生输入与底部模型工具栏保留挂载。空态“打字，或按住说话”，短按住后松手提示“按住久一点再说话”，中文准备提示缩短为“正在开启麦克风…”。19 语言同步。
- 验证：新增 tap 事件顺序三种情况、准备连击、两处长按入口、整块输入区与编辑触摸归属、慢连接取消重开和旧 finally 隔离回归；最终相关 6 suites / 210 tests 通过，空白聚焦后的整区手势补跑 UI 33 tests 通过。真实 Preview 同一设备签名握手中取消 → 立即重开 → 再重开，后两次均 task-ready 后正常取消。全仓 typecheck、设计系统与文档检查通过；required 仍在协议包既有分支覆盖率 99.54%（要求 100%）处失败；i18n missing=0，5 个既有无关旧键仍阻断 strict。此轮仅 JS/文案，无新增原生依赖或云端部署；真机需重新验证 HT-VOICE-0919。

## Chat 阿里云语音输入（2026-09-19，重启后恢复验证）

- 负责人授权替换 iOS 原生转录，参考 Isaac Codex 的 PCM + Qwen 流式方案。已删除原生识别模块与 Speech 权限声明；新增 Expo Audio、独立 speech Worker、服务端专用受限 Key。录音波形、点击持续听写、按住松手发送、上滑取消、停止回填、失败内存重试已接入；常驻模型工具栏保留。OpenClaw/Hermes 走同一现有发送/排队入口。
- Preview 云端链路已用 2.819 秒英文合成音频实测成功，返回完整句子。修复实测发现的 Workers `redirect:error` 不支持及新版 WebSocket 默认 Blob 两项兼容问题，并加入准入/升级回归测试。未部署 Production 或发布 App。
- 阶段验证：语音相关 6 suite / 66 tests、服务端 5 suite / 20 tests 通过；Android arm64 Debug 用项目 Gradle 9.3.1 构建成功（559 tasks）。全仓 typecheck 通过；required 门禁被无关协议包分支覆盖率 99.54% / 要求 100% 阻断（现有 `mock.ts` 改动）。iOS arm64 Simulator Debug 构建成功；中文 4.371 秒合成音频也返回完整句子。最终 Mobile 全量：301 suites，300 通过；3061/3062 tests 通过，唯一剩余失败为无关 CronEditorScreen 的既有页面期望。语音生命周期追加原生状态事件先后顺序、权限读取期间取消不弹迟到权限框、显式转录文本绕过旧草稿两后端回归；生命周期最终 17 tests 全部通过。v1 兼容矩阵 5 suites / 39 tests 通过。文档与设计系统检查通过；i18n missing=0，5 个无关旧键（Header action / Models）阻断 strict。Expo 依赖检查仅提示 8 个已有包新补丁，未升级无关依赖；新增 Expo Audio 版本符合 SDK。全部日志保存在开发机 `~/.config/clawket/voice-validation/`，真机观感与硬件麦克风仍待 HT-VOICE-0919。
- 实现规范见 `22-voice-input.md`；取代 `04` 的“语音沿用现有”及旧双环反馈方案，属于负责人明确授权。付费墙为后续阶段：此轮预留服务器权益校验边界，不把设备签名或客户端 Pro 标记当订阅授权。


## 渠道 tab 找回 2.0 的私聊会话范围与账号开关（2026-09-19）

- 负责人问 2.0「设置 Agent 默认 main session 响应渠道」的页面去哪了。核对 `717f265^`（3.0 基线前最后一版）：2.0 Console → Channels（`components/console/ChannelsView.tsx`）顶部是「DM Scope Settings」四选一（Global / Per Sender / Per Channel + Sender / Per Account + Channel + Sender，写 OpenClaw 全局 `session.dmScope` 并确认重启），下面每个渠道卡里每个账号带启用开关（写 `channels.<id>.accounts.<aid>.enabled`）和「In 3m ago · Out 1h ago」。3.0 的 `ChannelsDevicesSection` 频道 tab 从 M5 首版起只有名称 + 状态只读行；`10-migration-map.md` 第 20 行写的是「迁移合并」而非删除，`00-decisions` 没有砍它的决定，`04` 只写了「分段页：渠道 / 设备 / 节点」，PROGRESS 无偏离记录——与 09-16 模型页同一类「迁移只做了一半」。PostHog：2.0 渠道页 923 人触达，但 2.0 未给 dmScope 切换与账号开关打埋点，无使用量数据。
- 协议：`Capabilities.channelManage`（可选精化，OpenClaw true，Hermes / YouMind / local-model false）；`ChannelsOperations` 改为 `Partial`，加性新增 `getRouting` / `setRouting` / `setAccountEnabled` 与 `DM_SCOPES` / `DmScope` / `ChannelRoutingSettings` / `ChannelAccountEnabledWrite`；mock 适配器按能力补默认实现。vitest 30 tests 通过，本次改动分支全覆盖（`mock.ts` 唯一未覆盖行在并行会话新加的 `mockCronPayload`）。
- OpenClaw 适配器：`utils/gateway-settings.ts` 恢复 `parseDmScope`（未设置按 `main`）/ `buildDmScopePatch`，新增 `buildChannelAccountEnabledPatch`；写入先读 hash、`config.patch`、`ok:false` 抛 `server` 错误（`gateway-adapters.recorded` 新增 1 例）。Hermes 不改。
- Mobile：频道 tab 顶部「Direct messages」行（尾值当前范围，`—` 直到读到配置）→ 四项选择弹层（标题 + 一行说明 + 当前项勾号）；渠道行可点 → 渠道弹层（`Accounts` 小标题、账号名 + 默认后缀、`Received · Sent` 副标题、`ThemedSwitch`）；两种写入都经 `ConfirmationModal`（一句后果 + 通用重启句），成功后本地镜像 + 静默只刷状态（`loadView('channels', true)` 不出骨架、不重读 routing——写入值即权威），失败留在弹层 `Banner`、开关不假动。`channelManage` 为 false 时无「Direct messages」行、账号行只显示 Enabled / Disabled。不进付费墙（2.0 免费，与工具页一致）。埋点 `channel_dm_scope_changed{scope}`、`channel_account_toggled{channel, enabled}`：`scope` 限四值，`channel` 限 OpenClaw 内置渠道 id 否则 `other`，永不带账号 id。
- 文案 22 键 × 19 语言（`settings`），`i18n:check` `missing=0`（剩余 5 个 removable 键仍是并行会话的模型页 / 头部改动）。测试：`channels-devices-model` +4、`ToolsChannelsSections` +3（改范围取消 / 确认 / 选回当前项；账号开关失败保持真实值、成功镜像并静默刷新；无 `channelManage` 只读）、`gateway-settings` +2、`events` +1。`check:ui-style` 198 文件通过；Mobile `tsc` 除并行会话进行中的 `model-config-delete.ts`（`hasPolicyAllowEntry`）外无错误；`AgentSettings` 目录 38 suites 中 36 通过，失败的 `AgentSettingsScreen`（红字确认）与 `CronEditorScreen`（编辑页）两例在另一会话正在改的 Cron 文件里。
- 文档：`01` 能力矩阵与 `channels` 操作、`03` 适配器映射、`04` §5 新增「渠道 tab」段与行表、`07` 两个事件、`apps/mobile/AGENTS.md`、`design-system.md`、`packages/agent-protocol/AGENTS.md`；偏离表 `[UX-2026-09-19-channels-tab]`。未提交、未真机验收（HT-CHANNELS-0919）。
- 已知边界：`session.dmScope` 是 OpenClaw 全局设置、只管私聊（群 / 频道消息本来就各自隔离）；较新的 `session.groupScope` 与渠道级 dmScope 覆盖本次未暴露（2.0 也没有）。当前 OpenClaw `hybrid` 热重载下 `session.*` 与 `channels.*` 实际不整机重启，确认文案沿用全 App 统一的「This will restart Gateway」句以兼容旧 Gateway。

## 工具页：保存按钮回到页头，档位与开关改动可见可存（2026-09-19）

- 负责人真机反馈：切换「工具档位」后下面的开关会跟着变，但功能没变，也找不到保存按钮，怀疑保存漏做了。核查：保存链路完整——档位与开关只改本地 `draftPolicy`，`tools.save` 走 `config.patch` 写 `agents.list[{ id, tools }]`（OpenClaw `config.patch` 开了 `mergeObjectArraysById`，按 id 合并不覆盖其他 Agent，与 2.x 同形状），单测覆盖。真正的问题是「放弃 / 保存 (N)」这一行渲染在 `ToolsSection` 的最末尾、又整体塞在父页 `ScrollView` 里：几十个开关翻到底才看得见。2.x `ToolsView` 是 FlatList 之外的 sticky 底栏，3.0 迁移时退化成了滚动内容；而 3.0 的 Identity / Document / Models / Cron 编辑页都是「页头 ghost 保存 + 脏状态返回确认」，工具页是唯一例外。
- Mobile：`ToolsSection` 删除滚动末尾的按钮行，新增 `saveRequest` / `onEditorChange({ dirty, saving, editable })` 契约（只有新的 `saveRequest` 才打开确认；取消后再改草稿不会重新弹；卸载时上报清零），重启确认由 `Sheet` 改为 `ConfirmationModal`（标题「应用 N 项更改？」，正文 = 重启一句 + 「保存后 x/y 个工具将启用」，确认「保存」；先关弹窗再写，进度由页头按钮的 spinner 承担）。`AgentSettingsSectionScreen` 在 `section === tools` 时于页头右侧渲染 ghost「保存」（草稿脏且可编辑才可用），并用 `usePreventRemove` + `ConfirmationModal`（丢弃 / 继续编辑）拦截脏状态离开；写入中静默阻止离开。删除 `settings:Save ({{count}})` × 19 语言。
- 文档：`apps/mobile/docs/design-system.md`「Tools page — September 19」、`apps/mobile/AGENTS.md` 设计系统段新增工具页一条。
- 验证：`ToolsChannelsSections.test`（重写保存用例：宿主驱动、取消不重弹、卸载清零、埋点）与 `AgentSettingsSectionScreen.test`（新增页头保存 + 脏离开守卫用例，补 `usePreventRemove` / `Button` mock）通过；全量 Mobile jest `--runInBand` 296 suite / 2990 tests 中 295 / 2988 通过，仅 `CronEditorScreen.test` 两个「加载更多」用例失败，属并行会话进行中的 Cron 编辑页改动；Mobile typecheck 中本次文件无错误（剩余错误在并行会话的 `ThreadPrimitives.test` / `SkillDiscoverScreen.test`）；`check:ui-style`（198 文件）、`check:docs` 通过；`i18n:check` 本次键已清理干净，剩余 missing / removable 全部来自并行会话的 Channels / ClawHub / 模型页。未提交、未真机验收（HT-TOOLS-SAVE-0919）。

## 全局搜索：灰底输入框与空查询态（2026-09-19）

- 负责人截图反馈：搜索页头部「全都是白的」，输入框要不要加浅灰底；没有最近搜索时下面一片空白，看不出能搜什么，要不要捞最近消息或「猜你想搜」。
- 现状核查：`SearchInput` 默认 `floating` = 纯白 `surfaceFloating` + 0.04 透明度阴影铺在纯白 `canvas` 上，几乎看不见边；Thread 头部已是「白色浮起返回圆 + 灰色 `HeaderPill`」、Skills / Models 页搜索框已用 `quiet`，搜索页是唯一用浮起阴影画文本框的地方。更实际的问题：`listFavorites` 只有 `SearchScreen` 与 `message-detail` 调用——收藏消息在整个 App 里只有搜索页一个入口，还必须输入命中关键词才出现，用户收藏后无处可翻。PostHog：3.0 未发，`search_performed` 60 天 3 人；2.0 Chat History 30 天 24 人，低频页，首要是第一印象与「能找到我存的东西」。
- Mobile：`SearchView` 输入框改 `appearance="quiet"`（返回键仍为白色 `surface` 圆），占位「Agent、会话和消息」；`buildSearchModel` 空查询时返回 `favorites`（复用收藏结果构建，免费用户照旧带锁 + `messageHistory`），`resolveSearchPageState` 新增 `favoriteCount`；空查询下「最近搜索」之后新增「收藏」节（`SearchResultRow`，先 `SEARCH_FAVORITES_PREVIEW_LIMIT`=5 条，「全部 N 条收藏」一行就地展开），两者皆无时居中一句「搜索 Agent、会话，以及这台设备上打开过的聊天消息」替换「暂无最近搜索」。不做最近会话 / 最近消息列表（与花名册重复）和「猜你想搜」（无信号可生成）。19 语言新增 3 键、删除 `No recent searches`。
- 文档：`04-app-screens.md` §7、`design-system.md` §8「Search empty state」、`apps/mobile/AGENTS.md` 导航段。
- 验证：`src/screens/Search` 5 suite / 51 tests 通过（模型新增空查询收藏列表与页面状态用例，视图新增收藏节展开 / 空态文案 / quiet 输入用例，容器新增收藏透传用例）；Mobile typecheck 中 Search 无错误（剩余 9 个错误在并行会话进行中的 `AgentSettingsSections.test` / `ChannelsDevicesSection` / `SkillDiscoverScreen`）；`check:ui-style`（198 文件）、`check:docs` 通过；`i18n:check` 中本次键全部 19 语言齐全、无 unused，剩余 missing / removable 均为并行会话的 Channels / ClawHub / 模型页键。未提交、未真机验收（HT-SEARCH-EMPTY-0919）。

## 删除「聊天与通知」：回复完成提醒与语音输入语言（2026-09-19）

- 负责人问「回复完成提醒」是不是死的。核查：链路本身通（开关 → `run_finished` 带消息 → `expo-notifications` 本地通知 → 点开进会话），但只在 iOS、只对活动连接、在任何线程页都不响，且依赖 App 进程还收得到 WebSocket 的 `chatFinal`——`app.json` 无 `UIBackgroundModes`，切后台约 30 秒即挂起，`00-decisions` 又明确不做远程推送。2.x 是硬编码 `CHAT_REPLY_NOTIFICATIONS_ENABLED = false` 禁掉的，3.0 于 09-05 改成默认关的开关，未发布。PostHog：`chat_reply_notification_shown` 95 次 / 10 人、`_opened` 18 次 / 5 人，全部在 1.0.0 / 1.1.0 的 2026-03-16 → 03-22，之后半年零事件（同期 iOS 月活 1864 → 320）。负责人决定删除，并一并去掉「语音输入语言」（固定跟随系统），整个「聊天与通知」分段删除。
- Mobile 删除：`services/chat-notifications.ts` 及测试、App.tsx 的两个通知 effect / `openChatFromNotification` / `pendingChatNotificationOpen` 管线（`AppContext` 的 `requestOpenChatFromNotification` / `clearPendingChatNotificationOpen`、`useChatController` 的通知打开 effect 与滚动 ref、`ThreadScreen` 的透传）、`ThreadOrigin` 的 `notification`、`chat_reply_notification_*` 两个事件；`SpeechRecognitionLanguage` 类型、`StorageService.get/setSpeechRecognitionLanguage`（键 `clawket.speechRecognitionLanguage.v1` 不再读写，旧值留在 SecureStore 无害）、`resolveSpeechLocale`、`useChatVoiceInput` 的语言参数（原生层不再收 locale，跟随设备语言；`chat_voice_input_tapped.locale` 固定 `'system'` 保持事件形状）、`AccountPreferenceSheet` 的 `speech-language` 分支与 `useAppContext` 依赖；设置首页的「聊天与通知」行、`voice` / `notifications` 分段与 `AccountSettingsDetailSection`、section-model 的 `set-reply-notifications` / `replyNotifications` toggle、`AccountSettingsSectionScreen` 的偏好弹层插件（分段页已无偏好行）。`agent-protocol` 删除 `replyNotifications` 能力。14 个文案键 × 19 语言删除（`{{agentName}} replied`、`New message from {{agentName}}`、`Chat & notifications`、`Recognition Language`、`Reply Notifications`、`Voice`、六个语言名、`common:Chat` / `settings:Chat`），`expo-notifications` 包保留给节点通知。
- 文档：`04-app-screens.md` §6 / §10、`01-architecture.md` 能力矩阵、`07-analytics.md`、`design-system.md`、`apps/mobile/AGENTS.md`、`packages/agent-protocol/AGENTS.md`。
- 验证：Mobile typecheck 除另一会话进行中的 `AgentSettingsScreen.tsx`（`colors` 未定义）外无错误；agent-protocol typecheck + 30 tests 通过；Mobile 受影响 22 suite / 249 tests 通过（AccountSettings、navigation、useChatController ×3、ThreadScreen、useChatVoiceInput、speech、analytics、bootstrap）；`check:ui-style`（196 文件）、`check:docs` 通过；`i18n:check` 的 `missing=0`，剩余 5 个 removable 键仍是并行会话的。未提交、未真机验收（并入 HT-SETTINGS-APPEARANCE-0919）。
- 顺手发现：`AppContext.requestChatWithInput` 已无调用方（原 Prompts 功能残留），本次未动。

## 设置首页外观卡（2026-09-19）

- 负责人需求：① 聊天默认字号改成 17；② 「外观」子页里的主题 / 聊天主题 / App 图标放到设置首页，但不能把「外观」行直接换成三行把常用组拉长。
- ① 核查结果：代码里 `DEFAULT_CHAT_FONT_SIZE`（`features/chat-appearance/defaults.ts`）、`FontSize.body` 与 `ThreadView` 的默认值本来就是 17，仓库历史里从未是 16，无需改动；真机若显示 16 是设备上曾保存过的值（`clawket.chatFontSize.v1`），聊天主题页「恢复默认」即回 17。
- ② Mobile：`AccountSettingsScreen` 常用组去掉「外观」行（剩连接 / 聊天与通知 / 语言），其下单独一张外观卡：「主题」（`SunMoon`，原地 `AccountPreferenceSheet`）、「聊天主题」（`Palette`，`onOpenAction('chat-appearance')` → `ChatAppearance` 路由）、「App 图标」（`Image`，免费用户锁 + `appIcons` 付费墙续做，`appIcons` 能力为假时隐藏）；首页的语言弹层状态泛化为一个 `preference`，新增 `onPreferenceChanged` 把 App 图标变更回传给 App.tsx（与原分段页同一处理）。`appearance` 从 `AccountSettingsSection` / `section-model` / `ACCOUNT_ACTION_SECTION` 删除，不再有第二处外观入口。首页不加分节标题。
- 文档：`04-app-screens.md` §6、`design-system.md` Settings refinement、`apps/mobile/AGENTS.md` 导航段。
- 验证：Mobile typecheck 通过；`AccountSettings` 全部 + `navigation` 共 10 suite / 73 tests 通过（首页新增外观卡路由、Pro 锁续做与能力隐藏两个用例；分段模型与分段页的锁 / 禁用用例改到「聊天与通知」的识别语言行）；`check:ui-style` 通过（196 文件）；`i18n:check` 的 `missing=0`，5 个 removable 键（`Header action` 与 4 个模型页 `settings` 键）来自并行会话。未提交、未真机验收（HT-SETTINGS-APPEARANCE-0919）。

## 定时页默认落「运行记录」tab（2026-09-19）

- 负责人需求：Agent 主页的定时任务入口点进去，默认先锚定到「运行记录」；她判断这是通用优化，不只限于失败红字入口。原行为：只有主页有红字时才带 `cronView: 'runs'` 落运行记录，否则落「任务」tab。
- Mobile：`CronSection` 自己决定落点——任务列表首次就绪时，本 Agent 有任务且后端支持 `runs` 就落「运行记录」，没有任务落「任务」tab（空态直接新建）；落点用 ref 定一次，之后新建 / 删除不再自动切 tab，用户手动切换优先。删掉 `initialView` prop、`AgentSettingsSection` 路由的 `cronView` 参数与主页 `openRow` 里的红字特判（主页只导航到 `cron` 分区；红字仍在运行记录 tab 被记为已看，逻辑不变）。OpenClaw 与 Hermes 同一规则（两者都有 `runs`）。
- 文档：`04-app-screens.md` §5 与主页卡片表、`design-system.md` Cron management、`apps/mobile/AGENTS.md`。
- 验证：Mobile typecheck 在改动文件上无错误；`AgentSettingsSections.test`（有任务落运行记录 + 空 Agent 落任务且首个任务创建后不跳）、`CronEditorScreen.test`（列表用例统一先切到任务 tab）、`AgentSettingsScreen.test`（红字 / 无红字导航参数一致）、`AgentSettingsSectionScreen.test`、`navigation` 共 7 suite / 92 tests 通过。未提交、未真机验收（并入 HT-CRON-FAILED-0919 的落点检查）。

## 开发者选项新增「模拟免费账号」开关（2026-09-19）

- 负责人需求：账号已订阅，但想在真机上随时看各处付费墙的效果。做成纯 App 侧状态：高级设置（开发者分区）在调试模式下多一行 `Simulate free account` / `模拟免费账号` 开关（`LockOpen` 图标，排在「预览更新公告」之后）。
- Mobile：`ProPaywallProvider` 持有并持久化该标记（`StorageService.setSimulateFreeAccount`，SecureStore 键 `clawket.simulateFreeAccount.v1`），开着时 `isPro` / `requirePro` / `showPaywall` 与对外暴露的 `snapshot` 一律按免费账号处理（`snapshot` 置空，付费墙走免费版布局而非会员改方案布局），`EXPO_PUBLIC_UNLOCK_PRO` 也一并让位，RevenueCat 照免费用户流程初始化；从存储恢复标记之前 `isLoading` 保持为真，避免冷启动闪一下 Pro。RevenueCat、埋点订阅属性与 SecureStore 里的权益记录都不动，仍是真实订阅。关调试模式会顺手清掉它；付费墙里真的购买 / 恢复成功也会结束模拟（与真实免费用户购买后的体验一致）。业务代码不读这个标记，照常消费 `isPro` / `requirePro`。
- 文案 19 语言 `config` 命名空间 `Simulate free account`；`apps/mobile/AGENTS.md` 订阅段与开发者行说明同步。
- 验证：Mobile typecheck 通过；`ProPaywallContext.test`（+3：开关生效与还原、持久化恢复期间的 loading、恢复购买后结束模拟）、`section-model.test`、`AccountSettingsSectionScreen.test`（+1）共 38 项通过；`check:ui-style` 通过；`i18n:check` 的 `missing=0`，当前 4 个 unused `settings` 键来自并行会话未完成的模型页改动。未提交、未真机验收（HT-SIM-FREE-0919）。

## 弹层滚动失灵与执行记录对齐（2026-09-19）

- 负责人真机反馈：定时任务编辑页的「执行记录」弹层往下滚不动、一滚就自动弹回，且「任务 / 时长 / 通知」几行与下方正文、左上关闭键都不对齐。核对代码：`CronRunSheet` 是动态高度 `Sheet` 里套原生 `ScrollView`——Gorhom 弹层的内容拖动手势把滚动抢走再回弹；而把 `BottomSheetScrollView` 直接塞进动态高度弹层也不行（Fabric 先派发父 `onLayout`，滚动内容尺寸最后写入 `contentHeight`，弹层会按缺了头部的高度裁掉底部），所以统一走仓库既有配方：固定 `snapPoints` + Gorhom 集成滚动。对齐问题是 `SettingsGroup` 默认 16pt 行内边距叠在 24pt 内容边上、浅色下 `surfaceFloating` 与弹层 `canvas` 同色，卡片消失只剩缩进。
- 修法（Mobile）：`CronRunSheet` 68% / 92% + `BottomSheetScrollView`，元信息组改技能详情配方（无边框 `canvas` 组、行零横向内边距、comfortable 行高、`inset="none"` 通栏细线），与摘要文本共用 24pt 边；心跳表单 82% / 92%。同类排查后一并改掉：工具详情弹层（68/92）、线程运行结果 `RunResult`（新增 `presentation="sheet"`，去掉弹层里的 `paddingTop`）、帮助中心主题弹层、节点详情弹层、回复失败弹层（原本就是固定档但滚动是原生的）、聊天外观模糊 / 变暗 / 字号取值列表（七行以上者 62/92，五档不透明度保持动态高度）、OpenClaw 配置编辑器与命令选项列表（编辑器 93% 单档：输入框 `scrollEnabled={false}` 放进集成滚动，取消 / 保存行固定在滚动下方）。会话面板横向 chip 条不受影响。Files 详情弹层同期已被另一会话改成全页 `DocumentScreen`，未再处理。
- 门禁：`check:ui-style` 新增 `validateSheetScrollableUsage`——`Sheet` 内出现竖向原生 `ScrollView` / `FlatList` / `SectionList`（含别名、条件渲染）即失败，`horizontal` 条豁免，自测 5 条（含损坏输入 fail-closed），共 56 项。`CronEditorScreen` 新增执行记录回归（固定档、集成滚动、24pt 边、零行内边距、通栏细线）。文档：Mobile `AGENTS.md`、`design-system.md`、`04-app-screens.md`、`05-visual-system.md`。
- 验证：Mobile typecheck 在本次改动文件上通过（`AgentSettingsSections.test.tsx` 的类型错误来自并行会话的文档页重构）、`check:design-system` 通过（196 文件 / 56 自测）、`check:docs` 通过；受影响 32 个 suite / 319 tests 连续三次全绿，完整 `mobile:test` 中另 3 个失败 suite 属并行会话未完成的 Files / SKILL.md 文档页改造。未操作模拟器 / 真机，未提交；等负责人真机验收（HT-SHEET-SCROLL-0919）。

## Agent 主页「N 个失败」红字改为看过即消，并直落运行记录（2026-09-19）

- 负责人反馈：主页定时任务卡的红色「1 个失败」永远消不掉；点进去落在任务 tab，要自己切到「运行记录」往下翻很久才找到失败那条，回来红字还在。根因：3.0 的 `load-summary.ts` 直接数后端任务里「上次运行失败」的条数（还把 `lastError` 文本、`consecutiveErrors` 也算作失败），OpenClaw 只在下一次运行成功时才清这些字段——每天跑一次的任务失败一次红字挂 24 小时，一次性 / 已暂停 / 被自动停用的任务永远不消；2.0 的 `StorageService.ackCronFailures` 已读逻辑在重建时只剩存储层，调用点全丢。
- 负责人决定：① 红字是红点式通知，看过就消；② 有失败时点卡片统一落到「运行记录」tab。
- Mobile：新增 `cron-failures.ts`（失败判定收窄为 `lastRunStatus ?? lastStatus === 'error'`，与任务行 / 运行记录的红条一致；失败签名 `jobId@lastRunAtMs`；由任务状态重建运行记录条目）与 `services/cron-failure-acks.ts`（按 `connectionId::agentId` 存已看签名、只保留仍存在的失败、变化时通知订阅者、删连接时清理；替换掉无消费者的 2.0 `StorageService.getAckedCronFailures / ackCronFailures`）。`loadAgentSettingsSummary` 的 Cron 卡拆成 `loadAgentCronSummary`：只数本 Agent 未看过的失败（原来跨 Agent 都数）。主页有红字时 `navigate('cron', { cronView: 'runs' })`，并订阅确认事件只重读 Cron 卡；`AgentSettingsSection` 路由新增 `cronView`；`CronSection` 接 `initialView`，运行记录 tab 顶部先列红色「{{count}} failed」+ 每个失败任务一行（与分页历史去重、点开同一详情弹层），任务列表就绪即写已读。两个后端同一条路径（Hermes 也有 `runs` 与 `last_status` / `last_run_at`）。
- 文档：`04-app-screens.md` §Agent 主页新增「失败红字」段、数字卡表与定时任务段同步；`apps/mobile/AGENTS.md` 数字卡 / Cron / 连接删除三条；`design-system.md` Cron 配方。
- 验证：Mobile typecheck；新增 `cron-failures.test`（3）、`cron-failure-acks.test`（4）；`load-summary.test` 改为已读 / 跳过 / 他人 Agent 三类不计并新增单卡重读用例；`AgentSettingsScreen.test` 新增红字导航参数与确认后消红两例；`AgentSettingsSections.test` 新增运行记录落点 + 失败置顶 + 已读、任务 tab 不写已读两例；`connection/index.test` 新增删连接清理用例。`AgentSettingsSectionScreen.test`（未 mock 并行会话新增的 `DocumentScreen`）与 `AgentSettingsSections.test` 的 14 个 Files 用例（并行会话 `FilesSection` 新增必填 `onOpenFile`）当前失败，与本次无关。未提交、未真机验收（HT-CRON-FAILED-0919）。

## 定时任务模型行：新建 / 编辑 / 查看都能看到并选模型（2026-09-19）

- 负责人反馈：OpenClaw 定时任务只有运行记录弹窗能看到模型，新建与编辑 / 查看都看不到定义的模型。核对 OpenClaw 源码（`src/cron/types.ts`、`packages/gateway-protocol/src/schema/cron.ts`、`src/cron/isolated-agent/model-selection.ts`）：`agentTurn` payload 本就有 `model` / `fallbacks`，`cron.add` / `cron.update`（`model: string | null` 清除）/ `cron.list` 都原样承载；运行记录里的 `model` 是解析后的实际值，所以没设覆盖也有。硬限制：`sessionTarget: main` 只能配 `systemEvent`，没有模型字段，运行记录也不记模型。App 侧数据层早就支持（`CronDraft.model`、create / patch 都写回），但 UI 把模型字段藏在高级设置里、只对 `agentTurn` 显示，而主 Agent 新建的任务一律是 `main` + `systemEvent`——只有一个 Agent 的用户从没见过；且是裸文本框、要手打 `provider/model`。清除覆盖时发的是 `''` 而不是 `null`。
- 负责人决定：主 Agent 新建任务也改为独立会话（与 OpenClaw Control UI / CLI / agent 工具的默认一致），代价是结果不再出现在主聊天；已有主会话任务不动。
- Protocol：`Capabilities.cronModel`（OpenClaw true；Hermes 原生 `cronjob(model=, provider=)` 支持但 Bridge 未透传，保持关闭）；`CronPayloadPatch` 允许 `model: null`，`CronJobPatch.payload` 改用它；mock 的 cron.update 归一化 `null`。Mobile `types/cron.ts` 同步。
- Mobile：`buildCronJobCreate` 对所有 Agent 生成 `isolated` + `agentTurn`；`buildCronJobPatch` 模型只在变化时带、清除发 `null`；新增 `cronJobModel` / `cronModelLabel` 与 `useCronModels`（`models.getSelection()` 取目录与 Agent 默认，失败不影响行）。编辑器：模型行移出高级设置，新建与编辑都在时间预览下方（`SettingsRow` 宽尾值 → `ModelPickerModal` 含「默认」行；尾值写目录名 / 「默认 · <默认模型>」/ 只读「跟随主会话」），高级设置里的模型文本框删除；列表行存了覆盖时多一行「模型 · <id>」。Hermes 适配器 `cronPrompt` 接受 payload patch；Hermes 创建 payload 由 `systemEvent` 变为 `agentTurn`，Bridge 只收 prompt，行为不变。i18n 新增 `settings` 两 key（`Follows main session`、`Default · {{model}}`）19 语言。
- 文档：`apps/mobile/AGENTS.md`、`design-system.md`、`packages/agent-protocol/AGENTS.md`、`04-app-screens.md` §定时任务新增「模型行」段。
- 验证：protocol / Mobile typecheck；protocol 30 tests；`cron-model` 6（新增 patch null / 标签 2 例）、`CronEditorScreen` 新增 4 例（新建选模型入 payload、编辑清除发 null 且主会话只读、Hermes 无行且创建仍只有 prompt、目录失败仍可用）；AgentSettings 相关 15 suites / 201 tests 串行通过；`check:design-system`、`check:docs` 通过。`i18n:check` 当前因模型页会话遗留的 4 个未用 key 失败（`Catalog` / `Defaults` / `Applies to all sessions` / `Switches control…`），与本次无关。并行会话「定时任务编辑页面布局优化」同时在重排同一编辑器（提示词独立页等），已把模型行并入其分组，其自己的用例仍在进行中。未提交、未真机验收（HT-CRON-MODEL-0919）。

## 文档页：文件与 SKILL.md 从弹窗改为完整二级页（2026-09-19）

- 负责人问长文档是否该做完整二级页而不是弹窗。现状：文件页详情是弹窗，阅读区 `maxHeight = 7 行`（364pt）内嵌 ScrollView 与弹窗拖拽共用手势，MEMORY.md 19.9 KB 约 300 行没法读；编辑态是弹窗里 6 行输入框 + 键盘，可见两三行；Cron 编辑器与身份页已是原生栈页，只有文件还是弹窗；技能页 SKILL.md 是另一套 93% Markdown 弹窗。2.0 的 `FileEditorScreen` 就是整页（612 人用过）。负责人决定：做完整二级页，体验必须好。
- Mobile：新增 `DocumentScreen`（一个页面承载工作区文件与 SKILL.md）与 `document-model.ts`（`DocumentSource` + `agentFileDocument` / `skillSourceDocument`，只负责后端读写与埋点）。阅读态整页渲染 Markdown + 「大小 · 修改时间」灰字；编辑态按 iOS 编辑模式：头部 Cancel / Save，正文一个 `flex: 1` 原生滚动的 `CompositionSafeTextInput` 放在 `KeyboardAvoidingView` 里，键盘弹出输入框缩短、光标可见，无嵌套滚动；已有文档不自动聚焦，缺失文件直接空白编辑态并聚焦、Cancel 离开；脏 Cancel 回阅读态、脏返回手势经 `usePreventRemove` 确认；错误固定在内容上方、草稿保留；只读 / 二进制 / 不支持无 Edit；Pro 仍只拦保存，付费墙续做校验页面仍在、草稿未变、在线，单次写锁。路由新增 `open-file { fileName }` 与 `skill-source { skillKey, skillName }`。`FilesSection` 只剩列表 + `onOpenFile`，返回时 `refreshKey` 安静刷新；`SkillsSection` 新增 `onOpenSource`，详情弹层关闭回调里 push 页面，SKILL.md 行只在可读且有宿主时显示；删除 `SkillSourceSheet.tsx`、`files-model.canSaveAgentFile` 及 SkillsSection 不再使用的 `isPro` / `onOpenPaywall`。
- 并发说明：另一会话在同一小时内把 `FilesSection` 的详情改成 93% 弹窗（`BottomSheetScrollView`），本项按负责人的页面决定整体替换了该文件；`root-stack.ts` 与该会话新增的 `cronView` 参数并存。
- 文档：`04-app-screens.md` §5 新增「文档页」段并改写文件页段；Mobile `AGENTS.md`「Identity and Agent files」与 `docs/design-system.md`（新增「Document page — September 19」，技能源码段改为指向文档页）。
- 验证：`DocumentScreen` 11 tests、`document-model` 3、AgentSettingsSections 29、AgentSettingsSectionScreen 11（新增文件 / SKILL.md 路由用例）、files-model 3 全绿；Mobile typecheck 通过；`check:design-system`（196 UI 文件）与 `check:docs` 通过；完整 Mobile 套件 290/291 suites、2,929/2,930 tests，唯一失败 `CronEditorScreen.test.tsx`「edits the prompt on its own page…」来自同时进行的 Cron 会话（单独运行通过，全量运行下超时），与本项无关。`npm run check:required` 两次都停在 `packages/agent-protocol` 覆盖率（另一会话未提交的 `mock.ts` `mockCronPayload` 分支 99.53% < 100%），未跑到 Mobile 步骤；`i18n:check` 另有 4 个模型页会话遗留的孤立 key（Applies to all sessions / Catalog / Defaults / Switches control…），本项只清理了自己产生的 `You have unsaved changes.`（19 locales）。未提交、未部署；真机视觉与键盘手感由负责人验收。

## 模型页视觉重排：方案 A 分组卡（2026-09-18）

- 负责人真机截图：模型页功能合理但「非常丑、乱七八糟」。核对代码：页面底是白色 `canvas`，白色分组卡完全消失，只剩灰底的默认模型行像补丁；备用模型尾值写整条链并折行；「模型目录」标题 + 胶囊按钮 + 说明句三层文字；每行副标题「1M · 推理」重复；provider 头是透明行，与模型行无容器关系；横向内边距 24 而其他设置页是 16。出了现状诊断 + A「分组卡」/ B「默认模型英雄」/ C「提供方一级」三块画板（画布 https://claude.ai/code/artifact/ff33a8d3-4233-4250-b602-07faba69b1c7 ），负责人选 A。
- Mobile：`ModelsScreen` 改为 `canvasGrouped` 底（`ScreenHeader` 同色）、内边距 16；默认分组卡三行各一个尾值（默认模型用新增的 `SettingsRow tailWidth="wide"` 64% 放长名；备用只写数量）；搜索胶囊 + 44pt `Plus` `FloatingButton` 取代分节标题、胶囊按钮与说明句；每个 provider 一张 `SettingsGroup`（600 头行 + 数量 + ›，下面名字 + 开关，无副标题）；含默认模型的 provider 置顶，默认行尾「Default」+ 锁定开关；Hermes / local-model 仍是勾号。`rowSubtitle` 删除，能力信息只在 `ModelDetailSheet`。业务屏 `FontSize` 取值 body / secondary 两档。
- 文档：`04-app-screens.md` §5 模型页、`apps/mobile/AGENTS.md`（改写同日早间另一会话写的「白底 + 强调默认行 + 链式备用 + 可见添加胶囊」一条）、`apps/mobile/docs/design-system.md` SettingsRow 行。
- 验证：Mobile tsc、`ModelsScreen` 12 用例（新增 1：provider 置顶 / Default 标签 / 无副标题 / 备用尾值数量）、`check:design-system`、`check:docs`。未提交；等负责人真机验收（HT-MODELS-0916 同时覆盖）。

## 弹窗头部留白与角落按钮统一（2026-09-18）

- 负责人真机反馈：模型选择器等底部弹窗的 header（含关闭键）与下方内容贴得太近；左上关闭键与右上管理键风格不一致。核对 `SheetHeader`：52pt 行内 44pt 圆形按钮上下各余 4pt，行下没有任何留白，而页面级 `ScreenHeader` 早有 `paddingBottom: Space.md`；29 个 `Sheet` 调用方里绝大多数 body 只写了横向 / 底部 inset，少数自行补了 4–16pt 的 `paddingTop`，问题是全局的。
- 只改公共组件：`SheetHeader` 行下加 `Space.md`（内容距 44pt 控件 16pt，与页面头一致）；新增 `SheetHeaderButton`（关闭键同一 quiet 44pt 圆形）并让关闭键、模型管理、会话面板搜索、Add 面板全部照片、技能源码 Edit / Save 统一走它（Models 与技能源码原为透明 `plain` 样式）。去掉 ModelProvider / 技能详情 / 花名册添加 / 会话面板 chip 行 / Add 面板 / Commands 自补的 `paddingTop`，Fallback / ModelDetail / Identity / SkillSource / ReplyFailure 的 `padding` 简写改为横向 + 底部，避免叠加。`ConfirmationModal`（居中确认）与 `RunResult` 未改。
- `check:ui-style` 新增规则：业务组件在 `<Sheet headerRight>` 里放 `FloatingButton` / `HeaderActionButton` / `ActionButton` 即失败（页面级同名 prop 不受影响），并带 6 条自测。文档：`apps/mobile/AGENTS.md`、`docs/design-system.md`、`05-visual-system.md`。
- 验证：Mobile typecheck、`check:design-system`（192 文件 / 51 自测）、`check:docs`、完整 `mobile:test` 287 suites / 2,891 tests 通过。未提交；等负责人真机验收。

## 首次连接配对卡片与 CLI 重复用户消息（2026-09-17）

- 负责人真机反馈：配对卡片点允许后停留，重开消失；只发一次「滴滴」却显示两条且单 / 双勾不同。本机只读核对 main transcript、Claude CLI transcript 与 `chat.history`：一次发送 / 一次回复，历史接口额外导入带恢复前缀的 CLI 用户副本；不是重复执行。节点授权完成记录与截图时间吻合。
- 配对审批仍走原设备 / 节点 API，仅线程投影过滤已完成 / 拒绝 / 过期条目；保留处理中防重复点击、失败重试和 store 墓碑以拒绝迟到事件。待处理卡片增加「允许此设备连接到 OpenClaw 吗？」（19 语言），说明可换行。没有自动授权，也没有删除真实审批能力。
- OpenClaw 历史适配层在缓存合并后仅去除紧邻本地格式发送标识的 CLI 恢复输入副本：明确 CLI 来源及消息 ID、精确恢复前缀、相同纯文本、无冲突发送标识、时间向前且不超过 60 秒。保留真正重复发送、附件、不完整页、未知来源和 Hermes 历史；保留原消息作为回复聚合的轮次锚点。已有缓存副本随成功历史刷新和正常缓存保存更新，不直接改手机存储或 OpenClaw 数据库。
- 验证：脱敏录制报文回归、缓存重载的双后端适配器回归、审批完成 / 拒绝 / 失败重试 / 并发及外部完成事件回归；最终适配器专项 2 suites / 57 tests 通过。完整 `npm run check:required` 通过（Mobile 286 suites / 2,875 tests、所有 workspace 类型与自含双后端测试、设计系统、19 语言和文档门禁）；最终 Mobile typecheck 通过。未部署、安装 App、重启服务或更换配对，真机展示仍由负责人验收。


## 连接管理统一：花名册左滑、连接页吞并高级设置、砍掉静音（2026-09-17）

- 负责人看花名册截图提出加左滑操作，并问「我的连接 → 连接页 → 高级设置」为什么怪。核对代码：连接级信息与操作复制在三处（连接页只有生命周期；「高级设置」其实是账户设置分段页的单连接只读模式：后端 / 传输 / 环境 / 地址 / Relay 状态；Agent 设置里还留着一份没有任何路由能到的「连接」分段，而最有诊断价值的 Bridge 版本、最近就绪只在那份死代码里）；「静音」只挡默认关闭的 iOS 回复通知、行上没有任何状态。负责人定稿：砍掉静音；左滑放「置顶」「管理」；改名放连接页；其余按实现者建议。
- Mobile：新增 `SwipeableRow` / `useSwipeableRowGroup`（80pt 图标加短标签的单元，中性 `surface` / 破坏性 `bad`，一列表只开一个托盘、滚动即收起、库自带 RTL 镜像）与 `RenameSheet`（花名册会话改名与连接改名共用）；删除 2.x 遗留且无人使用的 `SwipeableGatewayRow`。花名册 Agent 行左滑 = 置顶 / 取消置顶 + 管理（进 `Connection` 路由），置顶会话行左滑 = 取消置顶 + 重命名；长按菜单改为置顶 / 管理连接 / 移除连接（仅单 Agent 连接），托盘与菜单共用 `performRowAction`，托盘永不放移除。`muted` 从偏好存储、花名册模型、动作装配、通知门与 19 语言中删除；旧记录里的字段读取时忽略。
- 连接页重做为唯一连接页：头部 + 重连 / 恢复 + 暂停 + 「名称」行（`RenameSheet` → 新的 `ConnectionCoordinator.renameConnection`：只改 label，不断 OpenClaw 连接；Agent 名等于旧连接名的（Hermes 无 Bridge 名、本地模型）在内存与 roster 缓存里镜像改名，`RosterCache.updateAgents` 保留原 savedAt 不冒充新鲜就绪，活动连接重新握手一次）+ 只读「详情」（`buildConnectionDetailRows`：后端 / 传输 / 环境 / 服务器地址 / Bridge 版本 / Bridge 能力 / 最近就绪，地址从凭据记录按需读取不入描述符）+ 免费用户的免费连接组 + 移除。「我的连接」列表行左滑 = 暂停 / 恢复 + 移除，与连接页同样确认。删除：`AccountSettingsSection` 的 `connections` 分段（含 Relay 统计类型、`formatAccountSettingsUptime`、连接级 action、路由 `connectionId` 参数）、Agent 设置的 `connection` 分段定义与动作、App 内旧的 `connectionHosts` / `settingsSectionConnections` 装配；免费连接切换逻辑移到连接页回调。
- i18n：新增 `common` `Pin` / `Unpin` / `Manage` / `Pause` / `Resume`、`config` `Manage connection`，删除 `Mute Agent` / `Unmute Agent` / `Uptime`，19 语言同步，strict 报告 missing=0 / removable=0。文档：Mobile `AGENTS.md`（连接页唯一、滑动托盘规则、静音删除）、`design-system.md` §6 两条新基元、`04` §花名册手势 / §账户设置 / 新增连接页段落。
- 测试：`SwipeableRow` 4、`connection-details` 4、`ConnectionScreen` 4、`ConnectionsScreen` 3、`RosterCache.updateAgents` 1、coordinator 改名 2（OpenClaw 不断线 / 派生名镜像并重握手）、花名册左滑 1；改写受影响的花名册、账户设置、Agent 设置与偏好用例。负责人真机验收项：托盘手感与阿拉伯语方向、改名后本地模型行名、连接页详情可读性（HT-CONN-0917）。
- 验证：完整 `npm run check:required` exit 0（Mobile 286 suites / 2,863 tests，全部 workspace 类型检查，protocol 覆盖率、relay / bridge 自含测试与 63 项脚本回归，191 个 UI 文件样式检查，19 locales / 24,738 translations strict 通过，docs 检查通过）。第一次运行因与并行的 `check:design-system` selftest 临时目录竞争而在 jest haste map 阶段报 ENOENT，单独重跑通过；不是代码问题。未操作模拟器 / 真机，未提交。

## 本地调试 ENOSPC 恢复（2026-09-16）

- `mobile:dev:ios` 在 npm postinstall 写入 Android Gradle 补丁时失败，Warp 也无法创建临时文件；实测系统盘仅剩 116 MiB。上一轮独立验证目录 `/tmp/clawket-sdk57` 占 7.2 GiB，收尾未及时释放。
- 仅对本次指定 DerivedData 执行 `xcodebuild clean`（成功），把剩余验证日志 / 缓存移到 `/Volumes/Lucy-SSD/Relocated/Caches/dev/clawket-sdk57-artifacts`，原 `/tmp/clawket-sdk57` 保留软链接。系统盘恢复约 7.2 GiB 可用；没有清除源码、通用系统缓存、Archive 或手机数据。
- 实际重跑 `npm run mobile:dev:ios`：npm install 成功，全部四个 postinstall 补丁通过，进入 Expo 真机 / 模拟器选择器（包含插线 iPhone）；主动取消选择，不额外触发构建 / 安装。Android 补丁的 3 个回归测试通过，依赖文件可正常读取与写入。本次未验证新的真机冷启动，HT-SDK57-0916 仍待关闭。

## Expo SDK 57 / iOS 27 启动修复（2026-09-16）

- 负责人授权完整升级。真机 TestFlight 3.0.0(5) 与 Debug 3.0.0(1) 均在 JS 启动前触发 `UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption` / SIGTRAP；采用 Expo 官方 SDK 57.0.23 + build-properties 57.0.20 Scene 支持，未压制系统断言。此前 SDK 55 Device Hub 临时补丁已由新版 CLI 原生能力替换，下节记录保留为历史。
- Expo 57 / RN 0.86.3 / React 19.2.3 / TS 6 与两份 lockfile、根 overrides 同步。配置插件启用 UIScene，粘贴输入在官方 scene delegate 创建 React host 后注册；保持 ExpoModulesCore 源码权限同步补丁、iOS 16.4 最低版本、启动屏官方插件及 app/extension 团队签名继承。MediaLibrary 旧行为走 `/legacy`，文件复制等待完成，替换 RN 已删除的 absoluteFillObject。
- 当前验证：Expo dependency check 与 Doctor 21/21 通过；完整 `check:required` exit 0（Mobile 280 suites / 2,841 tests，双后端自含回归、全部类型检查、设计系统 / i18n / docs）。clean prebuild / Pods 与最终 iOS Debug 真机架构构建成功，未依赖命令行签名团队覆盖。Android 初始 Kotlin DSL 错误定位到 Gradle 9.3.1 对外接盘软链接缓存的上游回归；独立真实路径缓存已通过插件编译。原生日志在本机 `/tmp/clawket-sdk57/`。
- 最终 iOS Debug / Release 均 `BUILD SUCCEEDED`，签名校验通过，成品 Info.plist 含 ClawketSceneDelegate，Release 含 11 MiB 嵌入式 main.jsbundle。两种构建均成功原位安装到已配对 iPhone（未卸载 / 清数据），目前保留 Release 且本轮 Metro 已停止。启动命令被 SpringBoard 以 `Locked` 拒绝，设备 `passcodeRequired: true`；解锁前不能声称冷启动 / 闪退已验收，记录 HT-SDK57-0916。Android arm64 Debug `assembleDebug` 已通过（536 tasks），APK 位于 `apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk`；Google Maven 临时 TLS / 超时经 Gradle 重试恢复，没有修改依赖产物。根与 Mobile production dependency audit 均无 high / critical（仍分别有 31 / 16 项 moderate）。没有提交、上传 TestFlight 或部署后端；保留开始前其他任务的工作树修改。

## Xcode 27 本地 iOS 调试入口修复（2026-09-16）

- `mobile:dev:ios` 在设备选择前报 Simulator 不存在。实测本机 Xcode 27.0 / 27A266a、`xcode-select` 与 `simctl` 正常，但 Apple 已改用 DeviceHub；Expo 55.0.31 / CLI 55.0.36 是 55 系列最新补丁，仍只识别 Simulator。保持 SDK 55 基线，把 Expo 官方 #46757 / #46809 的检测、运行态、启动与激活兼容回移到 `patch-expo-device-hub.mjs`，接入根目录和 Mobile postinstall；三文件 × 两份 CLI 共 6 文件，版本/源块校验、重复执行幂等、全部校验后才写入。无 SDK / 原生依赖 / backend 行为变更。
- 验证：18 个 Node 回归测试通过（含旧 Simulator、DeviceHub plist fallback、工具缺失、启动失败、激活、源码漂移和安装布局）；实际执行原命令已进入真机与模拟器设备选择列表，主动取消在选择阶段，未安装或启动 App，未宣称完成原生构建或真机验收。完整 `npm run check:required` 通过：Mobile 279 suites / 2,835 tests，workspace 类型、自含 Relay / Bridge 测试、18 个补丁回归、设计系统、19 语言 i18n 和文档检查全部通过。日志：本机 `/tmp/clawket-devicehub-required.log`。

> 实现者维护。每次开工先读；每完成一个里程碑更新。人类只读这一份文件了解进度。


## 3.0 最终发布检查（2026-09-16）

完整结论与证据边界见 [最终检查报告](final-release-review-2026-09-16.md)。基线 `c9422fc9` + 当前工作树；保留本轮开始前已有 Xcode 27 原生修复与其他未提交文件。**核心代码可进入候选发布，尚不满足 App 全量发布签字。**

- 修复 FilesSection 的旧购买续做、Agent / adapter 切换、离线 / 卸载页面后提交旧草稿、乱序读取与失败 Retry 丢草稿；先复现红灯，再修复；新增 12 个双后端 / 并发回归，相关 2 suites / 52 tests 通过。
- 拆开自包含 `relay:test:integration` 与真实 local-model recovery / Preview 命令，真实命令缺少前置条件必须失败而非 skip；修正 Hermes 两处历史精确断言的 additive `hasActiveRun: false`。同步 `09` 中已经被负责人决策替代的验收项。
- 最终 `check:required` exit 0：Mobile 279 suites / **2,835 tests**、workspace 类型 / 测试、189 UI 文件、19 locales / 24,643 translations 与 docs 通过；`npm test` 通过（当时 Mobile 2,827 项，后续新增用例由最终 required 覆盖）。当前安装 Hermes 外部集成 4 文件 / 36 tests 通过。v1 compat 5 文件 / 39 tests、自包含 integration 5 文件 / 8 tests、当天四个 Production 只读 Worker 快照 × 新 / 0.7.0 Bridge 的 **20 阶段**真实 workerd 矩阵通过。
- 双后端真实本机文字 / 图片 / 停止 / 历史通过；独立 Preview pairing 经云端请求真实模型与六项管理读取通过；仅断开本次 runtime owner 后恢复约 OpenClaw 4.84 秒 / Hermes 4.73 秒，Hermes 空闲 125 秒后健康请求通过。单次测量不是 p90 / 长期 SLO。QA 会话与 runtime 清理；标准产品 smoke 刷新了已有 Preview access code，没有变更 Production pairing。
- Bridge 编译 / 包验证、双平台 Expo JS export、本地公开配置检查、根与 Mobile high 级依赖审计通过。没有本轮 Android 原生 Release、商店真实购买、旧包真机或长时观察签字；Simulator 控制工具可发现进程但选择 App 始终 `Invalid app`，因此没有虚报 UI 验收。
- PostHog 六个月事件与 2.x 源码对照：主要旧付费能力保留；Office 高使用量但按决策删除；技能辅助文件浏览缺等价入口、多连接备份缺来源标识作为产品 / 迁移待决项。详见报告，不将购买成功埋点当作已核实营收。
- Production 缺六位码 ticket 密钥、npm latest 仍 0.7.0、首次 Registry DO 迁移的前向恢复产物待演练；公开隐私页仍否认实际分析 / 第三方处理。没有部署、发布、购买或修改 Hermes 源码。已有早期门禁红灯（含本机 Python 许可）不代表当前结果，最终 required 与真实 Hermes 集成均已重跑全绿。

## Bridge CLI 测试在 Windows CI 上的偶发失败（2026-09-16）

- #32、#33 合入后 `main` 的 `Bridge and Relay compatibility (windows-latest)` 轮流挂在 `apps/bridge-cli/src/index.test.ts` 的三个用例（服务启动恢复 Hermes、守护进程重启 relay、reset 不误杀），偶尔 macOS 也挂；`vi.waitFor` 1 秒超时。本地稳定复现：在 mock 设置与 `import('./index.js')` 之间加 400 ms 空档即三个都失败。根因是 `main()` 不被 await，上一个用例遗留的 pid 轮询（每 200 ms 调 `execFileSync`，最长 25 秒）在下一个用例里消费掉共享 `execFileSyncMock` 的 `mockReturnValueOnce` 队列；`vi.clearAllMocks()` 不清 once 队列，`vi.resetModules()` 也不重跑 `vi.mock` 工厂。慢的 Windows runner 只是把这个窗口拉大。
- 修复只在测试侧：`execFileSync` / `spawn` / `getServiceStatus` / `readRecentCliLogs` 四个被后台轮询触达的 mock 改为每个用例新建实例，`beforeEach` 用 `vi.doMock` 重新注册三个模块工厂，遗留轮询继续打在旧实例上；`afterEach` 统一 `vi.useRealTimers()`，避免守护进程用例失败时假定时器泄漏拖垮后续用例。未改 CLI 实现，不影响 OpenClaw / Hermes 行为。
- 验证：`index.test.ts` 27/27；同一探针（400 ms ×3、1500 ms ×1）在修复后全绿、在 `main` 版本上 3 个用例中 2 个失败；`npm run bridge:test:required` 与 `check:docs` 通过。规则记入 `apps/bridge-cli/AGENTS.md`。


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
| `[UX-2026-09-19-connection-unavailable] 04-app-screens.md / Mobile design system` | 持续失败也只用连接胶囊。 | 持续失败增加完整提示；短暂恢复仍用胶囊，缓存与其他连接仍可访问。 | 用户明确要求参考远程电脑离线页，避免无限等待和无说明错误。 | 仅 Mobile 展示与手动重试入口；OpenClaw / Hermes 共用，不改变传输协议。 |
| `[UX-2026-09-19-channels-tab] 04-app-screens.md` §5 渠道与设备 / `10-migration-map.md` | 「分段页：渠道 / 设备 / 节点」，迁移表写 `ChannelsScreen.tsx` 「迁移合并为 `AgentSettings/ChannelsDevices`」；实现只做了名称 + 状态只读行。 | 找回 2.0 的两项写入：「Direct messages」行 + 四项范围弹层（`session.dmScope`）、渠道弹层里每个账号的启用开关；协议新增 `channelManage` 精化与 `channels.getRouting / setRouting / setAccountEnabled`。 | 负责人 2026-09-19 发现 2.0「所有 channel 共用一个 session 还是各自一个」的设置在 3.0 找不到；规格没写细、实现按最小理解做了只读、没记偏离，属于「以更简单为由砍掉功能而不记录」。 | OpenClaw 渠道 tab 多一张卡、渠道行变可点；Hermes 无渠道 tab不受影响；22 个 `settings` 键 × 19 语言；两个新事件。 |
| `[UX-2026-09-19-cron-create] 04-app-screens.md` §5 定时任务 / `design-system.md` Cron management | 新建两步各带步骤标题与引导副标题；「Cron 表达式收进高级设置」；`cronAdvanced` 门控「新建时暂停」（OpenClaw 新建页有「已启用」开关）。 | 删掉「1 选择起点」「选择模板，再调整任务内容和时间」「2 设置任务」三行文案；新建页去掉「已启用」开关（新任务一律 `enabled: true`）和整个「高级设置」行（Cron 表达式、描述、模型、通知）；编辑页原样保留全部高级项与开关。顺手修正编辑页「Advanced settings」未翻译（键在 `config` 命名空间，编辑器 hook 首选 `settings`，react-i18next 不做命名空间回退）。 | 负责人 2026-09-19 截图反馈：新建就是要启用，开关多余；步骤标题与副标题拖沓；Cron 表达式「用户可能 800 年都用不到」。PostHog 2026-03→09：`cron_create_tapped` 668 次 / 293 人，`cron_save_succeeded` 219 次 / 60 人且几乎全是编辑已有任务；2.x 向导新建同样只有名称 + 内容 + 时间、固定 `delivery: none`、无模型覆盖，从未有人在新建时用到这些项。 | 新建页更短；需要 Cron 表达式 / 通知 / 模型的用户创建后进编辑页一步到位，或让 Agent 在聊天里建；删除 3 个 `settings` 键 × 19 语言；`CronEditorScreen.test` 新增新建无开关无高级项、编辑页保留的回归。 |
| `[UX-2026-09-19-cron-edit] 04-app-screens.md` §5 定时任务 / `design-system.md` Cron management | 编辑页把名称、任务内容输入框、时间规则行 + 三次预计执行卡、开关、行内展开的高级设置、上次/下次运行两行、全部运行记录、按钮用同一个 16 间距堆成一列；任务内容是行内多行输入框。 | 分节 24 / 标题到内容 8（设置行 4）；设置行出血到屏幕边缘对齐标题；灰底只给可编辑文本；任务内容在编辑页折叠为六行正文 + 「编辑」，在独立子页全页编辑；时间规则行副标题承载下次运行与时区，编辑页不再放预计执行卡；高级设置改为子页；运行记录先取 3 条再每次 10 条，只显示时间与状态；删除「上次运行 / 下次运行」两行与 `Last run` 键；保存仅在草稿变化后可用。 | 负责人 2026-09-19 截图反馈：功能扎实但全堆起来、重点不突出、「什么时候执行？」离上方内容比离自己的子内容还近、同一信息出现两次、任务内容看不出可编辑。 | 编辑页多一次点击进入任务内容子页（与时间子页同一模式）；新建页保持行内输入；并入了同日另一会话加入的「模型」行；`CronEditorScreen.test` 新增编辑页回归。 |
| `[UX-2026-09-19-cron-run-detail] 04-app-screens.md` §4 Thread 运行卡 / §5 定时任务 / `03-adapters.md` | 聊天流 Cron 卡「以线程形式打开该运行会话」（推一层带 `runContext` 的只读 Thread，空态显示摘要），定时任务页运行记录另开一个弹层；运行记录只有摘要。 | 两处入口共用一个 `CronRunSheet`：投递内容（OpenClaw 从稳定会话键提取 `message` 工具发送正文；Hermes 输出文件全文）→ 执行摘要 → 时长 / 模型 / 通知 → 「查看完整会话」；Thread 的 `runContext` 模式删除；子 Agent 卡不变。新增 `cron.runContent` 适配器操作与 `CronRunLogEntry.delivery` / `outputRef`。 | 负责人 2026-09-19 反馈：定时任务真正发到 Telegram 的全文在 Clawket 里看不到，两条入口交互不统一；调查发现 `cron.runs` 的 `sessionKey` 带隐藏 `:run:<sessionId>` 后缀导致 `chat.history` 返回空，正文只在转写的工具调用参数里。 | 只有每个任务最近一次运行能读到全文（OpenClaw `chat.history` 无 sessionId 参数、`:run:` 行 24h 回收）；更早的运行退化为摘要 + 渠道。上游若在 `run-delivery-trace.ts` 保留 text 或给运行记录加 `deliveredText` 可去掉这一限制（HT-OC-CRON-TEXT-0919）。 |
| `[UX-2026-09-17-connection] 04-app-screens.md` §2 花名册手势 / §6 账户设置 | 长按 Agent 行 → 置顶 / 静音 / 移除连接；账户设置连接分组列出 label、后端、传输、环境标签。 | 静音删除；新增左滑托盘「置顶 / 管理」（置顶会话行「取消置顶 / 重命名」）；长按菜单为置顶 / 管理连接 / 移除连接；连接级详情与生命周期全部合并到唯一的 `Connection` 页并加本机改名，「高级设置」子页、账户设置连接分段、Agent 设置连接分段删除；「我的连接」列表左滑暂停 / 恢复 / 移除。 | 负责人 2026-09-17 决定：静音没有可见效果；连接信息分散三处且「高级设置」名不副实。 | 改名只改本机 label：OpenClaw 行名仍来自 Gateway 身份；Hermes 无 Bridge 名与本地模型的行名随连接名镜像并重新握手。 |
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
| `[UX-2026-09-19-document] 04-app-screens.md` §5 文件页 / `05-visual-system.md` 弹层原则 | 文件详情与 SKILL.md 用底部弹层查看与编辑。 | 长文档改为原生栈 `DocumentScreen`：整页 Markdown 阅读，编辑态 Cancel / Save + 原生滚动的全高输入框；文件与 SKILL.md 共用一个页面。 | 7 行预览 + 内嵌滚动读不了 20 KB 的记忆文件，弹窗里编辑键盘之上只剩两行；Cron 与身份已是页面，只剩文件是弹窗；负责人 2026-09-19 决定。 | 仅 Mobile；新增两个路由 action，删除 `SkillSourceSheet`；后端、协议、能力矩阵与埋点不变。 |
| `[UX-2026-09-16-identity] 00-decisions.md` §2 Agent 设置 / `04-app-screens.md` §5 | 顶行身份（名字、头像、人格、记忆文件）；Agent 组另有「文件」。 | 身份页只保留名字 / emoji / vibe / 头像与新建 / 删除智能体；SOUL / MEMORY / USER / AGENTS 只在文件页编辑（含创建缺失文件）；「我的信息」表单删除。 | 同一文件两处编辑器互相覆盖且交互不一致；OpenClaw Control UI 与 2.0 都只在 Files 编辑这些文件；Hermes 无 SOUL.md 使身份页出现死路；2.x 数据显示原文编辑器触达（612 人）高于结构化身份编辑（528 / 243 人）。负责人 2026-09-16 决定。 | 不改后端、协议或能力矩阵；埋点 `identity_file_activity` 改名 `agent_file_activity`（3.0 未发布）；Skills SKILL.md 弹层与文件页弹层样式仍不同，待负责人裁定。 |
| `[UX-2026-09-11-profile] 04-app-screens.md` §5 / `05-visual-system.md` §9 | Agent 设置 = 44pt 身份行 + 「行标题 + 尾值」两档字；卡片下不放小字。 | 档案页改为「数字卡 + 行」：头部右侧墨色圆按钮 = 继续聊天，两张 hero 卡（Cron jobs、Cost today）+ 三块计数格（Models / Skills / Files），卡右侧允许一个 `caption` 数字小字（红色失败数、灰色 tokens）。 | 负责人 2026-09-11 依据 2.0 控制台埋点（定时任务 hero 人均点 6.2 次、费用 3.3 次、用量页触达最广且付费用户超配）要求把数据放回一级；小字是数字不是句子。 | 本页用到 title / secondary / caption 三档（`check-ui-style` ≤ 3 仍通过）；行仍是两档；其他页面不变。 |
| `[UX-2026-09-11-profile] 04-app-screens.md` §5 身份行 | 灰字 = 连接名 · 后端。 | OpenClaw 有心跳时灰字 = `后端 · Active {{age}}`；否则退回连接名 · 后端。（2026-09-16 再改：后端进头像角标，灰字只剩 `Active {{age}}` / YouMind 邮箱，无信息时整行不渲染，见下一条。） | 2.0 心跳数字 482 人反复点；连接名与分节标题重复。 | 新增协议只读操作 `cron.heartbeat.last()`（可选），OpenClaw 转调 Gateway `last-heartbeat`；Hermes 不声明，行为不变。 |
| `[UX-2026-09-11-profile] 04-app-screens.md` §5 命名 | 「定时任务」英文 `Scheduled tasks`。 | 全部改回 2.0 的 `Cron jobs` / `New cron job`（中文仍是定时任务）。 | 负责人要求与 2.0 用户心智一致。 | 六语言 `common` / `config` 键改名；无其他页面引用。 |
| `[UX-2026-09-14-sprite] 00-decisions.md` §首启引导 / `04-app-screens.md` §4 第 5、6 行与「+」菜单 | 引导页第三个入口「YouMind 精灵」；「还没有 Agent？」含 YouMind 键；「+」菜单说明「连接 OpenClaw、Hermes 或 YouMind 精灵」。 | 负责人 2026-09-14 要求隐藏全部 YouMind 精灵入口：三处都由 `apps/mobile/src/config/features.ts` 的 `YOUMIND_SPRITE_ENTRY_VISIBLE=false` 关闭，「+」菜单说明改为「连接 OpenClaw 或 Hermes」（19 语言新增键）。**2026-09-17 负责人要求恢复：标志翻回 `true`，三处入口与「连接 OpenClaw、Hermes 或 YouMind 精灵」文案按原样回来，此项偏离已关闭。** | 只隐藏入口，不删功能：适配器、邮箱验证码登录、翻译、既有 YouMind 连接与测试全部保留，翻回标志即恢复（已于 2026-09-17 翻回）。 | 当前与规范一致；标志与隐藏态测试保留，便于再次关闭。 |
| `[UX-2026-09-14-profile-cost] 04-app-screens.md` §5 数字卡 | Cost today 右侧灰色「{{value}} tokens」小字。 | 去掉 tokens 小字，费用卡只显示美元数；tokens 仅保留在无美元数时的「Tokens today」退化态。 | 负责人 2026-09-14 依据真机截图：用量稍大（`$0.xx` + `863.8K tokens`）时小字与金额抢同一张 hero 卡的宽度，两者都被省略号截断。 | `model.ts` usage 卡不再产出 `detail`，`AgentSettingsStatDetail.key` 收窄为 `{{count}} failed`；19 语言 `settings` 删除 `{{value}} tokens` 键；Cron 卡的红色失败数与锁位不变。 |
| `[UX-2026-09-16-hero] 04-app-screens.md` §5 Hero / 行 | 名字下一行灰字 `连接名 · 后端`（有心跳时 `后端 · Active {{age}}`）；连接组分节标题 = 连接名。 | 后端改为头像右下角 24pt 圆角标（`PlatformMark` 官方图标 20pt，`surfaceFloating` 底 + 2pt `canvasGrouped` 描边；Pro 锁定时锁角标占位）；灰字只在有心跳（`Active {{age}}`，不带后端前缀）或 YouMind 邮箱时渲染，否则无第二行；连接组不再有分节标题。 | 负责人 2026-09-16 真机截图：Agent 名「Lucy」下又出现连接名「lucy」，同名重复；后端专门占一行不值；「身份」下再来一个「lucy」小标题很怪。 | 只改档案页头部与分组标题；`identity.detail` 改为可选、新增 `identity.backend`、`AgentSettingsGroupDescriptor` 去掉 `title`。Hermes 角标是该图标唯一被裁成圆的位置（只裁掉它自带的白色安全区），已写入 `apps/mobile/docs/design-system.md`。 |
| `[UX-2026-09-16-memory] 04-app-screens.md` §5 数字卡 | 第二排第三块计数格叫 Files（文件）。 | 计数格与其分栏页标题改名 Memory（记忆），19 种语言同步；`files` 路由、埋点名 `Files`、`FilesSection` 组件与文件页内文案不变。 | 负责人 2026-09-16 要求：该页承载的是 SOUL / MEMORY / USER 等记忆文件，「文件」对用户不表意。 | 只改标签与翻译，不改能力矩阵、路由或后端。 |
| `[UX-2026-09-16-roster-order] 00-decisions.md` §首屏 / `04-app-screens.md` §2 第 4 行 | 花名册「按最近活动排序」；04 细化为「需要你 > 有未读 > 最近活动时间」。 | 改为「Agent 级手动置顶 > 最近一次有人参与的活动时间」，未读 / 需要你只做徽标；活动时间取 OpenClaw `max(lastInteractionAt, lastActivityAt)` / Hermes `updated_ts`，只数主会话 / 直聊 / 群 / 渠道会话。 | 负责人 2026-09-16 判断：聊天列表形态带来的是「最后消息时间 + 手动置顶」预期；未读 / attention 是瞬态排序键，导致行在用户没动时上下跳；2.0 数据显示列表通常 1–4 行，徽标一眼可见；原实现用的 `updatedAt` 会被心跳推高，制造假未读与假置顶。 | 协议加可选 `lastActivityAt` 与 `sessionActivityAt` / `HUMAN_SESSION_KINDS`；两层排序合成一层；未读水位线、行时间、搜索、Thread 已读同一时钟；老 Gateway 列表整体无活动字段时回退 `updatedAt`。 |

## HUMAN TODO（只有人能做的事）

| 编号 | 事项 | 怎么做 | 验证方法 | 状态 |
|---|---|---|---|---|
| HT-MULTIDEVICE-0920 | 固定 3.0 候选后的双设备与版本混用验收 | OpenClaw/Hermes 各用两台真实 App：同/不同会话同时发送，A 锁屏时 B 继续，A 断网恢复，Bridge 重启，旧/新 App 混用，图像与停止；记录 App/Bridge/Relay 版本。沿用 HT-COMPAT-0914 等旧包/购买项，勿以协议回放替代。 | 不串请求/回复、不因 A 重连踢掉 B、run 停止准确、旧配对保留；区分连接共享与本机缓存/图片同步边界。 | 待固定包真机验收；本轮路由/休眠单测和 20 阶段本地兼容矩阵通过 |
| HT-IPAD-0920 | iPad 真机交互验收 | 安装含本轮原生配置的新构建；横竖屏与系统窗口缩放、软键盘中文组合输入/粘贴/发送、外接键盘、长回复阅读位置、后台恢复；分别连 OpenClaw / Hermes 发收并重连。 | 无裁切或遮挡；草稿保留；发送不重复、不串会话；回复与恢复正常。 | 待真机；模拟器 OpenClaw 链接发送与双后端独立会话实测已通过，Hermes App 内发收仍待补验。 |
| HT-OFFLINE-0919 | 连接失败页面真机验收 | 分别对 OpenClaw / Hermes 暂停电脑端服务或断网，等待原有恢复宽限结束；查看错误页、缓存入口和草稿，再恢复服务；另查暂停、配对失效、浅深色与大字体。 | 连接名与时间正确；无缓存不显示“没有 Agent”；重连/管理可用；其他连接可访问；恢复后自动回到内容，草稿不丢。 | 待人 |
| HT-REDEEM-0919 | 原生兑换与重装恢复验收 | 使用真实平台 RevenueCat key 的构建和 sandbox / license-test 账号；按 apps/mobile/docs/pro-redemption.md 验收有效、无效、取消、过期、复用码、月度到期、永久与原订阅并存、删装后 Restore。 | 商店与 RevenueCat 交易一致；OpenClaw / Hermes 的 Pro 门禁同时解锁；Apple 月度不自动扣款；重装恢复成功。 | 待商店沙盒实测；自动化测试已通过 |
| HT-VOICE-0919 | 云端语音真机与发布验收 | 安装包含 Expo Audio 的新构建，分别在 iOS/Android 验证点击听写、按住发送、上滑取消、停止回填；拒绝/重新授予麦克风权限、蓝牙、来电/后台、弱网重试和切会话。检查浅/深色、大字体、RTL、减少动态效果。正式发布前更新隐私披露并按 22 的后续付费阶段完成服务端权益方案。 | 常驻模型选择器不移动；无重复发送/串会话；失败可恢复草稿；两端麦克风及时释放。 | 待真机验收；付费接入按负责人要求后续实施 |
| HT-INSTALL-0919 | 删 App 重装后直接进首启引导（iOS + Android） | 用带此修复的构建：先配好一个连接，删 App，重新安装同一构建并冷启动：应直接落在首启引导，无「重新连接」胶囊；重新配对后花名册正常；再把 App 覆盖安装一次（不删）确认连接保留。Lucy 手机上现有的「幽灵连接」需要再删一次 App 或在连接页移除。 | 首屏是引导页而非空花名册；「添加连接」不再上锁；重新配对成功；覆盖安装不丢连接；宽限 / Pro 状态按 06 §1 保留（若之前有宽限，重装后不重发）。 | 待处理 |
| HT-CHANNELS-0919 | 渠道 tab 私聊会话范围与账号开关真机验收 | 装新构建 → OpenClaw Agent 设置 → 渠道与设备 → 频道：顶部应有「Direct messages」行，尾值为当前范围（未改过的 Gateway 显示「Shared session」）；点开弹层选「Per channel and sender」→ 确认 → 行尾值更新；再进弹层勾号在新项。点 Telegram 行 → 弹层列出账号（默认账号带「(default)」、有收发时间的账号有副标题）→ 关掉开关 → 确认 → 开关变灰；`openclaw config get channels.telegram.accounts.<id>.enabled` 应为 false；再打开恢复。 | 弹层里 `ConfirmationModal` 叠在 Sheet 上无遮挡问题；改范围后 `openclaw config get session.dmScope` 与页面一致；停用账号后 Telegram 不再回消息，启用后恢复。 | 待人 |
| HT-TOOLS-SAVE-0919 | 工具页页头保存与脏状态离开真机验收 | 装新构建，进 Agent 设置 → 工具：页头右侧应有灰字「保存」且不可点；切一个「工具档位」或拨任意开关后「保存」变为可点，页面底部不再有「放弃 / 保存 (N)」按钮行；点「保存」应弹居中确认框「应用 N 项更改？」（正文含重启 Gateway 与「x/y 个工具将启用」），取消后再改开关不应自动重弹；确认后页头按钮转圈、Gateway 重启并重连，档位勾选与开关落到新状态、再进页面仍一致；改动未保存时按返回或右滑应弹「丢弃更改？」，「继续编辑」留在页面、「丢弃」离开；再用显式 allow 列表的 Agent 确认只读横幅且无「保存」；浅 / 深色各看一遍。 | 页头保存与 Identity / Models 页同一观感；确认框文案两行内读完；保存后功能真的变（例如关掉 `exec` 后让 Agent 跑命令应被拒）。 | 待验收；本轮只有自动化验证 |
| HT-SEARCH-EMPTY-0919 | 全局搜索灰底输入框与空查询态真机验收 | 装新构建，花名册右上进搜索：输入框应为浅灰胶囊、返回键仍是白圆，占位「Agent、会话和消息」；先在线程长按两三条消息收藏，再回搜索页：空查询下「最近搜索」之后应有「收藏」节，收藏超过 5 条时末行「全部 N 条收藏」点一下就地展开；用「模拟免费账号」看收藏行带锁、点击弹 `messageHistory` 付费墙；清掉最近搜索且没有收藏时（或新装）应只剩居中一句「搜索 Agent、会话，以及这台设备上打开过的聊天消息」；浅 / 深色各看一遍。 | 灰底与返回键对比自然、收藏节与结果行同一视觉、空态一句话不突兀。 | 待验收；本轮只有自动化验证 |
| HT-SETTINGS-APPEARANCE-0919 | 设置首页外观卡真机验收 | 装新构建进账户设置：Pro 卡下应是「我的连接 / App 语言」一张卡（「聊天与通知」已删），再一张「主题 / 聊天主题 / App 图标」卡，最后「帮助与反馈 / 关于」；点「主题」原地弹选择、点「聊天主题」进聊天主题页、点「App 图标」（免费用「模拟免费账号」）先弹付费墙、购买 / 恢复后直接弹图标选择；看浅 / 深色与阿拉伯语 RTL 下三张卡的间距与尾值换行；再到线程按住麦克风说一句中文和一句英文，确认识别仍跟随系统语言。 | 三张卡节奏均匀、无「外观」「聊天与通知」子页残留、图标行锁与尾值正确、语音输入照常。 | 待验收；本轮只有自动化验证 |
| HT-CRON-RUN-0919 | 真机验收统一后的「执行记录」弹层与投递内容 | 用今早 07:00 的「YouMind 日报」运行：主会话里点 Cron 卡 → 弹层顶部应出现「投递内容 / Telegram · 8053522863」与发到 Telegram 的日报全文，通知行显示「Agent 已自行发送」，底部「查看完整会话」进入只读的 cron 会话（无输入框、日历图标）；再从 Agent 主页 → 定时任务 → 运行记录 / 编辑页运行记录点同一条，应是同一个弹层；点一条更早的运行应显示「这次运行的会话已被回收」；Hermes 任意运行记录应显示「运行输出」全文。 | 三处入口内容一致、长文可滚动、弹层收起后才跳会话；浅/深色与壁纸下都看一遍。 | 待验收 |
| HT-OC-CRON-TEXT-0919 | 决定是否向 OpenClaw 上游提议在运行记录里保留投递正文 | `src/cron/isolated-agent/run-delivery-trace.ts` 的 `normalizeMessagingToolTarget` 手上有 `text` 却只留路由；或给 `CronRunLogEntrySchema` 加有界 `deliveredText`。有了它，每次运行（不只是最近一次）都能在 Clawket 里看到投递全文，也不再依赖 `chat.history` 读转写。 | 上游合并后把 `cron.runContent` 优先读该字段，保留现有转写提取作旧版回退。 | 待决定 |
| HT-SIM-FREE-0919 | 「模拟免费账号」开关真机验收 | 已订阅账号装新构建：账户设置 → 关于 → 高级设置开「调试模式」，打开「模拟免费账号」：返回花名册应出现 Pro 胶囊、账户设置会员卡显示「查看 Pro」；进 OpenClaw 管理任一分段 / 运行日志 / 用量 7D / 非主会话 / 第二个连接，付费墙应按免费版布局弹出（无「当前方案」锁定、无管理订阅）；在付费墙点「恢复购买」成功后开关应自动关闭、功能立即解锁；再打开开关，关掉「调试模式」后重开应发现它已被清掉；杀进程重开状态与关闭前一致。 | 开关开着时所有 Pro 入口都弹付费墙且 RevenueCat / PostHog 仍记为已订阅；关掉后立刻恢复 Pro，不需要重启。 | 待验收；本轮只有自动化验证 |
| HT-SHEET-SCROLL-0919 | 弹层滚动与执行记录对齐真机验收（OpenClaw + Hermes） | 装新 App 构建：① 编辑任务 → 点一条运行记录：弹层停在 68%，上拉到 92% 后摘要能滚到底、不再回弹；任务名 / 时长 / 通知与下方摘要左边缘齐、细线通栏、浅 / 深色都无「缩进的卡片」；② 心跳表单能滚到保存键；③ 工具详情、线程里的定时任务结果、帮助中心任一主题、节点详情、回复失败详情、聊天外观「字号」与「模糊」列表、OpenClaw 配置编辑（长配置能滚、取消 / 保存一直在底部）、`/think` 选项列表逐个开一次；④ 大字号（辅助功能）下再过一遍 ①③。 | 每个弹层都能滚到最后一行且不回弹；下拉仍能关闭；执行记录三行与正文同一左边缘。 | 待处理；本轮仅自动化验证，未操作模拟器 |
| HT-CRON-FAILED-0919 | 定时任务失败红字真机验收（OpenClaw + Hermes） | 让一个任务跑失败（例如给它指定不存在的模型）：主页定时任务卡出现红色「1 个失败」；点卡片应直接落在「运行记录」tab（2026-09-19 起没有红字也默认落这里；只有没任务的 Agent 落「任务」tab），顶部红字「1 个失败」下有该任务一行，点开是失败详情；返回主页红字应已消失，任务 tab 行上的红色「失败 · 原因」仍在；再让它失败一次（或立即运行）红字重新出现，跑成功后不出现；杀进程重开红字不复活；删除连接重新配对后红字按新状态出现。Hermes 走同一遍。 | 红字只在有没看过的失败时出现，看过一次即消，同一任务再次失败会重亮；落点是运行记录且失败在最上面。 | 待验收；本轮只有自动化验证 |
| HT-CRON-MODEL-0919 | 定时任务模型行真机验收（OpenClaw） | 装新 App 构建，连上 OpenClaw：① 新建任务（模板或自定义）看时间预览下方有「模型」行、尾值为「默认 · <当前默认模型>」；点开选一个非默认模型再创建；② 到 OpenClaw 侧 `openclaw cron list --json`（或 Control UI）确认该任务 `sessionTarget: isolated`、`payload.model` 是所选 `provider/model`；③ 立即运行，运行记录弹窗里的模型应与所选一致；④ 编辑该任务把模型改回「默认」保存，`cron list` 里 `payload.model` 应消失（不是空串），再运行一次记录里应是 Agent 默认模型；⑤ 列表行只有设了覆盖的任务多一行「模型 · <id>」；⑥ 打开一个用 CLI `--session main` 建的旧任务，模型行应是灰色只读「跟随主会话」。Hermes 连接：新建 / 编辑都不应出现模型行，创建仍成功。 | 三个入口（新建 / 编辑 / 列表）与 OpenClaw 侧记录一致；清除后无空串；Hermes 无回归。 | 自动门禁通过；未装新构建或操作真机。 |
| HT-HEADER-0919 | 统一页面头部真机验收 | 装新构建后依次看：线程页（有 / 无壁纸）、智能体资料、定时任务、账户设置各子页、聊天主题、OpenClaw 管理、消息详情、搜索、首启引导、模型 / 身份 / 定时任务编辑器与文件页；暗色下再看一遍。 | 所有返回 / 关闭键都是 44 圆钮：亮色纯白 + 浮起阴影，暗色浮起面 + 细线；距屏幕边 16、距顶部安全区 8；标题居中；内容距控件 24；线程页两颗圆钮不再贴边。白底页（线程无壁纸、搜索、消息详情）上白圆钮只靠阴影显形，确认是否可接受。 | 自动门禁通过；未装构建或操作真机。 |
| HT-WALLPAPER-0919 | 沉浸式壁纸真机验收（OpenClaw + Hermes 各一次） | 账户设置 → 聊天主题选一张亮图和一张暗图，各在浅 / 深色下打开线程：看壁纸是否铺到状态栏与 Home 指示条之下、头部两颗玻璃圆钮与胶囊、玻璃输入卡、时间标签在照片上的可读性；调「压暗」30% 与「模糊」0 再看；拉起键盘（壁纸不应随键盘上移）、展开全屏草稿（应回到不透明 canvas）、离线胶囊与「回到底部」按钮位置；切换会话时壁纸不应闪。无壁纸时确认头部下方 24pt 渐隐、内容从头部下滚过与之前观感一致。 | 头部与输入区不再有白色 / 黑色色块；玻璃材质在两种极端照片上文字都能读；键盘、全屏草稿与会话切换无异常。 | 自动门禁通过；未装新构建或操作真机。若玻璃质感不够，再决定是否引入 `expo-blur`（需原生构建验证）。 |
| HT-MODELS-0918 | Model management device acceptance | Check Chat default badge vs current checkmark and Manage navigation; provider selection, keyboard, large text and last thinking option. | Consistent insets, working scroll, free switching and Pro configuration continuations. | Automated gates pass; no new build installed or device operated. |
| HT-SKILL-DOC-0918 | 技能详情与 SKILL.md 修复发布/真机验收 | 同步使用本次 App 与 Bridge 构建；OpenClaw 通过独立 Relay 客户端通道，验证内置/额外技能只读与 workspace/managed 保存；Hermes 验证原有读取、Pro 保存；检查浅深色、长描述与大字体。 | 介绍、状态、来源和 SKILL.md 同左边缘；文档无 unknown method；旧 Bridge/不支持的直连不显示假入口。 | 代码、读写回归、旧客户端回放、CLI 打包校验完成；未发布、安装或操作真机。 |
| HT-STORE-SHOTS-0918 | 3.0 iPhone 商店截图视觉验收 | 查看 `docs/3.0/evidence/app-store-2026-09-17/review.html`；六语言每套六张，原图与可编辑工程在同目录 ZIP。 | 确认风格、文案和展示顺序后再上传 ASC；iPad 按负责人要求暂缓。 | 36 张 1290×2796 PNG 与模板工程已完成；待负责人视觉反馈，未上传或提交审核。 |
| HT-SDK57-0916 | 解锁手机以完成 SDK 升级的冷启动验收 | 保持该 iPhone 与电脑连接并解锁，继续采集新版 Release 的连续冷启动 / 崩溃日志；Debug 需另开 Metro 安装验证，最终恢复 Release。 | Release 无开发服务器时正常进入应用，无原 UIScene SIGTRAP；Debug 启动 JS；双后端入口、链接与图片粘贴 / 相册待设备操作确认。 | 构建与自动测试通过，Release 已原位安装；系统拒绝启动，原因 Locked / passcodeRequired，待解锁。 |
| HT-FINAL-0916 | 最终候选发布签字与风险关闭 | 按最终检查报告第 1、7 节汇总关闭既有 HT-COMPAT-0914、HT-PRO-0914-3、HT-M8-1～5；先固定提交，准备保留新 DO / 限速的前向恢复产物，配置生产 ticket 密钥，真实旧包 / 商店购买通过后按服务端 → CLI → App 发布；另决定技能辅助文件浏览、备份来源语义及 Office 移除沟通。 | 每项留下明确版本 / 构建 / 实测记录；不要把本地代码回退当成 Cloudflare 迁移回滚，或把自动绿灯当成原生 / 付费验收。生产 Relay 自定义域名 health 的 WAF 403 与 `/ws` 可达需分别核对。 | 自动检查与真实双后端短时链路通过；生产切换、公开政策、旧包 / 双商店 / 真机和观察窗口未关闭。不重复创建同内容的旧 TODO。 |
| HT-PAYWALL-COPY-0916 | 付费墙文案与留白真机验收 | 负责人查看通用、锁定 Agent、文件编辑和日志入口；检查猫头区域、标题换行、权益到价格 32 pt 距离，并用大字号展开月付查看滚动。 | A 版通用文案与情境标题清楚，文字区靠近价格，长文案和购买按钮均可完整访问。 | 待负责人反馈；不操作模拟器 |
| HT-ROSTER-ORDER-0916 | 花名册排序真机验收 | 装新构建后打开花名册：只与 A 聊一句，确认 A 到顶且时间是刚刚；等一次心跳（`heartbeat.every`，本机 2h）或让某个没聊过的 Agent 跑一次 cron / 子 Agent，确认它不上浮、不出未读点；压后台 ≥1 分钟回前台重连，确认顺序在重连前后不变；OpenClaw 与 Hermes 两个连接各做一遍，切换活动连接后顺序也不变。 | 顺序只随「人参与的消息」变；心跳 / 重连 / 切换连接 / 打开会话都不改变顺序；红点与「需要你」仍在行上。 | 待验收 |
| HT-CONN-0917 | 花名册左滑、连接页与改名真机验收 | 花名册：左滑 Agent 行看「置顶 / 管理」托盘的滑出手感、按下态与只开一个托盘（滚动即收起）；置顶会话行看「取消置顶 / 重命名」；长按菜单不再有「静音」；阿拉伯语下托盘应从另一侧滑出。连接页：从「管理」进入，检查名称行改名（OpenClaw 不掉线；本地模型 / 无 Bridge 名的 Hermes 改名后花名册行名立即变、连接重新握手一次）、详情组（后端 / 传输 / 环境 / 地址 / Bridge 版本 / 最近就绪）的可读性、免费用户的免费连接组；账户设置 → 我的连接 → 行左滑「暂停 / 恢复 / 移除」。 | 无第二处「高级设置」入口；改名后返回花名册与我的连接列表名称一致；深浅色下托盘颜色只有 `surface` 与红色破坏性。 | 待处理 |
| HT-WHATSNEW-0916 | 更新公告弹层与更新日志真机验收 | 在有连接的设备上装新构建冷启动（模拟 2.x 升级：设备上不能已有 `clawket.appUpdateAnnouncementLastVersion.v1`），花名册连接就绪后应弹「Meet Clawket 3.0」；看猫头动效、浅 / 深色、中文每条描述是否一行、Continue；再冷启动一次不应再弹。账户设置 → 关于 → 高级设置开 Debug 后用「预览更新公告」反复看；账户设置 → 帮助 → 更新日志核对 11 个版本与日期。 | 弹层只出现一次、无叠层、Reduce Motion 下猫头静止；`app_update_announcement_shown/closed` 在 PostHog 诊断里各一条。 | 待处理 |
| HT-MODELS-0916 | 模型页真机验收（OpenClaw + Hermes） | OpenClaw：改默认模型 / 加备用 / 改思考等级 / 关一个开关 → Save → 确认重启；Provider 弹层加一个模型；详情弹层删一个未被引用的模型、给显式 provider 的模型改成本。2026-09-19 追加：在已迁移到 `modelPolicy` 的 Gateway 上，先删掉残留的 `openai/gpt-5.4`（详情弹层「删除模型」应可点，删完列表里不再出现），再核对开关状态与 `agents.defaults.modelPolicy.allow` 一致（`claude-opus-4-8 / 4-7 / sonnet-4-6` 应为关，`deepseek-v4-flash-vision-exp` 应为开）。Hermes：点行 → 「Set as current model」。 | Gateway `config.get` 里 `agents.defaults.model`、`agents.defaults.modelPolicy.allow`（旧 Gateway 为 `agents.defaults.models`）、`models.providers.*` 与页面一致；输入框模型选择器不受影响；Hermes `model.get` 变化 | 待处理 |
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
| HT-LM-0914 | 发布包含 `local-model` 的 bridge CLI 到 npm | 决定发布版本后按既有发布流程 `npm publish` `@p697/clawket`；发布前 `npm run test:compat` 必须全绿 | `npm pack @p697/clawket@latest` 解包后 `dist/index.js` 含 `local-model`；在干净机器上 `npx @p697/clawket pair --backend local-model` 打出六位码 | 待处理。当前 latest=0.7.0 不含该命令，App 本地模型步骤展示的 npx 命令在发布前只能改用仓库内 `node apps/bridge-cli/dist/index.js local-model pair`（README 已按此写；2026-09-19 起不再带 `--preview`） |
| HT-LM-0919 | 真机验收 Production 模式下的本地模型入口与配对 | 全新安装（不开调试模式）的 App 进入「连接你的 Agent」，确认列表含「本地模型」；用仓库内 `local-model pair` 打出的六位码完成一次配对并发一条消息 | 列表第三行为「本地模型」；配对后连接详情「环境」显示 Preview（专属资源所在账号，预期如此）、聊天可回复 | 待验收 |
| HT-COMPAT-0914 | 已发布 2.x App 跨版本抽验 | 保留真实旧包与存量配对，先在隔离候选服务、再在 Production 小范围按 09 §2 验证双后端聊天/流式/停止/附件/会话、重新配对、锁屏恢复；记录具体 App 版本与构建 | 旧包与新服务/新 Bridge 可用；协议回放不替代原生签字 | 39 项协议回放、20 阶段真实 Worker/Bridge 混合测试通过；旧二进制/真机待验收，2.1.1 provenance 不完整 |
| HT-PRO-0914-1 | Apple 月/年方案调整为同一服务等级 | App Store Connect → Clawket → Clawket Pro 订阅组 → Edit → Edit Level，将月付和年付合到一个 Level 并保存 | 列表不再是 Monthly Level 1 / Yearly Level 2；Sandbox 变更按同等级不同周期规则处理 | 已完成；负责人保存后，2026-09-14 独立打开后台确认两者均为 Level 1，状态 Approved；原生购买验收另见 HT-PRO-0914-3 |
| HT-PRO-0914-2 | Google 新加坡税务信息提醒 | 使用有付款权限的 Lucy 账号进入商家支付资料 → 税务中心 → 新加坡，按实际税务身份处理；不记录税务文件或支付资料 ID | 按 Google 当前政策核对信息与提醒；客户购买验收单独执行 HT-PRO-0914-3 | 已定位个人表单，UEN 可选；未代填或提交。官方说明新加坡免税相关税务居民信息状态目前不限制账户、不影响付款或预扣税，因此不列为紧急上线阻塞；个人身份不能单独决定免税资格，参见 pro-plan-management.md 的官方来源 |
| HT-PRO-0914-3 | 月/年切换与买断原生验收 | 按 `apps/mobile/docs/pro-plan-management.md` 用 Sandbox / license tester 覆盖双向换周期、买断后停原订阅、取消、pending、恢复、续费与退款，双后端连接均验收 | 确认商店当前/下期价格日期、实际 entitlement 与 PostHog 新事件；用户停掉原订阅后不再续费，订阅到期不抹去买断 | 自动门禁全绿；未操作模拟器或真实付费账户 |
| HT-CRON-0914 | 定时任务真机视觉验收 | 双后端验证列表开关、新建模板/四类时间、编辑保存/取消、原生日期选择、运行记录；浅深色、大字体、阿拉伯语 | 内容清晰且控件不重叠；保存失败保留草稿；时区说明真实；返回保持列表位置 | 自动检查及双平台 JS 打包通过，待负责人真机验收；未操作模拟器、配对或线上任务 |
| HT-SKILLS-0919 | 发现页（ClawHub 网页壳）真机验收 | 双后端进入技能页右上角 Compass：ClawHub 目录在手机宽度下的排版、深色模式跟随系统、滚动与站内跳转；点进一个技能详情看底部「@owner/slug + 通过 Chat 安装」栏，点安装后进入主会话并确认 Agent 收到 `openclaw skills install @owner/slug`（Hermes 为 `hermes skills install <slug>`）并真的装上；点站外链接（Docs、GitHub）跳系统浏览器；返回键先退网页历史、右上 X 直接退出；断网时安装按钮禁用；Android 硬件返回 | 页面可用、安装链路两端打通；ClawHub 网页在手机上可读 | 自动化验证通过，iOS Simulator Debug 构建通过；未操作模拟器看网页排版（本机沙箱浏览器拦资源、真机 Chrome 需选浏览器，均未看到 clawhub.ai 手机版实际效果） |
| HT-ANDROID-0919 | Android Debug 构建在 Gradle 9.3.1 下失败（早于本次改动） | `expo prebuild` 生成的 `android/gradle/wrapper` 指向 Gradle 9.3.1（与 RN 0.86.3 自带 wrapper 一致），但 `@react-native/gradle-plugin` 的 `build.gradle.kts` 在本机（Zulu JDK 17，唯一 JDK）编 Kotlin DSL 报 `Unresolved reference 'libs'`，单独在插件目录跑 `./gradlew help` 同样失败，清 `~/.gradle/caches/9.3.1/kotlin-dsl` 无效；用 `~/.gradle/wrapper/dists/gradle-9.0.0` 的二进制直接跑同一插件通过。09-17 SDK 57 升级时 Android 就因磁盘满未验证。请决定：装 JDK 21 重试，或通过 config plugin 把 wrapper 钉到 9.0.0 | 生成的 wrapper 直接能出 `app-debug.apk` | 待处理；用 9.0.0 二进制 + `-PreactNativeArchitectures=arm64-v8a` 已出包，只是绕过而非修复 |
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


### 2026-09-16 — Xcode 27 Archive compatibility

Owner requested a durable repair after Xcode 27.0 (27A266a) rejected five Pods resource-bundle deployment targets (9.0–13.4). App/React Native already require iOS 15.1. Added the registered `with-ios-pod-deployment-target` Expo plugin: after React Native post-install, raise explicit Pods minima to the greater of the app property and React Native minimum, preserving higher requirements and inherited settings. Repeated generation is idempotent and template drift fails closed.

Release Archive then exposed RevenueCat 5.67.1's Swift 6.4 synthesized initializer collision. Backported RevenueCat upstream commit `870899891ac9a05118ae6ee16d4ae189b2c1eac2` via a reviewed, idempotent Node patch run by the same Pod hook. The generated PaywallColor source matches upstream byte-for-byte; no dependency version or purchase behavior change. Source drift fails with a review instruction. Mobile instructions and engineering baseline document both fixes.

Validation: clean Expo prebuild for both platforms, repeated iOS prebuild and two successful pod installs; 127 Pods, all 290 explicit deployment settings at 15.1; Pod lock diff is only the Podfile checksum. Ruby hook tested with 8 version/inheritance cases plus a higher app floor. Full `check:required` passed (Mobile 279 suites / 2,818 tests); final plugin/backport suite passed 12 tests, Ruby syntax and docs checks passed. Xcode 27 Release generic-device Archive succeeded with `CODE_SIGNING_ALLOWED=NO`; signing, export and App Store upload were not performed. Android Debug verification was attempted but failed on `No space left on device`; removed only generated Android build intermediates to finish iOS verification. Android build remains unverified for this iOS-only plugin change. Evidence is local under `docs/3.0/evidence/xcode-27/`. No simulator/device operated, service deployed, pairing changed or commit created; unrelated `mock.ts.orig` preserved.


### 2026-09-18 — App Store screenshot review package

Owner authorized real simulator captures and explicitly allowed XCTest / simctl automation. Prepared six iPhone promotional images in each of en-US, zh-Hans, de-DE, ja, ko and es-ES (36 PNGs, 1290×2796). Used the MIT-licensed Open Screenshot Generator Inboxly Mail template and its native renderer; retained editable multi-language JSON, current app icon, copy, source/license, full-size PNGs, contact sheets, review gallery and a ZIP under ignored local evidence `docs/3.0/evidence/app-store-2026-09-17/`. iPad deferred as requested.

Connected real OpenClaw, Hermes and YouMind on the capture-only simulator; paired its OpenClaw device without rotating existing credentials. Created benign demo conversations and localized the actual app UI. A process-scoped existing Pro unlock flag was used only for the simulator build; no app source, .env, backend configuration, production deployment or store submission changed. Existing unrelated `mock.ts.orig` preserved.

Validation: 36 locale/scene source-image mappings matched embedded project images by bytes; PNG dimensions and nonblank phone interiors checked; all six contact sheets visually reviewed. Replaced a temporary offline hero, wrong-language model replies and one keyboard-visible skill capture. Final capture harness completed successfully. Visual acceptance remains HT-STORE-SHOTS-0918; this asset work does not replace release, purchase or compatibility gates.


### 2026-09-18 — Skill detail rhythm and OpenClaw document compatibility

Owner's screenshots exposed double horizontal insets, a description flush against sheet chrome, a detached SKILL.md group, and `unknown method: skills.get`. Details now share one 24-point edge with 16-point top/section spacing, 64-point minimum rows and full-width hairlines; SKILL.md follows Source in the same canvas group. Scroll, toggles, missing requirements, source handoff and uninstall remain intact.

Root cause: the restored source UI treated Hermes's document RPCs as native OpenClaw methods. OpenClaw now exposes read and write independently from the current handshake method list. Clawket Bridge supplies missing document methods only on negotiated isolated full-client channels to a local Gateway: each request resolves the skill through that client's scoped skills.status, preserves native methods, restricts reads/writes by granted scopes, and uses bounded UTF-8 reads and atomic default-SKILL.md writes. Bundled/extra skills are readable but protected; nonbundled workspace/managed skills need operator.admin to save. Host paths come exclusively from the authenticated status response. Unknown/duplicate keys, arbitrary paths, symlinks/hardlinks, binary/invalid UTF-8 and oversized documents fail closed. Pending operations expire or disappear with the owning connection. Hermes implementation and its source/edit/Pro flow are unchanged. Older Bridges/shared channels and direct Gateways without native document methods no longer expose an unusable source entry; complete OpenClaw Relay support requires the updated Bridge. This corrects the earlier documented assumption that generic skills support implied native document RPC support.

Validation: repository-wide typechecks and required test suites passed (Mobile 286 suites / 2,879 tests on the first run); check:required then caught the new literal zero-radius override, which was removed. The remaining design-system (191 UI sources), strict 19-locale and docs gates all passed on rerun. Final Mobile typecheck and protocol/adapter/section suites passed 75 tests, including the two added unavailable-operation regressions. Bridge includes 16 real-file document tests plus 66 runtime tests, including negotiated channel readback, legacy/remote passthrough and stopped-socket responses. v1 live replay passed all 39 tests. CLI bundle built and package verification passed (26 runtime modules / 58 provenance inputs). No cloud deployment, global CLI installation, pairing change or external OpenClaw/Hermes source modification; native visual/release acceptance is HT-SKILL-DOC-0918. Unrelated progress entries and mock.ts.orig preserved.


### 2026-09-18 — Model management and Chat entry refinement

Owner requested clearer defaults/catalog hierarchy, direct Add model, fixed thinking-sheet scrolling, Chat management access/default visibility and Pro configuration writes. Implemented capability-based configuration reads separate from session selection; independent default badge and dismiss-before-navigation. OpenClaw retains catalog drafts and one confirmed restart; Hermes/local-model global switching is now free. Provider form selects its provider explicitly and uses one 24-point edge with integrated scrolling; thinking has 72%/92% detents and an integrated list. Purchase continuations reject stale scope/offline/unmount. Existing unrelated skill/protocol work preserved. Validation: complete `npm run check:required` passed (Mobile 286 suites / 2,886 tests, all workspace types/self-contained tests, design-system, 19-language and documentation checks). Final focused model/Thread regression passed 6 suites / 63 tests, including the subsequently added thinking-list regression. Final Mobile typecheck and docs checks passed. No service deployment, pairing refresh or native device operation. Native layout/gesture acceptance remains with owner (HT-MODELS-0918).

### 2026-09-18 — English App Store screenshot revision

Owner approved an English-only six-card revision for visual review: brand/chat hero, tool execution detail, Session management, Agent Profile, Skills and Models. Removed the standalone Hermes chat and YouMind Sprite cards. New output lives under ignored local evidence `docs/3.0/evidence/app-store-2026-09-18-en-v2/`; previous six-language package is preserved. Continued using the existing MIT Inboxly Mail template and Open Screenshot Generator native renderer; added the existing cat mascot to a larger tilted hero composition. Captured actual Session/Profile/tool UI via the previously authorized XCTest/simctl workflow. Copy does not promise zero latency or full reasoning text across all models.

Created benign English demonstration sessions on the real OpenClaw Gateway. New hero/tool sessions use the configured DeepSeek native path after observing duplicate Claude CLI history/stream reconciliation in the installed capture build. No app source or global model default changed. Retired three unsuccessful task-created demo sessions with `deleteTranscript:false` after a private backup; retained final demonstration sessions. Existing unrelated SkillsSection.tsx changes and mock.ts.orig are untouched.

Owner-requested cron cleanup: backed up the five failed jobs privately under `~/.openclaw/backups/clawket-store-20260918/`, then removed four already-disabled old jobs through the normal Gateway API. The remaining skill-collection review is system-owned; its delete request was rejected by OpenClaw and no lower-level bypass was used. It still lacks Anthropic API credentials and remains visible as one failure in the honest Profile capture. Did not execute old cron payloads or send their messages. Repairing the system maintenance model/auth configuration is a separate unresolved item before the final Profile capture.

Validation: six 1290×2796 PNGs, embedded raw-image correspondence, nonblank screenshot regions and all six compositions visually checked; local review gallery, editable JSON and ZIP prepared. Not uploaded to App Store Connect; iPad and other language revisions remain deferred until the owner reviews the English design.

### 2026-09-19 — Fresh install after delete: reinstall no longer resurrects Keychain connections

Owner report: deleting the App and installing a new build opened the Roster with `No agents on this connection`, a `Reconnect` capsule and a locked `Add connection` instead of onboarding. Cause: `ConnectionStore` (and most local preferences) live in `expo-secure-store`, i.e. the iOS Keychain, which survives bundle deletion; only AsyncStorage (roster cache, chat cache, announcement baseline) was wiped. The restored registry made `initialRouteName` `Roster`, the empty roster cache produced the empty copy, the runtime reconnected the stale record, and the free tier counted the ghost connection so the add action locked. `06-paywall-and-growth.md` §1 already required re-pairing after a reinstall while keeping the grace record; `13-design-rollout.md` had observed records "immediately return" after a signed Simulator rebuild without treating it as a defect.

Delivered: `src/services/install-state.ts` — AsyncStorage marker `clawket.installMarker.v1`, `classifyInstallState` (`fresh` = no marker and no `clawket.*` / `agent_avatars` sandbox key, `upgraded` = no marker but sandbox data from a pre-marker build, `existing` = marker present; unreadable storage fails closed to `existing`), `ensureInstallState` runs the reset once and always writes the marker. `useFreshInstallGate` wraps the root: `App` renders the launch spinner until the state resolves, then mounts `AppRoot` (the former `App`), so no Keychain preference read or runtime start happens against state that is about to be forgotten. `resetForFreshInstall` (`account-maintenance.ts`) = `ConnectionRuntime.removeAllConnections` (each record through the existing removal path for device tokens / caches / watermarks / queues, YouMind session cleared per record via the widened credential port, then `ConnectionStore.clearPersisted` deleting the current, rollback and legacy 2.1 snapshots) + `clearLegacyGatewayConfig` + new `StorageService.clearLocalPreferences` (debug / simulate-free / relay environment / theme / accent / chat appearance / node toggles / current Agent). Kept on purpose: device identity and the Pro entitlement record beside it (grace stays once-per-device), scoped last-session pointers (no credentials). Android is unaffected (uninstall clears SecureStore) and the marker is harmless there.

Validation: `install-state.test` (classification incl. third-party keys, fail-closed reads, once-only reset, upgrade no-op, failed reset / marker write never block), `connection-store.test` (`clearPersisted` removes current / rollback / legacy and a restart sees no records or `gct_` tokens), `index.test` (`removeAllConnections` before `start`: 4 token deletions, YouMind session cleared, registry keys gone, roster cache tombstoned, runtime then starts with zero connections and no adapter), `account-maintenance.test` (identity untouched, wipe failure surfaces). `tsc` clean; bootstrap / Roster / Onboarding / storage suites green; design-system check 5/5. Note for the owner's phone: a build installed *over* the current ghost state classifies as `upgraded` (the sandbox already holds `clawket.*` keys) — delete the App once more and install the fixed build, or remove the ghost connection from its Connection page. Device acceptance in HT-INSTALL-0919.

### 2026-09-19 — Cron create page trimmed

Owner screenshot feedback on the new-job page: the two step labels and the guiding subtitle read as filler, the Enabled switch is meaningless while creating (a new job is obviously enabled), and the Advanced settings row (Cron expression) is something "users may not touch in 800 years". Checked PostHog before deciding: 2026-03 → 09 shows 668 `cron_create_tapped` by 293 users against 219 `cron_save_succeeded` by 60 users, nearly all edits of existing jobs, and the 2.x wizard already created jobs with only name + prompt + schedule, fixed `delivery: none` and no model override — nobody has ever set an advanced option at creation time.

Delivered in `CronEditorScreen`: removed `1 Choose a starting point`, `Choose a template, then adjust the task.` and `2 Configure the task`; the Enabled switch and the Advanced settings row (Cron expression, description, model, delivery) now render only when `jobId` is set, so a new job is always `enabled: true` and the create page ends at Create. The edit page keeps every previous control. Also fixed the edit page's `Advanced settings` label showing untranslated: the key lives in the `config` namespace and react-i18next resolves only the hook's first namespace (`settings`), so the call now passes `ns: 'config'` (the strict i18n gate did not catch it because it accepts any namespace of the hook). Three `settings` keys removed from all 19 locales. Spec 04 §5, the Mobile design-system recipe and `apps/mobile/AGENTS.md` updated; deviation row `[UX-2026-09-19-cron-create]`.

Validation: `CronEditorScreen.test` gains a create/edit split regression (no step labels, no switch, no advanced row on create; `enabled: true` + `delivery: none` in the add payload; switch, Use Cron expression and Description present on edit) — 14/14 pass. Device acceptance stays with the owner (HT-CRON-0914).

### 2026-09-19 — Immersive chat wallpaper

Owner reported on device that a custom photo only filled the message strip: the Thread header and the composer dock each painted an opaque canvas above and below it, and the saved `dim` was stored but never applied. Delivered the owner-requested immersive treatment without new native dependencies: `ChatBackgroundLayer` now renders once under the whole Thread as a sibling of the keyboard-avoiding content (edge to edge, blur plus a canvas overlay at the saved dim, 0–0.6, surfaced as a `Dim` row beside `Blur` in 19 locales); the header became an absolute band over the timeline in both modes (`resolveThreadHeaderHeight`, list content and centered states offset by it; the spec's 24-point canvas tail now really fades rows out under the opaque header); with a wallpaper the band and dock drop their canvas for `ChatWallpaperScrim` gradients and every floating control shares one glass recipe (`createChatGlassStyle`: `surfaceFloating` 0.8 / 0.74, `line` hairline, floating shadow in light) through `FloatingButton appearance="glass"`, `HeaderPill material="glass"`, the compact `Composer appearance="glass"` card, time labels and the appearance preview composer. Full-screen composition returns to the canvas; bubbles, tool rows, cards, sheets and overlays are unchanged. The header band now owns its touches so rows scrolled underneath cannot be tapped blind. Both backends share the renderer.

Validation: Mobile typecheck (remaining errors are another session's `packages/agent-protocol/mock.ts` and Cron editor work), `check:design-system` (194 UI sources), documentation checks; full Mobile jest 286 / 288 suites, 2,915 / 2,917 tests — the two failures are the concurrently edited `CronEditorScreen` suites, also the source of the current i18n strict `MISSING` keys. Added regressions: background layer (blur, bounded dim, preview image, null when off), resolver glass chrome and ink contrast over black / white / canvas, ThreadView default vs. immersive chrome and the full-screen composition fallback, Composer / FloatingButton / HeaderPill glass, appearance screen dim save and analytics. No simulator, device, deployment or pairing change; device acceptance is HT-WALLPAPER-0919. Unrelated dirty files preserved.

### 2026-09-19 — Cron edit page: rhythm, focus and explicit prompt editing

Owner screenshot feedback on the edit page: solid functionality but everything stacked with no focus; `When should it run?` sat closer to the block above than to its own rows; `every 02:32` / `Asia/Shanghai` appeared twice (row + preview card); run rows repeated the prompt summary; and the prompt looked like a static card — the owner only discovered it was editable by tapping it. Root causes in `CronEditorScreen`: one uniform 16-point `gap` for labels, inputs, headings and 52-point rows (a row's own 8-point padding made the label-to-content gap larger than the section gap), `SettingsRow` text inset 16 points further than labels and inputs, and the read-only preview card sharing the `surface` box of `FormTextInput`.

Delivered: sections are `secondary` grey labels with 24 between sections, 8 to an input and 4 to a row; rows bleed to the screen edge so text aligns; only editable text uses the grey box. The prompt on edit is ink text folded to six lines under a label row with a ghost `Edit` action (tap either) and is edited on a full-page sub-page (`page === 'prompt'`, body-size borderless input, Done) — the pattern the Schedule sub-page already used; create keeps the inline input. The schedule row carries `Next run` (server value while the draft's schedule is unchanged, `upcomingRuns` estimate after a change, `Paused` when the switch is off) and the timezone as subtitle, so the preview card left the edit page (it stays on the Schedule sub-page and the create form, now borderless and without repeating the timezone row). Model and Advanced settings are a second row group; Advanced settings is a sub-page (`page === 'advanced'`) instead of an inline expansion behind a chevron, with `Use Cron expression` as a row. Runs load three first (`limit: 3`, then ten per Load more) and show date + status only (error as subtitle; the summary is read in the run sheet); the Last run / Next run rows were removed and the `Last run` key deleted from all 19 locales. Save enables only on a dirty draft, matching Identity. The concurrently added Model row (`cronModel`, separate session) was kept and placed in the row group. Spec 04 §5, the Mobile design-system recipe and `apps/mobile/AGENTS.md` updated; deviation row `[UX-2026-09-19-cron-edit]`.

Validation: `CronEditorScreen.test` gains an edit-page regression (prompt sub-page round trip, no inline prompt input / preview / Last run on edit, `Next run` subtitle, 3-then-10 run paging, Advanced and Schedule sub-pages) — 19/19 together with the concurrent model tests; `AgentSettingsSections.test` 42/42; mobile `tsc` clean for the cron files; `check:ui-style` passes (196 files, 4 file/rule pairs beat the baseline); `check:design-system` and `check:docs` pass. The strict i18n gate currently fails only on four `settings` keys from the concurrent Models-page work (`Applies to all sessions`, `Catalog`, `Defaults`, `Switches control which models this Agent may use.`), not on this change. No simulator or device; visual acceptance stays with the owner (HT-CRON-0914).

### 2026-09-19 — One page header

Owner device feedback after the wallpaper work: the Thread's back and sessions buttons sat 4 points from the screen edge while the Agent profile and Cron pages sat at 16, and back buttons had no fill on some pages but a circle elsewhere; the owner asked for one shared header with consistent edge, size and filled circles. `ScreenHeader` (already the `05` §11 contract) is now the only page header: safe-area inset + 8 / 44-point control row inset 16 / 8 below, content 16 further down (24 from the control, matching the sheet rhythm); a quiet 44-point `FloatingButton` circle for back / close (`glass` over a wallpaper), a screen-centered title or the connection status that replaces it, one trailing action slot, and `testID`-derived or explicit test hooks. Migrated the Agent profile and section headers, `AccountSettingsPageHeader` (all account pages), Chat theme, OpenClaw management and message details onto it; Search, onboarding `FlowHeader`, the YouMind sign-in header and the Thread band keep their own rows on the same edge, height and quiet circles. Removed `HeaderActionButton` with its last consumer (index export, `check:ui-style` forbidden-set entry and selftest case updated). Owner follow-up the same day: the grey `quiet` fill was too close to the grouped canvas, so page-header circles now use `appearance="surface"` — pure white with the floating shadow in light, `surfaceFloating` with a hairline in dark; `quiet` remains for controls inside sheets, whose light canvas is already white. Docs: `apps/mobile/AGENTS.md`, `docs/design-system.md`, `04-app-screens.md` §0 / §3, `05-visual-system.md` §11.

Validation: Mobile typecheck (remaining errors are other sessions' `agent-protocol/mock.ts` and Cron editor work), `check:design-system`, root `check:docs`; full Mobile jest 292 suites / 2,942 tests green on rerun (three `waitFor` timing flakes in the concurrently edited Cron editor and Agent profile suites on the first pass, all passing in isolation). New `ScreenHeader` regression covers geometry, quiet / glass / close circles, status replacement and test hooks; Agent profile / section and Thread suites assert the shared inset and quiet circles. No device operated; acceptance is HT-HEADER-0919.


### 2026-09-19 — One execution record for Cron runs, with what the run delivered

Owner report on device: the chat-stream Cron card for the 07:00 daily brief opened a screen showing only the Agent's one-line narration, while the brief actually sent to Telegram was nowhere in Clawket; the card (a pushed read-only Thread with `runContext`) and the profile's run record (a sheet) were two implementations of the same intent. Investigated against the live OpenClaw 2026.9.1 Gateway and its sqlite stores: `cron.runs` reports a hidden per-run session key (`agent:main:cron:<jobId>:run:<sessionId>`) that `chat.history` resolves to zero messages, while the stable key `agent:main:cron:<jobId>` holds the newest run's 52-message transcript, including the `message` tool call whose argument is the full Telegram text (wrapped in a generic `tool_call` and echoed once more as a `custom` row). The run record itself carries only the ≤2000-character summary and a routing-only `delivery.messageToolSentTo` trace; OpenClaw drops the text on purpose. A second defect: the sheet showed `Not delivered` for delivery mode `none` because `delivered: false` was checked before `not-requested`.

Delivered: `CronRunLogEntry` gains `delivery`, `completionStatus`, `runId` and a backend-owned `outputRef`; `CronOperations.runContent(entry)` returns `{ deliveries, output?, sessionKey? }` — OpenClaw reads `chat.history` on the stable key (`resolveCronRunSessionKey`), accepts the transcript only when its `sessionId` matches the record, and extracts sends with `extractCronDeliveries` (direct `message`, `tool_call` wrapper, `custom` echo, de-duplicated); Hermes carries the output file name on every run entry and reads its full content through the previously unused `hermes.cron.outputs.get`. `CronRunSheet` moved to its own module and became the one execution-record surface for the chat card, the Runs tab and the editor: delivered content first (channel · recipient caption, skeleton while loading, an honest sentence when the conversation was recycled), announced runs show the summary as the delivered text once, then Summary, duration / model / notifications (`not-requested` fixed; `Sent by the Agent` for message-tool sends) and `View full conversation`, which navigates in `onAfterClose` to the stable session. The Thread `runContext` route param, header/empty-state/composer special cases and `RunResult` page mode are gone; cron sessions hide the composer by key and keep the calendar header icon; sub-agent cards are unchanged. Six new `settings` keys in all 19 locales. Spec 04 §4/§5, 03-adapters, the Mobile design-system recipe and `apps/mobile/AGENTS.md` updated; deviation row `[UX-2026-09-19-cron-run-detail]`.

Validation: new `cron-run-content.test` (key stripping, three send shapes, dedupe, malformed rows), `cron-run-content.adapter.test` (OpenClaw stable-key request, newer-session rejection, no-session shortcut; Hermes `outputRef` round trip), `CronRunSheet.test` (deliveries + deferred navigation, recycled, load failure, announced, stored output, failed run, stale response), and updated `ThreadView` / `ThreadScreen` / `CronEditorScreen` / `AgentSettingsSections` suites — all passing; Mobile `tsc` clean for the touched files, agent-protocol `tsc` clean, `check:ui-style` passes (196 files). Strict i18n reports zero missing keys; its five `UNUSED` findings are the concurrent Models-page work, not this change. No device operated; acceptance is HT-CRON-RUN-0919. PostHog (180 days) shows `run_card_opened` for cron only 27 times by 3 users — no usage evidence either way before 3.0 ships.

### 2026-09-19 — Onboarding no longer reports an unrelated connection as "No network"

Owner report on device (Preview, "Add connection" modal): the backend-choice page showed a `No network` banner with Retry while the phone had Wi-Fi and cellular. Cause: `resolveOnboardingRouteStatus` mapped the runtime's `activeState` — the adapter state of the *existing* active connection — to the page's `offline` kind whenever the user already had a connection, and the screen rendered that kind with the `network` error copy; the banner's Retry probed that old connection. The runtime error of the old connection leaked the same way, and its `ready` state could mark a new pairing as ready.

Delivered: the resolver only reads runtime state for the connection this pairing created (`operation.targetConnectionId === activeConnectionId`); before that, or on the choice/code form, the page is `idle` / `connecting` regardless of what the existing connection is doing. Retry probes only the paired connection and otherwise replays the last pairing action instead of probing an unrelated connection. The remaining offline case — the newly paired connection dropping mid-pairing — uses the roster wording `Offline · reconnecting` + `Reconnect` (existing `common` keys), never `No network`, which stays reserved for the `network` adapter error of the pairing itself.

Validation: `route-model.test` (scoped offline / ready / error, plus an unrelated-connection matrix over offline / reconnecting / error), `OnboardingRoute.test` (idle form over an offline existing connection, failed claim replays the claim, offline paired connection probes it), `OnboardingScreen.test` asserts the copy — 45/45 Onboarding tests; Mobile typecheck green. `i18n:check` strict reports five unused keys from concurrent Models / header work, none from this change. Device acceptance stays with the owner.

### 2026-09-19 — Roster connection capsule trails against Search

Owner device feedback: the header `Retry` capsule floated in the middle of the spare width between the account / Pro group and Search, which read as misplaced. `headerStatusSlot` now aligns its content `flex-end`, so the capsule sits 8 points before Search — the same `Space.sm` gap the account and Pro controls keep on the left; the slot still takes no layout space from the list. `RosterScreen.test` asserts the trailing alignment (15/15); `docs/design-system.md` §8 and the Mobile `AGENTS.md` describe the placement. Device acceptance stays with the owner.

### 2026-09-19 — Thread first frame settles once; scheduled cards stop jumping in

Owner report on device: opening Lucy's main chat painted the cached conversation (messages, `工具活动 (N)` groups), then about half a second later the Cron cards (`写日记`, `Memory Dreaming Promotion`, …) pushed in between the rows and the whole timeline re-laid out. Root cause: the message cache hydrated the first frame, but scheduled activity was page-local state fetched only after the adapter reported ready (`cron.list` + `cron.runs`), committed separately, merged by timestamp into the middle of the list, and re-fetched/replaced wholesale on every cron session revision — each landing as its own React commit with different tool-group keys, new time separators and new row gaps, followed by the bottom-follow `scrollToEnd`.

Delivered: (1) `ThreadActivityCacheService` (`src/services/thread-activity-cache.ts`) persists the last successful connection/Agent/session-scoped `ThreadRunSeed` snapshot (bounded, validated on read, removed on empty; cleared with connection removal and with "clear cache" / device reset). (2) `ThreadScreen` reads it once per route and `deriveThreadContentState` gains `hydrating`: the first frame waits (300 ms cap) so cached messages and cached cards land in one commit; cards alone never make a thread `ready` before history is known. (3) The network refresh is diff-merged through `areThreadRunSeedsEqual` — an unchanged result keeps the same state identity (no timeline rebuild, no persist) — and a result that arrives before the history refresh waits up to 300 ms for `historyLoaded` so both settle in one frame; changed results persist. `runCards` keep their array identity across session token updates. (4) `useThreadRunEntrance` + `MessageEntrance` (reply offset) let a card that appears on a visible timeline slide in like a reply; hydration, bursts beyond three and reduced motion stay still. (5) `ThreadView` keeps the delivery-status map stable across streamed chunks so visible rows stop re-rendering on every token. Both OpenClaw and Hermes share the path (both declare `cron`); YouMind / local-model have no cron capability and are untouched.

Validation: new `thread-activity-cache.test` (round trip, empty removal, corrupted/mixed records, scoped clear), `useThreadRunEntrance.test`, `model.test` (`hydrating` precedence, seed equality), `ThreadScreen.test` (cached cards present in the first ready frame for OpenClaw and Hermes, equal refresh keeps identity and skips persist, changed refresh persists, fresh result waits for history), `ThreadView.test` (hydrated cards still, one entrance for a new card, burst stays still), `connection/index.test` and `account-maintenance.test` cleanup; 237 Thread/chat/connection tests green, Mobile typecheck and `check:design-system` green. Device acceptance stays with the owner: expect one paint on thread entry, an unchanged timeline after the network refresh, and an 8-point slide for a job that finishes while reading.

### 2026-09-19 — Agent profile: Identity opens from the hero

Owner request: drop the `Identity` row on the Agent profile and make the avatar / name hero the entry instead, with an edit glyph beside the name. Delivered in `AgentSettingsScreen`: the hero is one `Pressable` (`agent-settings-identity`, `accessibilityRole="button"`, label = Agent name, hint = `Identity`, pressed opacity `Motion.pressedOpacity`) when `identity.editable || identity.locked`; a 16-point `inkSecondary` `PenLine` (owner: 20 read too big) hangs off the name's right edge (absolute, so the name stays centred under the avatar), swapping to `Lock` for a Pro-locked Agent whose tap goes through the `identity` paywall first; Hermes / YouMind (neither capability) render the same hero without glyph or press. The `agent-settings-identity-group` card and the `Fingerprint` icon are gone; analytics (`settingsRowOpened{row:'identity'}`) and navigation are unchanged. Docs: `04-app-screens.md` §5.

Owner follow-ups the same day: the glyph shrank from 20 to 16 points (`IconSize.sm`); and the Identity page's bottom `New Agent` button was deleted — PostHog (90 days, 2.x `agent_create_started`, all from the old `agent_header`) shows 37 of 2,541 users ever started creating an Agent, so one entry suffices and it stays in the roster `+` sheet, which already lands on Identity with `action: 'create-agent'` / `openCreateOnMount`; the create sheet and paywall gate are unchanged, `IdentityScreen.test` now drives creation through the route action.

Validation: `AgentSettingsScreen.test` (hero button + glyph, no `Identity` text, locked hero → paywall), shallow suite (YouMind hero stays inert), `IdentityScreen.test` (no create button, route-action creation, Pro gate); Mobile typecheck clean for both screens. `clears the red failure count once the Runs tab acknowledges it` and two `CronEditorScreen` timeouts fail in the concurrently edited Cron-ack work and are unrelated. No device operated; acceptance with the owner.

### 2026-09-19 — Skill discovery is ClawHub's web catalog again

Owner report: the `Discover` page reached from the Skills Compass looked useless. Cause: the 3.0 migration kept only the search half of the 2.0 discovery (`searchDiscoverSkills`), and both ClawHub and skills.sh return nothing for an empty query, so the page opened on `No discover results`; the 2.0 browse feeds in `features/discover/` had no caller left. PostHog (180 days) showed real demand — the custom Discover home had 5,108 views / 691 users and 186 users tapped install, the 2.0 ClawHub web shell 1,837 views / 786 users but only 59 install taps behind a small header Download icon; skills.sh browse was a minority (343 views). Owner decision: restore the web-shell path (ClawHub's own site, install support) rather than the custom ClawHub + skills.sh UI, whose data came from undocumented Convex endpoints.

Delivered: `SkillDiscoverScreen` (native-stack page hosting `react-native-webview` on `https://clawhub.ai/skills`, skeleton while loading, `Failed to load ClawHub` Banner + Retry on failure, `ConnectionStatusPill` in the title slot) replaces the `SkillsSection` discover view behind the same `skillDiscover`-gated Compass action (the `management.skills.discover` operation is no longer part of the gate). `skill-discover-model.ts` owns the pure decisions: `parseClawHubSkillUrl` recognizes the current `clawhub.ai/{owner}/skills/{slug}` detail shape (2.0's `/{owner}/{slug}` regex no longer matches — ClawHub now redirects it), `resolveClawHubNavigation` keeps the page on clawhub.ai (other http(s) and mailto/tel/sms open in the system browser, `target="_blank"` ClawHub links stay in-page via `onOpenWindow`, other schemes are dropped, non-top frames pass), and `buildClawHubInstallPrompt` is backend-aware — OpenClaw `openclaw skills install @owner/slug` (the command ClawHub's site shows today; the old prompt still said `clawhub install`), Hermes `hermes skills install <slug>` (Hermes ships ClawHub and skills.sh hub sources natively), other backends get the page only. A skill page grows a canvas footer: the `@owner/slug` handle plus a full-width `Install via Chat` button (`skillInstall`-gated, offline-disabled) that sends the prompt to the Agent's main session through `adapter.prompt` and then opens the Thread; the header back walks the web history first (`usePreventRemove` while `canGoBack`; Close and the post-install navigation release the hold), and a Close `FloatingButton` appears once the page has history. Analytics: `settings_row_opened{row: skills.discover}` on the Compass, new `skill_discover_detail_viewed{source: clawhub_web, backend}` once per skill page, `skill_install_tapped` gains `backend`; the route reports as the `SkillDiscover` screen. `SkillsSection` is installed-only again (discover view, `groupDiscoveredSkills`, `buildSkillInstallPrompt` and the `No discover results` / `Installs` keys removed from all 19 locales); `Failed to load ClawHub` added to `settings` in all 19 locales. skills.sh is not surfaced.

Native: `react-native-webview` returns to the Mobile manifest at the Expo-recommended `13.16.1` (removed as unused in M7; the migration map allowed keeping it if discovery still needed a web page). Root and Mobile lockfiles updated, `expo install --check` does not flag it, clean `expo prebuild`, `pod install` (needed `LANG=en_US.UTF-8` under Ruby 4 / CocoaPods 1.16.2) and an arm64 iOS Simulator Debug build succeed. Android Debug does not build on this host under the generated Gradle 9.3.1 wrapper — RN 0.86.3's own gradle plugin fails Kotlin DSL compilation standalone, independent of this change and unverified since the 09-17 SDK 57 upgrade; running the same `app:assembleDebug` with the cached Gradle 9.0.0 binary (arm64 only, after freeing 3.6 GB of iOS DerivedData — the disk was at 1 GB and the first attempt died in CMake with `No space left on device`) succeeds and produces `app-debug.apk` with the webview linked; the wrapper/JDK decision is HT-ANDROID-0919.

Follow-up (not mixed into this UI change, owner-agreed two-step plan): once the web page is confirmed on device, delete `features/discover/` (~1,000 lines), the adapter `skills.discover` operations in `openclaw.ts` / `hermes.ts`, the protocol `DiscoverSkillItem` / `DiscoverResult` / `SkillsOperations.discover` contract and mock, and the `skills.discover` section-model row.

Validation: `skill-discover-model.test` (URL shapes incl. plugin/catalog/redirected/invalid, navigation policy, backend prompts), `SkillDiscoverScreen.test` (catalog → skill page footer, one detail event per skill, OpenClaw and Hermes prompts, external / in-page / blocked navigation, web-history back vs Close vs hardware back, capability and offline gating, load failure retry, rejected install stays on the page), `AgentSettingsSectionScreen.test` (Compass pushes the page as its own screen and returns to chat), `AgentSettingsSections.test` / `skills-model.test` trimmed to installed behaviour, `posthog-navigation.test` and `events.test` for the new names. Mobile typecheck clean; `check:ui-style` passes (198 files); `i18n:check` reports no missing or unused key from this change (its remaining failures are other in-flight work: `ChannelsDevicesSection`, Models keys); full Mobile Jest 3,010 / 3,015 with the five failures in `AgentSettingsScreen.test` (cron ack) and `CronEditorScreen.test`, whose sources are dirty from another session and untouched here. `check:required` fails only in `@clawket/agent-protocol` coverage (`mock.ts` `mockCronPayload`, another session's in-progress cron change; this change touches no protocol file) and otherwise passes. No simulator or device operated for visuals; the ClawHub site's phone layout was not seen (sandbox browser blocked its assets) — HT-SKILLS-0919.

### 2026-09-19 — OpenClaw config page: table of contents, multi-open, search

Owner report: the config page defaulted to 26 identical collapsed cards, allowed only one open key (`useState<string | null>` from the 09-16 paywall batch — an implementation shortcut, never a decision), and marked the open row with the `selected` inset fill, whose 4-point vertical / 8-point horizontal insets and card-sized radius read as a misaligned grey patch. Measured against the owner's real `openclaw.json` (26 keys, ≈1,250 lines; `models` 250, `agents` 194, 11 keys under 7 lines) and PostHog (62 users opened the viewer in 60 days, 1.6 opens each): a low-frequency lookup page, so it optimizes for finding one value.

Delivered in `OpenClawManageSections.ConfigurationSection` / `OpenClawManageScreen`: (1) `describeConfigValue` / `filterConfigEntries` (`openclaw-manage-model.ts`) — each key row is captioned with its child key names, `{{count}} items` for arrays, or the literal for a primitive / empty container (those have no chevron and nothing to open); a `quiet` `SearchInput` filters by key name or serialized value, with the shared `No results` empty state. (2) One `SettingsGroup` in file order instead of 26 cards; any number of keys open at once; expanded keys and the query live on the screen so the menu round-trip keeps them; a header `Collapse all` ghost action appears from the second open key; nothing opens by default (the owner's "expand `meta` first" was declined — it is the least useful key and captions remove the need for a demonstration row). (3) `SettingsRow` gains `expanded` (down chevron via `-chevron-down` test hook, semibold title, `accessibilityState.expanded`); the config header no longer uses `selected`. (4) The opened JSON renders through the new `JsonValueTree` export of the shared chat `JsonTree` inside a `surface` code well under the row (16 horizontal / bottom margin, 12 padding, `Radius.settingsGroup`), so the grey moves from the header to the content and long sections start as a few collapsible nodes; the free-tier `ProGate` veil now dissolves into that well. Three `config` keys (`Search config...`, `Collapse all`, `{{count}} items`) in all 19 locales. Not touched: the whole-file editor sheet (a separate per-key editing topic) and the global `selectedFill` geometry used by five choice lists.

Validation: `openclaw-manage-model.test` (previews, filter by name/content/case, trimmed query), `OpenClawManageScreen.test` (captions, non-expandable primitives, two keys open, Collapse all threshold, open keys through the menu round-trip, search filter / no results / Edit still reachable, primitive fixture shown inline in the stale-result test, free-tier veil on an object key), `ThreadPrimitives.test` (`expanded` row: chevron, weight, no selected fill, a11y state). `check:ui-style` passes; `i18n:check` reports the three new keys as used — its remaining failures are other in-flight work (`ChannelsDevicesSection`, `SkillDiscoverScreen`, Models keys). Awaiting owner device acceptance.

### 2026-09-19 — Models page: allowlist follows OpenClaw's `modelPolicy.allow`

Owner report: deleting `openai/GPT-5.4` from the model sheet "succeeded", yet the row stayed in the catalog as lowercase `gpt-5.4` and its Delete row went grey with the sentence `Still used by Not in Gateway config`. Root cause, verified against the owner's Gateway (OpenClaw 2026.9.1, `~/.openclaw/openclaw.json` before/after and the live `models.list` RPC): OpenClaw's 2026-07-18 change "make per-agent allowlists explicit" moved the allowlist from the keys of `agents.defaults.models` (now per-model metadata only) to `agents.defaults.modelPolicy.allow`; the config carries `meta.migrations.modelPolicyAllowlist: true` and the RPC's 19 rows are exactly that array. The App only knew the legacy map: deletion removed the metadata entry and left the policy ref, so the Gateway synthesized a name-equals-id row (`buildSyntheticAllowedCatalogEntry`) that `analyzeModelDeletion` then reported as `model_not_configured`; the switches likewise read and wrote the metadata map, so three `claude-*` models the map lists but the policy hides showed as on, and `deepseek-v4-flash-vision-exp` (policy only) showed as off.

Delivered (owner decision: follow the latest OpenClaw): `resolveModelAllowlistMode` in `model-cost-config.ts` selects `policy` when the config carries `modelPolicy` or the migration marker, `legacy` otherwise (an older Gateway rejects the unknown key — the App never writes `modelPolicy` to a legacy config). Policy mode reads `allow` (exact refs, `provider/*` wildcards matched on segment boundaries, config order) as the page allowlist, rewrites it as a whole with `agents.defaults.modelPolicy.allow` in `replacePaths` when the array already exists, expands a wildcard into the other catalog models when one under it is turned off, gives a newly allowed ref an `agents.defaults.models` entry as OpenClaw's own picker does, keeps metadata when turning a model off, and `Add model` appends to a non-empty `allow`. Deletion (`model-config-delete.ts`) treats an exact ref or alias in the defaults or any `agents.list[*].modelPolicy.allow` as a deletable reference (`remove_policy_allow_entry`) and strips it; wildcards stay. `ModelDetailSheet` says `Not in Gateway config` on its own instead of wrapping it in `Still used by …`. Legacy configs keep the byte-identical patches (all prior tests unchanged).

Validation: `model-cost-config.test` (+10: mode detection, policy reads, wildcard matching, rewrite / append / expansion / unchanged, add-model on restricted and open policies), `model-config-delete.test` (+3: the owner's leftover-ref case across defaults and per-Agent policies, alias removal, wildcard-only stays `model_not_configured`), `model-catalog.test` (+1: policy allowlist state, `replacePaths`, defaults keep the primary / fallbacks allowed), `models-model.test` (+1: wildcard enable state and expansion), `ModelsScreen.test` (+1: plain `Not in Gateway config`), plus an ad-hoc run of the analysis against the owner's real config (deletable, 19 → 18 entries). Mobile tsc clean for these files, `check:design-system`, `check:docs`; full mobile suite 3014 / 3015 with the one failure in another session's in-flight `CronEditorScreen`. Not done: aliases inside `allow` are honored for deletion but not resolved for the switches (OpenClaw's own writer emits refs). Awaiting owner device acceptance — see HT-MODELS-0916, which now also covers deleting the leftover `openai/gpt-5.4` and the switch state on the migrated Gateway.

### 2026-09-19 — Local model entry offered in every app environment

Owner report: after deleting and reinstalling the app, `Connect your agent` listed only OpenClaw, Hermes and YouMind — no Local model. Cause, not a branch problem: the row was gated on `environment === 'preview'` (`OnboardingScreen`), i.e. Debug Mode on (`OnboardingRoute` maps `debugMode` → `preview`); the same-day fresh-install gate (`useFreshInstallGate` → `clearLocalPreferences`) now wipes the Keychain-backed `debugMode` on a clean install, so the previously surviving Preview selection was gone. The pairing profile (`backend-pairing-profile.ts`) and the environment assessment (`assessRelayEnvironmentSelection` classified the local-model Registry as an official Preview origin requiring Debug Mode) would have refused the code / link / QR anyway. Owner decision: local model is a first-class backend in every environment; the Preview-only rule is withdrawn.

Delivered: `isEnvironmentIndependentRegistry` (`relay-environment.ts`) marks the dedicated local-model Registry as an official pairing origin that `assessRelayEnvironmentSelection` never subjects to the Debug Mode / selected-environment checks (`resolveOfficialRelayEnvironment` still answers `preview` for it, so `pairing-session` trust and stored `connection.environment` are unchanged). The local-model pairing profile drops its `environment !== 'preview' || !debugMode` throws; links are accepted only from that Registry and the invitation expectation no longer carries `environment` (now optional in the profile contract). `OnboardingScreen` lists Local model unconditionally and, per a follow-up owner request the same day, orders the chooser OpenClaw → Hermes → YouMind Sprite → Local model (`chooserRows`; products first, the user's own model server last); `buildLocalModelPairingCommand` emits no `--preview` (the CLI's `local-model pair` always targets the dedicated Registry and ignores the flag). Docs: README (en/zh-CN) drop the Debug Mode / Relay Environment steps and `--preview`; `15-local-model.md`, `00-decisions.md`, root and Mobile `AGENTS.md` record the decision. CLI, Workers and OpenClaw / Hermes Preview isolation untouched.

Validation: `relay-environment.test` (+1: local-model origin accepted for every environment × Debug Mode combination, other Preview origins still gated), `backend-pairing-profile.test` (+2: Production code without Debug Mode reaches the local-model Registry with no `environment`; link accepted only from that Registry, OpenClaw Preview link rejected), `gateway-scan-flow.test` (Production / no Debug Mode local-model QR now accepted), `OnboardingScreen.test` + `model.test` (row visible by default in the new order, commands without `--preview`); 8 suites / 64 tests green, Mobile `tsc` clean. Not done: device acceptance of the row and a real code pairing from a Production-mode build (HT-LM-0919).


### 2026-09-19 — Native store redemption codes

Owner authorized end-to-end store-native gifting and explicitly approved Google Play promotion terms. Implemented Redeem code in the paywall legal footer (19 locales), native iOS sheet / Google Play redemption page, forced CustomerInfo reconciliation against a pre-presentation baseline, shared purchase/restore lock, cancellable wait, neutral timeout and stale-completion protection. Redemption continues gated features only after confirmed activation and retains lifetime/recurring renewal management feedback. No custom backend or hardware binding; catalog unchanged.

Console milestone: switched to the existing Google owner account and accepted the approved terms; created 20 lifetime gift codes (promotion 130831342), downloaded and privately copied outside Git. Apple monthly free/no-auto-renew offer 94f8b369-2e2f-443d-819b-104f734c579b created, with 500 production and 10 sandbox codes, both exports verified. RevenueCat restore policy read as Transfer to new App User ID, same behavior in sandbox. Apple lifetime free offer 985d3563-22dd-4776-90fc-f7df39800f28 completed with 500 production and 10 sandbox codes; all five CSV exports verified and saved with a Chinese distribution guide in the private Documents/Clawket-redemption-codes/2026-09 directory. All code batches expire Dec 18; Google starts Sep 19 12:00 GMT (console timezone verified). See apps/mobile/docs/pro-redemption.md for the audit.

Validation so far: Mobile typecheck, 301 suites / 3063 tests, design-system and docs checks pass. Repository check:required stops at existing agent-protocol mock.ts coverage (99.54% branch vs 100%, unrelated dirty work); no protocol files changed here. The independent i18n check finds missing=0 across 19 locales but exits for five unrelated unused Header action / Models keys. No actual store transaction or release submission performed.


### 2026-09-19 — Explicit connection-unavailable page

Owner request: use the supplied remote-computer offline screen as a reference to replace unclear retry/error presentation. Added shared `ConnectionUnavailable`: neutral laptop, scoped connection label, locally recorded successful connection timestamp (omitted if unknown), concise guidance, fresh-handshake Retry and the existing Connection route. Thread shows this after sustained failure, offers saved messages/cards, keeps the draft mounted and disables offline/error sends; readiness restores the timeline and resets dismissal for a future outage. Roster centers the state without rows or shows it above retained rows so other connections remain reachable. Recovery grace, transport retries, capability gates and pause semantics are unchanged. Pairing/sign-in actions now open the selected backend's Onboarding instead of merely probing again. Three new keys translated in all 19 locales.

Implementation deviation authorized by this request: sustained failure may own content space; transient recovery continues using the header pill. No Workers, protocol or external backend code changed. Validation: full Mobile Jest 301 suites / 3,080 tests green; final targeted Thread/Roster run 121 tests green (including OpenClaw/Hermes × light/dark, cache dismissal, recovery, known/unknown timestamps, fresh retry coalescing, pairing navigation and unrelated/scoped errors). Mobile typecheck, design-system and docs gates pass; v1 compatibility 5 files / 39 tests pass. `check:required` stops at the pre-existing agent-protocol mock coverage (99.54% branch against 100%; this task changes no protocol code). i18n reports missing=0 across 19 locales but fails for five pre-existing unused Header action / Models keys. `git diff --check` passes. Physical-device visual acceptance remains HT-OFFLINE-0919; no simulator/device or pairing credentials operated.

### 2026-09-20 — PR #36 CI follow-up

Close OpenClaw skill document read handles before atomic replacement on Windows, while retaining inode revalidation and guaranteed descriptor cleanup. Mobile RNTL async waits use a shared five-second ceiling for loaded CI runners. Ignore local Worker `.dev.vars` files. The stale `mock.ts.orig` backup remains local and is excluded from the PR. Validation is recorded in PR #36 before merge.
