# Pi 接入（3.1）

负责人于 2026-09-25 授权实施；这是 3.1 扩展，不改变冻结的 3.0 重建范围。兼容基线为官方 `@earendil-works/pi-coding-agent` **0.87.1** 的稳定 JSONL RPC。代码已实现；尚未发布新版 Bridge/App 或部署 Pi 云端服务。

## 使用方式

先在要连接的项目目录运行 `pi`，用 `/login`、`/model` 或 Pi 自己的 `models.json` 配好模型，并在终端确认需要信任的项目资源。Clawket 使用已安装的 Pi，不复制其他应用的凭据，不自动批准项目资源。npm 安装的 Pi 要求 Node 22.19 或更新版本。

本地源码试用（在 Clawket 仓库执行；手机也需要包含本次代码的开发版）：

```sh
npm run bridge:build
node apps/bridge-cli/dist/index.js pi pair --local --project /absolute/path/to/project
```

在手机选择 Pi，扫描终端二维码。同一局域网内，电脑需要允许所选端口入站。默认端口按项目路径生成，冲突时指定 `--port`；多网卡可指定 `--address`。配对完成后 Bridge 在后台运行，关闭终端不结束任务。

后续命令使用相同 `--project`：

```sh
node apps/bridge-cli/dist/index.js pi status --project /absolute/path/to/project
node apps/bridge-cli/dist/index.js pi doctor --project /absolute/path/to/project
node apps/bridge-cli/dist/index.js pi logs --project /absolute/path/to/project
node apps/bridge-cli/dist/index.js pi restart --project /absolute/path/to/project
node apps/bridge-cli/dist/index.js pi stop --project /absolute/path/to/project
```

`start` 恢复已配对项目；`reset` 停止本项目 Bridge、清除配对配置，但保留私有历史。当前没有 Pi 开机自启动安装器，电脑重启后使用 `start`。不会停止用户自己打开的 Pi 终端，也不会改变 OpenClaw/Hermes 的服务。

`clawket pair --backend pi` 等价于 `clawket pi pair`，默认走 Pi Relay。现有 npm 3.0.0 不包含本功能；发布前不要把 `npx` 当作本次候选的测试入口。默认 Pi Registry 地址尚未部署，开发阶段使用本地配对，或通过 `--registry <https-url>` 指向自己部署的独立 Pi Registry。自建服务使用二维码；手机的六位码入口指向官方 Pi Registry。

高级本机选项：`--pi-command` 指定可执行文件；`--agent-dir` 指定 Pi 配置目录；`--sessions-dir` 指定原生历史目录；`--config` 指定项目 Bridge 配置；`--foreground` 保持前台。首次配对时保存这些配置。默认原生历史发现遵循 Pi 的环境变量、项目 `.pi/settings.json`、全局 `settings.json` 的 `sessionDir` 优先级。后台服务使用启动时的环境变量；修改环境后需重新启动。

## 实现范围

| 能力 | 行为 |
|---|---|
| 项目 | 一条连接对应一个明确选择的工作目录；多个项目分别配对 |
| 聊天 | 文本、模型支持时的图片、原样流式文本/思考、工具开始和结果、错误、停止与运行中插话 |
| 会话 | 私有会话新建、命名、历史分页、恢复、重置、删除；不同会话可并行 |
| 原生 Pi 历史 | 只读展示当前树分支；“在新会话中继续”复制为私有分支，原文件不变 |
| 模型 | 读取本机可用模型；选择与思考档位作用于当前会话，不改全局默认 |
| 技能 | 读取 Pi 已加载的技能并通过原生 `/skill:name` 调用；安装、授权仍由 Pi 管理 |
| 扩展交互 | select、confirm、input、editor 与通知；重连恢复待回答问题；失败保留输入；取消不等于确认 |
| 手机离线 | Pi 继续执行；重新连接加载历史、当前运行状态与待回答问题 |
| 连接 | 本地认证 WebSocket；独立 Pi Registry/Relay、二维码与协商后的六位安全码；多设备共享事件、RPC 响应返回请求方 |

手机复用现有连接选择、聊天页、模型选择与会话列表。新增交互使用统一的 Banner、Sheet、表单和按钮，支持键盘、长内容滚动与浅深色语义色；19 种语言已同步。扩展问题与技能提示分别渲染，不覆盖离线提示。原生会话没有可误操作的输入框。

## 运行与数据边界

- Pi 是独立 backend；Relay/Local 是 transport。移动端通过能力表隐藏不支持的 Agent 管理、cron、渠道配置、执行审批等操作。
- Bridge 每个项目保存 `~/.clawket/pi/<project-hash>/runtime.json`、`pi.log` 和 `sessions/`；配置与私有历史限制为本机用户可读写。模型凭据留在 Pi 的配置体系。
- 工作目录不是沙箱。Pi 的工具和可信扩展保持原本的本机权限；普通确认问题不能被宣传成执行审批。自定义 TUI、任意终端接管、实验性 Server、Agent 间编排均不在本版范围。
- 私有会话各自运行稳定 RPC 子进程，最多保留 8 个，满时回收空闲进程；8 个都忙时拒绝新增运行。每个会话串行处理写操作。项目锁阻止两个 Bridge 同时写私有会话。
- 先持久化提示词指纹和 run ID 再确认接收；重复请求不会再次执行。崩溃与不确定超时不能自动重发，也不承诺已开始的工具副作用可以撤销。
- 模型运行以 `agent_settled` 为结束信号，`agent_end` 不结束压缩/重试中的任务。没有启动模型运行的纯扩展命令，在命令响应且 Pi 确认空闲后结束。停止同时取消该运行的待回答问题。
- 原生历史只解析 JSONL v3、当前项目、普通文件；不调用可能迁移原文件的 SessionManager.open。context edits 只改变未来模型上下文，手机仍保留原始可见记录，与 Pi 的历史语义一致。压缩/分支摘要与可见扩展消息进入历史。
- 私有历史先读本地持久化数据，再用 RPC `get_entries(since)` 补齐未落盘尾部，避免几轮图片之后整段历史超过 RPC 帧上限。手机历史每页最多 40 条且小于 7 MiB；单条过大明确报错。当前原生发现最多 200 个文件、单文件 32 MiB；私有历史读取上限 128 MiB，每项目最多 1,000 个会话。删除/重置保留旧私有文件，不删除原生文件。
- WebSocket 上限 8 MiB；认证前不发送事件，不暴露任意路径或原始 Pi RPC。六位码通过现有密钥证明和加密交换传递配对内容；日志不写配对内容或 provider 输出。

## 验证

以下命令可以复现；真实 Pi 集成是显式入口，不让普通 CI 依赖开发者电脑或账号：

```sh
npm run check:required
npm run test:compat
npm run test:pi:integration
npm run test:pi:relay
npm run test:pi:cli
```

- required：全仓类型检查、协议覆盖、Mobile、Registry/Relay、Bridge/CLI、Speech、设计系统、19 语言与文档规则。
- 旧版兼容：OpenClaw/Hermes 的 39 项协议回放通过。
- Pi 单元测试：JSONL/Unicode、进程失败与退出、重连退避、认证与帧限制、请求幂等、问题校验、会话锁、历史树和大历史增量读取、配置优先级、可执行文件与版本检查。
- 真实 Pi 0.87.1：使用临时项目、临时配置与只监听本机的确定性模型端点，实测 read 工具、图片请求与历史附件（不代表真实图像理解）、技能展开、插话、扩展确认与停止、模型会话隔离、流式/历史、手机离线运行、取消、原生分支、重启去重和会话维护。
- 本地真实 Workers：验证 Pi 独立配置、六位码错误证明拒绝及正确证明解密、二维码 claim、多设备响应隔离与广播、重连、Bridge 离线错误。
- 已构建 CLI：真实 Pi 后台配对、status/doctor/logs、stop/start/restart/reset；检查日志不含配对 token，重置保留历史且没有残留 owner 锁。

初轮自动化没有调用真实付费模型；随后负责人授权的 iOS 模拟器实测已完成真实 Qwen 对话和工具/技能执行，详见 [模拟器验收记录](pi-simulator-qa-2026-09-25.md)。Android 真机已完成真实任务与恢复验收，详见 [真机记录](pi-android-qa-2026-09-26.md)。仍未验证真实图片理解、Windows 主机或物理 iOS。Windows npm shim 路径有自动化回归，但不是 Windows 实机结论。实机观感按仓库约定交由负责人确认；测试未改变已有正式连接。Pi 云服务、npm/App 发布需要独立授权。

2026-09-25 验证结果：required 全绿（Mobile 333 套 / 3,455 项），v1 replay 39 项通过；Pi 定向回归 23 项、真实 Workers 联调 1 套、已构建 CLI 生命周期 1 套通过。测试均为本地执行，没有部署或发布。

Android recovery follow-up: pending extension commands do not necessarily create a Pi user-history entry. The Bridge temporarily projects the accepted input while waiting before agent start, keeping recovered activity on the current turn; it does not alter Pi JSONL or invent durable command history.
