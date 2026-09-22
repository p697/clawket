# Android 发布前实测 · 2026-09-20–21

## 结论

**当前不能把正式环境判为发布通过。** Android 真机发现并修复四处问题，候选包已重新安装；正式 OpenClaw Relay 仍有可复现的休眠后路由丢失，导致模型/会话请求超时及消息发送失败。候选 Relay 已包含路由恢复修复，Preview 真机对照通过，但本轮没有部署生产。

## 设备与构建

- Samsung Galaxy A56（SM-A566B），Android 16，arm64；ADB 由负责人在手机上授权。
- 使用当前 3.0.0 源码生成独立 Release APK，内置 JS，不依赖 Metro。Zulu JDK 17、Gradle 9.3.1，`GRADLE_USER_HOME` 使用 SSD 实际路径，最终构建成功。
- 手机已有商店签名的 2.1.0，测试签名不能覆盖（`INSTALL_FAILED_UPDATE_INCOMPATIBLE`）。保留原 App，另装 `com.p697.clawket.qa` / **Clawket QA**。
- 先测免费包，再使用仅本次构建的 `EXPO_PUBLIC_UNLOCK_PRO=1` 覆盖 QA 包，验证多连接和管理功能。不是正式商店签名包，不能作为购买/恢复购买或真实旧包覆盖升级验收。
- 包名、名称及强制重打 JS 的调整只在忽略的生成 Android 工程内；没有改变产品源码的应用 ID 或默认权益配置。

## 本轮修复

| 问题 | 修复与证据 |
|---|---|
| Android 16 键盘遮住输入区/发送按钮 | Thread 使用键盘控制器的 padding 和安全区偏移；iOS 原行为保持。双平台组件回归覆盖，真机展开 Samsung 键盘后直接发送成功。 |
| 用户消息时间重复显示 | 透明文本中的真实时钟数字在 Android selectable Text 中仍可能可见。改成不换行的等宽空白占位；真机只显示一次时间与状态。 |
| Hermes 英文单词粘连、换行/代码缩进丢失 | `message.delta` 不再使用 trim 标识符处理器；逐块保留文本，包括纯空格。回归覆盖实时事件、活动历史、最终文本；真机回复 `one two three` 和带四空格缩进的 Python 代码块正常。只改 Clawket，未改 Hermes 外部源码。 |
| 过期/无效二维码误报“请求太频繁” | 错误匹配 `includes('rate')` 把 `Generate a new QR code` 误判为限流。改为明确限流短语/429 匹配；覆盖过期、已使用、无效及四种真实限流错误。 |

前三项先有失败回归，再修复通过；配对错误通过现场 401 与提示不符发现，补了完整错误文案回归。最后一项已进入最终安装包；过期提示修复的最终证明是自动回归，不另称修复后真机重放通过。

## 真机覆盖

| 范围 | 结果/边界 |
|---|---|
| OpenClaw 正式 Relay 配对/基本聊天 | 旧 QR claim、握手和真实消息 `ANDROID_OPENCLAW_OK` 成功；后续间歇超时，不能判连接稳定性通过。 |
| OpenClaw Preview Relay | 新 QR 配对、19 个模型加载、专用 Codex UI Operator 会话切到 DeepSeek、真实回复 `PREVIEW_MODEL_OK`、后台超过一分钟返回后 `PREVIEW_RESUME_OK` 均成功；最后切回 GPT-6 Astra。 |
| Hermes 正式 Relay | 配对、`ANDROID_HERMES_OK`、切到 DeepSeek Pro 后 `HERMES_MODEL_OK` 成功，最后回到 Flash。长回复停止后可继续发送；Bridge 重启后自动恢复并验证修复后的空格和代码块。 |
| 连接生命周期 | Preview 暂停确认后显示已暂停；force-stop/冷启动后仍暂停；手动恢复在线；移除测试连接后回到正常列表。QA APK 同包覆盖安装保留已有连接。 |
| OpenClaw 管理 | Preview 下资料统计、配置浏览、权限、工具、渠道/设备/节点、运行日志、连接详情均可加载；本地配置备份创建与删除成功，未恢复/修改 Gateway 配置或停用外部渠道。 |
| Hermes 管理 | 模型、技能列表及 SKILL.md、记忆列表与 USER.md、任务空态/新任务模板、用量页可加载；未创建真实定时任务或修改用户文档。 |
| 共享页面 | 搜索本机已打开消息、Hermes 主会话与已有 QA 会话切换、账户、主题切换及恢复跟随系统、聊天主题预览、帮助中心/连接说明、关于与开发者页面可使用。 |
| 崩溃 | 最后读取设备 crash buffer 为 0 行；这不是无限时长或所有 Android 厂商稳定性保证。 |

正式和 Preview 同时连接同一 OpenClaw 时，花名册各显示一组 Lucy/Codex UI Operator。负责人指出后已移除测试 Preview 连接，最终仅保留正式 OpenClaw 与 Hermes；未在 Gateway 创建重复 Agent。导入二维码测试文件已从手机移除。

## 正式 Relay 阻断：现场证据

时间统一采用 UTC（手机显示 UTC+8，开发机 UTC+9）：

- `2026-09-20T15:26:24Z`：生产实时 tail 记录 `inactive_client_message_dropped`，原因 `non_connect_before_active`。
- `15:26:39Z`：`rehydrate_summary` 显示两个 socket、一个客户端、Gateway 存在；紧接客户端请求被当成 inactive 丢弃。
- `15:26:49Z`：记录 `gateway_message_dropped_without_active_client`，仍有一个客户端与 Gateway。
- 同轮手机模型弹层显示 `[request_timeout] models.list request timed out`，测试消息进入发送失败/暂停状态。
- 本地 Gateway 同期存在成功的 `models.list`/`sessions.list` 响应；一次模型读取 260 ms。不能把手机超时归因于所有 Gateway 请求都慢。
- 只读核对生产 Relay 最新部署版本 `daf2c639-4396-47fe-8b45-fc5510be29d0`，与 09-16 导出的生产快照一致。快照 `reconcileSockets` 恢复 socket 集合但不恢复 `activeClientId`；转发仍依赖该字段。当前候选实现的 WebSocket attachment 路由恢复及独立客户端通道已覆盖此类问题。

这组现场丢帧日志、源码缺口及 Preview 对照共同支持生产旧 Relay 路由缺陷，不能仅靠 App 延长超时掩盖。**发布前需按既有发布/Registry 迁移恢复流程更新正式服务，再复测空闲、休眠、后台返回、模型切换与消息发送。** 本地六阶段矩阵不是 Cloudflare 控制平面迁移的证明；没有在本轮直接部署。

本地 Bridge 另有约 35–40 秒无入站流量后的心跳重连记录，随后可恢复；未证明网络/代理/边缘哪段是根因，没有任意放宽看门狗。旧错误文件中的 ENOSPC 最后修改时间为 09-17，不是本轮新发生，未将历史错误当成当前故障。

## 自动化与协议检查

- `check:required` 全部通过：Mobile 307 suites / 3,183 tests（含键盘/时间修复），Bridge Runtime 239 tests，类型、协议覆盖率、其他工作区测试、201 个 UI 文件、i18n 与 docs 门禁通过。随后新增配对错误 7 个用例，单套 12 tests、Mobile typecheck 再通过；最终 Mobile 全量 307 suites / 3,190 tests 通过。
- v1 `test:compat`：5 files / 39 tests 通过。
- `relay:test:integration`：5 files / 8 tests 通过。
- Hermes 真实外部 checkout 集成：4 files / 36 tests 通过。显式传入本机 source、venv Python 和 PYTHONPATH，避免 isolated HOME 找不到依赖；未修改外部源码。
- `test:release:compat`：生产导出快照 × OpenClaw/Hermes × candidate/已发布 0.7.0 Bridge，4 组合 × 6 阶段全部通过。使用既有已校验固定 Registry recovery bundles，保留限流 DO 安全边界。
- Preview 产品 smoke 9 项、独立 Hermes Preview smoke 7 项通过；CLI package 验证通过。
- 修复后的真实本地 Hermes WebSocket：20 次 health（4 并发 × 5 轮）全部成功，最大响应 1 ms；两条会话 history 均 `hasActiveRun=false`、无 `inFlightRun`。这是小规模存活检查，不是压力测试。
- 本轮两次构建目录竞争曾造成临时 bridge-core 模块解析失败（测试同时运行了会清理 dist 的构建）；串行完成构建后重跑通过。没有把失败运行略去当作全绿。

证据目录：`docs/3.0/evidence/android-release-20260920/`（本机忽略目录）。关键文件：`required-final.log`、`mobile-final.log`、`compat-final.log`、`integration-final.log`、`hermes-integration-final.log`、`release-compat.log`、`android-final-build.log`、`android-final-install.log`、`production-routing-sanitized.json`、`hermes-live-protocol.json`、`android-crash-final.log`。原始私密配对内容不进入报告。

## 未覆盖的发布验收

- 正式服务修复部署后的真机重测；旧/新 App 双设备同时在线、Cloudflare 首次迁移与恢复演练。
- 商店签名覆盖升级、Google Play 真实订阅/恢复购买，其他 Android 版本/厂商及长时间断网/息屏后台。
- 真机 LAN、Tailscale、Cloudflare Tunnel/自建连接逐项验收。本轮真实 App 使用正式和 Preview Relay；生成了本地 QR/准备 USB reverse，但没有把未执行的手机直连写成通过。
- 麦克风/蓝牙/来电中断、语音真实转写与生产语音环境；真实图片附件发送。相关自动化协议/大小边界检查不替代这些真机验收。

沿用 PROGRESS 的商店、语音和双设备人工验收项；本轮不宣称全量发布签字。
