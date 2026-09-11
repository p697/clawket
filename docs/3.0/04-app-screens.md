# 04 · App 页面规格

> 每页按同一模板写：职责 / 结构（自上而下）/ 每行内容与文案 / 五种状态 / 手势与动作 / 导航 / 门槛 / 埋点。文案给中文与英文 key（i18n key 用英文自然语句，其余 5 个语言同步翻译）。视觉值一律引用 `05-visual-system.md` 的 token，页面里不出现具体数字。

## 0. 全局规则

- 单根栈导航（`@react-navigation/native-stack`），没有底部 Tab。根路由：`Onboarding`、`Roster`、`Thread`、`AgentSettings`（及其子页）、`AccountSettings`（及其子页）、`Search`、`Paywall`（全屏模态）。会话面板是 `Thread` 内的底部弹层，不是路由。
- 每页的五种状态必须实现：加载（骨架屏，不用转圈）、空、错误（错误码文案 + 一个动作）、离线（顶部横幅 + 内容保留缓存）、无权限（Pro 锁行或付费墙）。
- 所有可点击行高度 ≥ `ControlSize.settingsRow`；按下反馈用底色，不用涟漪。
- **自绘导航**：所有页面头部由内容拥有，`headerShown: false`；返回、关闭、标题、Tab、弹层、确认框全部用 `05` §11 移植的组件，不用系统导航栏按钮、系统 segmented control 或系统 `Alert` 做确认（系统 `Alert` 只用于权限类系统提示）。
- **文案预算**（`05` §9）：每屏默认只有两档字；行与卡片没有描述性副标题；没有装饰性文字标签；尾值只放一个值。本章凡与该节冲突的描述，以 `05` §9 为准。
- 减动效开启时：全部位移动画改为淡入淡出。
- 错误文案表（适配器错误码 → 文案 → 动作）：

| 码 | 文案（zh / en key） | 动作 |
|---|---|---|
| `bridge_offline` | 电脑上的 Bridge 没有在运行 / `Bridge is not running on your computer` | 「查看怎么启动」→ 帮助页对应段落 |
| `gateway_offline` | OpenClaw 没有响应 / `OpenClaw is not responding`（Hermes：Hermes 没有响应） | 「重试」 |
| `pairing_expired` | 配对已失效，需要重新配对 / `Pairing expired, pair again` | 「重新配对」→ 首启引导的配对步骤 |
| `unauthorized` | 登录已过期 / `Sign-in expired` | 「重新登录」 |
| `network` | 网络不可用 / `No network` | 「重试」 |
| `timeout` | 连接超时 / `Connection timed out` | 「重试」 |
| `rate_limited` | 请求太频繁，稍后再试 / `Too many requests, try again later` | 无 |
| `frame_too_large` | 内容太大，无法发送 / `Message too large to send` | 无 |
| `unsupported` | 这个后端不支持该功能 / `Not supported by this backend` | 无 |
| `server` | 服务端出错 / `Server error` | 「重试」 |

## 1. 首启引导 `Onboarding`

**职责**：把「54% 装了没连上」变成连上。只在没有任何连接时作为根路由；添加连接时以模态复用。

**结构**（选择态只有标题一档，无灰字副标题；进入配对步骤后才出现一行灰字）：
1. 标题（display）：「把 Clawket 连到你的 Agent」/ `Connect Clawket to your agent`；下面一行灰字（secondary）：「需要一台运行 OpenClaw 或 Hermes 的电脑」/ `You need a computer running OpenClaw or Hermes`。没有别的解释。
2. 两个选择行：「OpenClaw」「Hermes」，只有名字与图标，无副标题。选中后进入配对步骤（标题「连接 OpenClaw / Hermes」，无灰字副标题）。步骤 01「拿到配对码」/ `Get a pairing code` 用一个 44 点 `SegmentedTabs` 二选一，默认选中「发给我的 Agent」/ `Send to my agent`（产品鼓励的路径）：
   - Agent 路径：一个 surface 文本块展示发给电脑上 Agent 的自然语言消息（说明这是开源 Clawket CLI、要运行的确切命令、并把打印出的 `Pairing code:` 那一行回给用户），下方一个 44 点 neutral 按钮「复制这段话」/ `Copy this message`（Copy 图标，带触感），复制后 1.5 秒内显示「已复制」+ 对勾再恢复；再下一行灰字提示粘贴给平时聊天的 Agent（如 Telegram 里的 OpenClaw / Hermes）即可收到配对码。
   - 「自己运行命令」/ `Run it myself`：一句「打开终端，运行下面的命令。」+ 等宽命令块 `npx @p697/clawket pair` 与复制键，复制键同样 1.5 秒对勾后恢复。
   旧的「在哪里运行？」文档链接已移除，`bridge_offline` 报错动作仍指向官方文档。
3. 六位码输入（自动分组 3+3，粘贴自动填充，剪贴板检测提示一句话）。键盘弹起时（iOS）页面用 keyboard-controller 的 padding `KeyboardAvoidingView` 收缩视口，并用 `useKeyboardRevealScroll` 把「配对码输入框 + 连接按钮」这一组刚好推到键盘上方 16 点：只滚实测的差额、按键盘真实高度进度插值，第三方键盘二次改高度时只补增量。Android 保持 adjustResize。不用 RN `automaticallyAdjustKeyboardInsets`（第三方键盘过渡帧会按整个键盘高度过滚），也不用库的 `KeyboardAwareScrollView`（它缓存的输入框位置在滚动后不刷新，键盘改高度时会二次叠加滚动并弹回）。数字键盘不再设 `returnKeyType`，避免 RN 自动附加的 Go 工具条再改一次键盘 frame。
4. 主按钮「连接」/ `Connect`；下方一个文字键「扫描二维码」/ `Scan QR code`（折叠的兼容路径）。
5. 第三个选择行：「YouMind 精灵」/ `YouMind Sprite`，无副标题 → 邮箱验证码页（邮箱 → 六位验证码 → 完成）。
6. 底部一个文字链接：「还没有 Agent？」/ `No agent yet?` → 展开 OpenClaw / Hermes / YouMind 三个文字键，各自直接打开官网首页（`openclaw.ai`、`hermes-agent.nousresearch.com`、`youmind.com`），不进安装/快速上手文档。埋点沿用 `onboarding_docs_opened{ backend }`。

**状态**：连接中（按钮 loading，副标题「正在通过 Relay 连接…」/ `Connecting through Relay…`，三段进度：已连上 Relay → 等待 Bridge → 就绪）；失败（错误码文案 + 动作）；Preview 环境提示（Debug 模式下显示黄色「Preview」标签，沿用现有环境校验）。

**成功**：保存连接 → 跳花名册 → 连接就绪 → 若应弹自动付费墙（`06` §3 状态机）则先弹，关闭后再自动打开 main 线程；不应弹则直接打开 main 线程。

**埋点**：`onboarding_viewed`、`pairing_code_submitted{ length_ok }`、`gateway_connect_saved`（现有）、`gateway_secure_pairing_finished`（现有）、`onboarding_docs_opened{ backend }`、`onboarding_agent_prompt_copied{ backend }`。

## 2. 花名册 `Roster`

**职责**：所有连接里所有 Agent 的目录；一步进线程。

**结构**：
1. 顶部（无导航栏，内容通顶）：左上 44 圆形账户头像按钮（Pro 徽标 / 需要注意徽标）；右上两颗圆形按钮：搜索、「+」。
2. 宽限期横幅（仅宽限期内显示，见 06）。
3. 离线横幅（活动连接离线时）：「离线 · 正在重连」/ `Offline · reconnecting`，右侧「重连」。
4. 列表：每个 Agent 一行；用户置顶的会话作为带 📌 的行紧跟其 Agent 之后。排序：需要你 > 有未读 > 最近活动时间；同一连接的 Agent 相邻。
5. 空态（有连接但无 Agent，理论上不会）：「这个连接上还没有 Agent」。

**Agent 行**：`AgentAvatar`（56，状态环）+ 名字（body 600）+ 预览（secondary，一行）+ 右侧：时间（caption）或未读数字或红点。就这三样，不显示连接名、后端名、传输方式。缓存态：头像无环，右侧时间位置写「2h 前」（灰）。锁定态（免费用户的非 main Agent）：头像去饱和，右侧锁图标。

**置顶会话行**：头像用该 Agent 头像叠加渠道图标，标题只写「#频道名」，不重复 Agent 名。

**手势**：点行 → 线程；长按 Agent 行 → 菜单：置顶 / 取消置顶（Agent 级）、静音、移除连接（仅当该连接只有这一个 Agent）；长按置顶会话行 → 取消置顶 / 重命名。下拉刷新 → 对活动连接 `listSessions` + `probe`。

**「+」菜单**（2026-09-11 修订）：底部弹层，用引导页同款 `ChoiceRow`（52 图标块 + 标题 body 600 + 一行 `secondary` 说明 + 右侧箭头 / Pro 锁），不再是设置行文本。两项：添加连接（`MonitorSmartphone`，说明「连接 OpenClaw、Hermes 或 YouMind 精灵」→ 引导模态；免费用户已有一个连接时行尾显示锁，点击 → 付费墙 `gatewayConnections`）、新建 Agent（`Bot`，说明「在 {活动连接名} 上再建一个智能体」，无名称时写「当前连接」；仅活动连接支持 `agentCreate` 时显示；免费用户行尾显示锁，点击 → 付费墙 `agents`）。只剩一项时「+」直接进引导模态，不弹层。

**状态**：首次加载骨架 6 行；无连接 → 不会到这里（根路由是引导）；活动连接错误 → 顶部横幅 + 行保留缓存。

**埋点**：`roster_viewed{ connection_count, agent_count, pinned_count }`、`roster_row_opened{ kind: agent|pinned_session, unread, attention, locked }`、`roster_pin_toggled`。

## 3. 线程 `Thread`

**职责**：与某个 Agent 的持续对话（main），或用户从面板打开的任一会话。

**头部**（浮动，不是导航栏）：
- 左：44 圆形返回按钮。
- 中：`HeaderPill`：头像 28 + 名字（Name）；副标题（Caption）默认「模型名 · 剩 54%」（上下文剩余 = 1 − contextUsed / contextWindow；没有数据时只显示模型；YouMind 不显示模型）；非 main 会话时名字后接「 · 会话标题」；运行中副标题替换为「正在用 exec…」/ `Using exec…` 或「思考中…」；离线时头像去饱和、副标题「离线 · 重连中」。点胶囊 → 会话面板。
- 右：44 圆形齿轮 → Agent 设置。
- 头部下方 24 的 canvas → 透明渐变遮罩，内容从下方滚过。

**时间线**（复用 `useChatController` 的运行时与 FlashList；渲染层换新）：
- 用户气泡、助手气泡、工具调用卡（可展开）、系统事件行（压缩、连接恢复、Hermes 斜杠命令回执、YouMind「正在使用工具」）、子 Agent 运行卡、Cron 运行结果卡、审批卡（exec / 插件 / 配对）、日期分隔。
- 运行卡：一行标题（任务或子 Agent 名）+ 一行灰字（状态词 · 时间）+ 箭头。没有描述。点 → 以线程形式打开该运行会话。
- Cron 结果卡：同运行卡；失败时状态词为红色「失败」，右侧动作「日志」（Pro 门槛 `logs`）。
- 审批卡：一行标题「允许运行 exec？」+ 一行等宽命令 + 两颗按钮「允许」「拒绝」；长按「允许」→ 「总是允许」；到期变灰。配对请求卡：设备名一行 + 两颗按钮。
- 流式输出：光标闪烁；不做逐字动画。
- 加载更早历史：顶部上拉。

**输入区**：左圆形「+」（2026-09-11 负责人定稿的 Add 弹层，见下方「Add 弹层」）；胶囊输入框，占位「向 {name} 提问」/ `Ask {name}`；框内右侧麦克风（语音输入沿用现有）；有文字时框外 accent 圆形发送键；运行中变 ink 圆形停止键（`cancel`）；运行中已有草稿时停止键退为次级圆形、右侧再出现发送键，点击把消息放入本机队列（气泡下方「排队中」说明，本轮回复结束、历史刷新完成后按序自动发出；停止 / 回复失败 / 发送失败后队列变为「已暂停」，点气泡可「立即发送 / 编辑 / 移除」；队列上限 10 条，三种后端共用同一套本机队列，不向后端发第二个并发 prompt）。思考等级 chip 位于输入框上方，仅在后端支持且用户开过时显示（沿用现有 ThinkingLevel 组件）。斜杠命令建议沿用现有 `SlashSuggestions`。

**Add 弹层**（2026-09-11 负责人定稿，参考 youmind-mobile `AddToChatSheet` 并要求超过它）：固定两档 detent（62% / 92%，上档只用于长列表滚动，不做上拉变网格——负责人 2026-09-12 决定与 youmind-mobile 保持一致），内容可滚，底部留白。第一段是媒体区：iOS 已授权相册时为横向「最近照片」条（第一格相机 tile，随后 12 张最近照片；照片可多选，右上角 accent 圆徽标显示选中序号，选满剩余附件槽位后其余变灰；选中后底部浮出 ink 主按钮「附加 N 张照片」，关闭动画完成后再以 JPEG 0.8 进入既有待发附件流；头部右侧「全部照片」quiet 圆钮进系统相册）；未授权（或 Android，因 Google Play 照片权限政策只走系统 Photo Picker）时为三格 tile「照片 / 相机 / 文件」，iOS 点「照片」原地申请权限，授权后不关弹层直接换成照片条，拒绝则退回系统选择器；打开后的前 320ms 与权限/加载未定时显示骨架 tile。内容左右边距 16，与头部关闭键对齐。第二段是细线分隔的两组能力显隐行（2026-09-12 负责人按 youmind-mobile 定稿并要求再松一点：48 高、无水平内边距、36 方框居中的 ink 图标、行尾 chevron）：「选择文件」（仅照片条模式且后端支持文件）、「技能」（`skills`，Puzzle 图标）、「命令」（`slashCommands`，仅 OpenClaw；Hermes Bridge 只解释 /model /think /reasoning /fast，其余会当普通消息发出，故不提供目录；打开 `CommandsSheet`：完整斜杠命令目录的标准弹层，说明为标题、`/命令` 为行尾值，选中后在弹层关闭完成后执行，`reset` / `restart` / `kill` 先经 ConfirmationModal 确认；输入框上方的「/」联想只在输入时出现、不再有强制展开态）；细线；「创建定时任务」（`cronCreate`，进 Cron 页并直接打开新建编辑器，提示词预填当前草稿）、「工具」（`tools`，进 Agent 设置 → Tools）。思考等级只留在输入框上方的 chip；「提示词」功能整体移除（2026-09-12 负责人决定，该功能从未埋点、无使用证据）。所有打开另一个模态或原生选择器的动作都在弹层关闭完成后执行。埋点 `chat_add_menu_opened` / `chat_add_menu_action`。

**状态**：历史加载骨架 3 条；空会话显示居中一句「和 {name} 开始对话」；错误横幅在时间线顶部；离线时输入框可编辑但发送键禁用并提示；无权限（锁定 Agent）→ 整页替换为付费墙（情境版 `agents`）。

**导航**：从花名册进入 push；从面板切换会话时不 push，线程内内容交叉淡入并更新头部；返回 → 花名册；`Thread` 记住最后打开的会话（每个连接）。

**埋点**：现有 `chat_send_tapped` 等保留；新增 `thread_opened{ kind, from: roster|panel|search|notification }`、`run_card_opened{ kind }`、`approval_resolved{ kind, decision }`（合并现有 `chat_exec_approval_resolved` 与 `pair_request_resolved`）。

## 4. 会话面板 `SessionPanel`（底部弹层）

**职责**：这台连接上的全部会话；切换与管理。一次只看一个 Agent。

**结构**（2026-09-11 产品负责人定稿，融合 3.0 花名册行与 2.0 侧边栏的 Agent 胶囊、渠道 chip）：把手；头部 = 关闭键 + 居中 **Agent 胶囊**（头像 28 + 名字 body 600 + 折叠箭头；连接只有一个 Agent 时无箭头、不可点）+ 搜索图标；点胶囊在面板内弹出 Agent 菜单（头像 32 + 名字 + 会话数，当前项打勾），选择后 chip 与列表切到该 Agent，不切换线程；每次打开面板回到当前线程的 Agent 与「全部」。下方一排横向 **渠道 chip**（全圆，36 高 + 4pt hitSlop）：「全部 n」+ 每个渠道一枚（按数量降序，带数量）+ 有内容时的「直聊与群 / 子 Agent / 定时」；只有主会话时不显示这一排。可选搜索框在 chip 下方。不再有「分组 / 列表」切换、Agent 分组标题行和渠道分节标题。

**行**（与花名册同一套语言）：40pt 圆形头像位（主会话 = Agent 头像；渠道 = `surface` 底 + 单色 Lucide 平台图标：Slack / Discord / Telegram / WhatsApp / 飞书，其余用渠道图标；子 Agent / 定时 / 直聊用类型图标；运行中在右下叠静态活动标）+ 标题（body 600，置顶行前置 16pt 图钉）+ 一行最后一条消息预览（secondary；未读时用 ink）+ 右侧时间（caption）与 12pt 圆点（需要你 = `bad`，未读 = `ink`；当前会话不显示未读）。排序：主会话永远第一，其后置顶，再按活跃度与时间。「全部」下已完成的子 Agent 折叠成一行「子 Agent · n ›」，点它等于选中「子 Agent」chip。

**动作**：点行 → 线程切换到该会话并收起面板；长按 → 置顶到花名册 / 取消置顶（按当前状态显示）/ 重命名 / 重置 / 删除（按能力显隐；删除与重置二次确认）。

**状态**：加载骨架；空（「还没有会话」）；错误行内横幅；Hermes 老 Bridge：只有 main 一行，底部一句「升级 bridge 到 3.0 解锁多会话」。

**埋点**：`session_panel_opened{ session_count }`、`session_panel_filter_changed{ filter }`、`session_panel_agent_switched{ session_count }`、`chat_session_selected`（现有，加 `from: panel`）、`session_action{ action }`。

## 5. Agent 设置 `AgentSettings`

**职责**：这个 Agent 的配置与它所在连接的管理。`canvasGrouped` 底 + 白色分组卡。2026-09-11 负责人按 2.0 控制台埋点（定时任务与费用是点击最狠的两张卡，模型 / 技能 / 记忆计数格次之）把页面改成「数字卡 + 行」的合稿，结构如下。

**头部**：左返回、中标题「Agent profile」、右 44pt 墨色圆形 `FloatingButton`（`MessageCircle`）= 继续聊天（回到该连接 + Agent 最近的会话）。页面内不再有主按钮胶囊。

**Hero（居中）**：56pt 圆形头像 + 名字（title 600）+ 一行灰字。灰字 = `后端 · Active {{age}}`（`heartbeat` 能力为 true 且 `cron.heartbeat.last()` 返回时间戳时，age 走 `formatConsoleHeartbeatAge`），否则退回 `连接名 · 后端`；YouMind 为邮箱。

**数字卡（`stats`，按能力显隐，整卡可点，无箭头）**：

| 卡 | 位置 | 大数 | 右侧小字（caption，只放一个数字） | 目标 | 能力 |
|---|---|---|---|---|---|
| Cron jobs | 第一排左 | 任务数 | 红色「{{count}} failed」（失败数 > 0 时） | 定时页 | `cron` |
| Cost today | 第一排右 | 今日费用 `$x.xx` | 灰色「{{value}} tokens」 | 用量页 | `usage` |
| Models | 第二排 | 模型数 | 无 | 模型页 | `models` |
| Skills | 第二排 | 已安装数 | 无 | 技能页 | `skills` |
| Files | 第二排 | 记忆文件数 | 无 | 文件页 | `files` |

费用卡退化：后端给不出可靠美元数（`costPresentation.mode === 'unknown'`）时大数换成今日 tokens、标题改「Tokens today」、无小字；两者都没有时显示「—」。数字缺失一律「—」，不隐藏卡。无权限（permission）状态下小字位置换成锁。卡是 `SettingsGroup` + `SettingsRow layout="column"`：白底、14pt 圆角、52pt 以上、按下态复用行的 `surface`。

**行**：身份行「Personality & memory」（`agentEdit || files`）→ 编辑页；连接组（分节标题 = 连接名）只在一级放「连接」一行（在线 / 离线，离线红点）；其余连接级行进「Advanced management」弹层：

| 行 | 尾值 | 目标 | 能力 / 门槛 |
|---|---|---|---|
| OpenClaw 管理 | 锁（非 Pro）/ 无 | 分段页：配置 / 权限 / 诊断 / 备份 | `configManage` · Pro |
| 工具 | 可用数 | 工具页 | `tools` |
| 渠道与设备 | 待处理数（红点）/ 无 | 分段页：渠道 / 设备 / 节点 | `channels`、`devices`、`nodes` |
| 日志 | 锁 / 无 | 日志页 | `logs` · Pro |

行的形状不变：左标题（body 400）+ 一个尾值（secondary 灰）+ 箭头，没有副标题。命名沿用 2.0：`Cron jobs`（定时任务）、`New cron job`；不再用「Scheduled tasks」。

**数据**：`load-summary.ts` 在 `ready` 时并行读 `models.list`、`skills.status`、`cron.list`（同时数失败）、`cron.heartbeat.last`、`agents.files.list`、`usage.cost(today)`（费用 + tokens）、`tools.catalog`、待处理配对；任一失败只缺对应数字。Hermes 无心跳、无工具 / 渠道 / 日志：灰字只写后端名，弹层里少三行，数字卡完全一样。

点锁即付费墙；点行本身进入页面后被拦也弹付费墙（沿用现有 `showPaywall`）。

**埋点**：`agent_settings_opened`、`settings_row_opened{ row, locked }`；现有 `models_save_tapped`、`agent_save_tapped`、`cron_save_succeeded`、`tools_save_tapped`、`heartbeat_save_tapped`、`gateway_config_*` 保留。

## 6. 账户设置 `AccountSettings`

分组：Pro（状态 / 横幅 / 恢复购买）；连接（列表：label、后端、传输、环境标签；「添加连接」→ 引导模态；免费第 2 个连接 → 付费墙 `gatewayConnections`）；外观（主题、强调色、聊天外观、App 图标 Pro）；语音（识别语言）；通知（回复通知开关：默认关，沿用本地通知实现并去掉总开关常量）；帮助（帮助中心、OpenClaw 文档、Hermes 文档、发布说明、OpenClaw Releases、反馈）；社区（分享、评分、Discord、WeCom）；关于（版本、开源仓库、隐私、条款）；开发者（Debug 模式、Preview 环境、设计系统、清缓存、重置设备）。

行的形状同 Agent 设置：标题 + 尾值 + 箭头，没有副标题。现有 `ConfigScreenLayout.tsx`（2,162 行）重写为按分组描述符渲染的一个文件（目标 ≤ 500 行）+ 子页。

## 7. 全局搜索 `Search`

输入框自动聚焦；结果分节：Agent、会话（跨连接，来自缓存与活动连接）、消息（本机 `chat-cache`，高亮命中）、收藏（chip 筛选）。点消息 → 消息详情（Pro `messageHistory`）→ 「在线程中查看」。空查询时显示最近搜索。

## 8. 付费墙 `Paywall`

见 `06-paywall-and-growth.md`。路由为全屏模态；自动弹出只在活动连接就绪后触发，因此 `Onboarding` 期间永远不会弹。

## 9. 宽限期横幅

花名册顶部一行：「多 Agent 还剩 {n} 天」/ `{n} days left for multiple agents`，右侧「了解 Pro」→ 付费墙（通用版）。

## 10. 通知与深链

- 本地回复通知沿用（前台在其他页或后台且 socket 存活时）；打开通知 → `Thread` 对应会话。
- 深链 `registry.clawket.ai/pair/...` 沿用现有解析进入引导模态。
