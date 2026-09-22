# 3.0 发布前最终复核 · 2026-09-21 晚间

## 最新放行意见（Hermes 修复之后）

可以进入服务端/Bridge 发布准备和分阶段验证；尚未签署无条件全量发布或今晚 App Store 提审。下面旧审查中的“缺 secret / health 403 / 无边缘规则”已被配置任务与限流专项关闭，不再作为当前阻断。日用量/业务恢复告警仍不完整，Hermes 线上异常房间来源仍未完全确定。

- 最终候选 required、v1 39、集成 8、连接专项 95、CLI 29、双后端 × 新旧 Bridge × 六阶段矩阵均通过；Hermes owner 争抢修复有先失败后通过的回归。最终 Bridge 构建/包校验通过（3 files、4 boundaries、36 modules、69 provenance inputs）。
- 四生产部署 ID 与配置准备报告一致，四公开 health JSON 200，npm latest 仍 0.7.0；本轮没有部署或发布 npm。
- 已打包本地候选 `evidence/hermes-owner-fix-2026-09-21/p697-clawket-3.0.0.tgz`；SHA-256 `2e92a590f519cde991a495b4e0cc41055828d0c6fc9cf7d11e7d107c6da31709`。它包含 Hermes 修复，但源码仍是未冻结的共享工作区（HEAD 418edf3，329 个状态条目）；发布前需固定服务端候选和实际发布产物，不能将随后重新构建的文件视为同一候选。
- 推荐顺序仍是 OpenClaw Registry→Relay、Hermes Registry→Relay，每对验证实际旧 App 存量连接、新配对/旧 QR、消息/停止/图片/历史/后台恢复，再小范围安装并核对新版 Bridge。首次 Registry DO 迁移使用已演练的固定前向恢复包。
- App 提审 P0：本轮重新读取公开 privacy 页面，仍声称无 analytics/third-party sharing；最终商店签名包的构建号、旧版覆盖升级、购买/恢复购买尚未获得验收证据，正式语音配置仍未认证。QA 包结果不替代商店包。
- 09 §1.7 仍要求服务端/Bridge 稳定观察 48h 后提审，这是项目既定门禁而非 Apple 强制规则。Apple 支持审核后手动发布，但不能用它自动消除隐私、商店包验收或观察窗口缺口。若负责人另行改变提审节奏，应记录其明确决定及保留的风险，不默认放行。

详见 [配置准备](production-config-2026-09-21.md)、[限流与 Hermes 修复](security-admission-2026-09-21.md)。以下保留初次审查的历史证据。

后续状态：负责人授权后，六位码密钥、内部服务绑定、公开 health 与安全应用日志配置已准备，四服务代码哈希保持不变但部署版本已更新；新快照/恢复配置矩阵通过。下面保留审查时发现，配置现状以 [生产配置记录](production-config-2026-09-21.md) 为准。限流/告警由专门任务继续收口；新版代码发布、真实旧包与商店验收尚未完成。

结论：服务端 → Bridge → App 的顺序正确；当前候选的自动兼容门禁通过，但生产配置与实际旧包验收尚未闭环，不能签署立即全量发布或今晚提审就绪。按 `09-release-and-acceptance.md`，服务端和 Bridge 稳定观察 48 小时后再提审。审核周期不能替代这个观察窗口。

范围：只读线上核查、当前工作区代码审阅、本地测试和构建；没有部署、发布 npm、更新云配置、重启用户后端或操作手机。HEAD 为 `418edf3368b4ccec9f25e8f155cd0b0141794064`，另有约 320 个已修改/未跟踪条目，且其他工作仍在变化。结果针对运行时工作区，不是已冻结提交或商店包认证。日志归档于 `evidence/final-readiness-2026-09-21/`。

## 本轮实际验证

| 检查 | 结果与边界 |
|---|---|
| `check:required` | exit 0；Mobile 328 suites / 3,384 tests；protocol 30；shared 34、Registry 41、Relay 127；Bridge core 40、runtime 325、CLI 66；speech 29；脚本、设计、i18n、docs 全部通过 |
| `test:compat` | 5 files / 39 tests；历史客户端序列化/分派边界与历史 Bridge，包含图片；不是旧 IPA/APK 实测 |
| `relay:test:integration` | 5 files / 8 tests；本地真实 Worker 与受控后端/录制适配器 |
| `test:release:compat` | 4 组合 × 6 阶段通过：双后端、候选与 npm 0.7.0 Bridge、生产快照→Registry 升级→全部升级→代码回退→固定迁移安全恢复 |
| Bridge build / verify-package | 通过；3 文件、4 runtime boundaries、36 modules、68 provenance inputs |
| 根 / Mobile 独立锁审计 | high/critical 均 0；根仍有 19 moderate + 1 low，Mobile 16 moderate；不是全面渗透测试 |
| 工具链 | Wrangler 4.131.0，Miniflare 5.20260910.0-alpha，workerd 1.20260910.1 |
| 生产快照与恢复包 | 四快照 SHA-256 与 manifest 相符，四线上当前版本 ID 未变；固定恢复包校验通过：2 bundles、2 snapshots、2 configs |

发布矩阵第一次启动正逢 required 中 Bridge core 构建，入口临时不存在，未收集到测试；构建完成后原断言重跑通过。保留首轮失败日志，不作为产品兼容失败，也不隐藏测试运行的前置依赖。

## 兼容性判断

未发现本轮覆盖范围内的旧客户端协议回归。源码复核确认：pong 过期只对声明 `relay.client-pong.v1` 的客户端生效，超时下限为三个心跳周期；休眠路由从附件恢复并区分完整/受限客户端；独立 OpenClaw client channel 需要协商，Hermes 和旧 owner 保持原策略；旧二维码/12 位加密邀请保留，新六位码按能力启用；新文件操作仅在具备权限、原生能力和隔离 loopback channel 时声明。

必须同时支持旧 App + 新服务 + 旧 Bridge、旧 App + 新服务 + 新 Bridge、新 App + 新服务 + 旧 Bridge。上述回放和服务矩阵提供协议证据，不能替代真实已发布 2.x App 的双后端存量凭据、重新配对、流式、停止、图片、历史和锁屏恢复抽验。2.1.1 源码来源仍为 inferred，见 `tests/compat/PINNED.md`。npm 发布不会自动更新用户电脑，新多设备能力也不能承诺给未升级 Bridge 的用户。

## 线上状态与发布阻断

1. **生产仍是旧部署。** OpenClaw Registry/Relay 当前版本分别 `29c8cf07…` / `daf2c639…`（03-22）；Hermes 为 `cd231262…` / `98cc595b…`（04-12）。npm `latest` 仍为 0.7.0。今天 Android 真机记录的生产 OpenClaw 休眠路由问题仍不能算修复上线；候选休眠测试通过，已有 Preview 真机正常证据，见 Android QA 报告。
2. **六位码生产配置不完整。** OpenClaw 两服务 binding 名单均缺 `PAIRING_TICKET_SECRET`。生产候选配置也没有 `RELAY_SYNC_SERVICE`。两个 Relay 自定义域名 `/v1/health` 本轮均 403，而 workers.dev health 为 200，`/ws` 返回预期缺 ID 的 400。不能称 Relay 整体宕机；但 Registry 的六位码能力检测依赖 health，无 service binding 时使用公开请求。部署前应配置匹配密钥和可用的内部调用/公开 health 路径，并实际验证六位码，而不能只核对 secret 名称。
3. **边缘限流与告警未达到既定标准。** zone rulesets 中未发现 `http_ratelimit` 规则集；现有 API skip 规则明确跳过 `http_ratelimit` 与 `rateLimit`，所以补规则时必须同时修正跳过范围。保留对机器 API 的浏览器挑战豁免，不要令 API 收到 HTML challenge。账户通知只有 enabled 的默认预算告警，未查到规定的 Workers/DO/KV 用量通知。代码层注册限流已有测试保障，但不能等同于边缘与成本告警完成。
4. **生产稳定性证据不足。** 过去 24 小时 Observability 聚合只有 Preview 四服务记录，没有生产样本；两生产 Relay 配置没有启用 observability。Preview 返回过 canceled/responseStreamDisconnected，不能直接当作用户失败率。没有本轮生产连接 p90、失败率、崩溃率或 48 小时趋势认证。补诊断时只记录脱敏生命周期字段，避免 invocation 日志采集 URL token / Authorization；本轮 keys 元数据中可见这些字段名，未读取其值。
5. **App 提审前仍有具体缺口。** 公开 [隐私政策](https://clawket.ai/privacy/) 本轮仍声明无 analytics、无第三方共享，与 PostHog、RevenueCat 及阿里云语音路径不符。Cloudflare 账号仅找到 `clawket-speech-preview`，health 为 enabled；语音规格也仍要求生产隔离服务。远端 EAS production 变量未在本轮读取，因此不能断言商店包一定缺语音，也不能认证其正式配置正确。固定商店签名包的旧版覆盖升级、恢复购买与双端真实支付仍沿用既有 HUMAN TODO，不以 QA Release 代替。

四个主 Preview 服务、两个 local-model Preview 服务和 speech Preview 的公开 health 均返回 200。单次 HTTP 成功只说明当时入口响应，不证明模型、端到端聊天或持续稳定。

## 已关闭的旧风险与推进顺序

此前“Registry 迁移没有云端恢复演练”的缺口已关闭：今天的专用隔离资源完成双后端旧包→候选→固定恢复包，含限流重部署后仍有效；本轮核对证据并重新验证固定包矩阵。详见 [恢复操作单](registry-recovery-runbook.md)。不能直接使用旧 Registry `wrangler rollback` 跨越 DO 类迁移；[Cloudflare 官方限制](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)仍适用。恢复包只恢复部分旧路由，配对写入保留安全实现，不是所有故障的通用恢复。

建议立即冻结唯一候选、商店构建与 Bridge tarball；将新改动排出候选或重跑相关门禁。先关闭生产密钥/health/限流/通知配置及真实旧包抽验，再按 OpenClaw Registry→Relay、Hermes Registry→Relay 独立推进；每对完成存量连接和新配对再继续。随后小范围安装候选 Bridge、核对运行版本与双后端，发布 npm，开始规定的 48 小时观察。App 可先准备构建和资料；按现行规则，今晚或明晚直接提审均不足以完成从今晚开始的 48 小时窗口。公开政策、正式语音与支付/升级验收完成后再提审。

没有新发现要求推翻 3.0 连接架构；当前放行缺口主要集中在发布配置、固定产物和真实发布验收。此报告不是生产部署授权。
