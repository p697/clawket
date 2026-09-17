# 04 · App 页面规格

> 每页按同一模板写：职责 / 结构（自上而下）/ 每行内容与文案 / 五种状态 / 手势与动作 / 导航 / 门槛 / 埋点。文案给中文与英文 key（i18n key 用英文自然语句，其余 18 个语言同步翻译，语言表见 `apps/mobile/docs/localization.md`）。视觉值一律引用 `05-visual-system.md` 的 token，页面里不出现具体数字。

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
2. 两个选择行：「OpenClaw」「Hermes」，只有名字与图标，无副标题。选中后进入配对步骤（标题「连接 OpenClaw / Hermes」，无灰字副标题）。步骤 01 只有一条主路径（2026-09-17 改版：原 `SegmentedTabs` 二选一让「自己运行命令」与主路径平级、四行 prompt 正文压过按钮，Lucy 反馈"字太多、重点不突出"）：
   - Agent 路径（默认）：步骤标题直接是动作「把这段话发给你的 Agent」/ `Send this message to your agent`；标题下一行灰字「粘贴给你平时聊天的 Agent（比如 Telegram 里的 OpenClaw / Hermes），它会回复配对码。」；再下方是 `MessagePreview`——发给 Agent 的自然语言消息（说明这是开源 Clawket CLI、要运行的确切命令、并把打印出的 `Pairing code:` 那一行回给用户）折叠成两行 secondary 灰字加尾部 chevron，点一下展开全文（展开后可选中），它是给 Agent 读的，不是给人读的；最后一个 44 点 neutral 按钮「复制这段话」/ `Copy this message`（Copy 图标，带触感）是步骤 01 唯一的深色元素，复制后 1.5 秒内显示「已复制」+ 对勾再恢复，并且步骤标题右侧保留一个对勾表示"已发出、等回复"。步骤 02 标题随之改为「输入它回复的配对码」/ `Enter the code it replies with`。
   - 「自己运行命令」/ `Run it myself` 是底部文字键（Terminal 图标，与「扫码连接」「从相册选择」并列）；切过去后步骤 01 变回「拿到配对码」/ `Get a pairing code`：一句「打开终端，运行下面的命令。」+ 等宽命令块 `npx @p697/clawket pair` 与复制键，复制键同样 1.5 秒对勾后恢复；底部文字键变为「发给我的 Agent」/ `Send to my agent` 可切回。
   旧的「在哪里运行？」文档链接已移除，`bridge_offline` 报错动作仍指向官方文档。
3. 六位码输入（自动分组 3+3，粘贴自动填充，剪贴板检测提示一句话）。键盘弹起时（iOS）页面用 keyboard-controller 的 padding `KeyboardAvoidingView` 收缩视口，并用 `useKeyboardRevealScroll` 把「配对码输入框 + 连接按钮」这一组刚好推到键盘上方 16 点：只滚实测的差额、按键盘真实高度进度插值，第三方键盘二次改高度时只补增量。Android 保持 adjustResize。不用 RN `automaticallyAdjustKeyboardInsets`（第三方键盘过渡帧会按整个键盘高度过滚），也不用库的 `KeyboardAwareScrollView`（它缓存的输入框位置在滚动后不刷新，键盘改高度时会二次叠加滚动并弹回）。数字键盘不再设 `returnKeyType`，避免 RN 自动附加的 Go 工具条再改一次键盘 frame。
4. 主按钮「连接」/ `Connect`；下方一行文字键：「自己运行命令」/「发给我的 Agent」（见 2）、「扫码连接」/ `Scan to connect`、「从相册选择」/ `Choose from photos`（折叠的兼容路径）。
5. 第三个选择行：「YouMind 精灵」/ `YouMind Sprite`，无副标题 → 邮箱验证码页（邮箱 → 六位验证码 → 完成）。
6. 底部一个文字链接：「还没有 Agent？」/ `No agent yet?` → 展开 OpenClaw / Hermes / YouMind 三个文字键，各自直接打开官网首页（`openclaw.ai`、`hermes-agent.nousresearch.com`、`youmind.com`），不进安装/快速上手文档。埋点沿用 `onboarding_docs_opened{ backend }`。
7. Preview 环境（Debug 模式）额外显示第三个选择行「Local model」（2026-09-11 授权的 `local-model` 后端，见 `15-local-model.md`）。其步骤 01 没有「发给我的 Agent」路径（底部也不出现切换键）：标题「拿到配对码」下用 `SegmentedTabs` 提供 llama.cpp / Ollama / Other（OpenAI 兼容）三选一，作为「支持哪些模型服务」的自解释列表；一行灰字说明该服务需先运行，命令块随选择带上 `--engine` / `--base-url`（Ollama 11434、其他 1234；llama.cpp 用 CLI 默认 8080）。「还没有 Agent？」不列出 Local model——它不是要安装的产品，而是用户已在运行的服务；`bridge_offline` 的文档动作指向 `15-local-model.md`。

**状态**：连接中（按钮 loading，副标题「正在通过 Relay 连接…」/ `Connecting through Relay…`，三段进度：已连上 Relay → 等待 Bridge → 就绪）；失败（错误码文案 + 动作）；Preview 环境提示（Debug 模式下显示黄色「Preview」标签，沿用现有环境校验）。

**成功**：保存连接 → 跳花名册 → 连接就绪 → 若应弹自动付费墙（`06` §3 状态机）则先弹，关闭后再自动打开 main 线程；不应弹则直接打开 main 线程。

**埋点**：`onboarding_viewed`、`pairing_code_submitted{ length_ok }`、`gateway_connect_saved`（现有）、`gateway_secure_pairing_finished`（现有）、`onboarding_docs_opened{ backend }`、`onboarding_agent_prompt_copied{ backend }`。

## 2. 花名册 `Roster`

**职责**：所有连接里所有 Agent 的目录；一步进线程。

**结构**：
1. 顶部（无导航栏，内容通顶）：左上 44 圆形账户头像按钮（Pro 徽标 / 需要注意徽标）；右上两颗圆形按钮：搜索、「+」。
2. 宽限期横幅（仅宽限期内显示，见 06）。
3. 离线横幅（活动连接离线时）：「离线 · 正在重连」/ `Offline · reconnecting`，右侧「重连」。
4. 列表：每个 Agent 一行；用户置顶的会话作为带 📌 的行紧跟其 Agent 之后。排序（2026-09-16 负责人决定，替代原「需要你 > 有未读 > 最近活动」）：Agent 级手动置顶 > 最近一次有人参与的活动时间降序；同一连接的 Agent 相邻，连接组之间也按最近活动排。「有人参与的活动」= 主会话 / 直聊 / 群 / 渠道会话（`HUMAN_SESSION_KINDS`）里最近的用户消息或面向用户的回复：OpenClaw 取 Gateway 的 `max(lastInteractionAt, lastActivityAt)`（心跳轮询与元数据 patch 不推高它，`updatedAt` 会），Hermes 取 `updated_ts`；子 Agent 与定时任务会话不计入。未读与「需要你」只做徽标，不参与排序——它们是瞬态，会让行在用户没动的情况下上下跳；1–4 行的列表里徽标一眼可见，置顶不省时间。行右侧时间与未读水位线用同一个活动时钟，缓存态与在线态顺序一致。
5. 空态（有连接但无 Agent，理论上不会）：「这个连接上还没有 Agent」。

**Agent 行**：`AgentAvatar`（56，状态环）+ 名字（body 600）+ 预览（secondary，一行）+ 右侧：时间（caption）或未读数字或红点。就这三样，不显示连接名、后端名、传输方式。缓存态：头像无环，右侧时间位置写「2h 前」（灰）。锁定态（免费用户的非 main Agent）：头像去饱和，右侧锁图标。

**置顶会话行**：头像用该 Agent 头像叠加渠道图标，标题只写「#频道名」，不重复 Agent 名。

**手势**（2026-09-17 负责人定稿）：点行 → 线程；**左滑 Agent 行**（RTL 下为右滑）→ 两枚图标加短标签的托盘：「置顶 / 取消置顶」「管理」（进该连接的连接页，`Connection` 路由）；左滑置顶会话行 → 「取消置顶」「重命名」。长按 Agent 行 → 同一套动作的完整菜单：置顶 / 取消置顶、管理连接、移除连接（仅当该连接只有这一个 Agent，二次确认）；长按置顶会话行 → 取消置顶 / 重命名。托盘与长按菜单共用一个动作装配器，托盘永远不放「移除」。原「静音」已删除：它只挡默认关闭的 iOS 回复通知，行上没有任何状态，负责人判定看不见效果。下拉刷新 → 对活动连接 `listSessions` + `probe`。

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
- 审批卡：一行标题「允许运行 exec？」+ 一行等宽命令 + 两颗按钮「允许」「拒绝」；长按「允许」→ 「总是允许」；到期变灰。配对请求卡：设备名 +「允许此设备连接到 OpenClaw 吗？」+ 两颗按钮；说明允许换行，避免截断。仅显示待处理请求，请求处理中禁用操作，失败保留重试；允许 / 拒绝成功或已过期后收起，去重墓碑仍保留，不自动授权。
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

**行**（与花名册同一套语言，但整体比花名册小一档：40pt 头像位定尺度）：40pt 圆形头像位（主会话 = Agent 头像；渠道 = `surface` 底 + 单色 Lucide 平台图标：Slack / Discord / Telegram / WhatsApp / 飞书，其余用渠道图标；子 Agent / 定时 / 直聊用类型图标；运行中在右下叠静态活动标）+ 两行文字：第一行标题（secondary 600，置顶行前置 16pt 图钉）与同行右侧时间（caption，`inkTertiary`）；第二行最后一条消息预览（caption，`inkSecondary`；未读时用 ink）与同行右侧 6pt 圆点（需要你 = `bad`，未读 = `ink`；当前会话不显示未读）。时间与圆点各自和所在行文字对齐，不再单独成一列；chip 与「子 Agent · n」的数量用 caption `inkTertiary`（2026-09-14 负责人反馈"字多、字大、黑点大"后收敛）。排序：主会话永远第一，其后置顶，再按活跃度与时间。「全部」下已完成的子 Agent 折叠成一行「子 Agent · n ›」，点它等于选中「子 Agent」chip。

**动作**：点行 → 线程切换到该会话并收起面板；长按 → 置顶到花名册 / 取消置顶（按当前状态显示）/ 重命名 / 重置 / 删除（按能力显隐；删除与重置二次确认）。

**状态**：加载骨架；空（「还没有会话」）；错误行内横幅；Hermes 老 Bridge：只有 main 一行，底部一句「升级 bridge 到 3.0 解锁多会话」。

**埋点**：`session_panel_opened{ session_count }`、`session_panel_filter_changed{ filter }`、`session_panel_agent_switched{ session_count }`、`chat_session_selected`（现有，加 `from: panel`）、`session_action{ action }`。

## 5. Agent 设置 `AgentSettings`

**职责**：这个 Agent 的配置与它所在连接的管理。`canvasGrouped` 底 + 白色分组卡。2026-09-11 负责人按 2.0 控制台埋点（定时任务与费用是点击最狠的两张卡，模型 / 技能 / 记忆计数格次之）把页面改成「数字卡 + 行」的合稿，结构如下。

**头部**：左返回、中标题「Agent profile」、右 44pt 墨色圆形 `FloatingButton`（`MessageCircle`）= 继续聊天（回到该连接 + Agent 最近的会话）。页面内不再有主按钮胶囊。

**Hero（居中）**：56pt 圆形头像 + 名字（title 600）。后端不占文字行：头像右下角叠一枚 24pt 圆角标（`surfaceFloating` 底、2pt `canvasGrouped` 描边把它从头像上抠出来，内放 `PlatformMark` 官方图标 20pt——OpenClaw 龙虾、Hermes 官方 App 图标、本地模型为 Lucide 显示器；无障碍名 = 后端名），Pro 锁定的 Agent 由锁角标占位、不叠两枚。名字下的灰字只在有动态或账号信息时渲染：`heartbeat` 能力为 true 且 `cron.heartbeat.last()` 返回时间戳时写 `Active {{age}}`（age 走 `formatConsoleHeartbeatAge`，不再带后端前缀）；YouMind 写邮箱；其余情况没有第二行，不留空高度（2026-09-16 负责人：连接名与 Agent 名重复、`连接名 · 后端` 专门起一行不值）。

**数字卡（`stats`，按能力显隐，整卡可点，无箭头）**：

| 卡 | 位置 | 大数 | 右侧小字（caption，只放一个数字） | 目标 | 能力 |
|---|---|---|---|---|---|
| Cron jobs | 第一排左 | 任务数 | 红色「{{count}} failed」（失败数 > 0 时） | 定时页 | `cron` |
| Cost today | 第一排右 | 今日费用 `$x.xx` | 无（2026-09-14 起去掉灰色 tokens 小字：与金额抢同一张卡的宽度，用量稍大两者都被省略） | 用量页 | `usage` |
| Models | 第二排 | 模型数 | 无 | 模型页 | `models` |
| Skills | 第二排 | 已安装数 | 无 | 技能页 | `skills` |
| Memory（记忆；2026-09-16 起由 Files 改名，路由 `files` 与埋点名不变） | 第二排 | 记忆文件数 | 无 | 文件页（页标题同为 Memory） | `files` |

费用卡退化：后端给不出可靠美元数（`costPresentation.mode === 'unknown'`）时大数换成今日 tokens、标题改「Tokens today」；两者都没有时显示「—」。tokens 只在这个退化态出现，有美元数时不再以小字并列。数字缺失一律「—」，不隐藏卡。无权限（permission）状态下小字位置换成锁。卡是 `SettingsGroup` + `SettingsRow layout="column"`：白底、14pt 圆角、52pt 以上、按下态复用行的 `surface`。

**行**：身份行「Identity」（`agentEdit || agentCreate`）→ 身份页；连接组（无分节标题——2026-09-16 负责人去掉了连接名小标题，连接组直接跟在身份卡后、沿用 24pt 页面间距）只在一级放「连接」一行（在线 / 离线，离线红点）；其余连接级行进「Advanced management」弹层：

**身份页**（2026-09-16 负责人决定：SOUL / MEMORY / USER 等文件只在文件页编辑，身份页只保留非文件的东西）：`ScreenHeader` 标题「Identity」，右侧 ghost「Save」（脏才可点，保存中转圈）；正文是 `KeyboardAwareScrollView` 内联表单——居中的头像预览（随 emoji 草稿实时变化）、Agent name / Emoji / Vibe 三个 `FormTextInput`（Vibe 为多行输入；name / emoji 走 `agents.update`——Gateway 以 `agents.list[].identity` 优先于 IDENTITY.md 并自行镜像回文件，vibe 没有记录字段，按行合并写入已有 IDENTITY.md，`fileEdit` 为 false 时 vibe 只读；头像只预览不编辑——它是桌面端的工作区路径或 URL，手机不改，2026-09-16 负责人决定）、下方「New Agent」（`agentCreate`，非 Pro 先付费墙）与「Delete Agent」（非 main 且 `agentEdit`，`ConfirmationModal` 确认）。脏草稿返回或路由移除时 `usePreventRemove` + `ConfirmationModal` 确认丢弃；花名册刷新重建描述符不重置草稿，只有 adapter / Agent 变化才重新加载。Hermes `agentEdit`、`agentCreate` 都为 false，Profile 页不渲染身份行。

**文件页**是 SOUL.md / MEMORY.md / USER.md / AGENTS.md（OpenClaw 完成 onboarding 前还有 BOOTSTRAP.md；Hermes 只有 MEMORY.md / USER.md）的唯一编辑处：列表由后端 `agents.files.list` 决定；`missing` 的文件在 `fileEdit` 可用时尾值为「Create」，点开直接进入空白编辑并以 `agents.files.set` 创建，不可编辑时尾值「Missing」且行禁用。编辑 / 保存 / 失败上报 `agent_file_activity{ action, backend, document }`，`document` 是有界枚举（agents / soul / identity / user / bootstrap / memory / other），永不带文件名或路径。

**模型页**（2026-09-16 负责人指出 3.0 只剩「点一下勾选」、2.0 的管理功能全部丢失，且「提供方」Tab 与「模型」Tab 渲染同一份列表、勾号读的是 Agent 默认模型写的却是主会话；按 2.x 埋点保留使用过的功能后重做）：`ModelsScreen` 是独立原生栈页（对齐身份页：`ScreenHeader` + ghost「Save」、`usePreventRemove` + `ConfirmationModal` 脏确认）。上段「Defaults」分组：「Default model」（尾值模型名，点开复用输入框的 `ModelPickerModal`）、「Fallback models」（尾值数量，弹层里按顺序列出、上移 / 移除 / 添加）、「Thinking level」（尾值等级，复用 `ThinkingLevelPickerModal`）；三者与目录开关共用一份草稿，Save 经「This will restart Gateway」确认后一次 `config.patch`（`agents.defaults.model.primary / fallbacks / thinkingDefault` + `agents.defaults.models` 白名单）。下段「Catalog」：搜索框 + 一句灰字说明开关含义 + 按 provider 分组；组头可点进 Provider 弹层（模型数、Base URL、API、「Keys and endpoints」跳 OpenClaw 配置编辑器、底部「Add model」表单只填 ID + 名称）；行标题模型名、副行「200K · Reasoning · Image」或模型 ID，行尾 `ThemedSwitch` = `agents.defaults.models` 白名单（Gateway 无白名单时全开，第一次关掉某个模型会把其余模型显式写成白名单，不让列表悄悄缩成一个）；点行进模型详情弹层（ID / provider / 上下文 / 能力 / 成本 + 「Set as default model」「Add to fallbacks」「Copy model reference」「Edit cost」「Delete model」；删除前用 `analyzeModelDeletion` 列出「Still used by …」并禁用；加模型 / 改成本 / 删除是带确认的即时写入，草稿未保存时这三个动作提示「Save changes first」）。Hermes 与 local-model（`modelManage` 为 false）：上段只有「Current model · Applies to all sessions」，目录行尾是勾号、无开关，详情弹层只剩「Set as current model」与复制，写入始终是全局 `setSelection`。成本编辑保留但降级到弹层（2.x 只有 16 人用过）；新增 / 编辑 provider 与 2.0 一样不做，指向配置编辑器。付费墙（2026-09-16 负责人决定，对应 `00` 「模型切换保持免费」只保留给聊天输入框的会话级切换）：本页所有写动作都是 Pro——开关、换默认模型 / 当前模型（选到不同的模型才拦，选回原值不拦）、备用增删排序、思考等级、加模型、改成本、删除；页面对免费用户完整显示真实数据、控件看起来可用，点到写的那一步才弹 `modelManage` 付费墙，购买 / 恢复后原地续做该动作，开关保持真实值不假动。Save 本身不再单独拦（能改脏草稿的已经是 Pro）。埋点沿用 `models_save_tapped`、`model_allowlist_toggled{source:'models_list'}`、`model_add_tapped{source:'provider_sheet'}`、`model_delete_tapped{source:'model_sheet'}`、`model_cost_save_tapped{source:'model_sheet'}`。

| 行 | 尾值 | 目标 | 能力 / 门槛 |
|---|---|---|---|
| OpenClaw 管理 | 无 | 功能菜单（2026-09-16 负责人：四个入口只有名字，用户不知道是干嘛的、没有点进去的欲望）：一张 comfortable 卡四行，每行 = 图标 + 标题 + 一行 caption 说明 + 箭头——「OpenClaw 配置 / 查看和修改 OpenClaw 的全部设置」「权限 / 看 Agent 能不能上网、执行命令，一键修好」「状态诊断 / 给 OpenClaw 做个体检，有问题自动修」「备份 OpenClaw 配置 / 存一份在手机上，改坏了能还原」（说明按负责人要求写给初中生看：一句、不带术语）；行尾只放菜单本来就免费拿到的数字：权限行 = 本次连接收到的待处理执行审批数（红点），备份行 = 最新还原点距今（本地读取，不请求 Gateway）。点行进分段页：配置 / 权限 / 状态诊断 / 备份 OpenClaw 配置（页内有一段说明 + 创建备份）；分段加载中 Companion 居中 | `configManage` · Pro（页内最后一步拦截） |
| 工具 | 可用数 | 工具页 | `tools` |
| 渠道与设备 | 待处理数（红点）/ 无 | 分段页：渠道 / 设备 / 节点 | `channels`、`devices`、`nodes` |
| OpenClaw 运行日志 | 无 | 日志页：免费看最新 3 条，其余遮罩 + 解锁 | `logs` · Pro（页内最后一步拦截） |

行的形状不变：左标题（body 400）+ 一个尾值（secondary 灰）+ 箭头，没有副标题。命名沿用 2.0：`Cron jobs`（定时任务）、`New cron job`；不再用「Scheduled tasks」。

**数据**：`load-summary.ts` 在 `ready` 时并行读 `models.list`、`skills.status`、`cron.list`（同时数失败）、`cron.heartbeat.last`、`agents.files.list`、`usage.cost(today)`（费用 + tokens）、`tools.catalog`、待处理配对；任一失败只缺对应数字。Hermes 无心跳、无工具 / 渠道 / 日志：头像角标换 Hermes 图标、名字下没有灰字，弹层里少三行，数字卡完全一样。

点锁即付费墙；点行本身进入页面后被拦也弹付费墙（沿用现有 `showPaywall`）。2026-09-16 负责人决定：OpenClaw 管理四个分段与运行日志不在行上锁，免费用户进入后看到真实数据，只在交付 Pro 价值的最后一步拦截（配置展开 / 编辑、权限详情 / 规则 / 修复、诊断第 3 项起 / 详情 / 修复、备份创建 / 恢复确认、日志第 4 条起），遮罩用 `ProGate`（真实内容 + 渐隐遮罩 + 一句话 + 解锁按钮），见 `06` §3。

**埋点**：`agent_settings_opened`、`settings_row_opened{ row, locked }`；现有 `models_save_tapped`、`agent_save_tapped`、`cron_save_succeeded`、`tools_save_tapped`、`heartbeat_save_tapped`、`gateway_config_*` 保留。

### 技能管理（2026-09-13 负责人确认）

移除 Installed / Discover 顶部分段，已安装页用白底、安静搜索框、总数/开启数和无卡片列表。每行最小 88pt：名称、一行用途、独立中性开关；点名称进详情。开启状态与可用性分开，缺配置/依赖/系统要求或允许列表限制显示具体原因，Always on 不显示可操作开关。开关保存与回读不卸载列表、不按状态重排；失败保持旧值，回读失败保留已确认的新值；断网保留已加载内容并禁用修改。

右上角 Compass 按钮按发现能力及操作显隐，压栈打开发现页，返回保留原列表搜索和滚动位置。ClawHub / skills.sh 与聊天安装保留；安装请求成功、详情弹层关闭后进入对应 Agent 主会话。详情为可滚动标准 Sheet，含完整说明、启用/可用状态、来源和所有缺失项；卸载按能力与 deletable 元数据显隐，在详情关闭后经 ConfirmationModal 确认。此页面允许列表用途说明，覆盖普通设置行无副标题限制；完整配方见 Mobile design-system。

### 定时任务（2026-09-14 负责人确认）

列表使用白底无卡片行：任务名称、人类可读的时间规则、服务端下次执行时间、独立开关；失败与启用状态分别展示。保留任务/运行记录切换，心跳放在次级入口。右上角加号压栈进入新建页，点击任务直接进入完整编辑页，返回安静刷新并保留列表顺序。

新建保留两步：「选择模板或自定义」→「设置内容和时间」。恢复八个模板，默认显示四个；每天、每周多选及工作日/周末快捷选择、间隔和单次采用可视化控件及原生日期/时间选择器，预览接下来三次预计执行。Cron 表达式收进高级设置。Thread 草稿直接进入配置阶段，只预填本次新建。编辑复用同一套时间控件，明确保存，离开未保存内容需确认；保留运行记录、立即运行、删除和现有高级配置。

时间规则用结构化数据，无修改时不回写 schedule，保留时区、间隔锚点、stagger 和自定义规则。按 `cronTimeZone` / `cronAdvanced` 精确显隐：OpenClaw 可指定单任务时区及高级执行配置；Hermes 使用 Agent 所在时区、整分钟间隔且新建时启用，不提供不生效的选项。未知远程时区不猜测绝对运行时间，实际执行以服务端为准。运行完成与通知送达分别显示；列表与编辑按连接、Agent、adapter 隔离缓存和异步回调。详细配方见 Mobile design-system。

### 用量页（2026-09-16 负责人确认）

`UsageSection` 是 Agent 主页「Cost today」卡的落地页：`canvasGrouped` 底 + 白色分组卡，两个后端共用同一份 `management.usage.sessions / cost` 契约，费用相关内容按 `cost` 能力显隐。顶部 `SegmentedTabs` 三档（今天 / 7D / 30D），2.0 的昨天 / 3D / 14D 不恢复。主度量由 `resolveUsageMeasure` 决定：`cost` 能力为真、`costPresentation.mode` 不是 `unknown` / `included` 且范围费用大于 0 时以费用领头，否则以 Token 领头；页面永不以 `$0.00` 领头。

结构自上而下：英雄卡（左主数字、右次数字，title 600 表格数字 + secondary 标签；次标签在 `estimated` / `mixed` 时写「Estimated」/「Partial」，`included` 时次数字写「Included」，`unknown` 时写「—」；下方 `SegmentBar` 四段，费用模式按单价从深到浅排 输出 / 输入 / 缓存写入 / 缓存读取，Token 模式排 输入 / 输出 / 缓存读取 / 缓存写入，颜色用 `ink → inkSecondary → inkTertiary → line` 一条墨色序列，图例逐项写值、不靠颜色辨识）→ 2×2 指标卡（消息 / 工具调用 / 会话 / 缓存命中 = cacheRead ÷ (input + cacheRead)，没有提示 token 时「—」；复用 Agent 主页数字卡配方）→ 趋势卡（今天档显示「近 7 天」并默认选中今天，7D / 30D 显示对应天数，缺日补零；`UsageBarChart` 选中柱 `ink`、其余 `inkTertiary`、网格 `line`，只标选中值，30 天时 x 轴每 7 天一标加今天，点柱子切换选中）→ 模型卡（`ShareRow` 前 5，按主度量排序与显示，行下 4pt 占比条）→ 工具卡（前 5 与调用次数；`totalCalls` 为 0 时整卡不渲染）。删除了每日日期列表、零值时的费用明细四行与页尾按钮；统计海报改从页头右侧 `Share` 44pt `FloatingButton` 打开，内容不变。图表全部单色：界面主题里 `accent` 已被 `buildInterfaceTheme` 映射为墨色，不新增颜色 token。

加载与切换：`useUsageDashboard` 以 adapter + Agent + 范围 + 起止日期为键做内存缓存（60 秒内不重复请求，更久则静默刷新）；屏幕只显示当前键的数据，另一范围的迟到响应只进缓存、不改屏幕，快速连点后停在哪档就显示哪档的数字；未缓存的范围立即显示同形骨架（英雄卡 / 四卡 / 柱数按范围 / 两行列表），有缓存的范围零等待切换。今天档落地后顺带取 7D 作为趋势上下文，再按 7D → 30D 预取一次（每个 adapter / Agent 作用域一次，离线不请求）。失败保留已加载数据并在顶部给一条 `Banner` + Retry，无旧数据时才显示错误横幅。数据变更整块交叉淡入 200 ms，柱子从基线长起 320 ms，减弱动效下静止。

**付费（2026-09-16 负责人决定）**：今天档完整免费；7D / 30D 是 Pro。免费用户可以切到 7D / 30D，数据照常加载，整块内容渲染在 `ProGate` 之下（蒙层高六行 `ControlSize.settingsRow`，英雄卡与指标卡的数字若隐若现、不可点、对无障碍隐藏），蒙层里是锁 + 「看整周、整月的用量」+「7 天与 30 天的用量、费用与趋势。」+ 全宽墨色「解锁用量趋势」按钮，点击以 `usage` 原因弹付费墙（英雄 `generic`，标题「看清每一个 token 花在哪」）。今天档趋势图里过去几天的柱子对免费用户也是钩子：点了直接弹墙。购买或恢复后蒙层随 `isPro` 消失。不在分段控件上加锁标或禁用档位。

**埋点**：`usage_range_changed{ range, cached, locked }`。

## 6. 账户设置 `AccountSettings`

分组：Pro（状态 / 横幅 / 恢复购买）；连接（「我的连接」列表：label、Agent 名、在线 / 离线 / 已暂停；行左滑 → 「暂停 / 恢复」「移除」，与连接页同样二次确认；点行 → 连接页；「添加连接」→ 引导模态；免费第 2 个连接 → 付费墙 `gatewayConnections`）；外观（主题、强调色、聊天外观、App 图标 Pro）；语音（识别语言）；通知（回复通知开关：默认关，沿用本地通知实现并去掉总开关常量）；帮助（帮助中心、OpenClaw 文档、Hermes 文档、发布说明、OpenClaw Releases、反馈）；社区（分享、评分、Discord）；关于（版本、开源仓库、隐私、条款）；开发者（Debug 模式、Preview 环境、设计系统、清缓存、重置设备）。

**连接页 `Connection`**（2026-09-17 负责人定稿，唯一的连接级页面；花名册「管理」、我的连接列表、Agent 资料页「连接」行都指向这里）：头部 = 官方图标 + 连接名 + 状态 + Agent 名；主操作「重新连接 / 恢复连接」+「暂停此连接」（确认）；「名称」行 → 改名弹层（`RenameSheet`，只改本机 label，不动凭据、不断 OpenClaw 连接；Hermes 无 Bridge 名与本地模型的 Agent 名来自连接名，改名立即镜像到花名册与缓存，活动连接重新握手一次）；「详情」分组只读：后端、传输、环境、服务器地址、Bridge 版本、Bridge 能力、最近就绪；免费用户多一组「免费连接 · 当前」或「设为免费连接」（24 小时冷却尾值）；底部「移除连接」（确认）。原「高级设置」子页、账户设置的连接分段和 Agent 设置的连接分段一并删除，不再有第二处连接详情或生命周期入口。

2026-09-16 帮助中心发布核查：配对说明覆盖 OpenClaw / Hermes、主机执行前提及配对码 / QR 操作；排障先提供 Clawket status / doctor / logs --follow / start，再提供 OpenClaw 专属检查。区分 Relay 出站联网与直连端口，凭据变更指向重新配对，断线指向连接页重连 / 恢复与主机 Bridge 重启。LAN / Tailnet 配置片段保留旧版 Gateway 启动需要的 allowedOrigins；说明合并配置、替换地址和强令牌、重启后用带 URL 的本地配对命令生成 QR。更新采用 openclaw update。所有帮助文案同步 19 语言；npm 发布由负责人另行把控。

2026-09-13 用户授权品质升级：主页为 Companion 猫头 Pro 品牌卡、常用组（连接 / 外观 / 聊天与通知 / 语言）、支持组（帮助 / 关于）。账户设置及连接、外观、帮助子页和选择弹层使用 comfortable 设置组件：64pt 最小行高、22pt 圆角、统一中性图标和留白，长文案自动增高；选择项提供底色、勾选与读屏选中状态，保存期间防重复操作。Pro 卡为品牌身份例外，可显示标题与会员状态两行。Agent 设置保留原密度。完整实现配方见 Mobile `docs/design-system.md` 的 Settings refinement；所有原有动作和权限判断保持。

## 7. 全局搜索 `Search`

输入框自动聚焦；结果分节：Agent、会话（跨连接，来自缓存与活动连接）、消息（本机 `chat-cache`，高亮命中）、收藏（chip 筛选）。点消息 → 消息详情（Pro `messageHistory`）→ 「在线程中查看」。空查询时显示最近搜索。

## 8. 付费墙 `Paywall`

见 `06-paywall-and-growth.md`。路由为全屏模态；自动弹出只在活动连接就绪后触发，因此 `Onboarding` 期间永远不会弹。

## 9. 宽限期横幅

花名册顶部一行：「多 Agent 还剩 {n} 天」/ `{n} days left for multiple agents`，右侧「了解 Pro」→ 付费墙（通用版）。

## 10. 通知与深链

- 本地回复通知沿用（前台在其他页或后台且 socket 存活时）；打开通知 → `Thread` 对应会话。
- 深链 `registry.clawket.ai/pair/...` 沿用现有解析进入引导模态。
