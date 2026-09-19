# 3.0 发布前产品保全与连接审查 · 2026-09-20

> 负责人后续决定（2026-09-20）：非主会话收费维持现状，P-1 不再要求调整宽限；语音交由语音 Agent 处理；生产尚未发布是已知发布阶段。备份删除、技能辅助文件入口和协议覆盖率已在本轮跟进修复。新建会话的数据复核见 [分析结果](session-creation-analytics-2026-09-20.md)，恢复包与执行步骤见 [恢复操作单](registry-recovery-runbook.md)。以下正文保留初次只读审查时的发现，最新验证以 PROGRESS 顶部跟进记录为准。


结论：可以继续收敛候选版，但当前不宜直接全量发布。主要旧付费能力仍在，几处早期迁移遗漏已修复；仍有局部能力缺口、老用户权益过渡缺口和生产准备未完成项。连接基础通过了本轮兼容与混合版本测试，没有发现 OpenClaw / Hermes 主链路整体失效的证据；这些结果不等于真机、生产迁移或长期稳定性签字。

**检查口径**：`4870730` 加当前工作区（开工时约 351 个变更条目，包含未跟踪文件）；没有修改产品代码、部署服务、重启用户后端或执行购买。历史对照采用 `c2bfe068`（2.1.0 已发构建源码）、`717f265^`（3.0 改造前快照），版本来源限制见 [PINNED](../../tests/compat/PINNED.md)。后者不是“所有用户实际装过的 2.0”。

**数据口径**：使用仓库已有 PostHog 调研记录，没有在本轮重新查询 PostHog。人数、页面浏览和购买成功事件分别标注；购买事件未经 Sandbox 排除，不能当成真实成交或收入。本轮重新核查的是当前代码、Cloudflare 部署/绑定名称、npm 版本及测试结果。此前报告见 [09-16 审查](final-release-review-2026-09-16.md)，最近已恢复的功能以当前代码为准。

## 产品保全

| 能力与历史信号 | 当前落点 / 结果 | 判断 |
|---|---|---|
| 多连接：此前记录 56 次购买成功事件（03-16 至 09-15） | Roster / Connections、免费连接选择、多连接 Pro、旧凭据迁移 | 核心能力保留；真实旧会员恢复仍需验收 |
| 备份：21 次购买成功事件（同一窗口，含旧别名） | OpenClaw 管理 → 备份；创建和恢复保留，删除入口缺失 | 不完整迁移，见 P-2 |
| 权限 / 诊断：17 / 6 次购买成功事件 | OpenClaw 管理对应分段、查看与修复能力 | 未发现整项删除；本轮未在日常 Gateway 执行修复 |
| 日志：10 次购买成功事件 | 运行日志免费预览、Pro 完整访问 | 保留 |
| App 图标：9 次购买成功事件 | 账户设置图标选择 | 保留；系统图标实际切换未由本轮验收 |
| 文件编辑：约 610 人访问、8 次购买成功事件（09-14 调研） | Identity、Files → 完整 DocumentScreen，编辑、保存、失败保草稿、Pro 续做 | 已恢复；此前长文编辑简化问题不能再列为未修复 |
| 历史 / 收藏：ChatHistory 1,918 views、messageHistory 4 次购买成功事件（09-16 调研） | Search、消息详情、空查询收藏列表 | 核心能力保留，入口变化；本机缓存并非跨设备同步 |
| Usage：1,277 人访问（03-10 至 09-11 调研） | Agent 主页费用卡、Usage 今天/7D/30D、海报 | 已从隐藏入口恢复；今天免费，长周期 Pro 是明确决定 |
| Cron：7,471 views（09-16 调研） | 主页卡、任务、运行记录、心跳、创建/编辑；已恢复失败已读和正文入口 | 保留并增强；运行正文依赖后端保留的转写，不能保证所有历史全文 |
| Models：4,548 views（同上） | 模型目录、默认/备用、成本/删除/allowlist、聊天内切换 | 最近已补齐；模型管理写操作 Pro、聊天切换免费是明确决定 |
| Skills：6,399 views；发现页 691 人、186 人点安装（后者 09-19 的 180 天调研） | 已安装开关、ClawHub 网页发现、Chat 安装、SKILL.md 编辑 | 主路径恢复；辅助文件仍缺，见 P-3 |
| Channels：923 人触达（09-19 调研） | 已恢复 DM Scope 与渠道账号开关；设备/节点审批和管理保留 | 先前只读迁移问题已修复；子功能无旧埋点，不能量化其使用人数 |

### P-1 · 高优先级：非主会话的新付费限制没有覆盖对应老用户的宽限

这不是泛泛担心付费墙。当前代码存在可重复的具体组合：一个连接、一个 main Agent，用户以前一直在其 Telegram/Slack 等非主会话聊天；首次升级后直接只读两条，没有 14 天宽限。单连接 Hermes 的其他会话也同样不满足宽限判定。

- [ThreadScreen:237](../../apps/mobile/src/screens/Thread/ThreadScreen.tsx#L237) 对非主会话的非 Pro 用户启用预览并给 controller 传 `readOnly`。
- [pro-entitlement-bootstrap:18](../../apps/mobile/src/services/pro-entitlement-bootstrap.ts#L18) 只识别 OpenClaw **非主 Agent** 的缓存，明确排除 Hermes；不识别主 Agent 的非主会话。
- [pro-entitlement-storage:171](../../apps/mobile/src/services/pro-entitlement-storage.ts#L171) 仅 `连接数 > 1 || hasNonMainAgentSession` 发放宽限。
- App 把这个同一宽限传给 `sessionHistoryGraceActive`。本轮直接执行真实纯函数：OpenClaw 主 Agent 渠道会话、Hermes 其他会话均 `nonMainSession=true / graceUntil=null`；非主 OpenClaw Agent 对照组获得宽限。输出见本轮 evidence 的 `grace-repro.json`。

限制本身是 09-11 已批准的 [产品决定](21-session-preview-pro.md)，但新增受限人群没有相应过渡保护。已有调研显示 65% 的发送者切过会话，重度切换者贡献 71% 的发送；它比 Office 页面删除更直接影响聊天重度用户。**建议保留既定收费策略时，至少为旧非主会话使用者补明确的迁移宽限和说明**，并单独验证有效旧 Pro 从启动到恢复购买都保持完整访问。不能用历史数字推算本轮确切受影响人数。

### P-2 · 中优先级：备份删除漏迁移

旧 `717f265^:apps/mobile/src/screens/ConfigScreen/GatewayConfigBackupsScreen.tsx` 第 91–108、184–193 行有删除确认和 `deleteGatewayConfigBackup` 调用。当前 [BackupsSection:534](../../apps/mobile/src/screens/AgentSettings/OpenClawManageSections.tsx#L534) 只有创建和恢复；底层 `StorageService.deleteGatewayConfigBackup` 仅被测试调用，管理适配器也没有 delete 操作。

影响：包括 Pro 在内都不能从备份界面清理过期/误建备份。没有发现批准删除此动作的记录。建议恢复原有删除确认，不扩大备份功能。历史 21 次购买事件证明备份是付费价值来源，但不能证明“删除”本身高频。

此外，备份仍是没有 connectionId 的全局列表，可以在 B 连接恢复 A 的配置；这是 2.x 沿用风险，不是新回归。多连接越来越重要后，至少应标来源与明确跨连接恢复，兼容旧备份，不能静默丢弃。

### P-3 · 中优先级：技能辅助文件浏览仍未恢复

旧 `SkillContentScreen` 使用 `linkedFiles` 和 `filePath` 浏览 references/scripts 等关联文件。新 [skillSourceDocument:63](../../apps/mobile/src/screens/AgentSettings/document-model.ts#L63) 只读主文档，丢弃 linkedFiles，没有选择文件的入口。09-16 已记过此缺口，09-19 改成完整 DocumentScreen 后仍未补齐。

建议恢复后端允许范围内的只读辅助文件浏览，或明确记录减法；不要把“SKILL.md 可编辑”当作所有旧技能文件能力对等。当前 Bridge 文档兼容层有意只支持 SKILL.md，扩展必须保留 Agent/授权/路径安全边界。没有独立子功能用量，不能声称是高频付费损失。

### P-4 · 需在发布前明确：语音升级尚未形成 Production 闭环

原 iOS 系统语音模块已删除，新 [useChatVoiceInput:204](../../apps/mobile/src/chat/useChatVoiceInput.ts#L204) 仅在 `EXPO_PUBLIC_SPEECH_URL` 非空时显示支持；同步脚本只把本地语音端点发往 development。Cloudflare 本轮列举当前账号，只找到 `clawket-speech-preview`，与 [22 语音规格](22-voice-input.md) 的 Preview 阶段一致。

这不证明远端 EAS production 变量一定为空（本轮未读取它），但**缺少正式端点会让新版直接没有麦克风；误配 Preview 则受到整个服务每天 200 次录音的测试额度限制**。上线前应确定 Production 服务、额度/权益、构建配置、真实双端录音验收。不能因开发包语音正常认定商店包正常。

### 已批准的减法与仍需关注的聊天体验

- Office、旧 Console 首屏、Live、独立 Discover Tab 的删除有决定；判断应看工作流是否有替代，不能要求复原旧 UI。Office 历史有 39,510 views，这既不能证明没人用，也不能证明用户从中获得价值；本轮没有新的行为漏斗证据要求恢复它。
- **App 新建会话入口也对 Pro 消失**，是 09-11 明确要求，不是漏接。Adapter `createSession` 仍在而 UI 无调用。现有会话可切换，但“保留旧对话、另起独立话题”已不能从 App 直接完成。既然定位进一步转向高质量聊天，建议把它当明确产品取舍复核，不擅自恢复。
- 回复通知是明确删除：2.x 已硬编码禁用，旧事件只落在更早的 1.0/1.1，不能称为 2.0 高频能力丢失。Prompts 没有埋点，不能把无数据当作无人使用。YouMind 入口当前已恢复，09-16 报告的“隐藏入口”已过时。

## 工程与发布风险

### E-1 · 当前必需门禁红灯，必须在固定候选上解决

本轮 `check:required` 先完成全部 workspace typecheck，随后协议包分支覆盖率 99.54%（要求 100%）失败，缺口为 `mock.ts:610`。这是覆盖门槛失败，不是已经证实的用户运行故障；也不能忽略或降低阈值来发布。

为避免前置失败遮住后续结果，本轮单独执行后续套件：Mobile 全量 3,096/3,098，CronEditorScreen 的分页断言和一个 5 秒超时失败；同套独立重跑 20/20，属于全量环境下的不稳定验证，不能据此宣称分页产品逻辑必坏，也不能把全量红灯改记为绿。i18n 缺翻译为 0，但五个旧 key 导致 strict 失败。

### E-2 · Production 六位码与 CLI 发布顺序尚未完成

09-20 只读 Cloudflare 查询：四个服务仍分别是 03-22 的 OpenClaw、04-12 的 Hermes 旧部署，与 09-16 snapshot manifest 的版本 ID 一致。OpenClaw Registry/Relay 的 secret 名单和完整 binding 名单均无 `PAIRING_TICKET_SECRET`；没有读取密钥值。

[Registry:503](../../apps/relay-registry/src/index.ts#L503) 只有匹配配置和 Relay 支持都在时才提供新短码能力，否则退回兼容邀请；这不表示所有旧 QR 断掉，但新用户六位码主流程尚未准备好。npm 本轮查询 `@p697/clawket@latest` 仍是 **0.7.0**，不能用本地 3.0 源码版本证明用户安装得到新 Bridge。

关闭条件：准备服务端配置，按 Registry → Relay → 小范围 Bridge → App 推进；每步核验旧配对和旧 QR/12 位流程，再验六位码、一次 claim、过期及重复 claim。禁止把所有层同时切换后才排查。

### E-3 · 首次 Registry DO 迁移不能靠简单 rollback 恢复

两个候选 Registry 新增 `PairRegisterRateLimiter` DO；当前生产 Registry 没有该绑定或导出。Cloudflare [官方回滚限制](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/) 明确限制跨 DO 类生命周期变更回滚。此次本地五阶段矩阵绿色只证明代码/协议/数据兼容，**没有演练云端 DO 迁移回滚**。

关闭条件：准备保留新 DO 类、绑定、迁移和限速的前向恢复产物，或先建立兼容基线，在隔离资源演练。不能以删除 DO/限速来恢复，也不要把 `npm latest` 回指旧包当作已安装 Bridge 自动降级。

### E-4 · 多设备设计有覆盖，但发布承诺需要限定版本与真实场景

OpenClaw 通过 `bridge.client-sockets.v1` 协商，每个完整客户端拥有单独的 Gateway 握手。当前单测覆盖相同请求 ID 不串设备、内存丢失后的路由、单通道重启、过期 socket、严格 8 MiB 原帧。Hermes 继续自己的按请求来源路由，单独覆盖健康探针、替换 socket 和休眠恢复，不能把 OpenClaw 的新通道机制套在 Hermes 上。

旧 Bridge/Relay 无协商时仍走兼容路径；**“旧用户仍能用”不代表“不升级 Bridge 也获得新版多设备行为”**。需要在真实两台 App 上覆盖：同时发送、相同/不同会话、A 锁屏 B 继续、A 断网重连不影响 B、Bridge 重启后双方恢复、旧/新 App 混用、5 MiB 图像、停止正确的 run。当前本轮没有执行这组真机矩阵。

还需避免把多设备连接描述为数据同步：收藏、草稿、缓存、未读仍在本机；已记录发送端图片缓存使第二台设备可能只看到文本，取决于后端历史是否含图像。这是已知边界，不是本轮新造出的同步故障。

### E-5 · 旧包、商店权益、原生与持续运行尚不能签字

2.1.1 fixture 是 inferred source，不能替代确切发行 IPA/APK。升级时必须保留旧连接凭据，在实际旧 App 上验收双后端；旧买断/月年订阅、恢复、pending/到期及兑换要做商店测试账户交易。

本轮没有重跑 iOS/Android 原生构建、麦克风、物理网络切换或 48 小时稳定性。最新 PROGRESS 的 iPad/语音记录已显示 Gradle 9.3.1 Android arm64 Debug 成功，因此较早 HT-ANDROID 的失败不能继续作为当前已证实阻断；最终 Release 构建与真机仍需固定包后验证。

### E-6 · 公开隐私文本与实际产品不符

本轮重新读取 [公开隐私政策](https://clawket.ai/privacy/)，仍称没有 analytics、没有第三方数据共享。代码已经有 PostHog、RevenueCat、YouMind 路径，现在另加阿里云接收录音。需在 App 发布前同步实际处理方式与商店披露；这是具体文本与数据路径冲突，不是本轮做出的法律结论。

## 本轮验证清单

| 检查 | 本轮结果 | 范围 |
|---|---|---|
| `check:required` | **失败** | workspace 类型通过；protocol 30 tests 通过，但 branch 99.54% < 100% 阻断后续 |
| 独立 Mobile 全量 | **301/302 suites，3,096/3,098 tests** | 两失败均在 CronEditorScreen；独立重跑该套 20/20，保留全量红灯记录 |
| `test:compat` | **5 文件 / 39 tests 通过** | pinned 老协议、历史 Bridge；不是旧原生包 |
| `test:release:compat` | **4 组合 / 20 阶段通过** | 09-16 导出 Production bundle；本轮核实线上版本 ID 未变且文件 SHA256 与 manifest 一致；新旧 Bridge × 双后端 × 升级/代码回退 |
| `relay:test` | **202 tests 通过** | shared 34、Registry 41、Relay 127 |
| `bridge:test:required` | **343 tests 通过** | core 40、runtime 237、CLI 66；不含外部真实 Hermes 集成 |
| `relay:test:integration` | **5 文件 / 8 tests 通过** | 本地 workerd、受控后端和录制 adapter；不是公网模型推理 |
| `speech:test` | **5 文件 / 20 tests 通过** | 语音自包含测试；非真机录音 |
| Bridge build / verify-package | **通过** | 3 包文件、4 运行边界、26 模块、58 provenance inputs |
| 设计系统 | **通过** | 当前 UI 静态检查及自测；不等于视觉验收 |
| i18n strict | **失败** | 19 locales，missing=0，五个 removable key 未清理 |
| npm 根依赖审计 | **0 high / critical** | 33 moderate、1 low；不等于没有中低风险 |
| Mobile 独立 lock 审计 | **0 high / critical** | 16 moderate；未在本轮升级依赖 |
| `check:docs` | **通过** | 指令文件/符号链接检查及 5 项自测 |

日志与 `grace-repro.json` 归档于本机忽略目录 `docs/3.0/evidence/pre-release-audit-2026-09-20/`，原始运行目录 `/tmp/clawket-audit-20260920/`。测试数不将定向重复运行累加为覆盖。

**建议处理顺序**：先修 P-1 的升级过渡、确认 P-2/P-3 的功能保全、决定新建会话的产品取舍；同时使全仓门禁稳定全绿。随后固定唯一候选和包，完成正式六位码/语音配置及 DO 恢复准备，再做双设备、实际旧包与商店权益验收。生产按层推进并完成规定观察窗口后放量。本报告不授权自动部署或改变既定付费策略。
