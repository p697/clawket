# 05 · 视觉系统（向 Grok Bot 对齐，双端统一）

## 1. 原则

1. 白底、无导航栏、控件浮在内容上。
2. 无分割线、无卡片边框；靠间距与字号分层。
3. 颜色只给头像；界面只有白、一档浅灰、黑字、灰字；强调色只出现在发送键、选中态、链接、「查看中」、未读点。
4. 一种气泡；系统事件是一行居中小灰字。
5. 状态靠头像表达。
6. 只有 400 / 600 两种字重。
7. 不用 Liquid Glass、SF Symbols、原生 TabBar、Material 涟漪、模糊遮罩、emoji 图标、三个跳动的点、彩色文字、渐变（付费墙英雄图除外）。

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

现有 `accents.ts` 的六种内置强调色保留（id 不变，便于老用户偏好迁移），每种按新色板重新取值并提供浅 / 深两档，通过对比度检查（文字对 canvas ≥ 4.5:1 时才允许作为链接色，否则链接用 ink 加下划线）；`customAccent` 相关代码（`AppProviders`、`useAppBootstrap`、`ThemeProvider`、`storage`）没有对应界面，删除。删除现有 `surfaceMuted / surfaceElevated / primarySoft / info*` 等不再使用的 token，并把 `check-ui-style` baseline 相应下调。

## 3. 字体与字阶（`src/theme/tokens.ts`）

iOS 用系统 SF Pro，Android 用 Roboto，中文走系统 CJK；不引入第三方字体。数字用 `fontVariant: ['tabular-nums']`。**只有五档**，任何页面默认可见的文字只允许用到其中两档。

| 名称 | 字号 / 行高 | 字重 | 用途 |
|---|---|---|---|
| `display` | 28 / 34 | 600 | 付费墙标题、引导标题（每屏最多一个） |
| `title` | 20 / 26 | 600 | 设置类页面标题、面板标题 |
| `body` | 17 / 24 | 400 或 600 | 消息正文、输入框；600 时用于名字、行标题、按钮 |
| `secondary` | 15 / 20 | 400 | 预览、行尾值、系统事件行 |
| `caption` | 13 / 18 | 400 或 600 | 时间、法务小字；600 时用于徽标里的数字 |

删除现有全部中间字阶与 `micro`；`FontSize` 只保留以上五档。

## 4. 形状与间距

| 项 | 值 |
|---|---|
| 栅格 | 4；间距只用 4 / 8 / 12 / 16 / 24 / 32 |
| 气泡圆角 | 20 |
| 浮动按钮 / 胶囊 / 输入框 | 全圆；圆形按钮 44；胶囊高 40 |
| 卡片 | 16 |
| 设置分组卡 | 14；卡内行高 52 |
| 头像 | 花名册 56（圆角 18）；头部胶囊 28（圆角 9）；设置顶行 44（圆角 14）；面板行 32（圆角 10） |
| 花名册行 | 高 88；横向内边距 16；头像与文字间距 14 |
| 线程 | 同一发言者气泡间距 6；不同发言者 16；系统事件行上下 12；气泡最大宽 82% |
| 页面横向内边距 | 16 |
| 浮动头部 | 顶部安全区 + 8；下方 24 渐变遮罩 |

## 5. 组件配方（`src/components/ui`）

| 组件 | 规格 |
|---|---|
| `FloatingButton` | 44 圆，`surfaceFloating` + `shadowFloating`，Lucide 图标 22 / 1.75 描边、`ink`；按下缩放 0.96；可带徽标（accent 点或 bad 数字） |
| `HeaderPill` | 高 40 全圆，`surfaceFloating` + 阴影，内容：头像 28 + 名字 `name` + 副标题 `caption inkSecondary`；副标题变化用 100 ms 淡入淡出（沿用现有头部动画） |
| `AgentAvatar` | 圆角方块，底色 `agentPalette[hash]`，内容 emoji（若有）或 1–2 字首字母（白，600）；状态环：`working` = 右下小型静态活动标记（三条短竖线），不旋转头像外轮廓（2026-09-06 用户验收修订）；`attention` = 右下 12 圆点 `warn` / `bad` 带 2pt canvas 边；`done` = 右下 `good` 圆点 3 s 后淡出；`offline` = 整体去饱和 60%；`locked` = 去饱和 + 右下锁 |
| `Bubble` | 助手：`surface` 底、`ink` 字、圆角 20、左对齐；用户：`accentSoft` 底、`ink` 字、右对齐；Markdown 渲染沿用现有 `chatMarkdown` |
| `SystemEventRow` | 居中，`caption inkSecondary`，前置 Lucide 14；可点带右箭头 |
| `RunCard` | `surface` 底、圆角 16、左 3pt 状态色竖条（accent / bad / warn）、标题 `secondary 600`、说明 `caption`、右箭头 |
| `ApprovalCard` | 同 RunCard 外形 + 命令预览（等宽 13）+ 底部两颗胶囊：主 `ink` 底白字、次 `surfaceFloating`；过期态整体 60% |
| `Composer` | 安静底色与统一 40pt 按钮视觉 / 44pt 点击区域；输入自动增高到五行，第三行出现展开按钮；全屏编辑保留同一个原生输入框、草稿与光标，附件归入输入区；发送 / 停止使用无浮动阴影的 ink 主操作。2026-09-06 按负责人授权升级，详见 `16-composer-upgrade.md`。 |
| `Sheet` | 底部弹层，圆角 20，`surface` 底，把手 36×4 `line`；背景压暗 40%；320 ms 推上 |
| `SettingsGroup` / `SettingsRow` | 白卡圆角 14；行高 52，标题 `name 400`（17/400）、副标题 `caption`、右箭头 / 锁；行间 `line` 发丝线，首尾无线 |
| `RosterRow` | 见 `04` §2；无边框；按下 `surface` 底 120 ms |
| `Skeleton` | `surface` 底的圆角块，1.2 s 呼吸；用于全部加载态 |
| `Banner` | 顶部横幅，`warnSoft` / `badSoft` 底，`caption`，右侧文字动作 |

删除：`Card` 的 `tone` 变体、`IconButton`（迁完后）、`CircleButton`（并入 FloatingButton）、`ModalSheet`（并入 Sheet）、`SegmentedTabs` 若只剩面板使用则保留为 `Segmented`。

## 6. 动效

| 场景 | 值 |
|---|---|
| 时长 | 120 / 200 / 320 ms，`easeOut` |
| 按下 | 浮动按钮缩放 0.96；行换底色；气泡无 |
| 新消息 | 淡入 + 上移 4，120 ms |
| 头像状态环 | 1.2 s 循环；done 3 s 淡出 |
| 面板 / 付费墙 | 320 ms 从底部推上 |
| 切换会话 | 线程内容交叉淡入 200 ms，不整页推入 |
| 减动效 | 全部改为无位移淡入淡出；状态环静止 |

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
| 无装饰标签 | 不用文字标签表达类型、状态、来源。状态用 6pt 颜色点，类型用分组或 16pt 图标，来源不显示。允许的文字徽标只有两种：未读数字、「Pro」锁。 |
| 尾值不叙述 | 设置行右侧只放一个值：数字、名字、状态词或锁图标；不放句子（「105 · 发现更多」这类禁止）。 |
| 一句话 | 空态、错误态、横幅、系统事件行都是一句话，≤ 16 个汉字 / 8 个英文词，配一个动作词。 |
| 不重复 | 页面标题已表达的信息，不在正文再说一遍；头部胶囊里已有的名字，不在列表里重复。 |
| 分节 | 列表默认不加分节标题；只有分组本身是信息时才加（会话面板的 Agent 分组、设置的 Agent 组 / 连接组），分节标题用 `secondary`，不用全大写。 |
| 筛选 | 筛选 chip 最多 3 个，且列表不超过一屏时不显示。 |
| 按钮 | 主按钮文案 ≤ 6 个汉字（付费墙允许带价格）；一屏最多一个主按钮。 |

每屏预算（默认态可见文字，不含用户内容）：

| 页面 | 允许的两档 | 例外 |
|---|---|---|
| 花名册 | 名字（body 600）+ 预览 / 时间（secondary / caption） | 徽标数字 |
| 线程 | 消息正文（body）+ 系统事件 / 时间（secondary / caption） | 头部胶囊的一行灰字（模型 · 上下文剩余）是产品负责人指定保留的唯一一处头部辅文字 |
| 会话面板 | 标题（body 600）+ 时间（caption） | 分组标题（secondary） |
| Agent 设置 / 账户设置 | 行标题（body）+ 尾值（secondary） | 页面标题（title）、身份卡副标题一行 |
| 首启引导 | 标题（display）+ 正文一行（secondary） | 按钮文字 |
| 付费墙 | 标题（display）+ 收益 / 方案（body / secondary） | 法务小字（caption） |

审查方法：M5 每个页面完成后，实现者在 `PROGRESS.md` 里按页面填自检表：使用的字阶档数、是否存在描述性副标题 / 装饰性标签，并用渲染测试断言支撑（快照里 `FontSize` 的取值集合、无 `borderWidth`）；超预算即返工。不做截图。`scripts/check-ui-style.mjs` 加一条：业务屏幕文件里 `FontSize.` 的不同取值 ≤ 3（含标题档）。

## 10. 样张（风格参照，不是像素依据）

`docs/3.0/mockups/index.html` 是花名册、线程、会话面板、Agent 设置四屏的网页草图，用来传达整体气质：白底、浮动控件、方块头像、两层字、颜色只在头像上。**它是手写的 HTML，有简化和错误，不要照着它的 CSS 抄。** 尺寸、圆角、阴影、字号一律以 §2–§5 的 token 表和 §11 的 youmind-mobile 组件为准；两者冲突时以 token 与组件为准。

## 11. 自绘导航与组件：从 youmind-mobile 抄什么

原则：**页面级的返回、关闭、标题、Tab、弹层、搜索框全部自绘，不用系统原生控件**（不用原生导航栏按钮、不用系统 `Alert` 以外的原生弹窗、不用系统 segmented control）。youmind-mobile（`/Users/lucy/Desktop/youmind/youmind-mobile/apps/mobile`）已经有一套经过打磨的实现与规范，直接移植，改 token 不改结构。先读它的 `docs/design-system.md` §4–§11 与 `AGENTS.md` 的组件决策表。

| Clawket 3.0 组件 | 移植自 youmind-mobile | 要点 |
|---|---|---|
| `FloatingButton`（44 圆形按钮） | `src/components/ui/ActionButton.tsx`（`variant="icon"`，44×44，22pt 图标） | 保留 `appearance="quiet"`（在已抬升的表面内用）与按下态；阴影换成 `shadowFloating`；返回箭头用 `DirectionalChevronLeft`，不用系统返回 |
| 页面头部 | `ScreenHeader` 的对称 44 槽位契约 + 我们的浮动布局 | 所有页面头部由内容拥有：左 44 槽、中标题或胶囊、右 44 槽；`native-stack` 的 `headerShown: false`，永远不用系统 header |
| `Segmented`（分组 / 列表等） | `src/components/ui/SegmentedTabs.tsx` 原样移植 | **全圆胶囊**：轨道 `Radius.full`、高 44、下沉底色不描边；选中段抬升底色 + `Shadow.xs`（深色改发丝线）；`FontSize.base`，选中 600；`size="sm"` 为 32 高的紧凑档；`variant="text"` 为文字 Tab。全 App 所有 Tab 统一用它 |
| `Sheet`（会话面板等底部弹层） | `AdaptiveBottomSheetModal` + `SheetHeader` / `SheetDragHandle` / `useSheetBackgroundStyle` + `SheetBackdrop` + `ThemedFullWindowOverlay` | 顶部 chrome 只走这一套：把手、圆角、关闭键 + 居中标题；iPad 自动居中面板 |
| 居中弹窗（二次确认、删除） | `ModalSheet` | 不用系统 `Alert` 做确认；`title` 自带关闭键 |
| `SearchInput` | `src/components/ui/SearchInput.tsx` | 44 高胶囊，`Radius.full`；弹层内传 `inSheet` |
| 文本输入 | `CompositionSafeTextInput` / `CompositionSafeBottomSheetTextInput` / `PasteCapableTextInput` | 中文输入法组合安全；输入框里粘贴图片走 `PasteCapableTextInput` |
| 长文本编辑 | `TextEditorSheet` | 编辑 Agent 人格、记忆文件 |
| 抬升表面的阴影 | `createThemedShadowStyle(colors, scheme, Shadow.tier)` | 浅色柔影、深色发丝线，一处实现，不在业务文件里手写 |
| 主按钮 / 次按钮 | `Button`（`md` 44 高全圆胶囊；`sm` 紧凑） | 付费墙、引导、审批卡按钮 |
| 状态页 | `EmptyState`、`LoadErrorState`、`SkeletonPulse` | 一句话 + 一个动作；骨架屏用 `SkeletonPulse` |
| 样式护栏 | `scripts/check-ui-style.mjs` 的规则集与 baseline 机制 | 我们已有同源脚本，按 youmind-mobile 当前版本补齐规则（数值 `borderRadius` / `fontSize` / 非零 `borderWidth` / 硬编码颜色 / `FontSize` 算术 / 错误的 `KeyboardAvoidingView` 来源） |

移植规则：

1. 组件文件整体复制到 `apps/mobile/src/components/ui/`，把它们引用的 token 名映射到 §2 的 token（`surfaceBg → surface`、`raisedBg → surfaceFloating`、`hover → surface`、`subtleBorder → line`、`primary → accent`），不改组件结构与尺寸。
2. youmind-mobile 的 `Radius` 值（`full: 9999`、`sheet: 36`、`bottomSheet: 28`、`xl: 22`）直接采用；我们 §4 里的气泡 20、卡片 16、设置卡 14 是内容圆角，与控件圆角并存。
3. 不移植 YouMind 业务组件（Board、Skill、Task 相关）。
4. 移植后跑 youmind-mobile 同名组件的测试（若有），再跑我们的 `check:design-system`。
