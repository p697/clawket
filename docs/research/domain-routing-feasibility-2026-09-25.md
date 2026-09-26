# 双域名入口与 App 网络选项可行性评估

日期：2026-09-25。状态：调研方案，尚未实施或发布。

## 结论

可以让新版本默认使用 `hello-clawket.com` 下的官方服务入口，并允许在设置中切回 `clawket.ai`。不需要删除连接、重新扫码或清空聊天记录；已建立的 WebSocket 需要关闭后按新入口重新握手，不能承诺切换过程中完全无中断。

成立条件是：每个服务的新旧域名指向该服务的同一个 Worker、同一套配对存储与 Durable Object namespace，保持 backend、environment、gateway/bridge ID、设备身份与凭据不变。OpenClaw、Hermes、Pi、本地模型之间仍保持原有隔离。手机用新入口、Bridge 用旧入口的混合组合在此设计下可行，尚未执行双域名端到端验证。

新注册的域名可以作为可达性对照，但域名年龄本身不能保证中国大陆速度或稳定性。如果问题主要来自跨境路由、Cloudflare IP 路径、Wi-Fi 或模型调用，换域名未必改善。不能把上一轮旧域名的探针结果当成新域名的测量结果。

## 已核实的现状

- Cloudflare API 确认 `hello-clawket.com` zone 已 Active，Universal SSL 已 Active，覆盖根域名及一级子域名。
- 新 zone 当前没有 A/AAAA/CNAME 业务解析记录、Worker routes 或 Worker Custom Domain 绑定。因此尚没有可用于公平比较的业务端点；未宣称新域名更快。
- 新域名为 Free Website；`clawket.ai` 为 Pro Website。旧 zone 规则不自动应用到新 zone。
- 现有生产 Custom Domains：`registry.clawket.ai` → `clawket-registry`；`relay.clawket.ai` → `clawket-relay`；Hermes 对应两个独立 Worker；`speech.clawket.ai` → `clawket-speech`。
- 当前移动端分析上报地址为 `echo.clawket.ai`。DNS 是不经过 Cloudflare 代理的 CNAME，指向 PostHog 托管代理，不是上述 Worker。
- 浏览器打开注册详情链接时进入登录页；账户、DNS、绑定和证书状态通过已连接的 Cloudflare API 确认。没有操作登录或注册表单。
- 当前工作区有并行的 Pi 3.1 和移动端改动，本评估依据当前源代码，并区分了已确认的生产绑定与尚未部署的候选代码。

## 建议的入口映射

以下均为建议地址，不表示已经配置。

| 用途 | 新入口 | 承接服务 |
|---|---|---|
| 官网入口 | `hello-clawket.com`、`www.hello-clawket.com` | 跳转 `https://clawket.ai`，官网继续用旧域名 |
| OpenClaw 配对 | `registry.hello-clawket.com` | 原生产 Registry |
| OpenClaw 消息 | `relay.hello-clawket.com` | 原生产 Relay |
| Hermes 配对 | `hermes-registry.hello-clawket.com` | 原 Hermes Registry |
| Hermes 消息与健康查询 | `hermes-relay.hello-clawket.com` | 原 Hermes Relay |
| 语音 | `speech.hello-clawket.com` | 原生产 Speech Worker |
| 分析上报 | `echo.hello-clawket.com` | 经单独验证的 PostHog 代理入口 |
| Pi | `pi-registry`、`pi-relay` 子域名 | Pi 独立服务，待其服务就绪后接入 |
| 本地模型 Relay | `local-model-registry`、`local-model-relay` 子域名 | 现有专用服务，保持独立资源 |
| 调试 Preview | 显式命名的 Preview 子域名 | 原 Preview 服务，绝不转生产 |

业务接口直接绑定到同一服务；不通过 HTTP 301/302 将 WebSocket、带认证请求或语音请求跳到另一域名。只有官网导航使用网页跳转。Cloudflare 官方支持一个 Worker 绑定多个 Custom Domains。

## 不需要重新配对的依据

1. Relay 按 backend 所属 namespace 和 `principalId` 定位房间，调用 `namespace.idFromName(query.principalId)`，不以访问域名作为房间标识。见 [Relay 路由](../../apps/relay-worker/src/index.ts)。
2. App 保存 `gatewayId/bridgeId`、`clientToken` 和连接 ID，Bridge 保存相同配对对象的身份与 owner 凭据。域名是传输入口，不是更换后端用户的指令。
3. 配对 ticket 校验绑定配对 session、gateway 和签名密钥；双入口保持原密钥与存储即可，不能通过新建独立 Registry/Relay 来“复制”服务。见 [协议实现](../../packages/relay-shared/src/protocol.ts)。
4. 现有 Bridge 从保存的 `config.relayUrl` 建连。新增别名不会强迫旧 Bridge 改地址；只要旧入口仍可用，它可以继续工作。手机设置也不会远程改变 Bridge 所在电脑的网络配置。

配对关系能保留不等于在途操作能零中断。OpenClaw 的客户端 channel 可能在切换时重建本地 Gateway 会话；必须依赖现有历史恢复机制验证已发消息状态，不能自动重复提交不确定是否成功的消息或管理操作。

## 不能做全局字符串替换：已确认的改造点

| 位置 | 当前行为 | 实施要求 |
|---|---|---|
| [官方环境识别](../../apps/mobile/src/services/relay-environment.ts) | 用精确 origin 集合识别生产/Preview；Pi、本地模型也有固定地址 | 增加明确的服务及环境别名表，保留自托管与环境隔离 |
| [连接注册表](../../apps/mobile/src/connection/registry/connection-store.ts) | Relay 去重用 backend + `serverUrl` + gateway ID | 同服务双域名映射到稳定身份，保留 connection ID、免费槽位、缓存和草稿，不生成重复连接 |
| [设备凭据存储](../../apps/mobile/src/services/storage.ts) | 凭据 key 包含 `serverUrl::gatewayId` 的哈希，operator/node 分开 | 地址切换不得改变凭据查找作用域；必要迁移需保留旧值与角色边界 |
| [Gateway 客户端](../../apps/mobile/src/connection/protocol/gateway-client.ts)、[Node 客户端](../../apps/mobile/src/services/node-client.ts) | WS 地址与设备凭据作用域分别取自连接配置 | 明确区分稳定身份与实际访问 URL，两条通道一起适配 |
| [连接 runtime](../../apps/mobile/src/connection/index.ts) | 同 connection ID、同 factoryRevision 时复用 active adapter | 改偏好或写 URL 不会自然保证换路；增加明确的入口变更与串行重连处理 |
| [配对会话](../../apps/mobile/src/services/pairing-session.ts) | Registry 返回的 relayUrl 直接用于临时配对 WebSocket | 配对 HTTP、短码临时 WS、解密后 payload、正式连接都要按选择解析；不能遗漏其中一步 |
| [OpenClaw CLI 配对](../../packages/bridge-core/src/pairing.ts) | 不同 serverUrl 被判断为不同服务器，并提示 reset | 官方同服务别名应兼容；不能因默认值更新要求老用户 reset |
| [Hermes CLI 配对](../../packages/bridge-core/src/hermes-relay.ts) | 地址不同不会走现有身份的 refresh 分支，会进入注册流程 | 同服务别名不能重新注册/覆盖原配对身份 |
| [Bridge 默认入口](../../apps/bridge-cli/src/index.ts)、[打包注入](../../apps/bridge-cli/scripts/build-bundle.mjs) | 默认 Registry 部分由环境/打包值注入；另有 workers.dev fallback | 更新新安装默认值与兼容判断；保留已存身份，不做静默重注册 |
| [语音客户端](../../apps/mobile/src/services/speech/speechStream.ts)、[签名校验](../../apps/speech-worker/src/auth.ts) | 模块加载时读固定 URL；签名包含 `url.host` | 动态选入口并按实际 host 重新签名；不能拿旧 host 签名重定向到新 host |
| [官方打包检查](../../apps/mobile/scripts/check-public-config.mjs)、[EAS 配置](../../apps/mobile/eas.json) | 只接受旧生产语音 URL | 精确允许两个已验证生产入口，同时保持拒绝 Preview 和社区构建边界 |
| [原生配置](../../apps/mobile/app.json) | iOS associatedDomains/Android intentFilters 仅列旧官方配对 host | 新版本增加新配对 host；服务端验证 AASA/assetlinks；旧二维码和 scheme 继续工作 |

Registry 当前返回的 Relay URL、邀请链接公共 origin 也有独立配置。新增域名别名后，它们仍可能返回旧地址。建议第一阶段由新客户端对严格允许的官方地址做统一入口解析，旧客户端继续获得兼容响应；后续再明确服务器按请求入口返回 URL 的策略。禁止把任意 QR 内的 host 机械替换成官方域名或把自托管凭据送给官方服务。

语音双入口应使用同一个 admission namespace，保证设备占用、nonce 重放和额度仍共享；不要新增一套语音 Worker/额度计数来实现换域名。

## 设置页方案

建议位置：设置首页“我的连接”附近增加“网络”入口，独立于 Debug Mode 和订阅权限；断网时仍能打开并改回。

- 选项：`hello-clawket.com（默认）`、`clawket.ai（兼容）`，附“用于 Clawket 官方服务；切换后将重新连接”。
- 一台手机一个偏好，持久化并在连接启动前读取。新版本没有已保存选择时默认新入口；用户主动选旧入口后尊重其选择。
- 对已有官方连接也生效，不只影响新建连接。连接原始身份、ID、令牌、聊天缓存与草稿不变；地址解析仅影响实际请求。
- 用户选择时更新偏好，串行重建当前官方连接及其 Node/健康 sidecar；非活动连接在下次激活时使用新入口。
- 进行中的录音/转录、消息发送、配对或不可重复的管理操作要保护。建议空闲时立即生效；忙碌时明确显示“当前操作结束后生效”，需要立即恢复离线连接时保留手动重连路径。
- 不确定发送结果的消息不自动重发；重连后拉取状态/历史再恢复展示。切换失败时设置页仍能切回，不能要求 reset。
- 第一版优先明确的手动双选项；自动回退若后续引入，需要展示实际入口并限制频繁切换，且不能重放写操作。

建议用独立的 endpoint resolver 接受 `service + backend + environment + networkPreference`，只解析维护的官方域名白名单。配对身份与网络入口分层，避免每次切换都批量重写 SecureStore。新旧保存记录需要 canonical identity 兼容测试，不能只覆盖从旧域名升级这一方向。

## “各种网络请求”的范围

官方 Registry、Relay、配对、健康查询、语音、官方分析代理可以纳入统一选择。生产、Preview、Pi、本地模型需逐项列明映射，不留下某一类请求仍偷偷走 workers.dev。

源码中还存在 YouMind 登录/API、Apple/Google 商店与 RevenueCat SDK、GitHub 更新检查、ClawHub、skills.sh、头像与用户自行配置的服务地址。它们不是 Clawket 自有入口，不能通过替换域名获得等价服务。若确实要求其中的可代理 HTTP 也走新域名，要分别设计代理与认证、缓存、内容大小限制；商店原生支付等无法用一般自有域名代理替代。自托管、局域网、Tailscale 和自定义服务应保持用户配置。

`echo.clawket.ai` 要在分析代理服务侧确认新 hostname 和证书接入，不能只复制 DNS CNAME 并假设可用。App 的分析客户端初始化也要考虑切换时已有队列与实例的生命周期。

## 基础设施准备与风险

- 同一 Worker 新增 Custom Domain、验证证书及 101 升级，并同步到忽略的实际部署配置；否则下一次发布可能覆盖控制台别名。
- 新 zone 配置机器 API 的 challenge 豁免、原有限流与观测脱敏。旧 zone 的这些设置不会随着 Worker 自动复制。
- 已确认旧 Pro 有两条限流（WS 握手与配对）。当前 Cloudflare 文档中 Free 仅一条、10 秒窗口，且表达式字段少于 Pro；不能原样复制现有两条 60 秒规则。正式承接流量前需决定套餐一致性或经过验证的等效应用层防护；本次未变更套餐或防护。
- 两个 zone 的边缘计数不是一个共享计数器；即使规则复制，流量也可以跨入口分摊。继续共享服务内的注册、配对和语音强一致计数，评估总量而非仅单 zone。
- 保留旧域名、证书和服务绑定；不把旧入口整体重定向到新入口，不让旧 App 被动承担迁移。
- 根域名/www 的官网跳转只匹配官网入口，不能用广泛通配跳转误伤 API、配对 fragment 或 well-known 文件。

## 后续验证顺序

1. 先完成新入口基础设施和健康检查，保留旧默认流量；同一批大陆/境外节点比较 DNS、TCP、TLS、HTTP，并在真实大陆 Wi-Fi/蜂窝上比较长 WebSocket。分别记录 IPv4/IPv6、运营商、节点及成功率，不能用一次 200 判定改善。
2. 用隔离测试配对验证四种组合：旧 App/旧 Bridge、新 App/旧 Bridge、旧 App/新 Bridge、新 App/新 Bridge。对新 App 测新旧入口往返切换，对 Bridge 测既存配对升级后再次 pair/refresh-code 不换身份。
3. 覆盖 OpenClaw/Hermes；Pi、本地模型在各自服务可用后加入矩阵。核实 operator/node、短码/旧二维码/一键链接、历史恢复、流式回复、语音签名与共享占用/额度。
4. 验证设置离线可用、重启后保留、已有连接默认换入口、显式旧入口不被覆盖、自托管不变、错误 token/配对过期仍按原语义失败。
5. 实施后运行 required、v1 compat 与定向恢复测试，再由负责人做 iOS 验收。新版本打包、上传与发布按独立授权执行。

## 本轮交付边界

本轮只新增此调研文档；未改产品代码、配对文件、Worker/DNS/WAF、默认域名、套餐或运行进程，未构建或发布。当前结论来自源码与控制面只读核查；尚未配置新服务入口，因此没有新旧域名性能提升或真实会话切换成功的验收结论。

## 官方资料

后续基础网络对照已完成，见 [新旧域名基础网络测试](domain-network-comparison-2026-09-25.md)。短时大陆样本未显示新入口整体优于旧入口；临时测试配置已清理，产品默认地址未更改。

- [Cloudflare Custom Domains：同一 Worker 多域名](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)
- [Durable Object namespace API](https://developers.cloudflare.com/durable-objects/api/namespace/)
- [China Network：跨境路径的时延和可靠性](https://developers.cloudflare.com/china-network/)
- [WAF 限流能力与套餐差异](https://developers.cloudflare.com/waf/rate-limiting-rules/)
