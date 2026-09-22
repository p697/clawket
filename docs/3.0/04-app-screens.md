# 04 · App 页面规格

> 每页按同一模板写：职责 / 结构（自上而下）/ 每行内容与文案 / 五种状态 / 手势与动作 / 导航 / 门槛 / 埋点。文案给中文与英文 key（i18n key 用英文自然语句，其余 18 个语言同步翻译，语言表见 `apps/mobile/docs/localization.md`）。视觉值一律引用 `05-visual-system.md` 的 token，页面里不出现具体数字。

## 0. 全局规则

- 单根栈导航（`@react-navigation/native-stack`），没有底部 Tab。根路由：`Onboarding`、`Roster`、`Thread`、`AgentSettings`（及其子页）、`AccountSettings`（及其子页）、`Search`、`Paywall`（全屏模态）。会话面板是 `Thread` 内的底部弹层，不是路由。
- 每页的五种状态必须实现：加载（骨架屏，不用转圈）、空、错误（错误码文案 + 一个动作）、离线（顶部横幅 + 内容保留缓存）、无权限（Pro 锁行或付费墙）。
- 所有可点击行高度 ≥ `ControlSize.settingsRow`；按下反馈用底色，不用涟漪。
- **自绘导航**：所有页面头部由内容拥有，`headerShown: false`；返回、关闭、标题、Tab、弹层、确认框全部用 `05` §11 移植的组件，不用系统导航栏按钮、系统 segmented control 或系统 `Alert` 做确认（系统 `Alert` 只用于权限类系统提示）。页面头部统一为 `ScreenHeader`（2026-09-19 负责人定稿）：距屏幕左右边 16、上方安全区 + 8、44 高、下方 8，内容再空 16；返回 / 关闭是 44 圆形 `surface` 按钮（亮色纯白 + 浮起阴影，暗色浮起面 + 细线），各页顶部按钮的边距与大小一致。
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

2026-09-19 连接选择页补充：四个连接选项与「还没有 Agent？」下方的留白放置居中、无卡片的开源说明：「本项目开源」「Clawket 不会在服务器保存你的数据」以及可点击的 `github.com/p697/clawket`。仅选择态显示，小屏随内容滚动，使用现有 secondary 字号和主题颜色；不作第三方服务或本机零存储承诺。

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

**头部**（浮动，不是导航栏；边距与其它页面的 `ScreenHeader` 一致：距边 16、安全区 + 8 / 44 / 8）：
- 左：44 圆形纯白返回按钮（壁纸上为玻璃材质）。
- 中：`HeaderPill`：头像 28 + 名字（Name）；副标题（Caption）默认「模型名 · 剩 54%」（上下文剩余 = 1 − contextUsed / contextWindow；没有数据时只显示模型；YouMind 不显示模型）；非 main 会话时名字后接「 · 会话标题」；运行中副标题替换为「正在用 exec…」/ `Using exec…` 或「思考中…」；离线时头像去饱和、副标题「离线 · 重连中」。点胶囊 → 会话面板。
- 右：44 圆形纯白会话按钮 → 会话面板（壁纸上为玻璃材质）。
- 头部下方 24 的 canvas → 透明渐变遮罩，内容从下方滚过（头部是绝对定位的浮层，列表内容从头部高度 + 16 开始）。
- **自定义壁纸 = 沉浸式**（2026-09-19 负责人要求）：壁纸铺满整屏（含状态栏与输入区之下），头部与输入区不再铺 canvas，改为柔和的 canvas 渐变遮罩；返回 / 会话按钮、`HeaderPill`、紧凑输入卡与时间标签统一换成半透明玻璃材质（`surfaceFloating` 0.8 / 0.74 + 细线）；「压暗」在壁纸上叠一层 canvas（0–60%）。全屏编辑草稿时输入区回到不透明 canvas。

**时间线**（复用 `useChatController` 的运行时与 FlashList；渲染层换新）：
- 用户气泡、助手气泡、工具调用卡（可展开）、系统事件行（压缩、连接恢复、Hermes 斜杠命令回执、YouMind「正在使用工具」）、子 Agent 运行卡、Cron 运行结果卡、审批卡（exec / 插件 / 配对）、日期分隔。
- 运行卡：一行标题（任务或子 Agent 名）+ 一行灰字（状态词 · 时间）+ 箭头。没有描述。子 Agent 卡点 → 以线程形式打开该运行会话（没有子会话时打开记录的执行结果）。
- Cron 结果卡：同运行卡；失败时状态词为红色「失败」，右侧动作「日志」（Pro 门槛 `logs`）。点 → 打开与定时任务页同一个「执行记录」弹层（2026-09-19 负责人决定，两处入口只有这一个实现；见 §5 定时任务），不再推一层只读线程：OpenClaw 的 `cron.runs` 给的是隐藏的 `:run:<sessionId>` 会话键，`chat.history` 查不到，转写实际挂在稳定键 `agent:<id>:cron:<jobId>` 上。
- 审批卡：一行标题「允许运行 exec？」+ 一行等宽命令 + 两颗按钮「允许」「拒绝」；长按「允许」→ 「总是允许」；到期变灰。配对请求卡：设备名 +「允许此设备连接到 OpenClaw 吗？」+ 两颗按钮；说明允许换行，避免截断。仅显示待处理请求，请求处理中禁用操作，失败保留重试；允许 / 拒绝成功或已过期后收起，去重墓碑仍保留，不自动授权。
- 流式输出：光标闪烁；不做逐字动画。
- 加载更早历史：顶部上拉。
- 发送后的用户气泡在历史回显更换服务器 ID 时保留本地渲染标识、发送身份与显示时间；后到的旧历史不能删除当前轮用户消息并把流式回复归到上一轮。重复短消息的匹配同时排除已知旧消息的显示 ID 与原始历史 ID；OpenClaw、Hermes 共用此规则。

**输入区**（有壁纸时整块为玻璃材质浮卡，底部渐变遮罩）：左圆形「+」（2026-09-11 负责人定稿的 Add 弹层，见下方「Add 弹层」）；胶囊输入框，占位「向 {name} 提问」/ `Ask {name}`；框内右侧麦克风（Expo Audio + 阿里云流式转录；点击持续听写、按住松手发送、上滑取消，底部模型选择器保留，见 `22-voice-input.md`）；有文字时框外 accent 圆形发送键；运行中变 ink 圆形停止键（`cancel`）；运行中已有草稿时停止键退为次级圆形、右侧再出现发送键，点击把消息放入本机队列（气泡下方「排队中」说明，本轮回复结束、历史刷新完成后按序自动发出；停止 / 回复失败 / 发送失败后队列变为「已暂停」，点气泡可「立即发送 / 编辑 / 移除」；队列上限 10 条，三种后端共用同一套本机队列，不向后端发第二个并发 prompt）。思考等级 chip 位于输入框上方，仅在后端支持且用户开过时显示（沿用现有 ThinkingLevel 组件）。斜杠命令建议沿用现有 `SlashSuggestions`。

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

**Hero（居中，= 身份入口）**：56pt 圆形头像 + 名字（title 600）。2026-09-19 负责人决定：页面里不再有单独的「Identity」行，整块 Hero（头像 + 名字 + 灰字）是一个按钮（`agent-settings-identity`，按下态 `Motion.pressedOpacity`），点了进身份页；名字右侧挂一枚 16pt `PenLine`（`inkSecondary`）表示可编辑，图标绝对定位在名字右缘外、不把名字挤离头像中线。Pro 锁定的 Agent 图标换成 `Lock`、点击先走 `identity` 付费墙再续跳；`agentEdit`、`agentCreate` 都为 false（Hermes、YouMind）时无图标、不可点。后端不占文字行：头像右下角叠一枚 24pt 圆角标（`surfaceFloating` 底、2pt `canvasGrouped` 描边把它从头像上抠出来，内放 `PlatformMark` 官方图标 20pt——OpenClaw 龙虾、Hermes 官方 App 图标、本地模型为 Lucide 显示器；无障碍名 = 后端名），Pro 锁定的 Agent 由锁角标占位、不叠两枚。名字下的灰字只在有动态或账号信息时渲染：`heartbeat` 能力为 true 且 `cron.heartbeat.last()` 返回时间戳时写 `Active {{age}}`（age 走 `formatConsoleHeartbeatAge`，不再带后端前缀）；YouMind 写邮箱；其余情况没有第二行，不留空高度（2026-09-16 负责人：连接名与 Agent 名重复、`连接名 · 后端` 专门起一行不值）。

**数字卡（`stats`，按能力显隐，整卡可点，无箭头）**：

| 卡 | 位置 | 大数 | 右侧小字（caption，只放一个数字） | 目标 | 能力 |
|---|---|---|---|---|---|
| Cron jobs | 第一排左 | 任务数 | 红色「{{count}} failed」（**未看过的**失败数 > 0 时；见下「失败红字」） | 定时页（默认落「运行记录」tab，见 §5；红字在那里被记为已看） | `cron` |
| Cost today | 第一排右 | 今日费用 `$x.xx` | 无（2026-09-14 起去掉灰色 tokens 小字：与金额抢同一张卡的宽度，用量稍大两者都被省略） | 用量页 | `usage` |
| Models | 第二排 | 模型数 | 无 | 模型页 | `models` |
| Skills | 第二排 | 已安装数 | 无 | 技能页 | `skills` |
| Memory（记忆；2026-09-16 起由 Files 改名，路由 `files` 与埋点名不变） | 第二排 | 记忆文件数 | 无 | 文件页（页标题同为 Memory） | `files` |

费用卡退化：后端给不出可靠美元数（`costPresentation.mode === 'unknown'`）时大数换成今日 tokens、标题改「Tokens today」；两者都没有时显示「—」。tokens 只在这个退化态出现，有美元数时不再以小字并列。数字缺失一律「—」，不隐藏卡。无权限（permission）状态下小字位置换成锁。卡是 `SettingsGroup` + `SettingsRow layout="column"`：白底、14pt 圆角、52pt 以上、按下态复用行的 `surface`。

**行**：连接组（无分节标题——2026-09-16 负责人去掉了连接名小标题，连接组直接跟在数字卡后、沿用 24pt 页面间距；身份入口已并入 Hero）是一张 comfortable 卡，按能力过滤后依次为下表四行，最后一行是「连接」（在线 / 离线，离线红点；2026-09-19 负责人决定放到列表最底部，它指向连接页而不是 Agent 的管理功能）；原「Advanced management」弹层已不存在：

**身份页**（2026-09-16 负责人决定：SOUL / MEMORY / USER 等文件只在文件页编辑，身份页只保留非文件的东西）：`ScreenHeader` 标题「Identity」，右侧 ghost「Save」（脏才可点，保存中转圈）；正文是 `KeyboardAwareScrollView` 内联表单——居中的头像预览（随 emoji 草稿实时变化）、Agent name / Emoji / Vibe 三个 `FormTextInput`（Vibe 为多行输入；name / emoji 走 `agents.update`——Gateway 以 `agents.list[].identity` 优先于 IDENTITY.md 并自行镜像回文件，vibe 没有记录字段，按行合并写入已有 IDENTITY.md，`fileEdit` 为 false 时 vibe 只读；头像只预览不编辑——它是桌面端的工作区路径或 URL，手机不改，2026-09-16 负责人决定）、下方只有「Delete Agent」（非 main 且 `agentEdit`，`ConfirmationModal` 确认）。页内不再有「New Agent」按钮（2026-09-19 负责人决定）：新建 Agent 的唯一入口是花名册右下角 `+` 弹层里的「New Agent」行（2.x 90 天里只有 37 / 2541 个用户点过新建，属低频动作，不值得两个入口），它带 `action: 'create-agent'` 跳到本页并直接弹出创建弹层（`openCreateOnMount`，非 Pro 先付费墙），弹层本身保留。脏草稿返回或路由移除时 `usePreventRemove` + `ConfirmationModal` 确认丢弃；花名册刷新重建描述符不重置草稿，只有 adapter / Agent 变化才重新加载。Hermes `agentEdit`、`agentCreate` 都为 false，Profile 页的 Hero 不带编辑图标也不可点。

**文件页**是 SOUL.md / MEMORY.md / USER.md / AGENTS.md（OpenClaw 完成 onboarding 前还有 BOOTSTRAP.md；Hermes 只有 MEMORY.md / USER.md）的唯一编辑处：列表由后端 `agents.files.list` 决定；`missing` 的文件在 `fileEdit` 可用时尾值为「Create」，不可编辑时尾值「Missing」且行禁用。点一行 push 文档页，返回时列表安静刷新（不出骨架，离线保留已加载的行）。编辑 / 保存 / 失败上报 `agent_file_activity{ action, backend, document }`，`document` 是有界枚举（agents / soul / identity / user / bootstrap / memory / other），永不带文件名或路径。

**文档页**（2026-09-19 负责人决定：长文档不用弹窗，做完整二级页；20 KB 的 MEMORY.md 在 7 行预览 + 内嵌滚动里没法读，弹窗里编辑键盘之上只剩两行）：`DocumentScreen` 一个页面同时承载工作区文件与技能的 SKILL.md（`document-model.ts` 的 `agentFileDocument` / `skillSourceDocument` 只负责后端读写与埋点）。路由 `AgentSettingsSection { section: 'files', action: 'open-file', fileName }` 与 `{ section: 'skills', action: 'skill-source', skillKey, skillName }`（技能详情弹层先关闭，再从关闭回调 push）。阅读态：`ScreenHeader` 标题 = 文件名（SKILL.md 以技能名为副标题），标题槽显示连接状态胶囊，右侧 ghost「Edit」；正文整页滚动、渲染 Markdown（body 字号、可选中、链接可点），末尾一行 caption 灰字「大小 · 修改时间」（后端给出时才显示）。编辑态按 iOS 编辑模式惯例：头部变成 ghost「Cancel」/「Save」（脏才可存，保存中转圈），正文是一个 `flex: 1` 原生滚动的 `CompositionSafeTextInput`（关闭自动纠错与首字母大写）放在 `KeyboardAvoidingView` 里——键盘弹出时输入框缩短、光标始终可见，没有嵌套滚动、没有随键盘的底部按钮；已有文档不自动聚焦（用户点到哪里改哪里），缺失文件直接以空白编辑态打开并聚焦，其 Cancel 离开页面。脏草稿点 Cancel 经 `ConfirmationModal` 确认后回到阅读态；脏草稿手势返回 / 硬件返回经 `usePreventRemove` 同样确认后才离开。错误是内容上方固定的 `Banner`，保存失败草稿留在编辑器里；加载是七行文本骨架；只读 / 二进制 / 后端不支持时无 Edit。Pro 只拦保存不拦阅读：付费墙续做只在页面仍在、草稿未变、在线时写入，同一时刻只有一次写。

**模型页**（2026-09-16 负责人指出 3.0 只剩「点一下勾选」、2.0 的管理功能全部丢失，且「提供方」Tab 与「模型」Tab 渲染同一份列表、勾号读的是 Agent 默认模型写的却是主会话；按 2.x 埋点保留使用过的功能后重做）：`ModelsScreen` 是独立原生栈页（对齐身份页：`ScreenHeader` + ghost「Save」、`usePreventRemove` + `ConfirmationModal` 脏确认）。上段默认分组卡（不加分节标题）：「Default model」（尾值模型名，行用 `tailWidth="wide"` 放长名，点开复用输入框的 `ModelPickerModal`）、「Fallback models」（尾值只写数量，链在弹层里按顺序列出、上移 / 移除 / 添加）、「Thinking level」（尾值等级，复用 `ThinkingLevelPickerModal`）；三者与目录开关共用一份草稿，Save 经「This will restart Gateway」确认后一次 `config.patch`（`agents.defaults.model.primary / fallbacks / thinkingDefault` + `agents.defaults.models` 白名单）。下段目录（2026-09-18 负责人嫌首版「乱七八糟」，选定三方向里的 A「分组卡」：页面底改 `canvasGrouped`、横向内边距 16 与其他设置页一致，去掉「Defaults / Catalog」分节标题、「添加模型」胶囊和那句灰字说明）：搜索胶囊 + 右侧 44pt `Plus` 浮钮（= Add model），下面每个 provider 一张白色分组卡：首行 provider 名（body 600）+ 模型数 + ›，点进 Provider 弹层（模型数、Base URL、API、「Keys and endpoints」跳 OpenClaw 配置编辑器、底部「Add model」表单只填 ID + 名称）；模型行只有名字，不再有「200K · Reasoning · Image」副行（能力信息收进详情弹层），行尾 `ThemedSwitch`；默认模型所在 provider 置顶，其行尾写「Default」并锁定开关 = Gateway 白名单（2026-09-19 起跟随 OpenClaw 自身语义：配置带 `modelPolicy` 或迁移标记时读写 `agents.defaults.modelPolicy.allow`——精确引用与 `provider/*` 通配，空数组即全开；旧 Gateway 仍读写 `agents.defaults.models` 的键，见 `resolveModelAllowlistMode`。Gateway 无白名单时全开，第一次关掉某个模型会把其余模型显式写成白名单，关掉通配符覆盖的模型时把通配符展开成其余模型，不让列表悄悄缩成一个）；点行进模型详情弹层（ID / provider / 上下文 / 能力 / 成本 + 「Set as default model」「Add to fallbacks」「Copy model reference」「Edit cost」「Delete model」；删除前用 `analyzeModelDeletion` 列出「Still used by …」并禁用（只在 `modelPolicy.allow` 里被引用的模型可删并一并从默认与各 Agent 的 allow 里移除；只被目录或通配符覆盖的模型显示「Not in Gateway config」）；加模型 / 改成本 / 删除是带确认的即时写入，草稿未保存时这三个动作提示「Save changes first」）。Hermes 与 local-model（`modelManage` 为 false）：上段只有「Current model · Applies to all sessions」，目录行尾是勾号、无开关，详情弹层只剩「Set as current model」与复制，写入始终是全局 `setSelection`。成本编辑保留但降级到弹层（2.x 只有 16 人用过）；新增 / 编辑 provider 与 2.0 一样不做，指向配置编辑器。付费墙（2026-09-16 负责人决定，对应 `00` 「模型切换保持免费」只保留给聊天输入框的会话级切换）：本页所有写动作都是 Pro——开关、换默认模型 / 当前模型（选到不同的模型才拦，选回原值不拦）、备用增删排序、思考等级、加模型、改成本、删除；页面对免费用户完整显示真实数据、控件看起来可用，点到写的那一步才弹 `modelManage` 付费墙，购买 / 恢复后原地续做该动作，开关保持真实值不假动。Save 本身不再单独拦（能改脏草稿的已经是 Pro）。埋点沿用 `models_save_tapped`、`model_allowlist_toggled{source:'models_list'}`、`model_add_tapped{source:'provider_sheet'}`、`model_delete_tapped{source:'model_sheet'}`、`model_cost_save_tapped{source:'model_sheet'}`。

| 行 | 尾值 | 目标 | 能力 / 门槛 |
|---|---|---|---|
| OpenClaw 管理 | 无 | 功能菜单（2026-09-16 负责人：四个入口只有名字，用户不知道是干嘛的、没有点进去的欲望）：一张 comfortable 卡四行，每行 = 图标 + 标题 + 一行 caption 说明 + 箭头——「OpenClaw 配置 / 查看和修改 OpenClaw 的全部设置」「权限 / 看 Agent 能不能上网、执行命令，一键修好」「状态诊断 / 给 OpenClaw 做个体检，有问题自动修」「备份 OpenClaw 配置 / 存一份在手机上，改坏了能还原」（说明按负责人要求写给初中生看：一句、不带术语）；行尾只放菜单本来就免费拿到的数字：权限行 = 本次连接收到的待处理执行审批数（红点），备份行 = 最新还原点距今（本地读取，不请求 Gateway）。点行进分段页：配置 / 权限 / 状态诊断 / 备份 OpenClaw 配置（页内有一段说明 + 创建备份）；分段加载中 Companion 居中 | `configManage` · Pro（页内最后一步拦截） |
| 工具 | 可用数 | 工具页 | `tools` |
| 渠道与设备 | 待处理数（红点）/ 无 | 分段页：渠道 / 设备 / 节点（渠道 tab 见下文「渠道 tab」） | `channels`、`devices`、`nodes`；写入随 `channelManage` |
| OpenClaw 运行日志 | 无 | 日志页：免费看最新 3 条，其余遮罩 + 解锁 | `logs` · Pro（页内最后一步拦截） |

行的形状不变：左标题（body 400）+ 一个尾值（secondary 灰）+ 箭头，没有副标题。命名沿用 2.0：`Cron jobs`（定时任务）、`New cron job`；不再用「Scheduled tasks」。

**渠道 tab**（2026-09-19 负责人发现 2.0 渠道页的「DM Scope Settings」和账号开关在 3.0 丢了——迁移表写的是「迁移合并」而非删除、也没有偏离记录，属于只迁了只读列表；按 3.0 的行 + 弹层找回）：顶部一张分组卡一行「Direct messages」，尾值 = 当前范围（`Shared session` / `Per sender` / `Per channel and sender` / `Per account, channel and sender`，读 OpenClaw 全局 `session.dmScope`，未设置即 `main`），`tailWidth="wide"`、带箭头；点开选择弹层：一句灰字说明（只影响各渠道的私聊，群和频道始终各自会话）+ 四行（标题 + 一行说明，当前项尾部勾号）；选到不同项弹 `ConfirmationModal`（标题 = 新范围名，正文「已有会话保留，新的私聊按新范围进入」+ 通用的重启 Gateway 句），确认后 `channels.setRouting`、关闭弹层、静默重读渠道状态；取消留在弹层；选回当前项只关弹层。下面渠道列表每行 = 渠道名 + 状态尾值 + 箭头，点开渠道弹层：`Accounts` 小标题 + 每个账号一行（名称，默认账号后缀「(default)」；副标题「Received 3m ago · Sent 2h ago」只在有过收发时出现；行尾 `ThemedSwitch` = `enabled !== false`），拨开关弹 `ConfirmationModal`（「Enable / Disable {{name}}?」+ 一句后果 + 重启句），确认后 `channels.setAccountEnabled`、本地镜像新值并静默刷新状态，失败时弹层顶部 `Banner` 红字、开关保持真实值；没有账号时一句「No accounts configured.」。`channelManage` 为 false（Hermes 本来就没有渠道 tab；OpenClaw 运行时降级）时不渲染「Direct messages」行，账号行尾值写 Enabled / Disabled、无开关。不进付费墙（2.0 也免费；与工具页一致）。这个范围是 OpenClaw 全局的、只管私聊；OpenClaw 官方默认 `main`（个人助手），多人共用收件箱才推荐 `per-channel-peer`。埋点 `channel_dm_scope_changed{ scope }`、`channel_account_toggled{ channel, enabled }`（2.0 没有埋点，无历史数据）。

**失败红字**（2026-09-19 负责人决定：红字是红点式通知，看过就消，不是任务状态）：`cron.list` 里本 Agent 的任务中 `lastRunStatus`（旧字段 `lastStatus`）为 `error` 的算失败——只有 `lastError` 文本或 `consecutiveErrors` 不算，因为跳过的运行也带错误文本、运行记录里找不到对应红条。每条失败的身份是 `jobId@lastRunAtMs`（`cron-failures.ts`），用户打开该 Agent 定时页的「运行记录」tab 时把当前全部失败签名写入 `CronFailureAckService`（`clawket.cronFailureAcks.v1.<connectionId>::<agentId>`，只存仍存在的失败，删连接时清理）；红字只数没写过签名的失败，所以看过即消、同一任务下次再失败会重新亮、下一次成功由后端清状态。主页在下层收到确认事件后只重读 Cron 卡（`loadAgentCronSummary`），不整页刷新。「运行记录」tab 在有失败任务时先列一个红色「{{count}} failed」小标题 + 每个失败任务一行（由任务状态重建，点开同一个运行详情弹层，与分页历史里的同一条去重），再接完整历史；这块按任务状态显示，不受已读影响。任务 tab 行上的红色「失败 · 原因」同样是状态，不随已读消失。

**数据**：`load-summary.ts` 在 `ready` 时并行读 `models.list`、`skills.status`、`cron.list`（同时数本 Agent 未看过的失败）、`cron.heartbeat.last`、`agents.files.list`、`usage.cost(today)`（费用 + tokens）、`tools.catalog`、待处理配对；任一失败只缺对应数字。Hermes 无心跳、无工具 / 渠道 / 日志：头像角标换 Hermes 图标、名字下没有灰字，弹层里少三行，数字卡完全一样。

点锁即付费墙；点行本身进入页面后被拦也弹付费墙（沿用现有 `showPaywall`）。2026-09-16 负责人决定：OpenClaw 管理四个分段与运行日志不在行上锁，免费用户进入后看到真实数据，只在交付 Pro 价值的最后一步拦截（配置展开 / 编辑、权限详情 / 规则 / 修复、诊断第 3 项起 / 详情 / 修复、备份创建 / 恢复确认、日志第 4 条起），遮罩用 `ProGate`（真实内容 + 渐隐遮罩 + 一句话 + 解锁按钮），见 `06` §3。

**埋点**：`agent_settings_opened`、`settings_row_opened{ row, locked }`；现有 `models_save_tapped`、`agent_save_tapped`、`cron_save_succeeded`、`tools_save_tapped`、`heartbeat_save_tapped`、`gateway_config_*` 保留。

### 技能管理（2026-09-13 负责人确认）

移除 Installed / Discover 顶部分段，已安装页用白底、安静搜索框、总数/开启数和无卡片列表。每行最小 88pt：名称、一行用途、独立中性开关；点名称进详情。开启状态与可用性分开，缺配置/依赖/系统要求或允许列表限制显示具体原因，Always on 不显示可操作开关。开关保存与回读不卸载列表、不按状态重排；失败保持旧值，回读失败保留已确认的新值；断网保留已加载内容并禁用修改。

右上角 Compass 按钮按 `skillDiscover` 能力显隐，压栈打开发现页，返回保留原列表搜索和滚动位置。详情为可滚动标准 Sheet，含完整说明、启用/可用状态、来源和所有缺失项；卸载按能力与 deletable 元数据显隐，在详情关闭后经 ConfirmationModal 确认。此页面允许列表用途说明，覆盖普通设置行无副标题限制；完整配方见 Mobile design-system。

**发现页 = ClawHub 网页端**（2026-09-19 负责人决定：3.0 迁移时只留了搜索没留浏览，进页面即空；自研的 ClawHub + skills.sh 列表依赖未公开的 Convex 接口，太复杂且脆弱，改为直接嵌 ClawHub 网页）。`SkillDiscoverScreen` 是独立的 native-stack 页面：`ScreenHeader` 标题「探索更多技能」+ 标题槽里的 `ConnectionStatusPill`，正文是 `react-native-webview` 打开 `https://clawhub.ai/skills`，加载中用骨架行，加载失败用 `Failed to load ClawHub` Banner + 重试。页面只留在 clawhub.ai：其它 http(s) 站点与 mailto / tel 交给系统浏览器打开（`resolveClawHubNavigation`），`target=_blank` 的 ClawHub 链接在本页内继续，`javascript:` / `intent:` 之类直接丢弃；iframe 不拦。返回键先走网页历史（`usePreventRemove` 在网页还能后退时接管硬件返回 / 手势），网页有历史时右上角出现 X 直接离开。URL 命中 `clawhub.ai/{owner}/skills/{slug}`（2026-09 的详情页形态；插件页与目录页不算）时底部长出安装栏：一行 `@owner/slug` 灰字 + 全宽 `Install via Chat` 按钮（2.0 网页壳只有右上角一个小 Download 图标，1837 次访问只有 59 次安装，转化差的直接原因）。按钮按 `skillInstall` 显隐；2026-09-21 负责人恢复 2.0 交互：点击先释放路由保护，关闭发现/设置页并回到该 Agent 的 main Thread，将安装提示词一次性预填到输入框，由用户主动发送。等待该会话草稿恢复后追加，保留已有输入；不调用 `adapter.prompt` 或直接安装接口，不等待网络，离线也可准备草稿。提示词由 `buildClawHubInstallPrompt` 按 backend 生成：OpenClaw 用 `openclaw skills install @owner/slug`（ClawHub 官网当前给的命令），Hermes 用 `hermes skills install <slug>`（Hermes 原生有 ClawHub / skills.sh hub source），其它后端只给页面链接。skills.sh 不再单列（2.0 数据里只占少数流量）。网页跟随系统外观，不跟 App 内主题。

旧的自研发现实现（`features/discover/`、adapter `skills.discover`、协议 `DiscoverSkillItem` / `DiscoverResult`、section-model `skills.discover` 行）在网页版真机确认可用后一并删除，不与本次 UI 替换混做。

### 定时任务（2026-09-14 负责人确认）

列表使用白底无卡片行：任务名称、人类可读的时间规则、服务端下次执行时间、独立开关；失败与启用状态分别展示。保留任务/运行记录切换，心跳放在次级入口。右上角加号压栈进入新建页，点击任务直接进入完整编辑页，返回安静刷新并保留列表顺序。页面默认落在「运行记录」tab（负责人 2026-09-19 决定：进定时页更常是看任务跑了什么，不是改配置），只有本 Agent 还没有任务时落「任务」tab 让空态直接新建；落点在任务列表首次就绪时定下，之后新建 / 删除不再自动切 tab，用户手动切换优先。两个后端同一规则（都有 `runs`）。「运行记录」tab 顶部先列当前失败任务、并把它们记为已看（见「Agent 主页 → 失败红字」）；原路由参数 `cronView` 已删除。

新建保留两步：「选择模板或自定义」→「设置内容和时间」，但不带步骤编号、不带引导副标题（2026-09-19 负责人决定：只留「希望 AI 能做什么？」一个标题，删掉「1 选择起点」「选择模板，再调整任务内容和时间」「2 设置任务」）。恢复八个模板，默认显示四个；每天、每周多选及工作日/周末快捷选择、间隔和单次采用可视化控件及原生日期/时间选择器，预览接下来三次预计执行。新建页只有名称、任务内容、时间和「创建」：新任务一律启用，不放「已启用」开关；也不放「高级设置」（Cron 表达式、描述、模型、通知）——2026-09-19 负责人决定，依据是 2.x 向导同样不提供这些且从未有人在新建时用到，需要时创建后进编辑页调整。Thread 草稿直接进入配置阶段，只预填本次新建。编辑复用同一套时间控件，明确保存，离开未保存内容需确认；保留「已启用」开关、高级设置（Cron 表达式、描述、模型、通知、超时）、运行记录、立即运行和删除。编辑页结构（2026-09-19 负责人反馈：内容全堆在一起、间距乱、任务内容看不出可编辑）：灰色 `secondary` 小标题 + 内容分节，节间 24、标题到输入框 8、到设置行 4（行自带 8），标题永远离自己的内容更近；灰底输入框只给可编辑文本——名称行内编辑，任务内容折叠为六行墨色正文、标题行右侧带「编辑」，点文本或「编辑」进独立的全页编辑子页（标题「希望 Agent 做什么？」，右上「完成」）；「什么时候执行？」下只有一行无边框规则行（标题为规则，副标题为下次运行 + 时区，草稿改过时间时用本地估算，关闭时写「已暂停」）和「已启用」开关，三次预计执行只在时间子页与新建页出现、去掉灰底且不再重复时区；下方是「模型」与「高级设置」两行（高级设置是子页而非行内展开，「使用 Cron 表达式」是其中一行）；运行记录只列最近三条（之后每次加载十条），只显示时间与状态，摘要进详情、失败原因作副标题；执行记录弹层（`CronRunSheet`，2026-09-19 负责人决定：聊天流 Cron 卡、运行记录 tab、编辑页运行记录三处入口共用）自上而下是：任务名 + 时间 + 状态一行；「投递内容」——运行真正发出去的东西：OpenClaw 从稳定会话键读 `chat.history`（`sessionId` 与记录一致才算本次），提取 `message` 工具的发送调用（含 `tool_call` 包装与 `custom` 回显去重），每条带「渠道 · 收件人」小字；Hermes 用 `hermes.cron.outputs.get` 的全文作「运行输出」；`announce` 投递成功的任务把摘要当投递内容展示且不重复列摘要；记录了 `messageToolSentTo` 但会话已被回收时写「这次运行的会话已被回收」；「执行摘要」（失败时为红色错误）；时长 / 模型 / 通知三行——通知按 `not-requested` 显示「未请求通知」（`delivered:false` 不再误判为未送达），Agent 自行用 message 工具发送时显示「Agent 已自行发送」；底部「查看完整会话」只在转写仍属于本次运行时出现，弹层收起后再进入稳定键的只读线程（cron 会话不显示输入框）。OpenClaw 只有每个任务最近一次运行能读到全文（`chat.history` 无 sessionId 参数，`cron.sessionRetention` 默认 24h 回收 `:run:` 行），更早的运行退化为摘要 + 渠道；原「上次运行 / 下次运行」两行删除；设置行出血到屏幕边缘使文字与标题、输入框左对齐；保存仅在草稿变化后可用。

**编辑页**（2026-09-19 负责人两轮反馈：原页全堆一列、间距乱、任务内容看不出可编辑；第一轮改成白底无边框散行后「换了一种丑、更乱」）：按 Models 页的分组样式——`canvasGrouped` 底（含页头）、白色 `SettingsGroup` 卡片、卡间 24、卡内内容缩进发丝线，除「运行记录」外不加分节标题。卡一：「任务名称」行，名称为尾值，点开 `RenameSheet`（与连接页「名称」行同一配方）；「希望 Agent 做什么？」行，任务内容为两行副标题，点开全页任务内容子页（标题同名，右上「完成」，正文字号无边框输入）。卡二：规则行（标题为规则，副标题为下次运行 + 时区，草稿改过时间时用本地估算，关闭时写「已暂停」）进时间子页；「已启用」开关。卡三：「模型」（主会话任务显示「跟随主会话」的普通值行，不压暗）与「高级设置」（子页，「使用 Cron 表达式」是其中一行）。然后是「运行记录」标签 + 右侧「刷新」、最近三条运行的卡片（之后每次加载十条，只显示时间与状态，失败原因作副标题，摘要进详情）、「立即运行 / 删除」两个按钮。三次预计执行只在时间子页与新建页出现、去掉灰底且不再重复时区；原「上次运行 / 下次运行」两行删除。新建页与子页仍是白底表单：灰色 `secondary` 小标题，节间 24、标题到输入框 8，设置行出血对齐。保存仅在草稿变化后可用。

时间规则用结构化数据，无修改时不回写 schedule，保留时区、间隔锚点、stagger 和自定义规则。按 `cronTimeZone` / `cronAdvanced` / `cronModel` 精确显隐：OpenClaw 可指定单任务时区、编辑页的高级执行配置和单任务模型；Hermes 使用 Agent 所在时区、整分钟间隔，不提供不生效的选项（Hermes Bridge 尚未透传 `model`，不显示模型行）。两个后端新建时都启用。

**模型行**（2026-09-19 负责人决定）：新建与编辑页在时间预览之下、高级设置之外都有一行「模型」`SettingsRow`（宽尾值）：有覆盖时写目录里的模型名，没有时写「默认 · <Agent 当前默认模型>」（来自 `models.getSelection()`，取不到时只写「默认」），点开共用的 `ModelPickerModal`（含「默认」行）；主会话 `systemEvent` 任务显示只读「跟随主会话」。列表行只在存了覆盖时多一行「模型 · <id>」灰字；运行记录弹窗里的模型是 OpenClaw 解析后的实际值，所以不设覆盖也有。新建任务对主 Agent 也一律是 `isolated` + `agentTurn`（与 OpenClaw Control UI / CLI / agent 工具一致；主会话 `systemEvent` 没有模型字段、运行记录也不记模型，且结果只进主聊天），已有主会话任务仍可查看编辑。清除覆盖时 patch 发 `model: null`（OpenClaw 会把空串原样存下），未改动不带 `model`。未知远程时区不猜测绝对运行时间，实际执行以服务端为准。运行完成与通知送达分别显示；列表与编辑按连接、Agent、adapter 隔离缓存和异步回调。详细配方见 Mobile design-system。

**运行详情弹层**（`CronRunSheet`，编辑页运行记录与「运行记录」tab 共用；2026-09-19 负责人反馈：滚不动、一滚就弹回去，且「日志 / 时长 / 通知」几行与下方正文、左上关闭键都不对齐）：固定 68% / 92% 两档 + `BottomSheetScrollView`（普通 `ScrollView` 的拖动会被弹层手势抢走），正文与元信息共用 24pt 内容边：元信息是无边框 `canvas` 分组、行无横向内边距、通栏细线（任务名 + 时间 + 状态、时长、通知、有则模型），下接可选中的摘要或错误文本。心跳表单同样改为 82% / 92% + 集成滚动。同一类问题一并修掉：工具详情、线程运行结果、帮助主题、节点详情、回复失败、聊天外观取值列表（七行以上）、OpenClaw 配置编辑器、命令选项列表；`check:ui-style` 从此拒绝 `Sheet` 内的竖向原生 `ScrollView` / `FlatList` / `SectionList`。

### 用量页（2026-09-16 负责人确认）

`UsageSection` 是 Agent 主页「Cost today」卡的落地页：`canvasGrouped` 底 + 白色分组卡，两个后端共用同一份 `management.usage.sessions / cost` 契约，费用相关内容按 `cost` 能力显隐。顶部 `SegmentedTabs` 三档（今天 / 7D / 30D），2.0 的昨天 / 3D / 14D 不恢复。主度量由 `resolveUsageMeasure` 决定：`cost` 能力为真、`costPresentation.mode` 不是 `unknown` / `included` 且范围费用大于 0 时以费用领头，否则以 Token 领头；页面永不以 `$0.00` 领头。

结构自上而下：英雄卡（左主数字、右次数字，title 600 表格数字 + secondary 标签；次标签在 `estimated` / `mixed` 时写「Estimated」/「Partial」，`included` 时次数字写「Included」，`unknown` 时写「—」；下方 `SegmentBar` 四段，费用模式按单价从深到浅排 输出 / 输入 / 缓存写入 / 缓存读取，Token 模式排 输入 / 输出 / 缓存读取 / 缓存写入，颜色用 `ink → inkSecondary → inkTertiary → line` 一条墨色序列，图例逐项写值、不靠颜色辨识）→ 2×2 指标卡（消息 / 工具调用 / 会话 / 缓存命中 = cacheRead ÷ (input + cacheRead)，没有提示 token 时「—」；复用 Agent 主页数字卡配方）→ 趋势卡（今天档显示「近 7 天」并默认选中今天，7D / 30D 显示对应天数，缺日补零；`UsageBarChart` 选中柱 `ink`、其余 `inkTertiary`、网格 `line`，只标选中值，30 天时 x 轴每 7 天一标加今天，点柱子切换选中）→ 模型卡（`ShareRow` 前 5，按主度量排序与显示，行下 4pt 占比条）→ 工具卡（前 5 与调用次数；`totalCalls` 为 0 时整卡不渲染）。删除了每日日期列表、零值时的费用明细四行与页尾按钮；统计海报改从页头右侧 `Share` 44pt `FloatingButton` 打开，内容不变。图表全部单色：界面主题里 `accent` 已被 `buildInterfaceTheme` 映射为墨色，不新增颜色 token。

加载与切换：`useUsageDashboard` 以 adapter + Agent + 范围 + 起止日期为键做内存缓存（60 秒内不重复请求，更久则静默刷新）；屏幕只显示当前键的数据，另一范围的迟到响应只进缓存、不改屏幕，快速连点后停在哪档就显示哪档的数字；未缓存的范围立即显示同形骨架（英雄卡 / 四卡 / 柱数按范围 / 两行列表），有缓存的范围零等待切换。今天档落地后顺带取 7D 作为趋势上下文，再按 7D → 30D 预取一次（每个 adapter / Agent 作用域一次，离线不请求）。失败保留已加载数据并在顶部给一条 `Banner` + Retry，无旧数据时才显示错误横幅。数据变更整块交叉淡入 200 ms，柱子从基线长起 320 ms，减弱动效下静止。

**付费（2026-09-16 负责人决定）**：今天档完整免费；7D / 30D 是 Pro。免费用户可以切到 7D / 30D，数据照常加载，整块内容渲染在 `ProGate` 之下（蒙层高六行 `ControlSize.settingsRow`，英雄卡与指标卡的数字若隐若现、不可点、对无障碍隐藏），蒙层里是锁 + 「看整周、整月的用量」+「7 天与 30 天的用量、费用与趋势。」+ 全宽墨色「解锁用量趋势」按钮，点击以 `usage` 原因弹付费墙（英雄 `generic`，标题「看清每一个 token 花在哪」）。今天档趋势图里过去几天的柱子对免费用户也是钩子：点了直接弹墙。购买或恢复后蒙层随 `isPro` 消失。不在分段控件上加锁标或禁用档位。

**埋点**：`usage_range_changed{ range, cached, locked }`。

## 6. 账户设置 `AccountSettings`

分组：Pro（状态 / 横幅 / 恢复购买）；连接（「我的连接」列表：label、Agent 名、在线 / 离线 / 已暂停；行左滑 → 「暂停 / 恢复」「移除」，与连接页同样二次确认；点行 → 连接页；「添加连接」→ 引导模态；免费第 2 个连接 → 付费墙 `gatewayConnections`）；外观（主题、强调色、聊天外观、App 图标 Pro）；帮助（帮助中心、OpenClaw 文档、Hermes 文档、发布说明、OpenClaw Releases、反馈）；社区（分享、评分、Discord）；关于（版本、开源仓库、隐私、条款）；开发者（Debug 模式、Preview 环境、设计系统、清缓存、重置设备）。

**连接页 `Connection`**（2026-09-17 负责人定稿，唯一的连接级页面；花名册「管理」、我的连接列表、Agent 资料页「连接」行都指向这里）：头部 = 官方图标 + 连接名 + 状态 + Agent 名；主操作「重新连接 / 恢复连接」+「暂停此连接」（确认）；「名称」行 → 改名弹层（`RenameSheet`，只改本机 label，不动凭据、不断 OpenClaw 连接；Hermes 无 Bridge 名与本地模型的 Agent 名来自连接名，改名立即镜像到花名册与缓存，活动连接重新握手一次）；「详情」分组只读：后端、传输、环境、服务器地址、Bridge 版本、Bridge 能力、最近就绪；免费用户多一组「免费连接 · 当前」或「设为免费连接」（24 小时冷却尾值）；底部「移除连接」（确认）。原「高级设置」子页、账户设置的连接分段和 Agent 设置的连接分段一并删除，不再有第二处连接详情或生命周期入口。

2026-09-16 帮助中心发布核查：配对说明覆盖 OpenClaw / Hermes、主机执行前提及配对码 / QR 操作；排障先提供 Clawket status / doctor / logs --follow / start，再提供 OpenClaw 专属检查。区分 Relay 出站联网与直连端口，凭据变更指向重新配对，断线指向连接页重连 / 恢复与主机 Bridge 重启。LAN / Tailnet 配置片段保留旧版 Gateway 启动需要的 allowedOrigins；说明合并配置、替换地址和强令牌、重启后用带 URL 的本地配对命令生成 QR。更新采用 openclaw update。所有帮助文案同步 19 语言；npm 发布由负责人另行把控。

2026-09-13 用户授权品质升级：主页为 Companion 猫头 Pro 品牌卡、常用组（连接 / 外观 / 聊天与通知 / 语言）、支持组（帮助 / 关于）。2026-09-19 负责人要求把「外观」子页里的三项放到设置首页：常用组去掉「外观」行，其下单独一张外观卡——「主题」（`SunMoon`，原地弹主题选择）、「聊天主题」（`Palette`，进 `ChatAppearance` 页）、「App 图标」（`Image`，免费用户锁 + `appIcons` 付费墙续做；平台不支持换图标时隐藏）；`appearance` 分段页删除，首页自己持有一份 `AccountPreferenceSheet`（主题 / 图标 / 语言）。首页不加分节标题，行标题自明。同日负责人判定「聊天与通知」整块删除：「回复完成提醒」只是本地通知，依赖 App 进程还收得到 `chatFinal`（iOS 切后台约 30 秒即挂起，且不做远程推送），埋点显示只在 1.0 / 1.1 那一周响过 95 次、之后半年为零；「语音输入语言」固定跟随系统、不再让用户设置。`voice` / `notifications` 分段、`replyNotifications` 能力、`SpeechRecognitionLanguage` 存储与 `chat_reply_notification_*` 事件一并删除，常用组只剩「我的连接 / App 语言」。账户设置及连接、外观、帮助子页和选择弹层使用 comfortable 设置组件：64pt 最小行高、22pt 圆角、统一中性图标和留白，长文案自动增高；选择项提供底色、勾选与读屏选中状态，保存期间防重复操作。Pro 卡为品牌身份例外，可显示标题与会员状态两行。Agent 设置保留原密度。完整实现配方见 Mobile `docs/design-system.md` 的 Settings refinement；所有原有动作和权限判断保持。

## 7. 全局搜索 `Search`

输入框自动聚焦，灰底 `quiet` 胶囊（与 Thread 头部的 `HeaderPill` 同一材质；纯白画布上浮起阴影几乎不可见——负责人 2026-09-19），占位「Agent、会话和消息」；结果分节：Agent、会话（跨连接，来自缓存与活动连接）、消息（本机 `chat-cache`，高亮命中）、收藏（chip 筛选）。点消息 → 消息详情（Pro `messageHistory`）→ 「在线程中查看」。空查询时显示最近搜索，其下列出全部收藏（搜索页是收藏唯一的浏览入口；先 5 条，「全部 N 条收藏」一行就地展开；免费用户照旧带锁、点击走 `messageHistory` 付费墙）；两者都没有时居中一句说明搜索范围（Agent、会话、这台设备上打开过的聊天消息）。不放最近会话 / 最近消息列表，也不做「猜你想搜」（2026-09-19 负责人决定：与花名册重复、没有信号可生成）。

## 8. 付费墙 `Paywall`

见 `06-paywall-and-growth.md`。路由为全屏模态；自动弹出只在活动连接就绪后触发，因此 `Onboarding` 期间永远不会弹。

## 9. 宽限期横幅

花名册顶部一行：「多 Agent 还剩 {n} 天」/ `{n} days left for multiple agents`，右侧「了解 Pro」→ 付费墙（通用版）。

## 10. 通知与深链

- 不做回复通知（2026-09-19 负责人决定删除本地回复通知；远程推送本就不在范围内）。
- 深链 `registry.clawket.ai/pair/...` 沿用现有解析进入引导模态。


### 2026-09-19 · 持续连接失败

用户参考远程电脑离线页要求补齐明确的失败界面。短暂恢复继续使用已有宽限窗口和页头胶囊；持续失败后，Thread 展示居中的电脑图标、连接名称、无法连接说明、已知的上次成功连接时间、重新连接和管理连接。网络类错误不推断“电脑已关机”；暂停与配对/登录错误保留对应解释和动作。配对/登录动作进入所选后端的引导，手动重连建立新握手并合并重复点击。缓存消息/执行卡通过“查看已保存的消息”仍可读，草稿保留，离线禁止发送；恢复就绪自动回到内容。同一连接再次离线应重新显示提示，切换连接不沿用上一个连接的隐藏状态。

Roster 无缓存行时居中显示同一组件，不再误报“此连接没有 Agent”；有行时在列表顶部显示，保留其他连接与缓存入口。返回、搜索、账户、添加与连接管理仍可用。时间只表示本机成功连接记录，不代表服务端最后在线时间。浅深色沿用主题 token，19 种语言同步，完整状态可滚动以支持小屏和大字体。此用户要求取代此前“持续失败也只用胶囊”的实现细节。
