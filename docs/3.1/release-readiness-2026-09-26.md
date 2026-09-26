# 3.1 发布前复核 · 2026-09-26

结论（09:23 更新）：**Pi Preview 核心链路验收通过，可以进入正式发布流程**。已完成独立云服务部署、Android 真机与真实模型公网测试，并修复重启恢复问题。生产服务、npm 包和最终签名客户端尚未发布或验收，因此这不是“现在即可让正式用户使用”的结论。下文早间补验覆盖夜间发现的 Pi 公网缺口。

## 夜间验证（Preview 部署前）

设备：Samsung Galaxy A56 / Android 16，独立 `com.p697.clawket.pitest` Debug 3.1.0，使用当前工作区 JS 与此前已安装的 Markdown 原生修复。临时 Metro 启用本地 Pro 测试开关；这不构成商店包或购买验收。Pi npm 最新版查询结果为 0.87.1，与已安装测试版本一致。

| 范围 | 结果与边界 |
|---|---|
| OpenClaw Preview 公网 Relay | 手机相册导入实际 Preview QR，认证、Agent/历史列表、新建会话、真实 Claude 回复 `OPENCLAW_PREVIEW_OK` 通过。冷启动后可重新发送，后台返回后看到真实回答；该轮 Agent 未按标记要求回复，不能将模型行为记作精确标记通过。 |
| Hermes 本地 LAN | 相册 QR 配对、历史恢复、真实 DeepSeek 回复 `HERMES_0926_OK`，冷启动后再次回复 `HERMES_RECONNECT_OK` 通过。 |
| Hermes 生产公网 Relay | 使用已有服务刷新邀请后相册配对，历史恢复、真实 DeepSeek 回复 `HERMES_RELAY_OK` 通过；冷启动再次发送、切后台返回后收到 `RELAY_RESTORED_OK`。只进行了正常配对/聊天，没有部署或修改生产服务配置。 |
| Pi | 本轮真实 Pi integration、构建后 CLI 生命周期、隔离本地 Registry/Relay 三项显式集成测试通过。此前 iOS 模拟器与 Android 真实 Qwen 任务、工具、扩展、模型切换、后台/重连结果见相邻 QA 文档。本轮不宣称完成 Pi 公网测试。 |
| 官方 Pi 图标 | Android 连接 Agent 页面实际显示官方彩色图标。修复新增 PNG 缺少 Jest mock 导致四个 suite 无法加载的问题。 |
| 全仓必需门禁 | `npm run check:required` 最终退出 0；Mobile 334 suites / 3,456 tests，runtime 362 tests，其余类型、服务、CLI、设计系统、19 语言、文档检查通过。 |
| 历史协议 | `npm run test:compat`：5 files / 39 tests 通过。 |
| 升级/回退矩阵 | 当晚只读导出四份真实生产 Worker，执行 `test:release:compat`：OpenClaw/Hermes × 候选/历史 0.7.0 Bridge，四组各六阶段通过。是本地 workerd 演练，不是 Cloudflare 控制面迁移回退证明。 |
| 恢复准备 | 两份 Registry 固定 recovery bundle 已生成，校验生产快照、恢复代码和配置哈希通过。Pi 两份 example 配置 dry-run 编译成功；占位 KV/身份仍不是可部署正式配置。 |

证据目录：`/tmp/clawket-release-20260926/`。主要日志为 `required-final.log`、`compat.log`、`rollout.log`、`pi-integration.log`、`pi-cli.log`、`pi-relay.log`、`recovery.log`；无凭据截图包括 `official-pi-onboarding.png`、`hermes-response.png`、`hermes-reconnect.png`、`hermes-relay-response.png`、`oc-response.png`。扫码图片和含邀请凭据的输出不作为公开附件。

## 云端与候选状态

部署前清单确认 OpenClaw/Hermes 各自 Production、Preview 都存在；旧后端 Preview 的修改时间早于当前候选。本轮只新增/更新 Pi Preview，Pi Production 仍未部署。

生产基线（2026-09-22 部署）：

| Worker | version ID |
|---|---|
| clawket-registry | bc3a2ab9-beb4-4858-9541-85031598c85a |
| clawket-relay | 7aff2f6b-57a2-46d4-9358-64d4a44fbdfe |
| clawket-hermes-registry | 47da186b-f63f-4683-83a9-0fa9fce3bcb2 |
| clawket-hermes-relay | 276c5488-5422-44c2-8ba7-ddb681f20707 |

完整哈希和 deployment ID 在 `snapshots/manifest.json`。两份 Registry SHA256 相同，两份 Relay SHA256 相同，但各自部署身份与资源必须保持独立。

PR #41 已合并，但当前测试工作区含合并后官方图标/mock 修改，也含原有本地 speech/community-build 提交。发布前必须固定唯一候选提交，确保测试过的必要改动都进入该提交；不能直接把 PR #41 的旧 SHA 当作本轮完整验收对象。当前 npm 3.0.0 不含 Pi，CLI 版本尚未按负责人选择更新。

## 早间 Preview 部署与补验

负责人明确 Preview 不需单独审批，根 AGENTS 发布规则已同步；生产与分发授权边界保留。实际部署：

| 服务 | 最终 version ID |
|---|---|
| `clawket-pi-relay-preview.clawket.workers.dev` | `4ac8bb54-4584-47f8-a303-8dfb07a750c8` |
| `clawket-pi-registry-preview.clawket.workers.dev` | `650931d7-1ba5-43f8-94e4-28b28d8b8691` |

专属 KV `e1093a55e5f14315a34476457f26f774`、PiRelayRoom 与 PairRegisterRateLimiter namespace 已创建。两端使用专属新密钥，Registry service binding 只指向 Pi Preview Relay。云端 settings 确认 query-string redaction 开启、invocation logs/traces 关闭；OpenClaw/Hermes 生产部署未改动。实际配置保存在忽略的 `wrangler.pi.preview.local.toml`，公开 example 保持占位资源。

| 测试 | 实际结果 |
|---|---|
| Android 真机公网配对/工具 | 本地 Bridge 仅监听 loopback，手机通过新 Preview QR 经公网连接；真实 Qwen 读取、修复 `sum.cjs` 并执行 `node test.cjs`，返回 `PREVIEW_TASK_OK`；外部执行同一测试也通过。任务期间切后台再返回，工具与最终回复恢复。 |
| 扩展问题与冷启动 | 在隔离 Pi agent 目录安装测试扩展（不绕过项目扩展信任）；手机 `/question` 显示待回复，强制停止 App 后重开仍恢复，点击“是”后任务结束、输入框恢复。 |
| 双客户端真实云端 | 健康、会话新建/命名/列表、当前模型选择、真实 `CLOUD_MULTI_OK`、重复发送幂等、双方流式事件、请求响应不串线、另一客户端回答扩展问题、取消后 run/question 清空、重置/删除全部通过。 |
| Bridge 重启 | 实测发现旧 owner lease 导致 409，指数重试错过启动期限；改为仅 409 每两秒重试，保留其他错误退避和 `relay.ready` 成功依据。回归覆盖连续冲突，实际立即 restart 在 21.24 秒内退出 0，之后真实云端全套再次通过。 |
| 错误文案 | Pi bridge 离线时原误显示 Hermes；修复并更新 Pi Preview Relay，Hermes 原文案保持不变。 |
| 环境隔离 | 新 Pi Preview 官方域名纳入 Preview 检查，非 Debug/环境不匹配拒绝；自建地址行为不变。新增回归通过。默认 Pi 六位码仍指向正式 Registry；Preview 测试使用显式 Registry QR，不宣称正式六位码已上线。 |
| 最终门禁 | 修改后 `check:required` 退出 0；`test:compat` 5 files / 39 tests 全绿，且先过兼容门禁再部署修复。Pi Relay 显式集成测试再次通过（含离线错误和重连）。 |

证据：`/tmp/clawket-pi-preview-20260926/`，包括 `required-final.log`、`compat-final.log`、`cloud-final.log`、`restart-fixed.log`、`relay-deploy-final.log`、`task-complete.png`、`question-restored.png`、`question-dialog.png`、`question-answered.png`。本轮新增公网移动端覆盖来自 Android；不将此前 iOS 本地测试描述成这次新云端 iOS 测试。

Preview App/Universal Link 身份仍使用 example 占位值，本轮未验收浏览器一键打开 App。正式环境必须填入真实签名身份，并验证实际安装包及默认六位码入口。

## 正式发布顺序

建议 **服务端就绪并验收 → Bridge npm → 客户端**，不是先把默认依赖尚不存在服务的 Bridge 发出去。

1. 固定包含本轮修复的唯一候选提交；Pi Preview 核心实测缺口已关闭，保留最终签名包与正式入口检查。
2. 经授权建立隔离的 Pi Production 资源。先部署 Relay（Registry URL 预先配置），再部署含 Relay service binding 的 Registry，设置两端匹配的独立密钥并验证完整链路。服务全部就绪前不对外推广入口。Pi 扩展不要求顺手重发 OpenClaw/Hermes 部署单元。
3. 经授权选择 Bridge 版本并发布 npm；在干净安装上验证用户实际使用的 `npx` 命令与默认正式服务。当前 3.0.0 包不满足此项。
4. 经授权构建并验收最终签名客户端，确认官方配置、无 Pro 测试开关、旧版覆盖升级，再按负责人批准的商店流程发布。

仍未覆盖：最终商店包、真实付费、物理 iPhone、长时间 Wi-Fi/蜂窝切换、Pi 正式云端及真正首次云端 DO 迁移。保持这些边界明确，不把短时 Debug 冒烟描述成长期生产稳定性保证。

夜间测试曾清理临时资源；早间为 Preview 补验再次启动了隔离 Bridge/Metro。收尾已停止本轮隔离 Pi Bridge 和 Metro，移除 USB 8081 映射、手机新增 QR 与本机私密邀请/配置/模型凭据副本；Preview 云服务保留。测试凭据与二维码不作为公开证据，不改用户原有模型配置或 OpenClaw/Hermes 运行状态。
