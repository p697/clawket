# OpenClaw 会话模型选择与实际执行不一致

日期：2026-09-22。结论：**已复现上游阻塞，未实施客户端行为变更**。负责人授权的退出条件是：Clawket 能可靠适配则实现；如果 OpenClaw 的问题使适配无法满足标准，则放弃本次适配。

## 验收标准与实测

正常情况下，输入框所选模型必须是下一轮实际使用的模型；发生备用切换时，应明确说明实际模型。不能仅把上一轮实际模型替换成下一轮的选择，也不能以接口返回成功证明模型执行一致。

环境为本机已安装 OpenClaw `2026.9.1 (90226cb)`。原报告会话的四条 assistant 记录均为 `provider=claude-cli`、`model=claude-opus-5`、`api=cli`；全局默认为 `deepseek/deepseek-flash`，主会话有用户设置的 `anthropic/claude-opus-5` 覆盖。新会话有 `parentSessionKey=agent:main:main`，自身没有模型覆盖。

独立测试会话于 01:41 UTC 创建，仅发送要求回复 `OK`、不使用工具、不修改文件的测试消息，`deliver=false`。未修改主会话或用户报告的会话。

| 步骤 | 请求 / 证据 | 结果 |
|---|---|---|
| 显式创建 | `sessions.create {agentId:"main", model:"deepseek/deepseek-flash", label:"Clawket model consistency probe 0922"}` | `ok=true`，`resolved=deepseek/deepseek-flash`，仍自动挂在主会话下面，未持久化显式模型覆盖 |
| 显式切换 | `sessions.patch {key:<测试会话>, model:"deepseek/deepseek-flash"}` | `ok=true`，`resolved=deepseek/deepseek-flash`，仍无显式模型覆盖 |
| 实际执行 | `chat.send {sessionKey:<测试会话>, message:<测试文本>, deliver:false, idempotencyKey:<唯一值>}` | 返回运行 ID；回复为 `OK` |
| 原生历史读回 | `chat.history` 的 assistant 元数据 | `claude-cli/claude-opus-5`、`api=cli` |
| 同一历史响应的会话投影 | `chat.history.sessionInfo` | 仍为 `deepseek/deepseek-flash`，`modelOverrideSource=null`，`hasActiveRun=false` |
| 交叉验证 | 原生 SQLite transcript/session entry 与 Gateway `agent/cli-backend` 执行日志 | 同样为 `claude-cli/claude-opus-5`，不是模型自述或 App 缓存推断 |

首次探测传入 `title` 被上游 schema 拒绝，没有创建会话；改用其支持的 `label` 后完成以上测试。该错误不计作模型复现成功证据。

## 根因

以下源码路径相对于外部 OpenClaw checkout；关键行为同时核对了已安装包的 `dist`，不是仅凭未部署源码推断：

1. `src/gateway/session-create-service.ts` 自动把普通 dashboard 新会话挂到 Agent 主会话，用于通知和线程归属。
2. `src/gateway/sessions-patch.ts` 将显式选择与默认值相同的模型标记为 `isDefault=true`；`src/sessions/model-overrides.ts` 随即清除 `providerOverride/modelOverride`。创建也复用模型 patch 逻辑，因此显式传入默认模型不能形成独立 pin。
3. `src/sessions/stored-model-overrides.ts` 在子会话没有 direct override 时读取父会话覆盖；`src/auto-reply/reply/model-selection.ts` 的执行选择使用这一结果。因此本例回到主会话的 Claude。
4. `src/agents/session-model-ref.ts` 与 `src/gateway/session-utils-row.ts` 的会话展示投影使用本会话覆盖或 Agent 默认值，没有按同一规则解析父会话覆盖，所以仍返回 DeepSeek。

这解释了为何“创建时明确指定”和“切换后再读回确认”都不能修复此例。原助手所说的 override 实际来自父会话；不能把它当作子会话显式覆盖，也没有证据把本次差异归因于模型失败后的 fallback。

## 客户端适配边界

Clawket 当前从 `sessions.list` 读取模型，通过 `sessions.patch` 切换会话模型。原生 `chat.history` 能提供已完成回复的实际模型，因此事后提示差异在技术上可做，但不能保证下一条消息执行用户所选模型，不能独立满足上述验收标准。

已检查的 `chat.send` schema 没有结构化 `model` 参数；`sessions.patch` 没有“强制 pin 默认模型 / 禁止继承父模型”的字段，也不能借模型切换修改 `parentSessionKey`。不采用修改主会话、全局配置、用户消息内容、创建 incognito 会话或直写本机数据库等绕过方式：这些会改变其他会话、存储或发送语义，也不是远程手机对现有会话的可靠通用适配。

因此按负责人退出条件停止本次客户端适配，保留现有行为，不把问题标为已修复。未修改 OpenClaw/Hermes 源码、App、Bridge 或部署配置；未发布或构建 App。

## 上游修复后再进入实现的条件

- 显式选择默认模型必须能覆盖父会话模型，或提供明确且可协商的禁用继承 / 固定选择接口；不能成功确认 DeepSeek 后仍静默执行父会话的 Claude。
- 会话有效模型的读取与执行必须使用一致的继承规则，并区分选定模型、实际执行模型和备用切换。
- 用同一最小复现验证创建、切换到默认、切换到非默认、重连读回与实际回复一致后，再实现客户端确认状态与实际模型提示，并覆盖旧 Gateway、跨会话请求竞争和 Hermes 全局模型语义。

本地测试证据：`/tmp/clawket-model-consistency-0922/`（仅测试会话；不提交原始响应）。测试会话通过原生删除接口按 session ID/更新时间校验后清理；原始会话和主会话保留，全局配置 SHA-256 前后相同。此记录是上游最小复现与适配可行性结论，不是客户端修复或完整发布验收。

文档验证：`npm run check:docs` 通过，进度日志 diff 空白检查通过。没有生产代码变更，因此未运行 `check:required`、设备测试或原生构建。
