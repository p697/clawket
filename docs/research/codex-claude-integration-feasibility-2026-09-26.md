# Codex / Claude Code 接入可行性 · 2026-09-26

结论：两者具备结构化接入基础。建议先做 Codex 的小范围验证，再做 Claude Code；首期以 Clawket 管理的项目会话为边界。不要把“可恢复历史”宣传成“任意已运行桌面/终端会话都能双向接管”。这是调研建议，不是实现或发布验收。

## 本机证据与版本

- 已安装 Codex CLI 0.153.3；本次 npm 查询 latest 为 0.157.0。导出已安装版非 experimental JSON Schema，核对 thread/turn/model/approval 接口。实际启动 stdio app-server：`initialize`（experimentalApi=false）、限定临时项目的 `thread/list`（0 条）、`model/list`（5 项）通过。
- 已安装 Claude Code 2.1.280；下载最新官方 Agent SDK 0.3.283 到临时目录，检查公开声明与发布包。SDK 指向已安装官方 CLI，以隔离 Claude 配置、空项目、占位 API key、不可达本机模型地址初始化成功，模型发现返回 6 项。
- 未发模型 prompt、未读取用户历史内容、未接管运行会话、未升级全局安装。上述模型目录数量不证明模型账号或推理可用。两个探测子进程已退出。
- 证据和脚本：`/tmp/clawket-codex-claude-feasibility-20260926/`。这是协议握手实测，不是工具、审批、真实推理、手机或云端验收。

## 接入路径

| 项目 | Codex | Claude Code |
|---|---|---|
| 建议入口 | Bridge 启动官方 `codex app-server`，本机 stdio JSON-RPC | Bridge 使用官方 Agent SDK，指向用户已安装的原版 Claude Code |
| 已有接口覆盖 | thread/turn、流式条目、模型、技能、审批 | 长连接 query、流式消息、会话函数、模型控制、canUseTool/用户问题 |
| 首期会话归属 | Clawket 创建并持有运行所有权 | Clawket 创建并持有运行所有权 |
| 原生会话 | 显式项目范围内查看；验证后允许复制继续 | 显式项目范围内查看；验证后允许 fork 继续 |
| 运行中终端/桌面接管 | 需单独验证同一 app-server 的订阅和控制权，独立进程 resume 不等于接管 | SDK resume 不等于 attach 活跃 TUI；CLI 的 attach 也不自动等于移动端协议 |
| 主要风险 | app-server 兼容性与实验状态、审批和多端一致性 | 用户原有配置继承、SDK/CLI 版本组合、认证产品边界 |

Codex 官方将 App Server 定位为自定义富客户端接口；但当前页面同时将 app-server 命令及 WebSocket transport 标为 experimental、不支持 production workloads。建议首期用 stdio、关闭实验字段、锁定验证过的 CLI 范围；这减少可变面，但不消除上游兼容风险，不能称为官方生产稳定协议。[App Server](https://learn.chatgpt.com/docs/app-server)、[Developer commands](https://learn.chatgpt.com/docs/developer-commands)

Claude SDK 有正式的会话枚举、历史读取、resume/fork 和命名接口，可以省去自己解析全部内部历史格式。最新版声明中的 `/bridge`、浏览器导出及 prewarm 不应因存在就当成稳定、开放的官方远程服务；其中存在 alpha 和官方服务身份前提，首版无须依赖。[Sessions](https://code.claude.com/docs/en/agent-sdk/sessions)

## 真实用户配置与认证

Codex 可以采用用户现有 provider 配置、自定义端点或本地 provider。模型兼容必须按用户实际 Codex 版本和端点验证：流式、工具、图片、推理并不因一个 URL 可配置就全部成立。不承诺任意模型即插即用，也不替用户改全局默认。[Advanced configuration](https://learn.chatgpt.com/docs/config-file/config-advanced)

Claude 当前 SDK 的 `settingSources` 默认已是 user/project/local，不能沿用旧版本“默认完全不加载”的经验。实现应明确读取范围并保持项目 CLAUDE.md、skills、hooks、MCP 和权限语义；后台启动环境也要与用户终端配置对齐。部分全局配置/管理策略不受该选项控制。应显式使用 Claude Code prompt preset，避免自定义 prompt 意外改变用户熟悉的行为。[CLI features in SDK](https://code.claude.com/docs/en/agent-sdk/claude-code-features)

Claude 的认证有两层，不能混为一谈：

1. SDK 文档要求第三方产品默认使用 API key/支持的云 provider；未经批准，不提供 claude.ai 登录或订阅额度。[SDK overview](https://code.claude.com/docs/en/agent-sdk/overview)
2. 当前 Legal 页面又明确允许终端用户在平台上的未修改官方 Claude Code 中自行使用其订阅登录；同时禁止第三方收集、保存或中转其会话凭据。对 Clawket 这种本机 SDK 驱动 + 手机交互的组合，不能仅凭技术可用推定属于允许范围。首期明确支持 API/provider 路线；订阅路线需核实具体产品边界，不提取 token、不仿冒官方客户端，也不修改二进制或禁用其内置认证方式。[Legal and compliance](https://code.claude.com/docs/en/legal-and-compliance)

这不意味着全部 Claude 订阅远程连接一律被禁止，也不意味着开源产品自动获得授权。

## 市场价值判断

Claude 官方 Remote Control 当前不支持 API key；自定义网关、Bedrock 等路线也不属于其可用范围。这为自带 API/provider 的用户留下明确功能缺口。此处是从官方产品边界推导的机会，不是用户量或付费意愿的证明。[Remote Control](https://code.claude.com/docs/en/remote-control)

Claude 官方允许兼容网关，但明确不支持经网关接非 Claude 模型。Clawket 应支持“用户已能正常运行的 Claude Code”，不额外承诺任意第三方模型兼容。[LLM gateways](https://code.claude.com/docs/en/llm-gateway)

两者的长期吸引力来自与 OpenClaw/Hermes/Pi 同屏管理，以及从手机处理真正需要人的环节。单纯复制官方远程聊天的吸引力较弱。这个判断仍需在真实用户中验证。

## 对现有 Clawket 的影响

现有 `AgentAdapter`、能力矩阵、Relay、项目授权、会话列表、流式工具卡、问题弹层可以复用。不需要先建设复杂云端 harness 或要求每个 Agent 安装通信 skill。

最值得先补的是**通用审批语义**：现有 `ApprovalRequest` 偏向 OpenClaw exec/plugin/pair，exec 决策只有一次/永久/拒绝。Codex 的会话级许可不能映射成永久许可；文件修改、网络和工具审批也不能伪装成 Pi 普通确认问题。Claude `canUseTool` 不是所有工具执行都会经过的全局拦截器，必须尊重原有权限规则。[Claude permissions](https://code.claude.com/docs/en/agent-sdk/permissions)

建议首期完整交付：

- 明确项目连接；创建会话、聊天/工具、停止、历史恢复、模型选择与技能发现。
- 真正可用的命令/文件/工具审批和用户问题；手机离线时保留待处理状态，重连后恢复，拒绝过期或重复答复。
- 手机断线不停止本机任务；Bridge 崩溃后不自动重放不确定输入。
- 原生历史只读或复制继续；不要同时让两个 harness 写同一个会话。
- 继续按后端划分能力，不展示不支持的 channel/cron/agent 管理。

一条连接的产品含义宜是“这台电脑上，这个项目里的 Codex/Claude Code”。项目不是 OS 沙箱；多个 Agent 同时写同一 checkout 仍会冲突，后续协作需要 worktree、任务归属及冲突策略。

## 实施优先级与验收门槛

建议 Pi 先按当前流程发布，不把两个新后端追加进临发版本。

下一阶段先用 Codex 验证一个完整闭环：手机发任务 → 工具执行 → 展示修改 → 审批 → 完成通知 → 离线恢复。随后让 Claude Code 复用已经打磨好的审批与项目体验。两套本机连接不要求先做 Agent 群聊；未来跨 Agent 派任务可以复用它们，但还需要显式委派权限、循环限制和结果归属。

正式投入前的小规模验证应回答：

1. 最新 CLI 与至少一个前版：真实模型、工具、拒绝/取消审批、图片和大历史。
2. 手机/Bridge 断线、进程退出、多设备同时回答、重复发送，不能重复执行工具。
3. 项目配置和技能与用户 CLI 一致；已运行原生会话不会被并发改写。
4. API/provider 的真实账号路线；Claude 订阅连接的明确产品边界。
5. OpenClaw/Hermes/Pi 全部回归；两个新后端分别隔离配对与环境。

技术可行性已经有证据，生产可用性尚未验证。工作量主要在这些恢复、审批和兼容细节；不以握手原型速度推算发布日期。
