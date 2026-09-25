# Pi 模拟器验收 · 2026-09-25

负责人明确要求实际连接、发送消息、测试基础功能并修复问题；随后授权复用本机 OpenClaw 模型配置。

## 环境与边界

- 本地 Debug App，iOS 27.0 `Clawket Bridge Review` 模拟器；Maestro 实际点击和输入，simctl 原生截图。
- 实际安装的 Pi 0.87.1、当前源码构建的 Bridge、本机 WebSocket 连接。通过相册导入真实配对二维码，没有注入已连接状态。
- 临时项目 `/tmp/clawket-pi-simulator-20260925/project`，独立 Pi agent/session/extension/skill 目录。
- OpenClaw 的 OpenRouter 凭据返回过期、Moonshot 返回 401；复用可用 DashScope 凭据，真实模型为 `qwen3.5-plus`。用户 Pi 默认模型已配置为 Qwen 3.5 Plus；凭据仅存本机权限 600 的私有配置，不进入仓库或报告。
- 免费状态验证配对、主聊天、新建会话、工具及扩展回答；原生历史完整查看/续聊使用仓库已有的本地 `EXPO_PUBLIC_UNLOCK_PRO=1` QA 开关，不购买或改变真实订阅。

## 实测与修复

| 项目 | 结果 |
|---|---|
| 相册二维码配对 | 连入 Pi 项目；首次主会话误入历史预览已修复：Bridge landing descriptor 必须是 `kind: main`，与 Agent 的 `mainSessionKey` 一致。 |
| 真实模型消息 | 收到 `PI_REAL_CHAT_OK` 和 `17 plus 25 is 42`；Pi JSONL 记录 provider=dashscope/model=qwen3.5-plus/stop。 |
| 真实工具与技能 | Qwen 调用 read（并检查目录），返回 sample.txt 原文；选择 fixture-check 先准备草稿，补充请求后执行并返回检查报告。 |
| 扩展确认与输入 | `/question` 点“是”、`/name` 填写 `Mobile QA task` 后继续聊天。打开面板先收起聊天键盘，完成后通过 visible 关闭仍挂载的 Sheet，避免遮挡按钮/残留遮罩。重启 App 后待回答问题仍能恢复。 |
| 会话 | 免费新建会话收到真实 `NEW_SESSION_OK`；重命名为 Mobile QA。重命名输入框补上 BottomSheet keyboard coordination，键盘展开时 Save 可见可点。 |
| 重置与删除 | 实际重置 Mobile QA 后历史为空，删除测试分支后列表不再显示该分支。修复重置残留 preview/model 元数据；保留幂等键避免旧请求回放。深色确认说明使用主题文字颜色。 |
| 模型隔离与停止 | Mobile QA 切换本地 Pi Test Two，主会话仍为 Qwen；长流式回复中按停止，Pi 原生日志 stopReason=aborted。此项使用确定性模型，不是真实推理。 |
| 原生历史分支 | 原生记录只读，点击“在新会话中继续”创建可发送分支并收到实际 Pi/本地模型回复。原生 JSONL 的 SHA-256 前后一致。 |
| 断线恢复 | 主动停 Bridge，App 显示正在重连；启动后自动恢复，在原会话发送 AFTER_RECONNECT_OK 并收到 pi-test-two 回复。 |
| 模型栏 | 保留完整模型引用供图标与选择使用；显示优先采用 catalog 名称，回退去除 provider 路径。模型文字单行尾截断且可收缩，加号后保留间距，思考控制不被挤压。用刻意超长名称验证浅/深色及键盘展开状态。 |

## 验证证据

本机截图、Maestro 流程和日志位于 `/tmp/clawket-pi-simulator-20260925/`。关键截图在其 `evidence/`：`real-chat.png`、`real-tool.png`、`composer-fixed.png`、`question-fixed.png`、`rename-fixed.png`、`native-readonly.png`、`native-branch.png`、`bridge-offline.png`、`long-model-light.png`、`long-model-dark.png`。不要分享该临时目录中的 pairing/config 文件；它们不属于截图证据。

- `npm run check:required` 全绿：333 Mobile suites / 3,455 tests，47 runtime files / 360 tests，其余仓库门禁通过。日志 `/tmp/clawket-pi-ui-required.log`。
- 后续 question/session UI 回归 15 项通过，最终 Mobile 类型检查、设计系统与文档检查通过；真实 Pi integration 再次通过。reset 回归后 runtime 全套 361 项通过。日志 `/tmp/clawket-pi-ui-followup-tests.log`、`/tmp/clawket-pi-ui-type-final.log`、`/tmp/clawket-pi-ui-docs-final.log`、`/tmp/clawket-pi-ui-integration.log`。
- Maestro 初轮发现的问题修复后重新操作确认；错误 selector、截图输出目录限制和仅选择技能未输入请求造成的脚本失败不算产品通过证据。

尚未进行物理 iOS/Android、Windows、真实模型图像理解或 Pi 公网服务验收。当前结果是本地开发版本与模拟器的端到端验收，没有部署、上传、提交商店或发布 npm/OTA。

收尾：临时 Bridge、确定性模型服务、Metro 已停止；临时 provider 凭据与配对文件已删除，QA Pro 开关已撤去，模拟器恢复浅色。用户全局 Pi 的 Qwen 配置保留。模拟器中的测试连接现在离线，截图与非敏感日志保留供复核。
