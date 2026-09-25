# Pi Android 真机验收 · 2026-09-25–26

## 环境

负责人授权操作已连接的 Android 手机，并继续修复实际使用问题。设备为 Samsung Galaxy A56（SM-A566B）、Android 16。独立安装 `com.p697.clawket.pitest` 3.1.0 Debug，保留正式 App 与此前 QA App 的安装和数据。

使用真实 Pi 0.87.1、真实 Qwen 3.5 Plus，以及确定性本地模型补充中止/长模型名测试。Bridge 候选从构建输出复制到临时目录后独立 npm 安装；手机经真实局域网 WebSocket 连接，只有 Metro 使用 USB 端口反向映射。通过系统相册导入配对二维码，没有注入连接状态。

## 已实际操作

| 场景 | 证据与结果 |
|---|---|
| 安装与配对 | 独立 Debug 构建、安装、首次 Pi 配对成功；独立安装的 CLI 启动后台 Bridge、doctor 就绪。 |
| 真实代码任务 | 手机要求阅读 sum.cjs/test.cjs、修正减法为加法并执行测试；Pi 实际调用 read 两次、edit 一次、bash 一次，返回 ANDROID_TASK_OK。另行执行项目测试也通过。 |
| 扩展确认 | /question 等待时强制关闭 App，重开后问题恢复；Android 返回键只关闭面板，重新打开回答 Yes 后结束等待。 |
| 扩展输入 | /name 打开输入面板，Samsung 键盘展开后输入 AndroidQA 并提交；修复前按钮被遮挡，修复后编辑区与提交按钮均可见可点。 |
| 后台任务 | Qwen 执行 sleep 15 后输出标记；切到桌面再返回，工具结果与最终回答恢复。重复在工具执行中返回，修复重复工具行后只显示一条命令及其输出。 |
| Bridge 恢复 | 主动停止 Bridge，手机显示正在重连；重启后自动恢复，原会话可继续发送并获得流式回复。此项不是 Wi-Fi/蜂窝切网验收。 |
| 中止 | 确定性模型长回复期间点击停止，Pi JSONL stopReason=aborted。 |
| 模型与会话 | 主会话切换刻意超长名称的模型；新建会话仍默认 Qwen，真实回复 ANDROID_NEW_SESSION_OK，独立原生 JSONL 完整保存。 |
| 输入栏 | 长模型名称不展示 provider、单行截断，加号与模型图标保持间距；长草稿发送后立即后台再返回，空输入框恢复标准高度。 |

## 本轮修复

- Pi 扩展命令在 agent_start 前可能没有原生用户历史。Bridge 仅在运行期间投影本次输入，避免恢复时把待回答状态接到上一轮；不改写 Pi 原生 JSONL。
- Android 扩展输入 Sheet 使用 adjustPan 配合 BottomSheet 键盘协调，避免 edge-to-edge 下输入框和操作区被遮挡。
- 运行恢复后的 toolresult 与迟到的 toolcall 完成事件按同一调用 ID 合并，保留名称与渲染 ID，避免重复工具行。
- 空草稿高度直接回到标准值，避免发送后马上后台导致收缩动画中断、输入框留在多行高度。

- Android 原生 Markdown 在小数屏幕密度下，固有宽度舍入会使末尾字形换到测量高度之外。CommonMark 测量保留一个物理像素，修复完整回复尾字不可见；加入双 postinstall 入口与缺失/漂移/重复安装回归。重新编译安装后，冷启动历史中原来漏掉的 K 已完整显示，再次实际发送同样请求的流式结果也完整可见（markdown-stream-fixed.png）。

## 验证与限制

完整 `npm run check:required` 通过：334 Mobile suites / 3,456 tests，47 runtime files / 362 tests，其他仓库门禁通过。旧协议兼容测试 39 项通过，真实安装 Pi 的显式 integration 通过。最后的输入栏变更另跑 UI 回归 37 项、Mobile 类型检查、设计系统及文档检查；随后原生文字补丁的 3 项回归通过，Android Debug 重新构建并安装成功。

本机证据根目录 `/tmp/clawket-pi-android-20260925/`；截图位于 evidence/，包括 task-complete.png、input-keyboard-fixed.png、cold-pending-fixed.png、background-fixed.png、bridge-offline.png、after-reconnect.png、new-session.png、markdown-width-fixed.png。自动检查日志 required-final.log、ui-confirm.log、compat.log、pi-integration.log。截图来自 ADB 实际操作；Maestro 没有获得可用的 Android 元素树，其尝试不计入通过证据。

该独立 Debug 包会显示 RevenueCat 无对应商店商品的开发警告，本轮未验收计费。没有验证物理 iOS、Windows、真实图像理解、官方 Pi 公网服务、商店包安装升级或长时间跨网运行。此前 iOS 模拟器覆盖见 [模拟器记录](pi-simulator-qa-2026-09-25.md)。现有 npm 3.0.0 不包含 Pi，官方 Pi 云服务尚未部署；这些端到端发布环节仍是对外提供 Pi 前的必要工作。本轮没有部署、发布 npm/OTA、构建分发包或提交商店。

收尾：本轮临时 Bridge、模型服务与 Metro 已停止，手机的 USB Metro 映射和测试二维码图片已移除，临时模型凭据及配对配置已删除。全局 Pi 的可用模型配置保留。独立 Debug App 保留并已关闭；其测试连接现在离线，继续使用需要重新启动开发服务。
