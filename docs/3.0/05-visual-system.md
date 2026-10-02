# 05 · 视觉系统（向 Grok Bot 对齐，双端统一）

## 1. 原则

1. 白底、无导航栏、控件浮在内容上。
2. 无分割线、无卡片边框；靠间距与字号分层。
3. 颜色只给头像；界面只有白、一档浅灰、黑字、灰字；强调色只出现在发送键、选中态、链接、「查看中」、未读点。例外是线程（聊天界面 A+，2026-09-30 负责人拍板）：内置壁纸和你发的实色气泡带强调色，见下方「线程底面」。
4. 两种气泡：你发的强调色实色白字，Agent 的白色；同一人连发合并、尾巴只在组末。日期、系统事件和工具活动是居中半透明胶囊。
5. 状态靠头像表达。
6. 只有 400 / 600 两种字重。
7. 不用 Liquid Glass、SF Symbols、原生 TabBar、Material 涟漪、模糊遮罩、emoji 图标、三个跳动的点、彩色文字、渐变（付费墙英雄图和线程内置壁纸除外）。

## 2. Token（`src/theme/theme.ts`）

| Token | 浅色 | 深色 | 用途 |
|---|---|---|---|
| `canvas` | `#FFFFFF` | `#0C0C0D` | 花名册、线程、付费墙底 |
| `canvasGrouped` | `#F5F5F7` | `#0C0C0D` | 设置类页面底 |
| `surface` | `#F2F2F4` | `#1A1A1D` | 助手气泡、卡片、行按下态、面板底 |
| `surfaceFloating` | `#FFFFFF` | `#222225` | 浮动按钮、头部胶囊、输入框 |
| `ink` | `#111113` | `#F3F3F5` | 名字、正文 |
| `inkSecondary` | `#6B6B72` | `#9A9AA3` | 预览、副标题 |
| `inkTertiary` | `#A3A3AB` | `#6A6A73` | 时间、占位 |
| `line` | `#E6E6EA` | `#2A2A2F` | 仅设置分组卡内的发丝线 |
| `accent` | 用户选择，默认 `#1F5EFF` | 默认 `#6B95FF` | 发送键、选中态、链接、查看中、未读点 |
| `accentSoft` | accent 10% | accent 16% | 用户气泡底、选中卡底 |
| `good` / `warn` / `bad` | `#178A6A` / `#D9791C` / `#D64545` | `#2FA07C` / `#D07F30` / `#E06060` | 状态环、徽标、失败；永远带图标或文字 |
| `goodSoft` / `warnSoft` / `badSoft` | 各自 12% | 各自 20% | 徽标底 |
| `agentPalette[8]` | `#1F5EFF #D9791C #178A6A #E2477B #7A5AF8 #1C8FA3 #8A5A3C #5B6673` | 同 | 头像底色，按 agentId 哈希固定分配 |
| `shadowFloating` | `0 2 12 rgba(17,17,19,.08)` | 无阴影 + `line` 发丝线 | 仅浮动控件 |

**线程底面**（`src/theme/chat-wallpaper.ts`，每种强调色浅 / 深各一套，只给对话用）：壁纸 = 165° 三段同色系渐变 + 132pt 平铺的 Clawket 涂鸦（猫爪、星光、终端提示符、时钟、对话框、代码括号，描边 1.4，浅色 9%、深色 7% 不透明度）；你发的气泡 = 实色 + 白字，取强调色（浅色即 accent500，深色为更沉的一档）和画布方案 B 的正中，感知明度、饱和度各走一半，冰川蓝浅 `#246DFD` / 深 `#2960DF`（2026-10-01：B 用着偏浅，恢复原色又偏深，负责人选定「居中」）；Agent 气泡 = 白色（深色为带色调的炭灰）；居中胶囊 = 浅色为 70% 的深色同色系底 + 白字，深色为 12% 白 + 浅字，照片上为 55% 黑 + 白字，失败为深红 78% + 白字；纯色（不铺壁纸）时气泡、卡片和胶囊回到 `surface`。你发的气泡白字 ≥ 4.3:1，其余正文和胶囊文字 ≥ 4.5:1，由 `resolver.test.ts` 检查。选择在「聊天主题 → 壁纸」：图案（默认）/ 照片 / 纯色。每发一条消息，图案壁纸的渐变沿 3 倍屏幕大的图层挪一步（`Motion.wallpaper` 600ms），顶部和输入栏的渐隐层跟着换色；减少动态效果时静止不动。

现有 `accents.ts` 的六种内置强调色保留（id 不变，便于老用户偏好迁移），每种按新色板重新取值并提供浅 / 深两档，通过对比度检查（文字对 canvas ≥ 4.5:1 时才允许作为链接色，否则链接用 ink 加下划线）；`customAccent` 相关代码（`AppProviders`、`useAppBootstrap`、`ThemeProvider`、`storage`）没有对应界面，删除。删除现有 `surfaceMuted / surfaceElevated / primarySoft / info*` 等不再使用的 token，并把 `check-ui-style` baseline 相应下调。

## 3. 字体与字阶（`src/theme/tokens.ts`）

iOS 用系统 SF Pro，Android 用 Roboto，中文走系统 CJK；不引入第三方字体。数字用 `fontVariant: ['tabular-nums']`。**只有五档**，任何页面默认可见的文字只允许用到其中两档。

| 名称 | 字号 / 行高 | 字重 | 用途 |
|---|---|---|---|
| `display` | 28 / 34 | 600 | 付费墙标题、引导标题（每屏最多一个） |
| `title` | 20 / 26 | 600 | 设置类页面标题、面板标题 |
| `body` | 17 / 24 | 400 或 600 | 消息正文、输入框；600 时用于名字、行标题、按钮 |
| `secondary` | 15 / 20 | 400 | 预览、行尾值、系统事件行 |
| `caption` | 13 / 18 | 400 或 600 | 时间、法务小字、居中胶囊；600 时用于徽标里的数字和日期胶囊 |
| `meta` | 12 / 16 | 400 | 只用于气泡里的时间与送达标记（聊天界面 A+，2026-09-30） |

删除现有全部中间字阶与 `micro`；`FontSize` 只保留以上五档。

## 4. 形状与间距

| 项 | 值 |
|---|---|
| 栅格 | 4；间距只用 4 / 8 / 12 / 16 / 24 / 32 |
| 气泡圆角 | 18；同一人相邻气泡的合并侧 6；组末尾巴那一角 0，尾巴 6×14 贴在气泡外侧（聊天界面 A+，2026-09-30） |
| 浮动按钮 / 胶囊 / 输入框 | 全圆；圆形按钮 44；胶囊高 40 |
| 卡片 | 16 |
| 设置分组卡 | 默认 14 / 行高 52；账户设置及子页 comfortable 22 / 最小行高 64（2026-09-13 用户品质升级） |
| 头像 | 花名册 56（圆角 18）；头部胶囊 28（圆角 9）；设置顶行 44（圆角 14）；面板菜单行 32（圆角 10）；会话面板行 40（全圆，渠道行同尺寸灰底图标位） |
| 花名册行 | 最小高 84（56 头像上下各 14；2026-09-27 负责人决定，原 88，试过 80）；横向内边距 16；头像与文字间距 12；两行字各带右端槽位：时间对齐名字行，未读 / 需要你 / 锁对齐预览行 |
| 线程 | 行本身无上下内边距，间距由时间线节奏统一给出（2026-09-16 负责人要求统一，2026-09-30 按 A+ 收紧）：同一人的相邻气泡 2（合并成一组）；同一声部的其它相邻行 8（工具胶囊与其产出的回复）；用户与 Agent 之间、胶囊两侧 12；日期胶囊上方 16、下方 12；列表首尾各 16。消息内部（气泡 / 附件 / 收藏星）4。气泡内边距横 12 / 竖 8；用户气泡最大宽 82%，Agent 92% |
| 页面横向内边距 | 16 |
| 浮动头部 | 顶部安全区 + 8；下方 24 渐变遮罩 |

## 5. 组件配方（`src/components/ui`）

| 组件 | 规格 |
|---|---|
| `FloatingButton` | 44 点击区，Lucide 图标 22 / 1.75 描边、`ink`；页头、弹层头与确认弹窗一律 `plain` 纯图标（2026-09-27 负责人决定）；只有悬浮在内容上的按钮（回到底部）用 `surfaceFloating` + `shadowFloating`，壁纸上用 `glass`（80% 半透明 `surfaceFloating` + 细边 + 浅色模式浮起阴影；安卓的阴影用只画在外面的 `Shadow.floatingOutside`，因为 `elevation` 会画在整个轮廓下面、从半透明底透上来；深色加一圈淡 `ink` 亮边，2026-10-01）；按下缩放 0.96；可带徽标（accent 点或 bad 数字） |
| `HeaderPill` | 高 40 全圆，`surfaceFloating` + 阴影，内容：头像 28 + 名字 `name` + 副标题 `caption inkSecondary`；副标题变化用 100 ms 淡入淡出（沿用现有头部动画）。线程在场感（A+，2026-09-30）：工作时头像外 2pt 转一段强调色弧（`PresenceRing`，1.4 s 一圈，轨道 16%），副标题换成状态句并用强调色（正在运行命令… / 正在输入… / 正在思考…）；等你批准或回复时整圈琥珀色呼吸，副标题琥珀色；减弱动态效果时静止 |
| `PresenceRing` | 头像外圈：工作 = 强调色四分之一弧旋转；等你 = `warn` 整圈呼吸；只在 UI 线程动 transform / opacity |
| `AgentAvatar` | 圆角方块，底色 `agentPalette[hash]`，内容 emoji（若有）或 1–2 字首字母（白，600）；状态环：`working` = 不加头像或会话图块角标，沿用花名册预览与对话活动展示（2026-09-22 用户修订）；`attention` = 右下 12 圆点 `warn` / `bad` 带 2pt canvas 边；`done` = 右下 `good` 圆点 3 s 后淡出；`live` = 右下 `good` 圆点常驻，标出实时连接的 Agent（2026-09-26 负责人决定，规则见 04 §2 Agent 行），变为实时时 200 ms 淡入；圆点统一用 `StatusDot`（12pt 含 2pt 所在表面色描边）；头像是正圆，圆点与锁徽标的圆心压在圆周 45° 处，描边切出完整缺口（2026-09-27 负责人反馈：按方框角外扩时描边只擦到圆边一点，像 bug）；同一角一次只放一个标记，锁 > 需要你 > 实时；右上角只给首页会话行放对话徽标（`badgeIcon`：20pt `surface` 灰底圆 + 2pt canvas 描边，同样压在圆周 45°，2026-09-27）；`offline` = 整体去饱和 60%；`locked` = 去饱和 + 右下锁；官方图标（2026-09-27 负责人决定）：`platform` 为产品型后端（Hermes、Codex、Claude Code、Pi、本地模型）时，脸就是官方图标——白底圆 + 发丝描边，裸图标占直径 54%，App 图标类素材满圆裁切——不画 emoji、首字母或图片；`platformBadge` 让有自己头像的 Agent 在右下带后端角标：24pt 画布色环 + 20pt `surface` 灰底圆（白底在画布上会消失）+ 官方图标，圆心压圆周 45°，只在花名册混合两种以上后端时使用；锁 > 需要你 > 角标，实时连接的角标环变 `good`，不再另加绿点 |
| `Bubble` | 颜色来自 `useChatSurfaces()`（线程底面）：Agent 左对齐白底 `ink` 字，用户右对齐实色白字；`joinsOlder` / `joinsNewer` 由时间线给出，挂靠侧合并圆角，组末一条带尾巴（描边材质不画尾巴）；消息自己的附件跟在气泡后时气泡按「后面还有」处理；Markdown 渲染沿用现有 `chatMarkdown` |
| `ServicePill` | 居中半透明胶囊（`components/chat`）：`caption`、白字、上下 3 / 左右 10、全圆；日期用 600；可点的末尾带 14 右箭头；`busy` 在图标位转圈，`trailing` 放较淡的用时；`bad` 为失败红 |
| `ToolActivityPill` | 工具过程只有三种胶囊：运行中（转圈 +「正在运行 `命令`」+ 用时，每秒刷新）、完成摘要（「运行了 6 个命令，读了 1 个文件 · 38 秒」，最多两类，否则「用了 N 个工具」）、失败（红色「`命令` 失败」，单独一颗）；点任一颗打开 `WorkRecordSheet` |
| `WorkRecordSheet` | 「工作记录」弹层：本轮提示词下的全部工具调用，一步一行（36 图标井、名称、等宽的命令 / 路径 / 查询、状态、用时），标题下写总用时 · 步数；点一步推入 `ToolDetailModal` 看完整输入输出，关掉回到记录。输入里写了这一步做什么（`title` / `description` / `summary`，如 Codex `js` 的 title、Claude Code Bash 的 description）时，这句话当主行，工具名和命令 / 路径放到下面一行；详情弹层标题、没有命令或路径可显示的运行中 / 失败胶囊也用它（2026-10-02 负责人反馈：Codex 工具全叫「js」）。命令摘要去掉 Codex 套在外面的 `/bin/zsh -lc "…"`，详情里的原始输入不变 |
| `SystemEventRow` | 居中，`caption inkSecondary`，前置 Lucide 14；可点带右箭头；线程里只剩消息附件的文件条（卡片色底） |
| `RunCard` | `surface` 底（线程里为卡片色，壁纸上即白色）、圆角 16、标题 `secondary 600`、说明 `caption`、右箭头；线程里只剩子 Agent 运行 |
| `CronDigest` | 相邻的定时任务结果合成一条 Agent 气泡（A+）：强调色日历图标 +「定时任务」，一任务一行（绿勾 / 红色警示 + 红字状态 / 灰色跳过，右侧 12 号时间），点一行打开执行记录；有失败时气泡下挂「看日志 / 重跑」；同一天的结果之间不插时间胶囊 |
| `InlineKeyboard` | 消息下挂按钮（Telegram 内联键盘）：高 44、圆角 14、间距 4、15/600；普通按钮为胶囊色底，消息要你做的那个为实色强调色；进行中原地转圈，禁用 55% |
| `ApprovalCard` | A+（2026-09-30 晚）起为 Agent 的气泡 + 下挂按钮：气泡占行宽 88%、带尾巴，类别图标放进 28 圆 `warnSoft` 井，标题 15/600，命令块用 `well` 色，说明灰字；气泡下 `InlineKeyboard`「拒绝 / 允许」（允许为实色强调色，长按 = 总是允许）；处理完只留标题、结果和命令。以下为 2026-09-30 上午方案 B 的原配方：`surface` 底、圆角 16、内边距 16，不带状态竖条；标题行 = 类别图标（命令 `Terminal`、改文件 `FilePenLine`、网络 `Globe`、权限 `Shield`、设备 / 节点配对 `MonitorSmartphone` / `Server`，16 `inkSecondary`）+ `secondary 600` 标题；命令放进 `surfaceFloating` 命令块（圆角 10，等宽 13/20，iOS 用 Menlo），长命令先显示三行、点整块展开；说明 `secondary inkSecondary`；底部两颗 44 高胶囊：主 `ink` 底白字、次 `surfaceFloating`；等待确认时只在按下的那颗里转圈；提交失败换成 `bad` 图标 + 一句提示；处理完收成「标题 + 右侧结果（已允许 / 已拒绝 / 已过期）+ 命令」，不留按钮 |
| `Composer` | 安静底色与统一 40pt 按钮视觉 / 44pt 点击区域；输入自动增高到五行，第三行出现展开按钮；全屏编辑保留同一个原生输入框、草稿与光标，附件归入输入区；发送 / 停止使用无浮动阴影的 ink 主操作。2026-09-06 按负责人授权升级，详见 `16-composer-upgrade.md`。 |
| `Sheet` | 底部弹层，圆角 20，`surface` 底，把手 36×4 `line`；背景压暗 40%；320 ms 推上 |
| `SettingsGroup` / `SettingsRow` | 白卡圆角 14；行高 52，标题 `name 400`（17/400）、副标题 `caption`、右箭头 / 锁；行间 `line` 发丝线，首尾无线 |
| `RosterRow` | 见 `04` §2；无边框；按下 `surface` 底 120 ms |
| `Skeleton` | `surface` 底的圆角块，1.2 s 呼吸；用于全部加载态 |
| `Banner` | 产品消息横幅（宽限期、Pro、不支持、Bridge 升级），`warnSoft` / `badSoft` 底，`caption`，右侧文字动作；不再承载连接状态 |
| `ConnectionStatusPill` | 连接状态胶囊（2026-09-16 负责人要求）：40pt `surface` 胶囊（`inline`，放在页头中央或列表头）或悬浮版（`floating`，`surfaceFloating` + 浮起阴影），`caption` 文案 + 一个 600 动作词，整颗胶囊即 44pt 点击区；重连中呼吸文字、无动作；离线 `WifiOff`、错误红色 `CircleAlert`，底色保持中性。永不占布局高度：Roster 用页头空置中央，标题页由标题让位，Thread 悬浮在时间线顶部 |

删除：`Card` 的 `tone` 变体、`IconButton`（迁完后）、`CircleButton`（并入 FloatingButton）、`ModalSheet`（并入 Sheet）、`SegmentedTabs` 若只剩面板使用则保留为 `Segmented`。

## 6. 动效

| 场景 | 值 |
|---|---|
| 时长 | 120 / 200 / 320 ms，`easeOut` |
| 按下 | 浮动按钮缩放 0.96；行换底色；气泡无 |
| 发送 | 自己的气泡从输入框飞入：X、Y 各走一条曲线，300 ms；起点偏向起始侧 118、向下 148，从 0.94 倍、35% 不透明度长到原样（A+ 动效稿，2026-09-30 定稿） |
| 回复 | 上移 8，200 ms，ease-out，全程不透明 |
| 按钮互换 | 发送 / 停止 / 麦克风互换时从 0.6 倍放大并淡入，150 ms；消息发出途中先显示变暗、不可点的停止 |
| 头部状态 | 状态句变化时淡入并上移 4，200 ms；工作环 / 等待环淡入淡出 200 ms；工作时强调色 1/4 弧 1.4 s 转一圈，等你批准时琥珀色整环呼吸 |
| 运行步骤 | 运行中胶囊换新步骤时，文字从下方 6 滑入，160 ms；首个步骤和计时不动 |
| 触感 | 发送轻触；在看的对话回复完成 Success；失败、出错、新的命令审批 Warning；流式中、取消、后台不振 |
| 面板 / 付费墙 | 320 ms 从底部推上 |
| 切换会话 | 线程内容交叉淡入 200 ms，不整页推入 |
| 减动效 | 全部改为无位移淡入淡出：发送气泡原地淡入，回复直接出现，按钮和步骤原地淡入；状态环和转圈静止 |

## 7. 双端一致

- iOS 阴影用 shadow 属性；Android 用 `elevation: 2` 并叠 4% 描边补观感。
- 状态栏透明、内容通顶；两端相同安全区处理；Android 底部手势区留 16。
- 头部遮罩用渐变（`expo-linear-gradient` 若未安装则用两层 View），不用模糊；`expo-blur` 只留给付费墙背景压暗。
- 按下反馈统一用 `Pressable` 的 style 函数，不用 `android_ripple`。

## 8. 设计系统检查

- `scripts/check-ui-style.mjs` 新规则：业务文件不得含 `borderWidth` 于列表行组件；不得出现 emoji 字面量作为图标；不得引用被删除的 token。
- `ui-style-baseline.json` 在 M5 结束时应显著低于基线且只允许下降。
- `apps/mobile/docs/design-system.md` 按本章重写（删除 YouMind 借鉴段落）。

## 9. 文案与层级预算（硬规则，M5 完成标准之一）

Grok Bot 清爽的根源不是留白，而是**每个界面只有两层字**：一层主文字，一层灰色辅文字，其余信息靠位置、图标、颜色点表达。本节把它写成可检查的规则。

| 规则 | 内容 |
|---|---|
| 两层 | 任何页面默认可见的文字只用两档字阶（不含用户内容与消息正文）。第三档只允许出现在展开态、详情页或付费墙 / 引导的标题。 |
| 无描述 | 行、卡片、按钮、开关下方不放解释性副标题。功能靠名字和位置自明；需要解释的用「?」进帮助页。 |
| 无装饰标签 | 不用文字标签表达类型、状态、来源。状态用 6pt 颜色点，类型用分组或 16pt 图标；来源不写文字，只由头像表达：产品型 Agent 的脸就是官方图标，花名册混合两种以上后端时有自己头像的 Agent 带官方角标（2026-09-27 负责人决定）。允许的文字徽标只有两种：未读数字、「Pro」锁。 |
| 尾值不叙述 | 设置行右侧只放一个值：数字、名字、状态词或锁图标；不放句子（「105 · 发现更多」这类禁止）。 |
| 一句话 | 空态、错误态、横幅、系统事件行都是一句话，≤ 16 个汉字 / 8 个英文词，配一个动作词。 |
| 不重复 | 页面标题已表达的信息，不在正文再说一遍；头部胶囊里已有的名字，不在列表里重复。 |
| 分节 | 列表默认不加分节标题；只有分组本身是信息时才加（设置的 Agent 组 / 连接组），分节标题用 `secondary`，不用全大写。会话面板不分节：Agent 靠头部胶囊切换，来源靠行首图标与渠道 chip。 |
| 筛选 | 筛选 chip 最多 3 个，且列表不超过一屏时不显示。例外：会话面板的渠道 chip 一排按渠道数量生成、横向可滑，只有主会话时不显示（2026-09-11 产品负责人决定）。 |
| 按钮 | 主按钮文案 ≤ 6 个汉字（付费墙允许带价格）；一屏最多一个主按钮。 |

每屏预算（默认态可见文字，不含用户内容）：

| 页面 | 允许的两档 | 例外 |
|---|---|---|
| 花名册 | 名字（body 600）+ 预览 / 时间（secondary / caption） | 徽标数字 |
| 线程 | 消息正文（body）+ 系统事件 / 时间（secondary / caption） | 头部胶囊名字下的一行是唯一一处头部辅文字：空闲时强调色「在线」、工作时强调色状态句、等你时琥珀色（A+，负责人 2026-09-30 决定；模型与上下文剩余移到模型面板） |
| 会话面板 | 标题（secondary 600）+ 预览 / 时间（caption），比花名册小一档，40pt 头像位定尺度；未读 / 需要你用 6pt `StatusSize.dot` | 头部 Agent 胶囊名字（body 600）、chip 文字（secondary）与数量（caption `inkTertiary`） |
| Agent 设置 / 账户设置 | 行标题（body）+ 尾值（secondary） | 页面标题（title）、身份卡副标题一行 |
| 技能管理（2026-09-13 负责人确认） | 技能名（body 600）+ 一行用途（secondary）+ 独立中性开关 | 88pt 最小行高；缺失项可增加一行 warning 图标/说明；无 Active 重复尾值，发现移至右上角 Compass。 |
| 首启引导 | 标题（display）+ 正文一行（secondary） | 按钮文字 |
| 付费墙 | 标题（display）+ 收益 / 方案（body / secondary） | 法务小字（caption） |

审查方法：M5 每个页面完成后，实现者在 `PROGRESS.md` 里按页面填自检表：使用的字阶档数、是否存在描述性副标题 / 装饰性标签，并用渲染测试断言支撑（快照里 `FontSize` 的取值集合、无 `borderWidth`）；超预算即返工。不做截图。`scripts/check-ui-style.mjs` 加一条：业务屏幕文件里 `FontSize.` 的不同取值 ≤ 3（含标题档）。

## 10. 样张（风格参照，不是像素依据）

`docs/3.0/mockups/index.html` 是花名册、线程、会话面板、Agent 设置四屏的网页草图，用来传达整体气质：白底、浮动控件、方块头像、两层字、颜色只在头像上。**它是手写的 HTML，有简化和错误，不要照着它的 CSS 抄。** 尺寸、圆角、阴影、字号一律以 §2–§5 的 token 表和 §11 的 youmind-mobile 组件为准；两者冲突时以 token 与组件为准。

## 11. 自绘导航与组件：从 youmind-mobile 抄什么

原则：**页面级的返回、关闭、标题、Tab、弹层、搜索框全部自绘，不用系统原生控件**（不用原生导航栏按钮、不用系统 `Alert` 以外的原生弹窗、不用系统 segmented control）。youmind-mobile（`/Users/developer/Desktop/youmind/youmind-mobile/apps/mobile`）已经有一套经过打磨的实现与规范，直接移植，改 token 不改结构。先读它的 `docs/design-system.md` §4–§11 与 `AGENTS.md` 的组件决策表。

| Clawket 3.0 组件 | 移植自 youmind-mobile | 要点 |
|---|---|---|
| `FloatingButton`（44 圆形按钮） | `src/components/ui/ActionButton.tsx`（`variant="icon"`，44×44，22pt 图标） | 页面头部的返回 / 关闭 / 会话按钮、弹层头部的关闭与右侧按钮、页头右侧动作（聊天、新建、分享）一律 `appearance="plain"` 纯图标，与首页左上用户、右上搜索同一大小和风格（2026-09-27 负责人决定，取代 2026-09-19 的白底浮起圆钮和弹层灰底圆钮）；壁纸上用 `glass`；按下态保留；阴影换成 `shadowFloating`；返回箭头用 `DirectionalChevronLeft`，不用系统返回 |
| 页面头部 | `ScreenHeader` 的对称 44 槽位契约 + 我们的浮动布局 | 所有页面头部由内容拥有且只用 `ScreenHeader`（2026-09-19 统一）：安全区 + 8 / 44 高控件行、左右距屏幕边 16 / 下方 8，内容再空 16；左 44 槽是纯白（暗色为浮起面）的 44 圆形返回或关闭，中标题（或替换标题的连接状态胶囊）以屏幕居中，右 44 槽放唯一的尾部动作；`native-stack` 的 `headerShown: false`，永远不用系统 header。线程页的浮动头部带、搜索页的输入行与引导页 `FlowHeader` 共用同一边距、行高和圆钮 |
| `Segmented`（分组 / 列表等） | `src/components/ui/SegmentedTabs.tsx` 原样移植 | **全圆胶囊**：轨道 `Radius.full`、高 44、下沉底色不描边；选中段抬升底色 + `Shadow.xs`（深色改发丝线）；`FontSize.base`，选中 600；`size="sm"` 为 32 高的紧凑档；`variant="text"` 为文字 Tab。全 App 所有 Tab 统一用它 |
| `Sheet`（会话面板等底部弹层） | `AdaptiveBottomSheetModal` + `SheetHeader` / `SheetDragHandle` / `useSheetBackgroundStyle` + `SheetBackdrop` + `ThemedFullWindowOverlay` | 顶部 chrome 只走这一套：把手、圆角、关闭键 + 居中标题（`titleContent` 可换成会话面板的 Agent 胶囊）；header 行下自带 `Space.md` 留白（内容距 44pt 控件 16pt），body 不再补 `paddingTop`；右上角图标动作统一用 `SheetHeaderButton`（与关闭键同一 quiet 圆形）；等待不改变弹层高度（2026-09-29 负责人反馈 Codex 设置弹层“加载中”一消失就跳）：已显示的内容刷新时照常显示、可点、不变淡、不换骨架屏，后台读取在右上角空位转圈（`SheetHeaderSpinner`，400 ms 内结束不出现），写入在被点的那一行转圈，骨架屏只在该范围第一次拿到结果之前出现；可能超出屏幕的 body 用固定 `snapPoints` + `BottomSheetScrollView` / `BottomSheetFlatList`（详情 68% / 92%、表单 82% / 92%、文档编辑单档 93%），原生竖向 `ScrollView` 在弹层里滚不动、`check:ui-style` 直接拒绝；iPad 自动居中面板 |
| 居中弹窗（二次确认、删除） | `ModalSheet` | 不用系统 `Alert` 做确认；`title` 自带关闭键 |
| `SearchInput` | `src/components/ui/SearchInput.tsx` | 44 高胶囊，`Radius.full`；弹层内传 `inSheet` |
| 文本输入 | `CompositionSafeTextInput` / `CompositionSafeBottomSheetTextInput` / `PasteCapableTextInput` | 中文输入法组合安全；输入框里粘贴图片走 `PasteCapableTextInput` |
| 长文本编辑 | `TextEditorSheet` | 编辑 Agent 人格、记忆文件 |
| 抬升表面的阴影 | `createThemedShadowStyle(colors, scheme, Shadow.tier)` | 浅色柔影、深色发丝线，一处实现，不在业务文件里手写 |
| 主按钮 / 次按钮 | `Button`（`md` 44 高全圆胶囊；`sm` 紧凑；一律不带描边，灰底页面上的次按钮用 `card` 白色胶囊，2026-09-30 负责人决定） | 付费墙、引导、审批卡按钮 |
| 状态页 | `EmptyState`、`LoadErrorState`、`SkeletonPulse` | 一句话 + 一个动作；骨架屏用 `SkeletonPulse` |
| 样式护栏 | `scripts/check-ui-style.mjs` 的规则集与 baseline 机制 | 我们已有同源脚本，按 youmind-mobile 当前版本补齐规则（数值 `borderRadius` / `fontSize` / 非零 `borderWidth` / 硬编码颜色 / `FontSize` 算术 / 错误的 `KeyboardAvoidingView` 来源） |

移植规则：

1. 组件文件整体复制到 `apps/mobile/src/components/ui/`，把它们引用的 token 名映射到 §2 的 token（`surfaceBg → surface`、`raisedBg → surfaceFloating`、`hover → surface`、`subtleBorder → line`、`primary → accent`），不改组件结构与尺寸。
2. youmind-mobile 的 `Radius` 值（`full: 9999`、`sheet: 36`、`bottomSheet: 28`、`xl: 22`）直接采用；我们 §4 里的气泡 20、卡片 16、设置卡 14 是内容圆角，与控件圆角并存。
3. 不移植 YouMind 业务组件（Board、Skill、Task 相关）。
4. 移植后跑 youmind-mobile 同名组件的测试（若有），再跑我们的 `check:design-system`。
