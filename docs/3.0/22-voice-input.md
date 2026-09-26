# Chat 云端语音输入

2026-09-19 负责人授权用 Expo Audio PCM + 阿里云 Qwen 取代系统语音识别。2026-09-20 负责人授权完整落地弱网恢复、错误诊断和启动优化。2026-09-25 将正式版语音迁至独立 Production Worker 和 `speech.clawket.ai`；不改变 Pro 权益。

## 交互与恢复

- 2026-09-26 负责人授权启动提速：麦克风按钮按下即开始采集，松手时再区分点击（持续听写）与按住（松手发送）；空白/未聚焦紧凑输入区长按 200 ms 开始，打字不开麦克风。取消“正在开启麦克风”状态：权限已知时按下即进入聆听态（波形展开），原生采集随后补上；手指未离开麦克风前不显示停止按钮。权限已授予时使用本页预检结果；预检绝不弹权限框或打开麦克风，返回前台重新检查。未授权只在明确开始录音时请求，此时先等授权再进入聆听态。
- 采集由本地 `apps/mobile/modules/clawket-voice-capture` 模块负责（Expo Audio 只保留权限接口）：会话切换与引擎启停在独立串行队列上执行，不再与 Expo 全局异步队列上的钥匙串、文件和分析调用互相排队。iOS 会话类别只配置一次（`.playAndRecord` + `.measurement` + `.defaultToSpeaker`，不启用蓝牙输入），不强制 16 kHz 硬件采样率（由原生转换器转为 16 kHz），录音期间允许触感反馈；聚焦且在前台的会话页预先建好引擎，录音之间只暂停引擎（不采集、不亮麦克风指示灯）。激活会话若打断了其他 App 的声音，停止后立即释放让其恢复；否则空闲 30 秒、离开会话页或切后台时释放。Android 预先创建并复用 `AudioRecord`（MIC 音源不变），读块 40 ms。仍不以提前偷偷录音换速度：按下之前麦克风不运行。
- 停止回填草稿；按住松手或录音中发送键提交最终文本。上滑取消、录音中的显式 Cancel 丢弃当前录音；原生输入框和常驻模型工具栏始终保持挂载。短按住不发送，减少动态效果时波形静止。
- 单次最多十分钟，到时自动停止并回填草稿。网络或上游失败只暂停转录，继续本机录音；提示“正在本机录音 · 转录已暂停”。录音本身不依赖 Agent 是否在线，Agent 离线时不自动发送。
- PCM 每个原生回调先追加到设备沙盒 `voice-drafts-v1`，再上传。元数据创建一次，恢复依据实际 PCM 文件长度，结果按段写临时文件再替换。App 正常退出/被系统终止后已写入的分片可恢复；设备掉电、卸载、系统/磁盘损坏及尚未交付的原生缓冲不属于可保证范围。服务端不持久化音频或文字。
- 返回、切会话、后台/来电中断停止录音并保留本机文件，迟到转录不写入其他会话、不发送消息。回到原连接/会话后“录音已保留 · 点击恢复”可用；输入框已有文字也显示。恢复提供保留、删除、重试。再次点麦克风时先处理该会话未完成录音，不覆盖它。
- 重试只回填当前草稿，不自动发消息；当前草稿为空时恢复录音原有的文字前缀。已完成段有检查点，不重复提交。取消重试/离开页面保留音频，显式删除才移除。成功交付草稿后清理音频。最多保留 10 份（每份上限 19.2 MB），达到上限拒绝新录音，不自动清理未发送内容。磁盘写入失败立即停止，保留此前已写入的部分并提示腾出空间。

## 数据路径

`本地采集模块 → 16 kHz / mono / PCM16 → 本机追加文件 → signed WSS → 独立 speech Worker → Alibaba Qwen → 逐段结果检查点 → 原有草稿/发送入口`

客户端同步采集和转录；每个 Provider task 最多读取 110 秒音频，十分钟使用六个独立准入任务。服务端仍保持 120 秒 / 3.84 MB 单任务上限。连接准备期间首字留在本机文件，补传最高 5 倍实时速度。v2 ready 协商 `flowControl: ack.v1`，服务端每次转发 PCM 后确认累计接收字节；客户端未确认窗口达到 64 KB 时暂停读取，超过等待期限保留原始文件供重试。React Native 的 `bufferedAmount` 可能未实现，不能用它作为必要发送条件；旧服务未协商 ACK 且没有该属性时按实时速度发送。v1 不接收 ACK 新帧。客户端不把整段十分钟录音加载到内存。OpenClaw/Hermes 经过同一发送/排队入口。

Provider WebSocket 握手有独立 10 秒超时，fetch 返回或失败立即清理计时器；不可让握手 AbortSignal 在成功升级后继续计时并关闭长连接。后续启动、音频闲置、单段时长、结束等待由 session 自己控制。转录提前失败时仍继续本机录音，停止后才弹出已保存的错误，因此“点完成立即报错”不等于完成按钮触发断连。

身份用已有 SecureStore Ed25519 key 签署 `clawket-speech-v1|host|timestamp|nonce`；密钥不传输。模型固定 `qwen-audio-3.0-asr-flash-streaming`，Provider endpoint/key 由服务端控制。音频与转录会传给阿里云，服务条款和商店隐私披露仍需覆盖该处理。

## 额度与诊断

- 设备 60 次/固定小时、哈希 IP 120 次/固定小时、服务 200 次/UTC 日；每个任务按完整两分钟预留，失败/取消不退，重试和长录音后续段分别计数。保留成本底线，不静默放宽额度。单设备连接准备占位 25 秒；Provider 升级后仅匹配且未过期的 nonce 可提升为 150 秒正常会话占位。签名时钟窗口一分钟，nonce 防重放两分钟；准备占位过期不退额度、不移除防重放记录，旧 reserve RPC 仍保持 150 秒默认值。
- 设备签名不等于用户订阅，也不能阻止新建身份。未来服务端权益验证应在占用额度和连接阿里云之前完成，不信任客户端 Pro 标记。
- 新客户端请求 `x-speech-protocol: 2`：拒绝原因通过一次 WebSocket error frame 返回，以避开 RN 无法读取失败握手响应体的问题；旧客户端继续收到原来的 HTTP 401/429/503/502。ready/error/result 可附服务端生成 UUID `requestId`；错误可附 `retryAfterMs`。
- 错误区分：`speech_busy`（前次占用尚未释放）、`speech_auth`（签名/时钟/重放）、`speech_device_limit`、`speech_ip_limit`、`speech_daily_limit`、`speech_admission_failed`（准入基础设施）、Provider 的 busy/auth/quota/upgrade/unreachable/start_timeout/failed，以及连接、音频闲置和结束超时、协议/大小、原生采集和本机存储问题。
- 服务端在准入前将有界准备任务交给 `waitUntil`，启用 request abort signal；v2 在认证后先升级手机连接，使准备阶段 cancel/close 可取消上游握手。所有异步阶段后检查取消状态，过期/被替换占位不能启动 Provider task。准备阶段总期限 20 秒，上游升级期限仍为 10 秒，完成准备即清理相关监听/计时器。v1 仍保留原 HTTP 拒绝方式。
- 服务端释放设备占用后才向客户端确认完成，避免连续新建录音竞争旧租约。释放失败最多尝试三次（100/200 ms 退避），增加不含身份/音频的占位与释放诊断日志。清理幂等，旧调用不会释放新 nonce 的租约。客户端重试入口在本次 native teardown 完成后才展示，旧 finally 不能停止新录音。
- Worker 日志全采样，仅显式结构化记录 requestId、阶段、稳定错误码、字节数、耗时/状态；关闭自动 invocation request logs 和 traces，启用 query-string redaction，避免签名请求头和 IP 被默认记录。绝不记录音频、文本、原始 provider 错误内容或 Key。此前历史日志采样/缺字段，无法据此认定负责人 09-20 下午故障根因。
- 客户端仅对 `ready` 前明确的 `speech_busy` 拒绝进行自动重连：30 秒启动窗口内最多重试八次，500 ms 起指数退避、单次最多 5 秒，可随时取消；音频仍落本机，忙碌拒绝不消耗 Provider 额度。已上传任务、丢失最终结果、网络/认证/额度错误不自动重放。后台/导航取消会关闭迟到连接。错误等待时间记录为截止时间，停止录音才展示时扣除已过去的时间，过期不再显示冷却提示。
- Mobile `chat_voice_input_failed` 保留稳定 code 和服务端 request_id；`chat_voice_input_timing` 记录从开始操作（麦克风按钮为按下瞬间）到 native_started/first_buffer 的毫秒数，native_started 另附原生分步耗时、是否复用预热引擎和音频端口类别，不附会话、文字、录音或设备名。真机启动性能以这些观测为准，自动测试不声称达到固定毫秒数。

## 配置与运维

- Production：`wss://speech.clawket.ai/v1/speech`，独立 `clawket-speech` Worker、Durable Object、secret 和被 Git 忽略的 `wrangler.production.local.jsonc`，Custom Domain 启用，`workers.dev` 关闭。EAS Production 环境和 `eas.json` Store profile 都固定这个公开 URL；维护者本地 `.env.local` 提供同一 URL 和 `CLAWKET_OFFICIAL_BUILD=1`。官方 Android/iOS EAS Store 构建及启用官方标记的 Xcode 非 Debug 打包会拒绝缺失或 Preview URL；Xcode dotenv 加载不覆盖已有的 EAS/命令行值。已上传/安装的 AAB 内嵌旧地址，须重新构建与发布才能更正；配置变更不会改写旧包。
- Preview：`wss://clawket-speech-preview.clawket.workers.dev/v1/speech`；Mobile 本地 `.env.local` 可设置 `EXPO_PUBLIC_SPEECH_URL`。它只供本地开发/Preview，EAS 本地同步只将它送到 development。URL 是公开配置，绝不能填写 Key；未配置时隐藏麦克风/长按入口。
- Cloudflare 区域 WAF 仅对 `speech.clawket.ai` 的 `/health` 和 `/v1/speech` 跳过会阻断机器请求的托管防护/安全等级/Bot 检查，不跳过限流；Worker 自身仍执行签名、防重放与设备/IP/总量准入。
- Key 只放 Worker secret `ALIYUN_SPEECH_API_KEY`；`SPEECH_ENABLED=false` 停用。私有备份在仓库外 owner-only 目录。公开 URL 不等于公开 Provider Key；知道 URL 的自建客户端可能使用我们尚未接订阅授权的 Preview 服务。
- `npm run speech:typecheck`、`npm run speech:test`、`npm run speech:test:integration`（自包含本地 workerd + 合成 Provider，覆盖握手断开、v1/v2 连续录音、真实 DO 占位过期/替换隔离）、Mobile 语音套件与 `npm run check:required`。真实验证：`node scripts/speech/smoke.mjs <wss endpoint> <16k mono PCM file>`，只用合成或明确授权音频。v1 smoke 继续验证旧手机协议；v2 验证错误码与连续录音。
- 本轮不增加原生依赖；设备必须使用包含 Expo SDK 57 / Expo Audio 和 FileSystem 的原生构建。模型、Relay、Registry、Bridge 配对和订阅行为不变。2026-09-26 起采集改由本地原生模块 `clawket-voice-capture` 提供（无新增第三方依赖），设备必须安装包含该模块的新原生构建；不含该模块的旧开发包隐藏语音入口，不会回退到旧采集路径。

## 验收

自动检查覆盖持久文件恢复/损坏输入、限额与分段检查点、十分钟六任务、发送拥塞、断网后继续录音、后台/卸载组件/切会话恢复、取消和迟到清理、双后端只发送一次、重试不发送、具体错误帧和服务端释放先于结果。真机仍须验收 iOS/Android 首次及重复启动、蓝牙/来电、断网一分钟后继续讲话、十分钟录音、杀 App 后回原会话恢复、磁盘不足、连续短录音和长按触摸。

2026-09-22 负责人要求：桌面小组件语音入口直接进入现有录音流程，不再弹「开始录音」确认层。等待 App 前台、线程聚焦和原会话草稿恢复，导航过渡后一次性启动；切换目标或卸载取消待启动动作。系统权限、已有录音恢复及停止/取消沿用聊天录音行为，不自动发送。界面由负责人验收，不操作模拟器。

开源构建：受跟踪 Wrangler 文件为默认停用的占位模板；复制为 `.local.jsonc` 后填写自己的账号、域名、Provider 地址，通过 Worker secret 提供 Key。社区 Release/Archive 不设置 `CLAWKET_OFFICIAL_BUILD`，可不配置语音或使用自建端点。官方 profile 保留正式域名校验。

2026-09-26 负责人授权上线占位清理修复：Production `491efc20-7a1c-4f49-9ad8-9706f500dad7`、Preview `a47225c3-a39d-4775-ab1f-e4d3a7bbe6f3` 均为 100%。两端导出的 `index.js` SHA-256 均为 `2cc0ba29057e5042af3060413da3ae7b702fc4effee5312453ccf3297174966a`，与本地候选包一致；原有独立 DO namespace、secret、Provider endpoint 和域名保留。回滚锚点分别为 `76e3c31f-6a78-4920-a681-9170342b0672` / `ddeaf1b0-cb86-44e7-a639-f920347d2df4`。真实阿里云合成音频验证两端 v1、v2 30 秒、连续录音、准备阶段取消/强断后的首次重连成功，以及活动录音不能被抢占；未声称完整十分钟真机/全运营商验收。证据在本地 `evidence/speech-busy-0926/verified-deployment.json`。客户端自动等待/冷却提示修改仍须安装包含改动的 3.1.0 构建。
