# 09 · 发布与验收

## 1. 发布顺序

服务端 → Bridge npm → App 的顺序成立，但服务端部署后仍需支持未升级的 App 和 Bridge；发布新版 npm 不会自动升级用户电脑。兼容矩阵见 [2026-09-14 发布兼容性报告](release-compatibility-2026-09-14.md)，最新证据与未关闭风险见 [2026-09-16 最终检查](final-release-review-2026-09-16.md)。

1. 固定候选提交和发布包，跑 `check:required`、`test:compat`、`relay:test:integration`、`bridge:cli:verify-package`。导出当时 Production 四个 Worker 的只读代码快照，用 `CLAWKET_RELEASE_SNAPSHOTS=<directory> npm run test:release:compat` 验证混合服务版本、旧/新 Bridge 与存量配对。快照缺失必须失败。
2. Preview 部署 Registry → Relay，逐后端验证；OpenClaw 与 Hermes 的资源、凭据独立。完成旧 App 协议回放、新版 App 连接旧 Bridge 的测试，并在隔离候选服务上用实际已发布 2.x App 抽验。保存 Production 版本与恢复产物。
3. **首次 Registry 迁移前准备恢复方案。** 新增 `PairRegisterRateLimiter` Durable Object 后，不能直接回滚到不导出该类的旧版本。先准备并验证保留新 DO 类、绑定、迁移及注册限速保护的恢复产物，或先建立支持迁移的兼容基线；故障时前向部署恢复产物。不得临时删除 DO 或限速来回退。
4. 核对每个环境/后端的绑定与密钥。OpenClaw 六位码必须在对应 Registry/Relay 配置匹配且至少 32 字符的 `PAIRING_TICKET_SECRET`；只核对名称不会证明值相同，需实际配对验证。旧 QR / 12 位加密邀请兼容流程仍须保留。
5. Production 按 OpenClaw Registry → Relay，再独立 Hermes Registry → Relay 升级；每个服务对完成存量连接恢复、新配对、发送/回复、历史、后台恢复检查后才继续。用实际已发布的 2.x App 抽验；失败即停止推进并使用预演过的恢复路径。
6. 服务端稳定后发布 `@p697/clawket@3.0.0`。先小范围安装、重启和核对运行版本，再扩大。用户电脑仍可能长期运行旧 Bridge，新 App 不得因此失去基本连接/聊天。
7. 服务端与 Bridge 稳定观察 48 小时后，按双端沙盒/购买/权限清单完成提审与正式发布；隐私标签以当前实际 SDK 和数据处理为准。

恢复边界：未跨 DO 类生命周期迁移的服务可使用 Cloudflare 版本回滚；跨迁移按第 3 步前向恢复。npm `latest` 指回旧版只影响后续安装，已经装上新 Bridge 的主机需要显式安装指定旧版本并重启。App 商店无法即时回退，因此必须最后发布。[Cloudflare 回滚限制](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)

自动集成命令边界：`relay:test:integration` 只跑自包含服务与录制适配器；真实本地模型另跑 `CLAWKET_RECOVERY_CONFIG=<config> npm run test:local-model:recovery` 和 `CLAWKET_LOCAL_MODEL_PREVIEW_SMOKE=1 npm run test:local-model:preview`（需要运行中的模型）。两个真实模型命令缺少前置条件必须失败，不能把自包含测试通过写成真实推理通过。

## 2. 老 App 验证脚本（保留实际已发布的 2.x 二进制和存量配对）

- 优先抽验线上仍活跃的 2.1.0 / 2.1.1，记录版本、构建与二进制来源；源码中的 2.1.2 版本号不能单独证明它已发布，2.1.1 的 fixture provenance 缺口见 `tests/compat/PINNED.md`。
- 打开旧包 → 存量连接自动恢复 → 发消息 / 流式 / 停止 / 图片 / 历史 → 后台 2 分钟回前台 → 仍可收发 → Console 的 Sessions Board 正常。
- 旧包扫新版 `clawket pair` 的兼容二维码 → 配对成功；OpenClaw / Hermes 分别覆盖旧、新 Bridge。

## 3. 验收清单（实现者做可自动验证的项并记录；界面观感与真机由人）

状态约定：`[x] AUTO` 只表示该行可自动验证的部分已完成，不代表同行的真机、控制台或视觉部分已通过；这些剩余部分显式写作 `HUMAN 待人` 并进入 `PROGRESS.md` 的 HUMAN TODO。纯人类项目保持 `[ ] HUMAN`。机器证据、Preview 版本与回滚锚点见 `PROGRESS.md` 的 M8 完成证据。以下历史清单遇到后续负责人决策时，以 `PROGRESS.md` 对应决策为准；不得恢复已明确删除的界面来满足旧清单。

### 3.1 首启与连接

- [x] **AUTO 完成；HUMAN 待人：双端卸载重装。** 全新安装打开 → 首启引导（引导期间不弹付费墙）
- [x] **AUTO 完成；HUMAN 待人：双端真实输入。** 六位码配对 OpenClaw（Relay）→ 连接就绪进花名册 → 按当前启动导航进入 main；新安装不弹升级公告，升级用户按版本规则展示公告，不恢复旧的冷启动自动付费墙。
- [x] **AUTO 完成；HUMAN 待人：真机相机与相册。** 二维码扫描（折叠入口）→ 配对成功
- [x] **AUTO 完成；HUMAN 待人：真实 LAN / Tailscale。** 直连 / Tailscale URL 配对 → 成功
- [x] **AUTO 完成；HUMAN 待人：真实双 transport 与旧 Bridge。** Hermes 配对（Relay 与本地各一次）→ 成功；老 Bridge 时显示升级提示
- [x] **AUTO 完成；HUMAN 待人：真实既有账户。** YouMind 新建入口按 09-14 决策隐藏；既有连接仍可恢复并聊天。标志重新开启时再验收邮箱验证码与新建流程。
- [x] **AUTO 完成；HUMAN 待人：真实故障复现。** 配对码过期 / Bridge 未运行 / 无网络三种失败分别显示对应文案与动作
- [x] **AUTO 完成；HUMAN 待人：真机打开链接。** 「还没有 Agent」链接只指向官方文档

### 3.2 花名册

- [x] **AUTO 完成；HUMAN 待人：双主题视觉与触控。** 行内容：头像状态环、名字、预览、时间、未读点、需要你徽标
- [x] **AUTO 完成；HUMAN 待人：真机多主机时序。** 多连接：其他连接的行显示「上次同步」，无未读；点进去连接并刷新
- [x] **AUTO 完成；HUMAN 待人：overlay 视觉。** 置顶会话行出现在 Agent 下方，使用 Lucide `Pin`；取消置顶即消失
- [x] **AUTO 完成；HUMAN 待人：真实计时与重启。** 免费用户：非免费连接整组带锁、免费连接里非 main Agent 带锁，点开分别弹 `gatewayConnections` / `agents`；账户设置里切换免费连接受 24 小时限制；宽限期横幅倒计时正确
- [x] **AUTO 完成；HUMAN 待人：手势与真实网络。** 下拉刷新；离线横幅；长按菜单
- [x] **AUTO 完成；HUMAN 待人：完整手势路径。** 「+」：添加连接 → 引导模态；第 2 个连接弹付费墙 `gatewayConnections`

### 3.3 线程

- [x] **AUTO 完成；HUMAN 待人：长名称与实时布局。** 头部胶囊：名字、模型、上下文剩余；运行中变「正在用 …」；离线变灰
- [x] **AUTO 完成；HUMAN 待人：三后端真机响应。** 发送、流式、停止键中止（三种后端各一次）
- [x] **AUTO 完成；HUMAN 待人：照片选择/相机与真实交付。** 附件：OpenClaw 与 Hermes 发图成功；YouMind 无附件入口
- [x] **AUTO 完成；HUMAN 待人：真实任务与日志。** 子 Agent 运行卡出现并可打开；Cron 结果卡出现；失败带查看日志（Pro）
- [x] **AUTO 完成；HUMAN 待人：真实审批生命周期。** exec 审批卡：允许 / 拒绝 / 长按总是允许；配对请求卡
- [x] **AUTO 完成；HUMAN 待人：长实时历史。** 上拉加载更早历史；压缩系统事件行
- [x] **AUTO 完成；HUMAN 待人：真实 Sprite 账户与网络。** YouMind：首次进入自动开场（不显示 WakeUp）；中止；断网后恢复对账
- [x] **AUTO 完成；HUMAN 待人：真实命令。** Hermes：斜杠命令回执为系统事件行
- [x] **AUTO 完成；HUMAN 待人：OS 辅助功能视觉检查。** 减动效开启时无位移动画，且跳过会话交叉淡入

### 3.4 会话面板

- [x] **AUTO 完成；HUMAN 待人：密集真实数据视觉。** 当前单一会话列表、搜索与类型过滤；不恢复负责人删除的分组 / 列表切换。
- [x] **AUTO 完成；HUMAN 待人：破坏性动作 UX。** 长按：置顶到花名册 / 重命名 / 重置 / 删除（二次确认）
- [x] **AUTO 完成；HUMAN 待人：真实 Hermes 主机。** Hermes 多会话：重命名、删除、切换；后台仍支持创建，App 新建按钮按负责人决策移除。
- [x] **AUTO 完成；HUMAN 待人：视觉流畅度。** 切换会话后线程 200 ms 交叉淡入，头部更新；减动效时跳过

### 3.5 设置

- [x] **AUTO 完成；HUMAN 待人：真实值与视觉。** Agent 设置：Agent 组 5 行、连接组 5 行按能力显隐；Hermes 7 行；YouMind 只读身份 + 连接状态，邮箱只在私有 route-scoped Agent Settings 显示
- [x] **AUTO 完成；HUMAN 待人：真实 OpenClaw/Hermes 各保存一次。** 每个二级页可打开并保存一次：模型、技能（已安装 / 发现 / 安装）、定时（含心跳、创建、运行）、文件（编辑保存 Pro）、用量、OpenClaw 管理四分段（Pro）、工具、渠道与设备（配对请求）、日志（Pro）
- [x] **AUTO 完成；HUMAN 待人：OS 图标/语音/通知。** 账户设置：Pro 状态、连接增删、主题 / 强调色 / 聊天外观 / 图标（Pro）、语音、通知、帮助链接、社区、关于、开发者（Debug、Preview、设计系统、重置）

### 3.6 搜索

- [x] **AUTO 完成；HUMAN 待人：大型真实 cache。** 全局搜索：Agent / 会话 / 消息 / 收藏分节；消息详情 Pro 门槛；「在线程中查看」跳转正确
- [x] **AUTO 完成；HUMAN 待人：真机多主机检查。** 面板内搜索限本连接

### 3.7 付费墙

- [x] **AUTO 完成；HUMAN 待人：双端冷启动。** 待审批优先，升级公告按版本一次；重连 / 后台切回不重复弹。付费墙由实际付费功能入口触发。
- [x] **AUTO 完成；HUMAN 待人：英雄图视觉签字。** 六个情境触发各一次；英雄图与文案正确
- [x] **AUTO 完成；HUMAN 待人：控制台本地化商品。** 年付默认选中，折合月价与省百分比正确；展开月付
- [x] **AUTO 完成；HUMAN 待人：App Store / Play sandbox。** 沙盒购买成功 → 页内成功态 → 自动继续被拦动作；恢复购买；取消不报错
- [ ] **HUMAN 待人：无安全本地替代。** Android 沙盒购买（license tester）

### 3.8 视觉与双端

- [x] **AUTO 完成；HUMAN 待人：六强调色 × 三主题真机检查。** 浅色 / 深色 / 跟随系统；六种强调色
- [ ] **HUMAN 待人：无截图/构建可替代主观同屏检查。** iOS 与 Android 同屏对比：头部、花名册行、气泡、面板、设置分组一致
- [x] **AUTO 完成；HUMAN 待人：渲染确认。** 无分割线、无卡片边框、无 emoji 图标；`check:design-system` 通过
- [x] **AUTO 完成；HUMAN 待人：本地化截断检查。** 文案预算：每屏默认只有两档字；设置行无副标题、尾值只有一个值；面板行无文字标签；空态与横幅一句话
- [x] **AUTO 完成 token / 静态规则；HUMAN 待人：整体视觉判断。** 四屏与 `docs/3.0/mockups` 的整体气质一致（白底、浮动控件、方块头像、两层字、颜色只在头像上），尺寸以 token 表为准
- [x] **AUTO 完成；HUMAN 待人：手势与呈现检查。** 所有页面级返回 / 关闭 / 标题 / Tab / 弹层 / 确认框为自绘组件（`05` §11），无系统导航栏按钮；全 App 的 Tab 都是全圆胶囊 `Segmented`
- [x] **AUTO 完成；HUMAN 待人：语境与截断。** 19 种语言无缺 key（09-16 strict 检查：19 locales × 4 namespaces、1,297 keys / 24,643 translations，missing / removable 均为 0）；仍需长文案与大字号原生检查。

### 3.9 服务端

- [x] **AUTO 完成。** 未知 OpenClaw gatewayId 与 Hermes bridgeId 连 `/ws` 返回 404 且 DO 未创建
- [x] **AUTO 完成 live 上限与 replay；HUMAN 待人：老/新真机附件端到端。** 9 MiB 帧被拒（1009）；1.5 MB 图片附件经 Relay 正常送达（老客户端与新客户端各一次）
- [x] **AUTO 完成。** 注册限速在线精确返回 429
- [x] **AUTO 完成。** Hermes Preview 实例由合一代码提供，心跳 30 秒
- [x] **AUTO 完成：compat 5 files / 39 tests；HUMAN 待人：已发布 2.x 真机脚本。** `test:compat` 全绿；§2 的真实旧包抽验尚未关闭。
- [ ] **HUMAN 待人：Preview `workers.dev` 无 Production zone WAF；见 `HT-M2-1`。** WAF 四条规则与三条告警已配置（HT-1，人）

### 3.10 减法

- [x] **AUTO 完成。** `metrics:loc`：已报告与基线的差值；高于基线时有说明
- [x] **AUTO 完成。** knip 报告为空或每条有理由
- [x] **AUTO 完成。** 删除清单（`10`）全部执行
- [x] **AUTO 完成。** `check:required`、`test`、`test:compat` 全绿

## 4. 发布后 48 小时

每天记录：`connect_ready` p90、`connect_failed` 按 code、`reconnect` 率、崩溃率（Expo / 商店后台）、`app_update_announcement_shown → paywall_viewed → purchase` 转化、Android 成交率。任何一项相对 Preview 恶化 > 50% → 先修连接稳定性。

## 5. 商店文案（供 HT-5）

- 副标题：OpenClaw 与 Hermes 的手机控制塔
- 描述首段：看清每个 Agent 在做什么，随时接管。连接你自己电脑上的 OpenClaw 或 Hermes，聊天、管理会话、定时任务、技能与模型；官方 App 用来聊，Clawket 用来管。
- 隐私文案须区分手机本地缓存、用户自建 Agent 的历史存储、Relay 转发与分析 / 购买 SDK；不得声称 App 无分析或无第三方处理。公开政策与商店标签更新见 `HT-M8-2`。
