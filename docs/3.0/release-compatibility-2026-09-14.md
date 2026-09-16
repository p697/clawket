# 3.0 发布兼容性检查 · 2026-09-14

## 结论与范围

推荐顺序仍是 **Registry → Relay → Bridge npm → App**，后端分别推进，不能把“发布了新版 Bridge”等同于“用户电脑已升级”。必须保留旧 App / 旧 Bridge 和新版 App / 旧 Bridge 的基本连接、聊天能力。

本轮已完成逻辑审查、历史协议回放和真实 Worker / Bridge 混合版本测试，并修复一项新版 App 对旧 Bridge 的握手问题。**尚不是 Production 发布完成或旧 App 真机签字**：六位码生产密钥、首次 Registry DO 迁移的恢复产物、已发布 2.x 二进制抽验仍需闭环。

测试对象是 `main` 的当前工作树（检查时 HEAD `e068b6579df1a92d5b15f3c6e9f3167681c3e6f9`，包含未提交及其他任务改动）。发布前应固定最终提交、重新生成包并重跑门禁。本轮未部署 Production / Preview、未发布 npm、未重启用户 Bridge、未刷新实际配对，也未接管手机或模拟器。

## 环境核对（只读）

npm `@p697/clawket` 的 `latest` 为 **0.7.0**，gitHead `bd69e3e09da028839d92321a55e97811fc44cd36`。候选为 3.0.0；Node 最低版本从旧包 `>=20` 变为 `>=20.3.0`，安装/升级前应检查实际 Node。

| 服务 | 当时最新部署版本 | 部署时间 UTC |
|---|---|---|
| OpenClaw Production Registry | `29c8cf07-bf12-4803-b23a-c59f0c68ffb5` | 2026-03-22 12:41 |
| OpenClaw Production Relay | `daf2c639-4396-47fe-8b45-fc5510be29d0` | 2026-03-22 12:41 |
| Hermes Production Registry | `cd231262-461a-4d18-80eb-06ee2fe60279` | 2026-04-12 07:21 |
| Hermes Production Relay | `98cc595b-ca15-4776-b607-3fb2752df02b` | 2026-04-12 11:12 |
| OpenClaw Preview Registry | `c3bb9e6a-5c83-4192-9e73-659c5726c853` | 2026-09-05 10:58 |
| OpenClaw Preview Relay | `8c863a2c-5cf9-4391-9eae-e437704300f2` | 2026-09-11 12:12 |

Production 仍是旧部署，不能拿 Preview 成功代替生产混合版本验证。

## 已完成的测试

| 检查 | 结果 | 覆盖与边界 |
|---|---|---|
| `npm run test:compat` | **5 文件 / 39 项通过** | 2.x pinned 协议、实际历史 Bridge、当前 Registry/Relay；连接、发送、会话、1.5 MiB 附件、旧客户端未知控制帧、心跳等。新增当前 caps 请求经历史 Bridge 的实测。 |
| `test:release:compat` | **4 用例 / 20 阶段通过** | OpenClaw / Hermes × npm 0.7.0 / 当前 Bridge × 五个服务阶段，见下。 |
| Mobile 握手/生命周期专项 | **4 suites / 168 项通过** | 两后端协议、旧 wire 对齐、能力协商、显式 schema 错误降级；不会对网络或鉴权失败盲目降级。 |
| `check:required` | **通过** | 全 workspace 类型/自包含测试、设计/i18n/docs 门禁；Mobile 266 suites / 2,614 项，Bridge Runtime 208 项。 |
| `relay:test:integration` | **8 项通过 / 1 项未执行** | Registry/Relay 与适配器 Node 集成。未执行的为显式 opt-in 的 local-model 公网 Preview 测试，不冒充全后端公网验收。 |
| Hermes 外部源码集成 | **4 文件 / 36 项通过** | 显式指定已安装 Hermes 源码与 Python，在临时用户目录运行；模型、历史、技能、用量等。未修改 Hermes 源码或真实聊天数据。 |
| Bridge 构建及包验证 | **通过** | CLI bundle 构建成功；3 个包文件、4 个运行边界、25 个模块、57 项来源输入校验。未发布。 |

五个服务阶段依次是：线上旧代码快照；只升级 Registry；Registry/Relay 都升级；Relay 代码退回；两者代码都退回。每个阶段实际启动 Wrangler/workerd 与对应 Bridge，复用升级前配对凭据，验证握手/health、`chat.send`、`sessions.list`、access-code 刷新和 claim。升级后新建的配对记录也在旧 Registry 代码下完成刷新/claim。

Worker 使用只读导出的实际 Production bundle，不是假设的旧实现；旧 Bridge 从 pinned Git 提交及锁文件构建。OpenClaw 的 0.6.4/0.7.0 源码等价已校验；**Hermes 在两版之间有改动，因此另建了准确 0.7.0 的独立产物，没有复用 OpenClaw 的等价结论。**

真实运行的是本地网络、Registry、Relay 与 Bridge；末端 Gateway/Hermes 应答受控，因此这些测试证明的是协议路由与存量数据兼容，不能代替真实模型响应、iOS/Android 系统后台行为、全球节点网络或长时间运行。旧 App 使用提取的协议/处理器，不是实际安装旧 IPA/APK；2.1.1 缺少精确发行物对应关系，保留在 `tests/compat/PINNED.md` 的 provenance 限制。

## 已修复：新版 App → 旧 OpenClaw Bridge

原实现把 `bridge.capabilities.v2` 放在 connect 的顶层 `meta`。新 Bridge 会去掉它，但 npm 0.7.0 原样转发，而 OpenClaw 的闭合 RequestFrame 不接受该字段。本机实际 Gateway 校验器验证：旧请求通过、顶层 meta 请求失败、`params.caps` 请求通过；该 Gateway 对非法顶层 frame 直接关闭，不能依赖一定返回可识别的 meta 错误来恢复。

修复后 App 使用现有 `connect.params.caps` 字符串数组，新 Bridge 同时识别 caps 和预发布 meta 格式。旧 Bridge 可透明转发，Gateway 不需要修改；Bridge 不返回能力时仍按 legacy 处理。后续握手继续安全声明 caps，避免缓存的 legacy 状态让已升级的 Bridge 永远无法被识别。协商不增加请求、轮询或额外连接。原有能力缓存为 v2 时的显式 schema 拒绝也允许一次兼容重试，网络/鉴权错误不触发该路径。

回归先在旧代码上失败（Mobile 1 项），修改后通过；历史 Bridge 实测已包含新 caps 格式。另修正一条过时的 YouMind 集成断言，使用实际 run ID 而不是流消息 ID，并验证只产生一次 run_started；没有改 YouMind 产品逻辑。

## 发布前仍需完成

1. **六位码 Production 配置。** 只读 secret 名称检查发现 OpenClaw Production Registry/Relay 都缺 `PAIRING_TICKET_SECRET`，配置文件也没有该值。需在正确的两个服务配置匹配的至少 32 字符密钥，再测六位码、过期、重复 claim 和旧 QR。原有 `PAIRING_SYNC_SECRET` 等不能自动替代它。未读取/记录密钥值，未在本轮修改配置。
2. **首次 Registry 迁移恢复方案。** 新版添加 `PairRegisterRateLimiter` DO，而旧线上 Registry 不导出该类。Cloudflare 禁止跨此类生命周期迁移直接回滚旧版本；本地“旧代码能读新数据”不能证明云端控制面允许回滚。部署前须准备、测试保留新 DO 类/绑定/迁移与注册限速的恢复产物，或先建立迁移兼容基线。故障时前向恢复，不能删限速规避。[官方回滚限制](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)
3. **已发布旧 App 抽验。** 保留一台真实 2.x App，先在隔离候选服务抽验，Production 切换后再小范围复核；不升级/不清配对，先验证存量恢复、发送/流式/停止/附件/会话，再验证新 QR 配对和锁屏恢复；OpenClaw 与 Hermes 都做。发布物版本须有对应记录，协议回放不替代二进制签字。记入 `HT-COMPAT-0914`。
4. **固定发布物后顺序推进。** 不同时升级全部层；各后端服务升级后先观察旧客户端，再小范围更新 Bridge，最后 App。npm `latest` 回指旧版只改变后续安装；已安装新 Bridge 的电脑需要显式安装旧版并重启。新 App 连旧 Bridge 只保证旧能力，新功能按 capability 降级。

## 复现与证据

```sh
npm run check:required
npm run test:compat
CLAWKET_RELEASE_SNAPSHOTS=/path/to/exports npm run test:release:compat
npm run relay:test:integration
HERMES_SOURCE_PATH=/path/to/hermes HERMES_PYTHON_PATH=/path/to/python npm run test:hermes-integration --workspace @clawket/bridge-runtime
npm run bridge:build
npm run bridge:cli:verify-package
```

快照目录必须包含 `clawket-registry.js`、`clawket-relay.js`、`clawket-hermes-registry.js`、`clawket-hermes-relay.js` 的 ES module 代码（先移除导出响应的 multipart 包装）。当前工具输出的 SHA-256：

| 快照 | SHA-256 |
|---|---|
| OpenClaw Registry | `6266d4ade74ccc414087ad72f537937a3ec6e5154499ed31ad7b687b86a70094` |
| OpenClaw Relay | `044fc5dc55a12911cf44e1f8b6901477c869ee388887f817c46e29618b0bc7f6` |
| Hermes Registry | `6103fd5a3e42776e065e51ae1a5ef926c3041af661ae500e36654c5c9495cd4e` |
| Hermes Relay | `a4b019a611c17bf217af99bff667fc938d05c626f01240ff05f891463c619aab` |

当次本地原始日志在 `/tmp/clawket-release-compat-0914/`：`compat-final.log`、`rollout.log`、`required-final.log`、`mobile-compat.log`、`hermes-external.log`、`integration.log`、`package-verify.log`。这些临时文件不是持久发布档案，正式发版须归档当次固定版本证据。

试跑中曾因未显式指定外部 Hermes 源码，在隔离 HOME 下报 `No module named hermes_cli`；指定实际安装路径后 36 项通过。构建清理 dist 与集成测试并行也曾造成导入失败，构建完成后串行重跑已通过；上述复现命令应避免与重建同一 dist 的任务并行。
