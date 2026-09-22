# 3.0 正式发布执行记录 · 2026-09-22

负责人明确授权修复、验收后继续发布。四个生产服务与 npm 3.0.0 现已正式上线并验证。前次中断与恢复历史保留在下文。

## 当前线上状态

| 服务 | 当前版本 | 状态 |
|---|---|---|
| OpenClaw Registry | `bc3a2ab9-beb4-4858-9541-85031598c85a` | 3.0 候选正式上线；安全绑定/迁移保留 |
| OpenClaw Relay | `7aff2f6b-57a2-46d4-9358-64d4a44fbdfe` | 3.0 正式上线 |
| Hermes Registry | `47da186b-f63f-4683-83a9-0fa9fce3bcb2` | 3.0 正式上线 |
| Hermes Relay | `276c5488-5422-44c2-8ba7-ddb681f20707` | 3.0 正式上线 |
| npm | `latest=3.0.0` | 负责人完成两步验证；公开元数据与下载包完整性验证通过 |

曾部署的候选：OpenClaw Registry `cb946ad0-d87d-4023-a492-9f2a7e7a612b`，Relay `8dde4cf4-1c1b-4801-95a0-71efe12bd4fc`。两次部署与两次恢复均经 v1 门禁。未清空 KV、删除 DO、轮换配对密钥或修改 Hermes。

**下次发布必须重新导出当前生产快照。** 09-21 manifest 已不能充当当前部署锚点；Registry 现已实际跨过首次 v1 DO 迁移，禁止使用不保留该类的旧包回退。

## 候选与门禁

证据目录 `evidence/production-release-2026-09-22/` 保存 207 个源码/配置输入哈希、四份固定 bundle/config、发布和恢复日志。部署使用 `no_bundle=true` 的固定 bundle，未从变化中的工作区重新编译。

- required 通过；v1 39、集成 8、发布矩阵 4 组合 × 6 阶段通过。
- 矩阵首轮跨整点，固定小时注册限流预期第 10 次拒绝实际第 11 次拒绝；整点后完整复跑通过，保留两次日志。这是测试对墙钟边界的敏感性，不修改限流规则掩盖失败。
- Bridge tgz SHA-256：`2e92a590f519cde991a495b4e0cc41055828d0c6fc9cf7d11e7d107c6da31709`，与此前通过验证的候选一致。隔离 npm install 成功，读取包版本 3.0.0，安装后 bundle 与已校验 bundle 逐字节一致。CLI 不支持 `--version`，其帮助输出不算版本证明。
- 两后端在旧生产上的受控配对/握手/协议往返通过。OpenClaw 候选发布后同凭据恢复、新配对、health/chat/sessions、刷新/领取通过。探针首轮不能解析新增控制帧而失败，修正为忽略已定义的控制帧后通过；不算产品修复。
- OpenClaw 候选部署后读回 observability：应用日志开启，invocation/traces 关闭，query redaction 开启；既有 secret 名称和对应 Registry→Relay service binding 保留。

## 真实 Android 2.1.0 的阻断

手机正式包 `com.p697.clawket`（Play 安装，2.1.0 / 20109）原先没有保存连接。不能声称已验证实际旧 App 的存量连接恢复。负责人明确授权通过 ADB 点击、输入和截屏，且不卸载/清空数据。

通过生产兼容 QR 新配对成功，设置页显示 lucy / Remote / relay.clawket.ai 活跃；进入聊天并冷启动后出现“Relay authentication failed and needs user action”，消息/历史/后台恢复未通过。

本机 Bridge 日志证实 Relay 已认证客户端并转发到 OpenClaw：bootstrap token issued 后，Gateway connect 返回 `INVALID_REQUEST`，消息为 `unauthorized: setup code invalid, expired, revoked, or already used`。因此不能把 App 的泛化提示直接归因为云 Relay 认证失败。

当前 Bridge 为未声明 mobile setup 能力的旧客户端调用 `issueLegacyOpenClawBootstrapToken`，写入旧 `devices/bootstrap.json` 格式。已发布 0.7.0 的 gitHead `bd69e3e09da028839d92321a55e97811fc44cd36` 使用同一逻辑；外部 OpenClaw 当前源码的凭据存储已迁移到 SQLite，`device_bootstrap_tokens` 不再通过此旧写入路径发放。这是旧客户端首次配对与当前本机 OpenClaw 的兼容问题线索；尚未完成修复或完整新旧主机矩阵，不能宣称所有旧用户受影响，也不能宣称回退云服务就修复该问题。

手机上本轮新增的 OpenClaw 连接保留。含凭据的临时 QR 已从电脑和手机 Download 删除；未修改 OpenClaw/Hermes 源码、主会话或全局认证配置。后续需要在 Clawket 内修复兼容路径并补真实旧 App 验证，再重新固定候选与门禁后推进。

## 兼容修复继续推进

负责人授权修复、真机验收后继续发布。Bridge 现只读检查 SQLite schema；存在原生 `device_bootstrap_tokens` 时拒绝旧 JSON 发证，旧 App 按已有协议回退 QR token/password，保持 Gateway 正常设备认证/审批。未更改原生凭据数据库，新 App 的官方 mobile setup 路径与 JSON-only 主机保持原行为。SQLite 无法读取时同样拒绝发放未经验证的 JSON 凭据；无 token/password 的旧客户端需要新版 App，不能声称此情况已支持。

针对迁移数据库、无关数据库、损坏数据库的三个回归用例，以及已有 OpenClaw/runtime 用例合计 101 项通过。真机旧正式包已以 token 完成实际 Gateway connect（ok=true），加载原有历史，并收到 `CLAWKET_OK_0922` 模型回复。后台恢复和最终包复验继续进行；尚未恢复正式发布。发布包使用 lazy `createRequire('node:sqlite')`，避免 tsup 将 prefix-only builtin 的动态 import 改写成第三方包名。

负责人确认本机有其他 Agent/客户端反复接入，不将该现象单独视作发布阻断，授权继续。旧 App 后台约两分钟后遇到并发接入期间重连，不能记录为后台恢复通过；上线后继续抽验。修复后的 required、v1 39 与当前真实生产快照的 24 阶段矩阵通过。首次矩阵失败是当前 OpenClaw Registry 已含限流 DO，而测试仅给候选配置该绑定；测试现按快照导出类保留绑定，并用独立测试源 IP 验证 10 次放行、第 11 次 429 与恢复后继续限流。未放宽生产限制。

最终固定 tgz SHA-256：`b64f0f9cfbf7545c4e0121c2d9e0ebe9f2e0d1831220580aa1233d1a6508bf8f`。包验证 3 文件、4 必需边界、37 runtime 模块、70 provenance 输入；隔离安装与已验证 bundle 字节一致。云端源码/配置与前次固定的四份候选逐项哈希一致，沿用其固定 bundle 发布。当前生产快照另存 `evidence/bootstrap-fix-2026-09-22/production-snapshots/`。

## 正式服务发布验证

四服务各经 v1 门禁后发布，读回均 100% 指向上表版本。生产导出源码 SHA-256 与固定候选 bundle 逐字节匹配，应用日志/关闭 invocation 和 traces/查询脱敏配置保持正确。新部署锚点与源码见 `evidence/bootstrap-fix-2026-09-22/production-final-snapshots/`。四个 `/v1/health` 返回 200。两后端的线上新配对、存量凭据重连、握手/健康、受控聊天/会话、访问码刷新/领取均通过。Doctor healthy，OpenClaw/Hermes 本机服务运行正常。旧正式 Android 在新版 Relay 上以存储 deviceToken 恢复，实际模型返回 `RESUME_OK_0922`；新服务下两分钟后台恢复另行补验。

新版服务上的旧 Android 后台验收通过：04:46:29 UTC 切至桌面，04:48:40 UTC 返回（131 秒），连接与历史保持可用，发送新消息后实际模型回复 `BACKGROUND_OK`。截图仅保存在忽略的私有证据目录。负责人已完成 npm 发布命令，本机 npm 日志退出 0；公开 registry 仍待传播，继续核对版本和完整性。

## 发布完成

负责人完成两步验证后 npm 返回 HTTP 202；后续认证生命周期 API 已为 `published`，公开 `latest=3.0.0`，精确版本与 SHA-512 integrity 相符。实际从 npm 下载 tgz 后 SHA-256 仍为 `b64f0f9cfbf7545c4e0121c2d9e0ebe9f2e0d1831220580aa1233d1a6508bf8f`，不存在换包。验收证据 `npm-verification.json`。等待期间补验 Android 3.0 QA 包 Hermes：旧历史打开、发送后真实模型回复 `HERMES_OK`，本地 Relay/Bridge 正常。此处没有将 QA 验证当作商店购买验收。

本机全局 npm CLI 已安装 3.0.0，与验收安装包的 bundle 字节一致。全局 doctor 对仍从隔离安装目录运行的 Hermes 子进程出现路径识别差异（实际 health/消息仍正常），因此按正常全局 CLI restart 将服务入口统一到已发布的全局安装包，再复查诊断。

全局服务入口统一后复查 `clawket doctor` 为 healthy / No issues detected；本机运行的 OpenClaw 与 Hermes 均为已发布 3.0.0 包。未停止其他 Agent 或外部 Gateway 服务。
