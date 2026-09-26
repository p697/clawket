# Claude Code Desktop / CLI 接入调研

日期：2026-09-26。范围：研究、竞品源码阅读、本机只读探测；尚未授权产品实现。本轮补充并修正早先 `codex-claude-integration-feasibility-2026-09-26.md` 的项目与会话建议。Owner 明确要求同时考虑 Claude 桌面版和 CLI，不能只为其中一种设计。

## 结论

值得接。Claude Code 的项目、原生历史和运行状态有可用接口，本机已验证；“没有 Codex App Server，所以只能新建孤立聊天”是不成立的。首选官方 Agent SDK 驱动本机未修改的 Claude Code，复用 Clawket 的项目筛选、聊天、工具展示和结构化提问 UI。

但三种能力必须区分：**发现原会话、恢复已释放的原会话、控制仍由桌面版或终端持有的原会话**。前两者有明确技术路径，第三种不能把 `resume` 当成 attach，更不能把 `idle` 当成已经释放所有权。当前未找到面向第三方、覆盖任意既有 Desktop 会话的稳定公开控制接口。研究结果不构成“已支持桌面端无缝接管”的承诺。

## 本机证据

| 项目 | 本轮结果 |
| --- | --- |
| 独立终端 CLI | `~/.local/bin/claude`，2.1.280；未升级 |
| Desktop 使用的内置 Claude Code | 运行进程路径中的版本为 2.1.281；不替换、不复用其认证令牌 |
| 调研时 npm / 官方 changelog 最新 CLI | 2.1.283 |
| 单独下载的官方 TypeScript SDK | 0.3.283；未加入仓库依赖、未安装竞品运行时 |
| CLI 认证状态 | `loggedIn: false`、`authMethod: none`；只代表当前 shell 的独立 CLI |
| Desktop UI | 实际查看 Code 页，存在项目分组、运行中与空闲会话，账号显示 Max；未向现有任务发送消息 |
| SDK 原生会话发现 | `listSessions({ includeProgrammatic: false, limit: 250 })` 返回 111 条，均有 cwd；其中 110 条 metadata entrypoint 为 `claude-desktop`，1 条为 `cli` |
| 项目目录 | 上述会话归属 6 个 cwd，5 个仍存在；失效目录不应造成历史消失或静默改 cwd |
| 项目筛选 / 历史 | 精确项目筛选的 5 条样本 cwd 全匹配；官方 `getSessionMessages` 成功读取 8 条原生历史样本，只保留类型和计数 |
| 程序化会话 | 开启 `includeProgrammatic` 后第一页达到 500 条上限；500 不是总量。产品不能无差别把 SDK/测试会话都放进最近聊天 |
| 实时状态 | `claude agents --json --all` 成功返回 3 个 interactive 会话，2 idle / 1 busy；3 个 sessionId 均匹配 Desktop 原生 transcript |
| Desktop 额外索引 | 本机 `~/Library/Application Support/Claude/claude-code-sessions/` 下找到 107 条含 `cliSessionId` 的 metadata，全部对应本机 transcript，含 title、cwd、originCwd、归档字段；这是内部存储格式，不是官方稳定 API |
| 已保存的项目配置 | `~/.claude.json` 有 16 个项目键；与 Desktop 可见项目不完全一致，不能声称这个配置就是完整桌面项目注册表 |

本轮聚合证据保存在本机私有目录 `~/.clawket/testing/claude-feasibility-20260926/`。不把会话标题、正文、ID、账号或令牌写入仓库。发现/筛选/历史的组合探测约 0.64 秒，实时状态查询约 0.26 秒，仅为单机单次探测，不是移动端性能承诺。

**未验证项**：本轮没有真实模型推理、手机消息、原会话写入、Desktop 双端实时续聊或 hooks 交接验收。早先报告的 SDK 初始化/模型目录探测也不等于真实推理。独立 CLI 需要走用户自己的原生登录或 API/provider 配置，不能因为 Desktop 已登录就提取其凭据填给 SDK。检查期间另有 Xcode 构建及其他工作在进行，本轮没有启动测试套件或额外模型运行进程。

## 官方能力及限制

### 项目与历史

官方 SDK 提供 `listSessions`、`getSessionInfo`、`getSessionMessages`、`forkSession`、`renameSession` 等。`listSessions` 可跨项目、分页，按目录过滤时可包含 git worktrees；数据通常在 `~/.claude/projects/`，也支持指定配置目录。项目可以从 cwd 聚合，无须先有单独的 Projects API。不要反解编码后的目录名来猜原路径。[官方会话文档](https://code.claude.com/docs/en/agent-sdk/sessions)

建议来源优先级：SDK 会话 cwd + 官方运行态 cwd；Desktop 的 originCwd/title/归档信息作为版本化、只读的增强；保存配置只作为补充。没有历史的项目、额外配置目录、SSH/WSL/云端项目，需要显式来源和目录选择，不能用本机扫描冒充覆盖。Desktop Code、普通 Claude Chat、Cowork、云端 Projects 是不同范围；首期讨论对象是本机 Code 会话。

### 对话与执行

官方 SDK `query()` 接收流式输入，输出文字增量、工具调用/结果、状态及结果；支持 cwd、按 ID resume/fork、中断、模型选择、权限模式、MCP、hooks、skills 和项目指令。保持一个受控输入流，不为每条手机消息重启进程；断线恢复依赖持久化记录和明确消息状态，不能盲重发。

`settingSources` 在当前 SDK 中省略时默认读取 user/project/local；旧资料声称默认空数组已过时。显式保留用户项目指令与配置，控制权限，不覆盖其 hooks；MCP consent、桌面连接器和内置工具仍需单独对齐。用 `systemPrompt: { type: 'preset', preset: 'claude_code' }` 明确选择编码代理行为。当前 TypeScript V2 `createSession/send/stream` 已移除，不能依旧教程选型。[配置文档](https://code.claude.com/docs/en/agent-sdk/claude-code-features)、[SDK 会话 API](https://code.claude.com/docs/en/agent-sdk/sessions)

2.1.283 的官方变更中包括 SDK 工具结果/审批恢复、MCP 生命周期和首请求延迟修复。因此未来应固定已验证的 SDK 版本，并探测用户 CLI 版本/运行时能力，不能依赖用户恰好安装同一版；本轮未升级用户 CLI。[官方 changelog](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)

### 审批和 AskUserQuestion

`canUseTool` 可以处理权限询问和 `AskUserQuestion`。问题支持多题、单选/多选和自由回答；返回原始 questions 与按 question 文本映射的 answers，不能直接照搬 Codex 的问题 ID 线协议。手机内部可用稳定 ID，但需保留后端原始映射。`ExitPlanMode` 应展示计划、批准或提出修改，批准计划不等于永久放开权限。[用户输入文档](https://code.claude.com/docs/en/agent-sdk/user-input)

`canUseTool` 不是每个工具都会必经的总拦截器：先有原生规则、权限模式和 hooks。遵守已有拒绝规则，不把“本会话允许”升格为永久权限。还要处理 MCP elicitation 和新版 SDK 的 `onUserDialog` / `supportedDialogKinds`，仅声明真正能渲染的 dialog。中断、过期、另一设备回答后必须及时撤销待答卡片。[权限文档](https://code.claude.com/docs/en/agent-sdk/permissions)、本轮下载 SDK 的 `sdk.d.ts`

### 运行中的会话

`claude agents --json` 是官方推荐的外部状态查询，包含 interactive/background、cwd、sessionId、busy/idle/waiting，以及等待权限或输入的原因。应优先使用它，而非把 transcript 修改时间猜成运行状态。`claude attach` 供终端附着后台会话；它不等于可给 Clawket 使用的结构化远程聊天接口。[Agent view](https://code.claude.com/docs/en/agent-view)

Desktop 与 CLI 共用不少配置和原生 transcript，但各有会话列表。Desktop 的 GUI、连接器、浏览器/电脑使用能力不一定随一个 SDK resume 迁移；同一 sessionId 也不证明桌面 UI 正确实时更新。发现活跃原 owner 时应保留所有权，不能再开一个进程写同一会话。没有查到 owner、owner 正在 idle、确认 owner 已释放，是三个不同状态。[Desktop 文档](https://code.claude.com/docs/en/desktop)

### Channels 和官方 Remote Control

Channels 能通过 MCP 向当前运行会话推送事件，支持回复工具和工具审批转发；桌面与手机先回答的一方生效。但仍处 research preview，自定义 channel 默认不在允许名单，要开发旗标或组织授权；仅支持 Anthropic 认证，不覆盖所有第三方 provider。审批转发也不是完整 AskUserQuestion/项目信任/全部对话框接口。适合验证原 owner 下的补充交互，不适合首期唯一主链路。[Channels](https://code.claude.com/docs/en/channels)、[Channels reference](https://code.claude.com/docs/en/channels-reference)

官方 Remote Control 面向 Claude 官方网页/手机，当前需要订阅，API key、自定义代理与部分云 provider 不适用。SDK 包中虽有 alpha `/bridge` 导出，但面向 Anthropic ingress/worker 会话，不是任意本机 Desktop 进程的 attach API。不要因为名字叫 bridge 就推断可以直接接 Clawket Relay。[Remote Control](https://code.claude.com/docs/en/remote-control)

## 竞品源码对照

GitHub 数字是 2026-09-26 的公开快照，不能换算为活跃用户、下载量或收入。本轮读源码和商店信息，没有安装竞品或做其真机完整测评。

| 产品 | 市场证据 | 接入实现与值得参考的部分 |
| --- | --- | --- |
| [Happy](https://github.com/slopus/happy) | 23,914 stars；9 月 22 日有 push；[美区 App Store](https://apps.apple.com/us/app/happy-codex-claude-code-app/id6748571505) 4.9 / 约 1K ratings；MIT | 官方 SDK；本地 TUI 包装器 + SessionStart hook + transcript scanner。远程消息触发本地进程退出，再恢复到远程模式；不是透明附着任意已有 CLI。结构化审批和提问已适配。 |
| [Happier](https://github.com/happier-dev/happier) | 1,730 stars；当天活跃；[美区 App Store](https://apps.apple.com/us/app/happier-remote-claude-codex/id6758554297) 4.5 / 11 ratings；MIT | 默认 Agent SDK 路线，也保留 legacy 实现；原生历史发现、延迟读取标题、等待安全回合边界交接、提问和审批失效处理。实验性本地 permission bridge 使用 PermissionRequest + PreToolUse(AskUserQuestion)。 |
| [Hapi](https://github.com/tiann/hapi) | 5,128 stars；9 月 25 日有 push；AGPL-3.0；仓库含原生 iOS/Android，不据此声称已确认商店发行 | Happy 衍生的 local/remote 生命周期，scanner 与 local permission bridge；提问答案写入 updatedInput，原生标题同步。可研究设计，不直接搬 AGPL 代码。 |
| [Paseo](https://github.com/getpaseo/paseo) | 18,587 stars；当天活跃；[App Store](https://apps.apple.com/us/app/paseo-remote-coding-agents/id6758887924) 已上架；主许可证 Apache-2.0，第三方部分另计 | 本地 daemon + 多端客户端；Claude query 层直接调用官方 SDK，负责流、resume、取消与计划批准。其 Git/worktree/插件工作台范围明显大于我们的首期。 |

Happy 和 Happier 完整 shallow checkout 放在仓库外 `../references/`，只作阅读。Hapi 的完整 checkout 下载停滞，已停止本轮 clone 进程，改为按固定提交下载关键源文件；Paseo 同样按提交读取关键文件。

固定源码锚点：

- Happy `8517ab232528a6046271d6010aaed663e1187dfc`：`packages/happy-cli/src/claude/{claudeLocalLauncher.ts,sdk/query.ts,utils/permissionHandler.ts}`。
- Happier `9047258b99545a8ce84923789c87945fcaeb1e69`：`apps/cli/src/backends/claude/{directSessions/listClaudeSessionCandidates.ts,remote/claudeRemoteAgentSdk.ts,utils/generateHookSettings.ts,localPermissions/localPermissionBridge.ts}`；`apps/cli/src/agent/localControl/turnLifecycle/createDeferredRemoteSwitchController.ts`。
- Hapi `86c88df93baf5d1f738dd4b202078bdf6dec376e`：`cli/src/claude/{claudeLocalLauncher.ts,claudeRemote.ts,utils/localPermissionBridge.ts}`。
- Paseo `513f2a9ea2e0709fec1f41d61785ce5d9654a535`：`packages/server/src/server/agent/providers/claude/{query.ts,agent.ts}`。

不能原样照抄旧兼容逻辑：例如 Happier 的部分旧注释仍写 SDK 默认不读 settingSources，当前官方行为已变；Happy 为让 SDK 会话出现在原生 resume picker 中设置 entrypoint，也说明“手机创建后回电脑继续”必须验收，不能只看 transcript 已落盘。

## 对 Clawket 的建议边界（待讨论）

同一个 Claude Code 后端、一次设备配对，两种原生来源 Desktop/CLI。沿用最近聊天 + 项目筛选 + 显式 cwd，新建会话和原生会话自然同列。路径沿用已打磨的顶部副标题，不另加工作台。来源与控制状态只在有必要时提示。

| 场景 | 建议承诺 |
| --- | --- |
| 本机 Desktop / CLI 原生项目和历史 | 首期必做；本轮已验证数据路径，补齐重命名、失效目录、worktree 和分页边界 |
| 手机新建及 Clawket 管理的会话 | 完整流式聊天、工具、停止、模型/模式、提问、审批和重连 |
| 已结束且原进程释放的会话 | 显式原会话继续；保留 cwd 和实际配置，Desktop 往返需单独验收 |
| Clawket 包装器启动的 CLI | 可设计可靠终端/手机交接；等待当前轮结束，临界区只保留一个 owner |
| 任意已运行的原生 CLI | 可发现、读历史和状态；增强需安装/启用 hooks 或进入受管生命周期，不能假装立即可写 |
| 任意已运行的原生 Desktop | 可发现、读历史和状态；普通消息、审批、提问分别验证。尚不承诺完整实时控制，不能用 fork 冒充原会话 |
| Claude Chat / Cowork / 云端会话 | 不是本机 Code SDK 覆盖范围，不混入首期承诺 |

CLI 的可选启动入口可以是 `clawket claude` 之类（仅为提案，尚未实现）。发现历史不应强迫所有用户改启动习惯；只有需要终端/手机可靠交接时解释启用增强连接的作用。

适合我们的优势：配对后立即看到原来的工作；手机回复不打断电脑当前一轮；权限、选择题和计划批准不漏掉；断线后知道消息究竟有没有发送；模型名称和工作目录保持克制。Git 管理、代码编辑器、终端模拟、团队调度和复杂 worktree 操作不纳入首期。

## 实施前最有价值的验证顺序

1. **先验证 Desktop/CLI 连续性**：各建立一个专用 QA 会话；完成项目发现、历史映射、当前 cwd、原会话释放后继续及返回原 UI。尤其验证 Desktop 是否展示新增记录，不能以 SDK 成功返回代替双端验收。
2. **验证正在运行的原 owner**：分别验证观察、手机普通消息、审批、AskUserQuestion；若只能通过 hooks/channel 完成部分能力，就如实限制并继续寻找公开可维护路径，不自动停止用户进程。
3. **受管会话闭环**：真实模型的文本/图片、文件编辑、命令批准/拒绝、单选/多选/自由回答、计划修订、取消及模型切换；无响应或断线不能生成第二个 writer。
4. **双端恢复**：App 冷启、网络切换、Bridge 重启、CLI 升级、另一设备抢先回答；完整验证原生记录不重复、权限不扩大、草稿不丢。
5. **产品验收**：iOS + Android 同一套简洁交互，再回归 OpenClaw/Hermes/Pi/Codex。实现后按根 AGENTS 的资源规则逐个运行窄范围测试，不并发重型任务。

认证设计应保持在用户电脑：第三方应用不收集或中转 Claude.ai 凭据、不实现自己的 Claude.ai 登录。官方条款一方面要求第三方开发使用 API/provider 路线，另一方面明确允许用户在未修改的 Claude Code 二进制中用自己的订阅登录；不能简单说“订阅全禁止”，也不能因竞品存在就推定任何集成形式都可用。[官方认证边界](https://code.claude.com/docs/en/legal-and-compliance)

本轮没有修改 Mobile、Bridge、协议或部署配置，也没有发布动作。下一步应先把两种原生入口的连续性证据做实，再决定首期能力承诺。

## 实施启动补充：测试 provider 与认证边界

Owner 随后授权实现与测试，Bridge runtime 已加入固定版本 Agent SDK 0.3.283 依赖；上文“未实现/未安装”描述的是调研阶段的状态，不能当作当前实施进度。

Owner 提议用 DeepSeek V4.1 Flash，并要求确认官方支持、保护现有 Anthropic 账号。2026-09-26 复核发现：DeepSeek 官方有 [Claude Code 接入教程](https://api-docs.deepseek.com/quick_start/agent_integrations/claude_code/)，使用其 Anthropic 格式接口及 `deepseek-flash` 模型；但 [Anthropic 的网关文档](https://code.claude.com/docs/en/llm-gateway) 明确不支持通过网关把 Claude Code 路由到非 Claude 模型。技术兼容与 Anthropic 支持范围必须分开描述；不能由 DeepSeek 单方教程推导账号风险为零，也不能把“不提供支持”直接断言成必然封号。

已向 Owner 说明差异，未创建 DeepSeek Key、未配置该路由、未发起 DeepSeek 推理。Owner 明确改选官方 `claude auth login`，测试本机未修改的 CLI。已启动原生登录流程，等待用户完成官方页面认证。不要提取 Desktop 凭据、接收聊天里的授权码或把账号登录集成到 Clawket UI。后续真实模型与连续性验收仍需单独记录，登录成功本身不算功能验收。
