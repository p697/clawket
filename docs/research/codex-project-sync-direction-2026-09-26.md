# Codex 项目与原生会话：产品边界讨论稿

日期：2026-09-26。状态：owner 已确认设备级连接、最近聊天优先、原对话接续及排除 Git/IDE 的方向；随后要求明确结构化用户提问的适配。新方向已获实施授权，但本文描述的是目标，不代表当前实现或验收完成。现有已验证能力仍见 `../3.1/codex.md` 与对应 QA 记录。

## 结论

建议从「一个目录对应一个连接」调整为「一台电脑的 Codex 对应一个连接，项目是聊天的工作范围」。保留花名册、Thread 和 SessionPanel，Codex 增加项目选择及会话工作目录提示。目标包含原生聊天继续与桌面运行状态跟随；仅导入历史再强制分叉不足以解决 owner 提出的体验问题。

基础项目/历史目录、原对话继续、桌面运行任务的安全控制可以分阶段工程验证，但不能把仅完成第一项称为完整桌面接续。不会承诺同步所有云端任务或精确复制桌面侧栏。

## 参考依据与可信度

参考仓库：[Emanuele-web04/remodex](https://github.com/Emanuele-web04/remodex)。独立本地浅克隆位于 `/Users/lucy/Desktop/me/references/remodex`，固定参考 SHA `e0e342dac5cddd40db661bfcf76e5ab0e3913ef8`（2026-09-20）。未安装或运行 remodex，以下是源码观察，不是竞品真机测试结果。许可证 Apache-2.0；若实际复用源码需保留适用许可和归属，不复用品牌。

| 已确认的源码行为 | 对 Clawket 的启发与限制 |
|---|---|
| `CodexService+ThreadsTurns.swift`：显式列出 cli/vscode/appServer/exec/unknown 来源、跨 provider 列表、updated_at 排序、cursor 分页；常规最近窗口默认 70 条，有 limit 时不遍历全部页 | 先快显最近，再按需分页；不能把「首批 100 条」当完整历史，也不能说 remodex 每次加载全部历史 |
| `SidebarThreadGrouping.swift`：按工作目录分项目、普通聊天归类、活动视图与项目视图 | 项目与 Agent 分开；目录身份不能只用 basename；普通聊天不能泄漏成一串日期文件夹 |
| `CodexService+ProjectFolders.swift`、`project-handler.js`：最近/常用位置、目录浏览搜索与创建、普通聊天实际目录 | 普通聊天也有真实 cwd；我们必须清楚定义并展示，不能默默使用 QA 临时目录 |
| `SidebarNewChatProjectPickerSheet.swift`：新聊天可选项目、worktree、普通聊天 | 保留必要的项目选择，去掉 Git/worktree 创建等复杂入口 |
| `desktop-ipc-action-follower.js`：原生运行状态、审批、用户问题、steer/interrupt 等通过本地 IPC 路由；断线保留待确认操作和运行状态，重新快照校准 | 断线不等于执行结束或消息未送达；禁止超时后另开 writer 或盲目重发 |
| follower 测试覆盖快照/patch、历史方向、重复流、不同 turn ID、运行发现、审批恢复等 | 借鉴失败场景与验收，不只模仿正常聊天路径；本轮未执行这些测试 |
| README 明确本地 IPC 是 Codex 私有协议；已建立配对后的应用负载为端到端加密 | 私有协议适配需要版本检测、隔离与降级；E2E 是真实竞品能力，不能用「功能减法」忽略 |

源码永久链接：[历史目录](https://github.com/Emanuele-web04/remodex/blob/e0e342dac5cddd40db661bfcf76e5ab0e3913ef8/CodexMobile/CodexMobile/Services/CodexService%2BThreadsTurns.swift)、[项目分组](https://github.com/Emanuele-web04/remodex/blob/e0e342dac5cddd40db661bfcf76e5ab0e3913ef8/CodexMobile/CodexMobile/Views/Sidebar/SidebarThreadGrouping.swift)、[目录服务](https://github.com/Emanuele-web04/remodex/blob/e0e342dac5cddd40db661bfcf76e5ab0e3913ef8/phodex-bridge/src/project-handler.js)、[IPC 跟随与恢复](https://github.com/Emanuele-web04/remodex/blob/e0e342dac5cddd40db661bfcf76e5ab0e3913ef8/phodex-bridge/src/desktop-ipc-action-follower.js)、[README](https://github.com/Emanuele-web04/remodex/blob/e0e342dac5cddd40db661bfcf76e5ab0e3913ef8/README.md)。

官方 App Server 文档已有 thread/list、read、resume、fork：[文档](https://learn.chatgpt.com/docs/app-server)。它提供原生历史/继续的基础，但独立 App Server 的 loaded 列表不是跨进程运行所有权证明。不能据此认为桌面没有运行任务。

尚未找到 remodex 精确同步 Codex 桌面空项目、保存的项目顺序、全部桌面项目元数据的证据。Clawket 如要展示没有聊天的桌面项目，应单独验证本地 metadata 的版本与可用性，而不是从 cwd 列表推断「完整项目同步」。

## 推荐范围

### 做

- 连接电脑一次，发现用户授权范围内的 Codex 项目及历史；支持当前实际 CODEX_HOME，明确 CLI/桌面历史来源与跨 provider 行为。
- 有聊天的项目从原生 thread 元数据发现；空项目尽量读取可验证的桌面保存目录，无法读取时允许用户明确添加已存在的目录。界面不声称与桌面侧栏完全一致。
- 最近聊天先显示缓存、后台校准，按需加载历史；搜索覆盖范围必须明确，不能只搜首批结果却呈现「没有聊天」。
- 新聊天明确选择/沿用项目；同名项目显示父路径区分，详情可看完整路径；工作目录不可静默迁移。普通聊天使用持久明确目录。
- 在原对话里继续，保留模型、cwd 与上下文；桌面运行时跟随状态、处理审批/问题、停止/补充指令。显式分叉保留为可选操作。
- 已有 worktree 聊天保持原 cwd；无需 Git 管理界面。目录不存在时允许查看历史，并明确为何不能继续。
- 原生所有者不明或当前 Codex 私有协议版本不支持时，显示具体受限状态，不启动第二个执行者；手动分叉不得冒充原对话接续。

### 不做

- Git 分支、提交、push、PR 管理；新建/删除 worktree。
- 文件树、代码编辑器、通用终端、完整移动 IDE。
- Agent 互聊、编排、群聊；完整复制 Codex 桌面布局和项目排序。
- 自动扫描整个电脑、静默扩大旧连接的目录授权、跨机器搬移工作目录。
- 把本机不可访问的云端任务伪装成本地可继续聊天。

E2E 另列为安全架构评估项：当前配对加密/TLS 不等同消息 E2E。若声称与 remodex 同等级隐私保护，必须先提供相应实现和验证；本轮不扩展为全后端加密改造。

## UI 建议

推荐「最近聊天 + 项目筛选」：

1. 花名册仍是一项 Codex，副标题是电脑名称。项目不占 Agent 位置，不影响现有免费 Agent 数量。
2. 沿用 SessionPanel 默认展示最近聊天；每行有轻量项目名，添加一个项目筛选入口。搜索遵循当前选择范围。
3. 新建聊天沿用当前项目；从所有项目入口新建则先选最近项目。用户始终能看见并修改新聊天所属目录。
4. Thread 内显示简洁项目标识；点击可看实际工作目录。改项目需要新建聊天，不能改变已存在对话的 cwd。
5. 不新增 Tab 或项目管理首页。

备选「项目 → 项目内聊天」更适合大量并行项目，但回到最近对话多一步，不建议作为默认。交互草案只是比较导航方式，示例数据和发送区不代表真实连接；实际实现仍需使用现有设计系统和真机验收。

现有 Session 数据缺少 project 维度，不能只改标题或按名字拼接；建议增加可选的项目描述/能力与 Codex 专用导航适配。Thread、消息渲染、审批组件尽量复用，OpenClaw/Hermes/Pi 保持现有交互与 capability。

另有需 owner 单独决定的商业化边界：现有导入历史 Pro 限制是否适用于 Codex。基础接续若被付费墙阻断会影响初次体验，但本轮不擅自修改订阅规则。

## 技术落地边界

- 设备级 Bridge 发现项目/线程；原有项目级自有 App Server 可按需惰性启动。连接身份、项目身份、原生 thread ID 与执行所有者分离。
- 官方接口优先处理目录和历史；桌面活跃操作由隔离的 IPC 适配器承担，明确支持版本和能力。不是直接复制全部 remodex bridge。
- 原生所有权探测、目录授权、线程状态校准必须先于 resume/turn/start；超时和断线不构成可安全重发的证据。
- 旧版单项目连接继续限制在原授权范围；迁移到设备范围需要用户明确选择，不自动拓宽。
- 保持所有旧后端契约和部署隔离。新方向已获授权；实际改动原生写入/IPC 之前同步更新 spec、最近 AGENTS 和协议能力，不能提前宣称具备桌面接续。

## 验收建议（均为未来标准，并非已通过）

- 多项目、同名目录、普通聊天、空项目、已有 worktree、目录丢失、非默认 CODEX_HOME、自定义 provider；20 项目/1,000 聊天 fixtures 验证分页与搜索完整性。
- 手机打开桌面旧对话后继续，手机/桌面两侧能看到同一 native thread；运行中的任务跟随、停止、补充、审批和问题回复不串线。
- 发送前/发送后未确认时断线，冷启动、网络切换、IPC 重启、旧快照和事件乱序；无重复执行、无审批丢失、无第二 writer。
- 手机新建聊天的真实 cwd 与 UI 所选一致；选择新项目不修改原对话。
- 对不支持的 IPC 版本和不明确的所有者提供明确降级，不显示虚假的实时/可继续状态。
- iOS/Android 长名称、键盘、路径详情、返回与新建流程；同轮跑 OpenClaw/Hermes/Pi 非回归与兼容门禁。

Owner 已确认上述产品方向。实现与真实桌面跨端验证必须包括以下用户提问闭环。


## 用户提问闭环（owner 补充，2026-09-26）

remodex 已实现 `item/tool/requestUserInput` / `tool/requestUserInput` 接收、结构化选项/文字输入、多题汇总，并在桌面拥有任务时通过 `thread-follower-submit-user-input` 回复。依据：`CodexService+Incoming.swift`、`CodexService+ThreadsTurns.swift`、`StructuredUserInputCardView.swift` 与 `desktop-ipc-action-follower.js`。本次为源码核对，未运行竞品。

当前 Clawket 具备基本 questions.list/respond、逐题收集及 AgentQuestions sheet，并在手机重连时查询尚未解决的问题；但选项与自由输入二选一（isOther 时退化为输入框）、缺少完整问卷呈现，原生桌面路由尚不存在。不要将之前协议/适配器测试解释为完整真实模型、桌面 IPC 与真机问答验收。

最低目标：

- 原样呈现标题、问题、选项说明及协议允许的自定义回答；多题保留各自 question ID，完整收集后仅向原 request 回复一次。不能把选项点击默认当作最终提交。
- 明确区分关掉面板、提交答案、取消任务；关闭仅收起，保留“需要你回答”入口；不自动选推荐答案。输入草稿与多题进度不因切换聊天或短暂断线丢失。
- 关联 thread/turn/request 与执行所有者；桌面提出的问题必须回答给桌面正在等待的请求，不能作为新聊天消息发给另一 App Server。
- 已由桌面回答、原任务结束/取消或 serverRequest/resolved 时，手机撤销对应待办；过期回复不能作用于后续请求。手机断线不能清除电脑仍在等待的问题。
- 断线后的提交状态不确定时先校准，避免重复回答；不支持的交互显示具体原因和可行入口，协议侧显式处理，不能只留下永远转圈的界面。
- 普通需求澄清与执行权限审批在产品上区分。相同 requestUserInput 通道也可能承载 App/MCP 的 Accept/Decline/Cancel，必须保留原始语义；不能统一解释成无权限含义的普通问题。
- MCP elicitation 是另一类请求，需能力检测和明确支持/降级边界；不声称适配 requestUserInput 即覆盖所有工具互动。敏感输入不能直接落入普通聊天缓存或日志；当前不支持时明确降级，不假装安全支持。

验收必须观察“真实 Codex 提问 → 手机选项/文字/多题 → 原任务收到答案并继续”，以及冷启动恢复、桌面先回答、重复提交、提交时断网、关闭面板和取消任务。每个结论区分确定性协议测试、真实 Codex 测试、iOS/Android UI 实测；不能相互替代。
