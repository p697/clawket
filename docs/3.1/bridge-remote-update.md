# 3.1 手机一键更新 Bridge

负责人 2026-10-06 决定：在「Bridge 更新」页上，可以直接从手机更新当前连接所在电脑上的全部 Clawket Bridge，不必再把命令发到电脑上执行。命令方式保留，作为旧 Bridge、Docker 或自定义部署，以及一键更新失败时的退路。

## 流程

1. 当前连接的 Bridge 在握手时声明 `bridge.remote-update.v1`：Codex、Claude Code、Pi、本地模型的 health 返回 `remoteUpdate: 1`；Hermes 写在能力列表里；OpenClaw 写在 Relay Bridge 补充的 `meta.capabilities` 里，Gateway 自己声明的同名能力会被丢弃。App 用中心能力 `bridgeRemoteUpdate` 判断，默认关闭，只有握手声明后才打开。
2. 当前连接已确认有旧 Bridge 时，页面显示「立即更新」。点击后，App 通过现有连接发送 `bridge.update.start`：Agent 后端走普通请求，OpenClaw 走 Relay control `bridge-update.request`。请求不带参数，Bridge 也不读取参数。
3. Bridge 用自己安装的 bundle 启动 `clawket update --remote <id>`，马上回复已受理，所以这个请求不会占住更新所需的空闲闸门。更新器与命令行执行 `update` 完全相同：读取 npm 官方 stable 版本，暂存并校验后，等所有运行时空闲，依次停旧、启新，失败时回滚。
4. 更新器把阶段写进 `~/.clawket/runtime/remote-update.json`：`checking`、`installing`（带目标版本）、`waiting`（带正在等的后端）、`restarting`，最后是 `updated` 或 `failed`（带固定原因）。手机每 2 秒通过 `bridge.update.status` 读取一次；Bridge 重启期间读取失败，界面按「正在重启」处理。Bridge 重启并握手后，状态文件里的最终结果和新版本一起确认更新完成。
5. 如果所有运行中的 Bridge 已经是目标版本，更新器直接报告 `updated`，不重启任何进程。

## 安全边界

- 只有已认证的完整客户端能发出这两个请求。Relay 的受限配对 socket 到不了这些方法，私有 owner 控制（`info`/`stop`）仍然只在本机可用。
- 手机不能指定版本、包、地址、路径或命令。更新器只安装 npm `latest` 上声明 `updateProtocol: 1` 的正式版，不降级。
- 每台电脑同一时间只跑一个更新，由更新锁和进行中的状态共同保证；第二次请求返回 `running`，并附上当前进度。
- 在电脑上创建 `~/.clawket/disable-remote-update` 文件，即可关闭手机更新：能力不再声明，请求一律返回 `disabled`。
- 运行在开发目录、无法识别出已安装 bundle 的进程不声明这项能力。通过 IPC 由 Windows supervisor 托管的本地模型也不声明，它仍按原方式更新。
- 状态只包含固定类别、版本号、后端名和时间戳，不包含错误原文、路径或进程信息；进程号只留在本机状态文件里，不会发给手机。更新器的输出写入 `~/.clawket/logs/bridge-update.log`。

## 平台

更新器要停掉发起请求的那个运行时，所以必须先脱离它：

- **macOS**：detached 子进程自带新会话，launchd 卸载服务时不会被一起结束。
- **Linux（systemd 用户服务内，即有 `INVOCATION_ID`）**：用 `systemd-run --user --scope` 启动，离开服务的 cgroup，避免 `systemctl --user stop` 把它一起杀掉；没有 `systemd-run` 时退回普通 detached 子进程。
- **Windows**：先启动一个中转进程，由它启动真正的更新器后立即退出，切断父进程链，避免 `taskkill /T` 波及。

如果更新器启动后 60 秒内没有写入自己的进程号，或者进程已经退出，状态会报告为 `interrupted`。

## App 状态

- **可用**：「立即更新」，下方一行说明这次会更新哪台电脑、何时重启；命令收在「改用命令更新」后面。
- **进行中**：一行进度，依次为检查新版本、下载、等某个后端完成任务、重启 Bridge。
- **完成**：「已更新到 X」，页面随新版本切到「更新完成」。
- **失败**：「更新没有完成」，加一句原因（后端仍在运行任务、下载失败、版本不支持、已有更新在进行、电脑已关闭、中途停止、无法确认），附「重试」，命令自动展开。
- 更新状态由 App 统一保存，切换页面和 Bridge 重启都不会丢失；离开指南页时清掉已结束的结果。超过 15 分钟仍未完成，按中途停止处理。

## 发布

Bridge 需要发布包含本功能的版本，App 也需要发布新版本，两边都满足时按钮才会出现。已经在跑的旧 Bridge 不认识这个请求，仍需先用命令更新一次。修复合入 main 不等于发布，发布须单独授权。
