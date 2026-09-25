# Pi 接入可行性调研

日期：2026-09-25。结论依据 Pi **0.87.1**（2026-09-22 发布），tag commit `f07218c4d4bbc12bef056a7058c3dd49dfe41abe`，不是把 main 分支能力当成已发布能力。本文件是研究建议，不改变 3.0 产品决策，也不是 Pi 实现或发布授权。

## 1. 结论

**可行，推荐通过用户本机 Pi 的原生 RPC 接入。** 第一版可以提供完整的项目会话聊天：流式回复、工具过程、历史、新建、命名、恢复、模型与思考档位切换、插话、取消及扩展的基础交互。无需 fork Pi，也不需要先实现 IM Channel 或通用 Agent 编排云。

Pi 的 Session 能力并不弱：它有项目归组、JSONL 持久化、树状历史、恢复、分支、压缩和用量统计。它与 OpenClaw/Hermes 的主要差异，在于稳定 CLI 不是一个自带常驻 Gateway、远程客户端认证和多渠道路由的服务。Clawket Bridge 要补运行管理与远程访问。

最需要明确的边界：

1. 稳定 RPC 控制的是自己启动的 Pi 进程，不能直接附着到任意已经打开的 Pi TUI。
2. 原生历史可以发现和读取，但不能据此判断该会话无人使用。首版建议原生会话只读，用户选择后创建独立分支；Clawket 创建的会话可以直接继续。
3. Pi 默认没有内建逐工具审批或沙箱。扩展可以实现确认，但不能把确认弹窗宣传成完整权限隔离。
4. 上游已经在做实验性 Server、多界面共享会话和 durable runtime。应保留替换运行层的接口，暂不依赖实验协议交付首版。

## 2. 本机安装与验证

按官方 npm 安装方式执行：

```sh
npm install -g --ignore-scripts @earendil-works/pi-coding-agent@0.87.1
```

- 安装包：`@earendil-works/pi-coding-agent`，不是旧的 `@mariozechner/…` 名称。
- Node：22.23.1，满足 Pi 的 `>=22.19.0` 要求。
- 命令：`/opt/homebrew/bin/pi`；全局包位于 `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent`。
- 普通命令和新登录 zsh 中的 `pi --version` 均返回 `0.87.1`；`pi --help` 正常。
- Pi 自己的认证存储目前有 0 个 provider，没有为用户迁移其他应用的凭据或指定模型。

用户开始使用：在目标项目目录执行 `pi`，在交互界面执行 `/login` 配置自己的 provider，再用 `/model` 选择模型。`pi --continue` 恢复当前项目最近会话；`pi --resume` 选择历史。自定义兼容端点用 `~/.pi/agent/models.json` 配置。

### 本地实测范围

运行真实已安装的 Pi 进程，连接只监听 `127.0.0.1` 的确定性 OpenAI-compatible 测试服务。使用临时 agent 目录、临时项目和显式测试扩展；禁用自动扩展/技能/项目上下文加载与启动联网。未发送实际项目文件给模型服务，也没有使用真实模型账号。

21 项断言通过：RPC 启动、自定义模型列表、流式和 settled、JSON 字符串内 U+2028、会话持久化、改名、真实 read 工具、工具结果历史、会话模型切换、不修改全局模型默认值、扩展命令发现、确认弹窗往返、中止到 idle、steer、follow-up、clone、切回原会话、树读取、新建空会话、进程退出后恢复历史、恢复会话模型。

额外验证：通过已安装包的 SDK 成功调用 `SessionManager.listAll()`，列出两条测试会话并找到命名会话。

本机复现脚本：`/tmp/clawket-pi-probe-2026-09-25/probe.py`；结果：同目录 `result.json`。源码检出：`/tmp/clawket-pi-source-0.87.1`。临时文件可能被系统清理。

**未实测**：真实 provider 登录和推理、真实图片推理、Windows/WSL、手机/Relay、进程崩溃时工具副作用、多个原生 TUI 并发写同一文件、第三方复杂扩展、实验 Server。测试进程和本地测试 HTTP 服务均已退出。

## 3. Pi 的实际能力

### Channel

此次调查对象是 `pi-coding-agent`。稳定 CLI 有 interactive、print、JSON、RPC 四种运行方式。RPC 是 stdin/stdout JSONL，不是 HTTP/WebSocket Gateway，没有内建手机配对、用户认证、IM 账户或渠道会话路由。

Pi 仓库另将 Slack/chat automation 指向独立的 `pi-chat` 项目，因此不能笼统说 Pi 生态没有 Channel；但它不属于此次安装后直接获得的 CLI 接入契约，也不是 Clawket 首版所需前提。

### Session

- 默认按工作目录保存到 `~/.pi/agent/sessions/`，支持 `--session-dir` / 环境变量 / 配置覆盖。
- JSONL v3，entry 通过 `id` / `parentId` 形成树；压缩和分支不是简单删除旧消息。
- RPC 有 `new_session`、`switch_session`、`set_session_name`、`fork`、`clone`、`get_tree`、`get_entries`、`get_messages`。
- `get_messages` 是当前运行上下文，不应直接充当完整的用户可见历史；压缩之前的消息、分支和 context edits 要按 session entry 和当前 leaf 解释。
- RPC 没有 `list_sessions` 或 `delete_session`。SDK 提供 `SessionManager.list/listAll`；删除是本地会话文件操作，需由 Bridge 定义所有权和可恢复删除策略。
- `SessionManager.open()` 可能迁移旧格式，不适合作为“不修改原生会话”的历史查看实现。列表/只读解析与打开运行会话应分开。
- 一个普通 RPC 进程有一个当前活动 Session；切换不是多会话并行。多个会话同时运行需要多个受管理进程或 SDK Session。
- 标准 session-manager 使用内存状态及文件 append/rewrite，没有为 Clawket 提供跨独立 CLI 的统一控制权。不能用文件存在、mtime 或 `ps` 猜测取得独占写权限。

### 模型、技能与扩展

- 原生支持多 provider、API key、订阅登录和兼容端点；具体授权与 provider 可用性由用户配置和相应服务决定。
- RPC `set_model`、`set_thinking_level` 作用于当前 Session；0.87.1 默认不会保存成全局默认。已用源码及实测确认，不能沿用 Hermes 全局模型语义。
- `get_commands` 返回扩展命令、prompt templates 和 skills；不包含所有 TUI 内置命令。`/login`、`/resume` 等不能不加区分直接转发为 prompt。
- RPC 支持扩展的 select / confirm / input / editor，以及通知、文本 widget；TUI 自定义组件、主题、header/footer 等会退化或不可用。
- RPC 的 `ctx.hasUI` 为 true，代表宿主应实现基础交互；不能忽略扩展请求，否则可能无限等待。
- 无人值守 RPC 不能展示内置项目 trust 提示。未决定的项目资源可能被跳过；Clawket 不能为方便自动加 `--approve`，也不能默默跳过用户技能后声称完整继承配置。

## 4. 接入程度与产品能力表

| 能力 | 上游基础 | Clawket 建议 |
|---|---|---|
| 文本、流式、思考、工具记录 | 原生事件 | 首版 |
| 停止、运行中插话、后续消息排队 | abort / steer / follow_up | 首版；区别三种动作，取消按最终状态确认 |
| 多会话、新建、命名、历史 | 原生 Session + SDK 列表 | 首版；原生与 Bridge-owned 会话动作分开 |
| 多会话同时运行 | 每个 RPC 进程一个活动 Session | Bridge 进程池，限制并发；首版可先串行运行 |
| 项目选择 | cwd 决定工具基准路径与资源发现 | 首版需要明确项目入口，不能硬造跨项目 main |
| 恢复桌面历史 | 原生文件和 session ID | 查看 + 独立分支；暂不承诺实时接管正在运行的 TUI |
| 会话级模型与思考档位 | 原生 RPC | 首版；按模型动态降级 |
| 图片 | prompt.images + 支持视觉的模型 | 可做；仍需验证图片编码和实际 provider |
| PDF、Office、任意文件上传 | RPC prompt 无通用文件附件字段 | Bridge 额外适配；首版不直接宣称支持 |
| 技能浏览/调用 | get_commands + 本地 skills | 可做；安装、更新和来源验证另算 |
| 插件简单问答 | extension_ui_request/response | 首版基础弹窗/输入卡；与执行审批区分 |
| 执行审批 | 无原生完整权限系统 | 默认不能声明 execApproval；只有受测 gate 扩展可声明有限支持 |
| 用量、费用、上下文 | get_session_stats 包含 contextUsage | 可做；费用是模型元数据估算，不是账单；未知保持未知 |
| 会话分支树、clone/fork | 原生 | 第二阶段提供 UI；首版底层要正确处理 |
| Cron、Heartbeat、Channels、Nodes | 稳定 CLI 未提供同类管理接口 | 能力关闭；不为补齐矩阵自造后端 |
| 多人格 Agent 花名册 | 无 OpenClaw 式固定人格注册表 | 默认一个 Pi 入口，下面是项目和会话；不把每个 Session 算成一个 Agent |
| 手机通知 | 无 APNs/FCM 服务 | Clawket 的独立系统能力，不是 RPC 自带 |
| 跨 Agent 协作 | 外部宿主可发送任务，扩展可注册调用工具 | 后续复用 Bridge；无需先做群聊或修改 Pi 核心 |

## 5. 推荐架构

```text
Mobile PiAdapter
      │ Clawket 认证连接（Relay / Local 等传输）
Clawket Bridge：项目与会话目录、运行所有权、请求去重、恢复快照
      │
PiRuntime 接口
      ├─ 稳定版：受管理的 pi --mode rpc 子进程
      └─ 未来：经过验证后替换为 Pi Server
```

`backendKind = pi`；RPC 是 Bridge 内部适配方式，不是新的 backend 或 transport。纯 TS agent-protocol 只增加可序列化元数据和能力，不依赖 Pi SDK。

### 为什么首版选 RPC

RPC 能使用用户安装的 Pi、原有 provider 和资源配置；进程隔离也避免 Pi 扩展直接进入 Bridge 主进程。它不等于操作系统沙箱，但能减少崩溃和生命周期耦合。

SDK 功能更完整，适合在版本匹配的辅助进程内进行会话列表/解析；不建议直接把整个 Pi 运行时嵌进现有 Bridge 主进程。上游导出的 `RpcClient` 可参考或复用，但必须显式指定 CLI 路径并做真实 ready 探测；其 `start()` 只等待短暂启动时间，不代表认证/模型已可用，而且会输出并累积 stderr，宿主需限制和脱敏。

ACP 属于另一层适配，Pi 原生 RPC 已能满足本次目标。现在增加 pi-acp 会再引入一套版本、事件和扩展语义转换；若以后 Clawket 要通用 ACP，再单独评估。

### Bridge 必须补的部分

1. **项目与会话定位**：本机允许连接的项目清单；使用不透明 ID 映射 cwd/session 文件，手机不传任意主机路径作为可信命令。支持用户自定义 session storage，避免只扫描默认目录。
2. **所有权**：Clawket 管理的 Session 单写者；原生 Session 默认只读，可分支。被其他进程打开的 Session 不自动接管。SDK 列表中的 `allMessagesText` 不应整个发到手机。
3. **进程管理**：安装发现、兼容版本、cwd、模型认证 readiness、受限并发、空闲回收、受控退出。手机断开不关闭 Pi stdin，否则 RPC 会退出；用户主动 stop 才取消受管理任务。
4. **恢复与去重**：Bridge 生成 runId、输入幂等键和事件序号，保留设备本地恢复状态。RPC request id 只有关联用途，不保证重复请求只执行一次。重连取快照再补事件，不重发 prompt；Bridge 崩溃后不自动重演可能已产生副作用的工具调用。
5. **事件与历史投影**：prompt response 只是接收成功；结束以 `agent_settled` 为依据并检查 error/aborted。`message_end` 校正流式文本。恢复时处理 tool IDs、entry IDs、branch leaf、压缩和 context edits。
6. **边界与资源**：JSONL 严格按 LF 分帧，不能被 U+2028/U+2029 分割；持续消费 stdout、处理背压。Pi 单条历史/图片记录不保证小于 Clawket 的 8 MiB，需要分页/转换/有界错误，不能把 raw RPC 全透传。
7. **交互和权限**：基础扩展 UI 要有取消、断线、过期、并发和迟到响应处理；普通 confirm 不是执行授权。若加 approval extension，明确被拦截工具、离线拒绝策略及不覆盖的扩展代码/直接 RPC bash 等路径。
8. **配置继承**：保持 agent dir、cwd、provider、skills 的语义；后台服务未必继承交互 shell 环境，诊断必须说明缺少哪个 provider 配置但不能暴露凭据。

## 6. Clawket 需要改哪些地方

| 区域 | 最小必要变化 |
|---|---|
| agent-protocol | pi backend、能力矩阵；项目元数据与创建 Session 时选项目；基础扩展问题响应契约 |
| bridge-runtime | Pi 发现/进程管理、RPC framing、session 目录/只读原生历史、事件映射和恢复 |
| bridge-cli | pair/start/stop/status/doctor/logs 的 Pi 支持，清理仅限 Clawket 自己启动的进程 |
| relay-shared / Registry / Relay | 显式 Pi 认证与路由策略；保持旧 OpenClaw/Hermes 契约，不把 Pi 冒充 Hermes |
| Mobile | PiAdapter、项目入口、会话选择与工具记录、能力控制、基础扩展交互 |

当前 `AgentAdapter.createSession(agentId, {title})` 没有项目参数，`AgentDescriptor` 又要求 `mainSessionKey`。应以可选字段和 Pi 专属入口语义做加法：默认打开最近选定会话或项目选择；不要给 Pi 凭空制造永久 main。会话级权限和能力应根据真实状态降级，尤其原生会话不提供改名/删除/重置。

单独增加 Pi 接入不要求把全部后端迁移为“每台电脑一次配对”。是否共用新的多 Agent Relay 部署、端到端加密与通知基础设施，要另行定规格和授权；本研究不建议借此修改现有两个后端的生产链路。

## 7. 建议推进顺序与验收

**第一步：本地 Pi 适配验证。** 一个显式项目、一个可运行会话；聊天、工具、停止、历史、模型切换、扩展问答，完成真实 provider 冒烟。手机断线不停止任务，重连不重复执行。这一步先验证产品体验，不部署服务。

**第二步：可发布的 Pi 连接。** 多项目/会话目录，原生历史只读/分支，诊断与生命周期，明确安全与配置继承；Local/Relay 路径与 OpenClaw/Hermes 回归验收分别完成。官方支持版本固定，其他版本先探测再降级。

**第三步：体验扩展。** 并行运行、图片/文件、分支 UI、远程审批扩展、通知和 Agent 委派。按用户需求选择，不必一起发布。

关键验收：后台服务环境中的认证；未信任项目的资源处理；工具运行时网络中断；进程退出/强杀；取消和排队消息的准确语义；未知扩展弹窗；多客户端同时提交；原生历史只读；大历史与 8 MiB 边界；Windows/WSL。每项需要实际结果，不用 CLI 安装成功代替接入完成。

## 8. 重要上游变化：Server 已在实验

同一 tag 下的 `packages/server` 明确标为 Experimental，已有连接/会话路由和多 presentation attachment；peer authentication 仍由宿主负责。

`src/experimental/mini` 演示 Unix socket Server、每 Session 一个 worker、多个 TUI 共享会话。`packages/durable` 也提供新的持久化运行基础，但不能把这些实验能力混进稳定 CLI 的 JSONL Session 承诺。

这说明我们应投入 Pi，但控制自建 Gateway 的范围：Clawket 的运行管理层保持窄接口，避免复制 Pi 正在建设的全部运行时。实验目录存在不代表稳定 pi CLI 已支持 `pi serve` 或任意 TUI attach。

## 9. 一手来源

- [0.87.1 安装说明](https://github.com/earendil-works/pi/blob/v0.87.1/packages/coding-agent/README.md)
- [Quickstart](https://github.com/earendil-works/pi/blob/v0.87.1/packages/coding-agent/docs/quickstart.md)
- [CLI integration](https://github.com/earendil-works/pi/blob/v0.87.1/packages/coding-agent/docs/cli-integration.md)
- [RPC 协议](https://github.com/earendil-works/pi/blob/v0.87.1/packages/coding-agent/docs/rpc.md) / [RPC 命令源码](https://github.com/earendil-works/pi/blob/v0.87.1/packages/coding-agent/src/modes/rpc/rpc-mode.ts)
- [Sessions](https://github.com/earendil-works/pi/blob/v0.87.1/packages/coding-agent/docs/sessions.md) / [SessionManager](https://github.com/earendil-works/pi/blob/v0.87.1/packages/coding-agent/src/core/session-manager.ts)
- [Session format](https://github.com/earendil-works/pi/blob/v0.87.1/packages/coding-agent/docs/session-format.md)
- [SDK](https://github.com/earendil-works/pi/blob/v0.87.1/packages/coding-agent/docs/sdk.md)
- [AgentSession：模型、用量与生命周期](https://github.com/earendil-works/pi/blob/v0.87.1/packages/coding-agent/src/core/agent-session.ts)
- [模型配置](https://github.com/earendil-works/pi/blob/v0.87.1/packages/coding-agent/docs/models.md)
- [RPC extension UI](https://github.com/earendil-works/pi/blob/v0.87.1/packages/coding-agent/docs/rpc-extension-ui.md)
- [Security](https://github.com/earendil-works/pi/blob/v0.87.1/packages/coding-agent/docs/security.md) / [权限扩展示例](https://github.com/earendil-works/pi/blob/v0.87.1/packages/coding-agent/examples/extensions/permission-gate.ts)
- [Experimental Server](https://github.com/earendil-works/pi/blob/v0.87.1/packages/server/README.md) / [mini](https://github.com/earendil-works/pi/blob/v0.87.1/packages/coding-agent/src/experimental/mini/README.md) / [durable](https://github.com/earendil-works/pi/blob/v0.87.1/packages/durable/README.md)
- [Changelog](https://github.com/earendil-works/pi/blob/v0.87.1/packages/coding-agent/CHANGELOG.md)

上面的产品边界与推进顺序是 Clawket 建议；公开文档、源码证据与本机实测范围已分别标明。
