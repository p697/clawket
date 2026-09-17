# Clawket 3.0 最终发布检查 · 2026-09-16

**结论：核心代码与双后端链路可以继续进入候选发布；目前不建议直接全量发布 App。** 自动门禁、旧协议回放、真实 Worker/Bridge 混合版本矩阵均通过，真实 OpenClaw / Hermes 的聊天、图片、停止、历史和 Preview Relay 重连也通过。剩余阻断主要集中在生产切换准备、旧包 / 原生购买验收和公开隐私披露。没有证据支持“所有功能、所有设备均已验收”。

检查基线：`c9422fc9bfddcb0e2781ffcbcd5ade4e935e9a7d` 加本机工作树；App / Bridge 源码版本均为 3.0.0。工作树原已有 Xcode 27 原生修复及其他未提交文件，本次保留原样；不能将当前检查等同于对该 Git 提交的纯净构建签字。正式发布前须固定最终提交与包的 provenance。

## 1. 必须在对应发布阶段关闭的项目

| 优先级 / 阶段 | 发现与影响 | 关闭条件 |
|---|---|---|
| 阻断生产六位配对 | 只读读取 Production 四个 Worker 的当前代码、部署与绑定。OpenClaw Registry / Relay 均无 `PAIRING_TICKET_SECRET`（既不在 secret 名单，也不在完整 binding 名单）；生产仍是旧服务版本。直接先发新版 App / CLI，不能保证新配对入口可用。 | 按 `09` 的 Registry → Relay 顺序准备部署；两端配置匹配的强密钥；实际六位码和旧 QR / 12 位邀请都跑通。密钥名称齐全仍不能代替配对实测。 |
| 阻断首次 Registry 迁移 | 新版引入 `PairRegisterRateLimiter` DO，当前生产快照不导出此类。旧代码在本地矩阵可恢复，不代表 Cloudflare 允许跨类生命周期变更直接 rollback。 | 准备保留新 DO 类、绑定、迁移与限速的前向恢复产物，并在隔离资源演练；保存四服务版本与恢复步骤。不要用删除 DO / 限速的方式回退。 |
| 阻断面向用户的新 CLI 指引 | 实时 npm 查询 `@p697/clawket@latest` 仍为 **0.7.0**，不是本机编译的 3.0.0。新 local-model 等指引不能靠源码版本号证明可用。 | 服务端验证后发布固定包；干净机器按用户看到的命令安装、配对、启停、升级；检查实际运行版本。 |
| 阻断 App 提交：隐私陈述不实 | 09-16 访问公开政策，仍称 App 不运行分析、不与第三方共享数据；候选构建配置同时启用 PostHog 和 RevenueCat，且还有既有 YouMind 连接。 | 更新公开政策、支持页和商店标签，使其与实际 SDK、身份关联、缓存和自建后端存储一致。已有 `HT-M8-2`，此次确认尚未解决。 |
| 阻断 App 放量：购买与旧权益 | 本次验证了付费逻辑、商品配置校验和购买后续做的自动测试，**没有**完成 Apple / Google 商店真实测试账户交易。尤其不能用一次模拟购买证明老买断、续订、退款、pending、恢复购买均正确。 | 按 `pro-plan-management.md` 覆盖月 / 年 / 买断、双向换周期、恢复、pending、取消、到期与旧 Pro 升级；两个平台均记录实际 entitlement 和被拦动作续做。 |
| 阻断兼容性签字：真实旧包 | 39 项 v1 回放和 20 阶段矩阵通过，但没有完成实际已发布 2.1.0 / 2.1.1 二进制与存量配对的原生抽验；2.1.1 fixture provenance 仍不完整。 | 保留旧包与配对，从旧服务切到候选服务，覆盖双后端聊天、停止、图片、历史、重新配对、锁屏恢复；记录具体构建来源。源码中的 2.1.2 不代表已发布二进制。 |
| 阻断最终原生 / 稳定性签字 | 本次未完成当前原生 UI 全流程、Android Release 构建、物理网络切换及规定的 48 小时观察。 | 固定构建完成 iOS / Android 原生矩阵；按 `09` 观察两个 48 小时窗口。短时重连测试不替代 p90、崩溃率和长期耗电 / 内存验收。 |

Cloudflare 回滚限制已对照[当前官方文档](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)；公开文案问题来自[当前隐私政策](https://clawket.ai/privacy/)。本次没有部署 Production、发布 npm、修改生产密钥或执行付费购买。

## 2. 本次已经修复的明确问题

### 2.1 付费文件编辑可能提交旧草稿或错误上下文

`FilesSection` 的购买成功回调持有旧闭包。用户离开页面、换 Agent / adapter、离线或继续改草稿后，旧回调仍可能调用旧文件保存；快速切文件还可能被较慢的旧请求覆盖详情。保存失败横幅的 Retry 原先重新读取文件，会丢掉刚才失败的草稿。

已将编辑状态绑定到连接与 Agent，保存前核对页面生命周期、adapter、文件、草稿与实时在线状态；同步写锁防止重复续做；列表和详情读取只接受最新请求；失败后保留草稿，由 Save 重试。

先用新增用例重现旧代码的失败，再修复。新增 **12 个回归用例**，包括 OpenClaw / Hermes 各自的离页、离线、新草稿、adapter 与 Agent 更换；另覆盖重复回调、乱序读取和失败重试。最终相关 **2 套 / 52 测试通过**。未改变权益价格、后端能力或连接协议。

### 2.2 集成门禁混入依赖现场环境的测试

`relay:test:integration` 原先遍历整个目录，包含必须提供真实模型配置的恢复测试，又将 Preview 实测静默 skip，产生“没有配置就失败”和“没有实测也显示通过”的混合口径。

现将自包含的 Relay / 模型服务器 / 录制 adapter 测试与两个真实模型命令分开，保留所有测试。真实命令缺少前置条件直接报错，不跳过。本次自包含 **5 文件 / 8 测试通过**；本机没有就绪的 local-model 推理服务，两个真实模型验收没有被记为通过。缺少 Preview opt-in 的失败路径已验证。

### 2.3 Hermes 外部集成断言过时

两处历史断言未包含已有协议新增字段 `hasActiveRun: false`，导致集成套件失败。仅更新完整预期，继续使用精确相等断言；没有删除测试或改变 Hermes 生产实现。更广的 `npm test` 已通过，当前安装的 Hermes 源码也单独复验。Hermes 外部源码全程只读。

### 2.4 验收文档仍描述已撤销的界面决策

同步 `09`：真实旧包版本、升级公告代替旧冷启动付费墙、隐藏 YouMind 新建入口、单一会话列表、移除 App 新建会话按钮、19 语言与当前 39 项回放。避免后续验收者按照旧清单误判，或为通过清单恢复负责人已经删除的功能。

## 3. 已完成验证与证据边界

原始日志在本机忽略目录 [`evidence/final-review-2026-09-16/`](evidence/final-review-2026-09-16/)。不提交账户配置、凭据或用户会话正文。以下计数为各自命令范围，不把重复运行的测试相加为覆盖数量。

| 检查 | 结果 | 能证明什么 / 不能证明什么 |
|---|---|---|
| `npm run check:required` | 通过；Mobile 最终 279 suites / 2,835 tests；全 workspace 类型、自包含测试、设计 / i18n / docs 门禁通过 | 189 个 UI 源文件静态检查，19 locales / 24,643 translations 无缺 key；不等于屏幕视觉和真机交互通过 |
| `npm test`，显式外部 Hermes 路径 | 通过；Bridge runtime 32 文件 / 253 测试 | 包含 36 个外部集成测试；运行时 Mobile 为 2,827 项，随后新增的文件回归由最终 required 和定向套件覆盖 |
| `test:compat` | 5 文件 / 39 测试通过 | v1 序列、双方路由、心跳 / hibernation / 替换 socket 约束；不替代旧 App 二进制 |
| `test:release:compat` | 4 组合 × 5 阶段 = 20 阶段通过 | 用当天导出的生产 Worker、已发布 0.7.0 与候选 Bridge，在真实本地 workerd 中测试混合升级和代码回退；模型回复为受控 fixture，不是 Cloudflare 迁移回滚 |
| `relay:test:integration` | 5 文件 / 8 测试通过 | 自包含 Registry / Relay / local-model 协议与录制移动 adapter |
| Preview 标准 smoke | OpenClaw 产品流 9 检查、Hermes 7 检查通过 | 六位码、票据、加密邀请、单次 claim、Relay、Gateway challenge；Hermes 标准脚本使用受控 bridge，另有下一节真实模型实测 |
| Bridge build / verify-package | 通过 | 发布包 3 文件、4 个必要运行边界、25 个打包模块 / 57 个来源输入；没有实际 npm publish |
| Expo production JS export | iOS / Android 两端成功 | Bundle / assets 可导出；不能代替原生 Android 构建、签名或商店配置 |
| Native / 配置 | 本地 PostHog、RevenueCat 配置检查通过；已有当日 iOS unsigned Release Archive 成功日志 | Archive 是本轮开始前已有原生修复的证据，没有重跑签名归档；当前 Android 原生构建未获证据 |
| 依赖审计 | 根与 Mobile `--audit-level=high` 均通过；根审计 0 high / 0 critical，45 moderate / 1 low | 中低风险主要在开发工具依赖链，另含 URI 解码、UUID 等建议项；46 个条目不是 46 个独立漏洞。未执行可能破坏原生兼容的 force 升级 |
| LOC | 非测试 TS/TSX 114,763；测试 80,978；343 个测试文件（报告编写前采样） | 本次只做小范围稳定性修复，不以删除测试或大幅清理满足行数目标 |

回放和 workspace 测试包含本次重点关注的认证配对、帧上限、Legacy 无 pong 的存活策略、双方 hibernation 恢复、旧 socket 的延迟事件、分离客户端通道与重连健康检测。它们是确定性回归证据，不是现场全部网络条件的模拟。

## 4. 真实 OpenClaw / Hermes 实测

复用本机已有服务；不需要安装新的后端，也没有修改 Hermes 源码。使用新建的 QA 会话，清理时只删除这些会话。真实图片采用无个人内容的 64×64 红色 PNG（228 bytes），因此不能据此认证 5 MiB 原生相册上传。

| 场景 | OpenClaw | Hermes |
|---|---|---|
| 本机健康 / 会话 / 模型 / 技能 / 文件读取 | 通过 | 通过 |
| 本机真实文本回复与历史 | 通过，收到指定回复且两条历史 | 通过，收到指定回复且两条历史 |
| 真实图片输入并回答颜色 | 通过 | 通过 |
| 发送后中止生成 | 同一认证 WebSocket 中发送 / 中止，返回 aborted 并收到终态 | /stop 被接受，收到 aborted 终态，历史 hasActiveRun=false |
| Preview 云端真实管理读取 | health、sessions、skills、files、sessions.usage、usage.cost 均通过 | 同六项通过 |
| Preview 云端真实模型回复 | 通过；本次约 19.4 秒 | 通过；本次约 2.95 秒 |
| 人为断开本次 QA runtime 的 Relay owner 后恢复健康响应 | 约 4.84 秒 | 约 4.73 秒 |
| 125 秒空闲后真实健康请求 | 未做此独立样本；由自动化覆盖 liveness | 通过 |
| 本机测试会话重命名 / reset / delete | delete 通过，其他管理读取 / 自动化覆盖 | create / rename / reset / delete 均通过 |

云端测试使用独立新建的 Preview pairing 与本次启动的 runtime，只断开测试 socket，不重启日常主机服务。标准 OpenClaw Preview 产品 smoke 会刷新本机已有 Preview pairing 的 access code；没有刷新 Production pairing。临时 Preview 注册记录按服务 TTL 管理，runtime 和测试会话已清理。

停止测试的两个重要边界：第一版 OpenClaw 脚本每次 CLI 请求新建连接，跨连接 abort 被返回 unauthorized；改为同一认证 socket 后通过，故不列为 App 回归。Hermes 的 `upstreamCancelled: false` 是诚实的协议标记：已向上游提交 stop 并结束本地运行，不等于证明提供方立即停止算力 / 计费。

生产域名另有诊断注意项：两个 Registry `/v1/health` 均 200；两个 Relay 自定义域名 `/v1/health` 返回 Cloudflare HTML 403，同域 `/ws` 的无参数 HTTP 请求能到达服务并返回 JSON 400，相应 `workers.dev` health 为 200。**不能据此声称生产 Relay 故障，也不能声称自定义域名健康检查已通过。** 发布时需要核对 zone 路径规则与监控口径，避免监控被 WAF 拦截。

上述耗时都是单个样本，包含测试客户端开销，既不是 `connect_ready` p90，也不是稳定性 SLO。

## 5. 旧热门 / 付费功能是否丢失

数据来自 PostHog 项目 337268，时间为 **2026-03-16 至 2026-09-15**，项目时区 Asia/Shanghai。下列是事件次数，不是人数、真实成交笔数或收入；未验证 Sandbox 过滤，不能据 `purchase_succeeded` 直接认定真实付费。按月 unique 的和也未当作六个月去重人数使用。

| 历史信号 | 当前 3.0 状态 | 判断 |
|---|---|---|
| `gatewayConnections` 56 次购买成功事件 | 多连接入口、免费连接选择、Pro 解锁与旧连接存储仍在 | 核心付费能力未发现被删除；真实购买恢复和旧数据升级仍需原生签字 |
| 备份相关 21 次（17 configBackups + 4 configBackupCreate） | OpenClaw 管理的备份列表、创建、确认恢复与购买后续做均保留 | 未丢失；但备份来源隔离有下述残余风险 |
| 权限管理 17 次；诊断 6 次 | 预览、规则 / 配置、修复和诊断入口仍在，按具体动作拦付费墙 | 未发现整项删除；未对日常 Gateway 执行破坏性 repair |
| 日志 10 次 | OpenClaw 运行日志、免费预览 / Pro 全量仍在 | 未丢失；真实日志读取通过，原生长列表 / 购买须补验 |
| 图标 9 次 | 账户设置 Pro 图标选择仍在 | 代码和自动化保留；OS 实际切换没有本轮签字 |
| 核心文件编辑 8 次；FileEditor 4,688 views | SOUL / USER / MEMORY 等集中在 Agent 的 Memory 页面，支持读写；身份页仅处理身份 | 能力还在，入口改变；本轮修复了此路径的草稿 / 购买回调回归 |
| messageHistory 4 次；ChatHistory 1,918 views | 历史 / 全局消息搜索仍在，Pro / 免费预览有明确限制 | 未发现整项删除；新免费边界是产品决定，需向老用户解释 |
| Agents 2 次；通用会员入口 82 次 | Agent / 连接权益与通用购买入口仍在 | 逻辑保留，真实商店兼容性未获本轮证据 |
| Console 95,733 views；Agent & Session Board 11,207 | 合并到 Roster、Agent 档案与 Session Panel；模型、技能、Cron、用量、文件、工具、渠道、设备均有能力控制后的入口 | 页面替换不等于功能丢失；要用具体功能验收，不能只找旧页面名字 |
| CronJobs 7,471；Skills 6,399；Models 4,548；Usage 5,331 views | Cron / 心跳、技能安装与主源码编辑、模型管理、用量档位均已存在 | 本机 / 云端读取与自动测试通过；真实配置保存、Gateway restart、Cron 执行未对日常环境全部操作 |
| Office 39,510 views | 按 3.0 决策删除 | **确实消失且历史使用不低**；属于已批准产品减法，不是漏接路由。发布说明和支持准备应承认变化 |

另外确认四项需要负责人知情，但本轮不擅自改产品策略：

1. **Skills 辅助文件浏览缺口**：2.x `SkillContentScreen` 有 `linkedFiles` / `filePath` 选择，新 `SkillSourceSheet` 主要操作主 `SKILL.md`，未看到等价的辅助文件选择入口。不能把“主源码编辑已恢复”表述为所有旧技能文件操作完全对等；需要决定恢复只读浏览，还是明确减法。旧写接口是 key 级，不能直接承诺任意辅助文件编辑。
2. **多连接配置备份来源不明确**：备份为全局本地列表，结构只有 id / createdAt / config，未记录连接来源。当前连接可以恢复另一连接保存的配置，UI 没有来源提示。这是沿用旧结构的风险，不是已证实的 3.0 新回归。需要确定跨主机恢复是否是支持场景，再设计来源标签、隔离与旧备份迁移；不应静默丢弃旧备份。
3. **明确删除或隐藏**：Office、手动 App 新建会话、分组 / 列表切换、Prompts、YouMind 新建入口有负责人决策记录；既有 YouMind 连接代码保留。Prompts 缺历史埋点，不能因没事件认定没人使用，也不能反过来宣称它是高频功能。
4. **权益与体验变化**：非 main 会话免费预览、历史 / 搜索门槛、宽限与免费连接限制，不能仅用自动化通过判断老付费用户感受。旧有效 Pro 应保持解锁，具体迁移需真实旧账号与商店恢复验证。

## 6. 本次没有完成、不能包装成通过的内容

- 尝试连接本机已经启动的 iOS Simulator，控制工具 inventory 可发现进程，但通过名称、bundle ID、完整 App 路径选择均返回 `Invalid app`，重置后仍然如此。没有得到可操作的原生 UI 会话，因此没有宣称完成逐屏点击、扫码、键盘或截图验收。
- 真实 iOS / Android 商店购买，App Store / Play 后台最终配置、签名包、旧 App 二进制升级、SecureStore / Keychain 跨卸载行为。
- 物理 Wi-Fi / 蜂窝 / 代理 / Tailscale / Cloudflare tunnel 切换、相机 / limited photo / 文件 picker / 语音 / OS 图标与通知、长列表帧率、无障碍朗读、大字号和 19 语言截断。
- 日常 Gateway 的危险配置恢复、权限修复、模型配置重启、外部渠道真实发信、系统服务卸载 / reset。这些做了源码与自动化检查，没有为了测试破坏本机已有配置。
- 本地模型 Preview 的真实推理 / 恢复（本机当时没有就绪模型），真实 YouMind 账户新建 / CDN、跨设备历史附件、生产 DO 迁移回退。
- 一小时 / 48 小时持续稳定性、真实故障率与重连分位数。125 秒空闲和几次回复不能外推长期可靠性。

## 7. 建议的发布执行顺序

1. 合入本轮明确修复与已有原生修复，固定唯一候选提交 / 包；保留当前绿灯日志，再按最终候选跑必要门禁。
2. 完成公开隐私更新、原生商店购买矩阵与真实 2.x 包抽验；先关闭上述阻断，不以“Preview 自动完成”替代 App 发布验收。
3. 准备 DO 迁移兼容的前向恢复产物，补生产配对密钥。按服务对升级，每一步实测老配对、新配对、真实消息 / 历史后继续。
4. 服务端通过后发布并小范围安装 CLI 3.0；检查双后端自动发现、启动 / 重启 / 日志 / 停止，确保旧 Bridge 用户仍能聊天。
5. 完成规定的观察窗口后发 App，小范围逐步放量。监控按后端、App / Bridge 版本、平台区分连接失败、重连、首发、停止、购买失败和崩溃。

最终判断：本次没有发现“OpenClaw 或 Hermes 主链路整体不能用”或“主要旧付费能力被整体删掉”的证据；确实修复了一处影响付费文件编辑的数据正确性问题。当前最不应该做的是把数千项自动测试绿灯当成生产切换、旧包原生兼容和真实付费全部完成。
