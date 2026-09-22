# 2026-09-21 · 工作流与小组件验收候选

当前是可安装验收的候选，不是完整 3.0 / 3.1 范围交付，也尚未发布生产或商店。完整范围和剩余实现以 [24-mobile-task-workflows.md](24-mobile-task-workflows.md) 为准。

## 本轮可以验收的内容

| 内容 | 已实现的行为 | 实际验证 |
|---|---|---|
| 桌面小组件 | 单色聊天胶囊、相机/照片/语音/技能圆形入口；安卓按桌面实际尺寸适配，iOS 小/中尺寸 | Samsung A56 真机与 iPhone 模拟器截图；浅深色、大小尺寸；选图发送、语音确认入口、相机取消 |
| 会话面板 | 最新修订：新建回到右上角单图标；搜索独立成行；默认高度 95% | 双端正常/大字号；iPad 横屏；点击创建真实会话 |
| 聊天技能 | 选择已安装可用技能，进入当前草稿，明确发送才调用 | OpenClaw / Hermes 真实调用；失效能力不显示可用入口 |
| 聊天转定时任务 | 从已完成会话形成可编辑、有限长度的任务说明，确认后创建；Hermes 支持任务独立模型 | 原生 Cron 创建、模型读回、实际执行与删除；不是仅测接口返回 success |
| 记忆和技能文件 | 读取、编辑、差异、版本恢复；保留原文空白 | Hermes 原生文件恢复前后逐字节一致；双端源码界面检查 |
| Hermes 技能管理 | 安装、来源、原生安全扫描、读取与卸载，避免覆盖手工目录 | 两端实际 ClawHub 安装/读回/卸载；清理后目录、登记和 usage 无残留 |
| 系统分享 | 文本、链接、图片和文档进入目标选择与草稿；后端确认发送后才消费收件记录 | 双端原生系统分享及实际回复；图片跨设备历史不再重复气泡 |
| 会话归档 | 本机保存完整分页快照，重命名、置顶、文件筛选、检索及 Markdown/JSON 导出 | Android 实际改名、置顶、文件筛选和系统导出；iOS 精确改名、持久化读回与冷启动置顶筛选 |
| 草稿稳定性 | 按连接/Agent/会话隔离；旧草稿先预览再主动恢复；串行写入避免已发送内容复活 | 两端恢复、冷启动保留、清空；安卓最终清空后再冷启动为空 |
| 运行中的控制 | Hermes 追加指令、协作取消、待审批恢复；永久授权单独确认 | 原生追加/取消、两端允许一次或拒绝；超时拒绝；未授予永久许可 |
| 付费入口 | 保存、阅读、单条导出、基础整理免费；全文检索/批量导出按使用场景引导 Pro | 免费门禁与付费墙界面回归；不代表商店支付验收 |

此外修复了 Android 发现页 WebView 原生崩溃、切换主题后圆形按钮的方形阴影、弹层挡住系统分享、聊天历史顺序和重复图片消息、技能卸载登记残留等实测问题。

最新布局修订：负责人要求将新建会话移回右上角，搜索保留正文内。下方旧截图与 Release 527 记录是上一候选的证据；新候选 577 双端构建安装、完整门禁和两端布局截图检查已通过，详见 PROGRESS。

## 当前验证范围

- 最新移动端原生候选：Release 527。Android 使用独立 QA 包 `com.p697.clawket.qa`，未替换原商店包；iPhone / iPad 使用模拟器。QA 包启用 Pro 测试覆盖，不是商店签名包。
- 完整 `check:required` 526 通过：Mobile 322 suites / 3,327 tests；Bridge 36 files / 316 tests，以及其余工作区类型、设计、语言和文档检查。
- v1 协议兼容回放 531：39 项通过。真实本机 Hermes 集成 533：37 项通过。
- iPad 深色横屏新会话发送得到 `IPAD_HERMES_VERIFIED`，并检查会话面板。不能据此替代 iPad 真机、外接键盘或所有窗口尺寸验收。
- 自动化失败均保留真实记录：早期 iPad QA 二维码路径错误、键盘移动期间的点击，以及 iOS 自动化未清空旧标题不计通过；使用正确二维码/稳定控件/清空后输入重新完成相应流程。
- 全量门禁 520 曾在同时构建时触发整段回放 5 秒超时；整段测试改为 15 秒，各包期限和断言保留。526 是修改后的完整通过记录，没有放宽生产运行超时。

## 验收重点与发布前缺口

1. 先看实机桌面小组件、会话列表和归档菜单的比例、留白、文字密度。截图已自检，最终设计品味由负责人验收。
2. 远程推送的 APNs/FCM 注册、撤销、去重、服务端投递尚未实现。应用退出后的通知不能算已支持。
3. 生成结果文件的安全下载/打开/保存、原生澄清问答、Hermes 高级供应商配置和预算洞察仍未完成；现有文档输入、导出、基础模型切换/诊断不等于这些能力。
4. 聊天转定时任务目前生成可审阅的结构化说明，没有额外 AI 摘要调用；从回复开新会话仅携带所选回复，不是完整上下文分叉。
5. 真实商店沙盒购买、恢复、升级与旧权益需要签名包/测试账号验收。没有实施普遍七天试用，也没有虚构资格或本机到期时间。
6. 生产 Relay / Registry 尚未发布，旧版生产链路的问题不能靠本机测试宣称解决；发布仍需兼容、恢复与正式服务端验收。更广泛的跨设备、断网和后台恢复矩阵仍有待补项。

临时测试内容未自动发送；本轮私密二维码文件和 App 选图缓存已清理。iPad 模拟器相册中的两张 QA 二维码已移入“最近删除”，永久清理受现有设备密码保护，见 PROGRESS 的 HT-QA-PHOTO-0921。

## 截图

以下为实际设备/模拟器截图，没有用效果图代替实现。

- [Android 桌面最终效果](evidence/workflows-2026-09-21/widget-review/android-wide-light-final.png)
- [Android 深色小组件](evidence/workflows-2026-09-21/widget-review/android-wide-dark.png)
- [最新 Android 右上角新建](evidence/workflows-2026-09-21/widget-review/android-session-header-577.png)
- [最新 iOS 右上角新建](evidence/workflows-2026-09-21/widget-review/ios-session-header-577.png)
- [Android 大字号会话面板](evidence/workflows-2026-09-21/widget-review/android-sessions-large-text.png)
- [iOS 桌面小组件](evidence/workflows-2026-09-21/widget-review/ios-widgets-light.png)
- [iOS 会话面板](evidence/workflows-2026-09-21/widget-review/ios-sessions-final.png)
- [iOS 归档整理](evidence/workflows-2026-09-21/widget-review/ios-archive-organized-527.png)
- [Android 归档整理](evidence/workflows-2026-09-21/widget-review/android-archive-organized-527.png)
- [iPad 横屏 Hermes 回复](evidence/workflows-2026-09-21/widget-review/ipad-hermes-landscape-reply-527.png)
- [iPad 横屏会话面板](evidence/workflows-2026-09-21/widget-review/ipad-hermes-landscape-sessions-527.png)


## 按需文件取回试用（2026-09-21）

入口为聊天「＋ → 会话文件」。电脑/Bridge 必须在线；仅支持当前会话最近 200 条消息中助手明确引用、允许目录内的常用文件，单文件不超过 10 MiB。不是整个电脑文件浏览器。旧 Bridge/直连原生 Gateway/旧生产 Relay 未协商到能力时隐藏入口。OpenClaw 当前端到端通过的是 Preview 独立连接，未发布生产 Relay。

已验证：Hermes Android 真机和 iOS 模拟器的列表/下载/系统分享；OpenClaw Preview iOS 同样通过；两个后端 iOS 下载缓存均与电脑原件逐字节相同。安全与取消回归、完整 required 587、v1 39 项及原生 Hermes 37 项均通过。没有执行真实外发，也没有证明所有第三方接收 App 的保存行为。iOS“保存到文件”选择后未完成独立落盘验收，保留为验收关注项。

无云端文件副本；Relay 仍转发文件字节。Android 为避免接收 App 读取时文件已被删除，保留手机本地临时文件，24 小时后下次下载清理；失败/取消的半成品立即清理。远程通知不在本次实现范围。

截图：[Android 列表](evidence/workflows-2026-09-21/session-files/android-hermes-list.png)、[Android 系统分享](evidence/workflows-2026-09-21/session-files/android-hermes-share.png)、[iOS 列表](evidence/workflows-2026-09-21/session-files/ios-hermes-list.png)、[iOS 系统分享](evidence/workflows-2026-09-21/session-files/ios-hermes-share.png)、[OpenClaw Preview](evidence/workflows-2026-09-21/session-files/ios-openclaw-preview-list.png)。
