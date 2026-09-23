# Chat 云端语音输入

2026-09-19 负责人授权用 Expo Audio PCM + 阿里云 Qwen 取代系统语音识别。2026-09-20 负责人授权完整落地弱网恢复、错误诊断和启动优化。本次仍使用独立 Preview 服务；不改变 Pro 权益或正式商店发布范围。

## 交互与恢复

- 点击麦克风完成后持续听写；空白/未聚焦紧凑输入区长按 200 ms 开始。权限已授予时使用本页预检结果；预检绝不弹权限框或打开麦克风，返回前台重新检查。未授权只在明确开始录音时请求。原生音频会话仍由 Expo Audio 激活和释放，不以提前偷偷录音换速度。
- 停止回填草稿；按住松手或录音中发送键提交最终文本。上滑取消、录音中的显式 Cancel 丢弃当前录音；原生输入框和常驻模型工具栏始终保持挂载。短按住不发送，减少动态效果时波形静止。
- 单次最多十分钟，到时自动停止并回填草稿。网络或上游失败只暂停转录，继续本机录音；提示“正在本机录音 · 转录已暂停”。录音本身不依赖 Agent 是否在线，Agent 离线时不自动发送。
- PCM 每个原生回调先追加到设备沙盒 `voice-drafts-v1`，再上传。元数据创建一次，恢复依据实际 PCM 文件长度，结果按段写临时文件再替换。App 正常退出/被系统终止后已写入的分片可恢复；设备掉电、卸载、系统/磁盘损坏及尚未交付的原生缓冲不属于可保证范围。服务端不持久化音频或文字。
- 返回、切会话、后台/来电中断停止录音并保留本机文件，迟到转录不写入其他会话、不发送消息。回到原连接/会话后“录音已保留 · 点击恢复”可用；输入框已有文字也显示。恢复提供保留、删除、重试。再次点麦克风时先处理该会话未完成录音，不覆盖它。
- 重试只回填当前草稿，不自动发消息；当前草稿为空时恢复录音原有的文字前缀。已完成段有检查点，不重复提交。取消重试/离开页面保留音频，显式删除才移除。成功交付草稿后清理音频。最多保留 10 份（每份上限 19.2 MB），达到上限拒绝新录音，不自动清理未发送内容。磁盘写入失败立即停止，保留此前已写入的部分并提示腾出空间。

## 数据路径

`Expo Audio → 16 kHz / mono / PCM16 → 本机追加文件 → signed WSS → 独立 speech Worker → Alibaba Qwen → 逐段结果检查点 → 原有草稿/发送入口`

客户端同步采集和转录；每个 Provider task 最多读取 110 秒音频，十分钟使用六个独立准入任务。服务端仍保持 120 秒 / 3.84 MB 单任务上限。连接准备期间首字留在本机文件，补传最高 5 倍实时速度。v2 ready 协商 `flowControl: ack.v1`，服务端每次转发 PCM 后确认累计接收字节；客户端未确认窗口达到 64 KB 时暂停读取，超过等待期限保留原始文件供重试。React Native 的 `bufferedAmount` 可能未实现，不能用它作为必要发送条件；旧服务未协商 ACK 且没有该属性时按实时速度发送。v1 不接收 ACK 新帧。客户端不把整段十分钟录音加载到内存。OpenClaw/Hermes 经过同一发送/排队入口。

Provider WebSocket 握手有独立 10 秒超时，fetch 返回或失败立即清理计时器；不可让握手 AbortSignal 在成功升级后继续计时并关闭长连接。后续启动、音频闲置、单段时长、结束等待由 session 自己控制。转录提前失败时仍继续本机录音，停止后才弹出已保存的错误，因此“点完成立即报错”不等于完成按钮触发断连。

身份用已有 SecureStore Ed25519 key 签署 `clawket-speech-v1|host|timestamp|nonce`；密钥不传输。模型固定 `qwen-audio-3.0-asr-flash-streaming`，Provider endpoint/key 由服务端控制。音频与转录会传给阿里云，服务条款和商店隐私披露仍需覆盖该处理。

## 额度与诊断

- 设备 60 次/固定小时、哈希 IP 120 次/固定小时、服务 200 次/UTC 日；每个任务按完整两分钟预留，失败/取消不退，重试和长录音后续段分别计数。保留成本底线，不静默放宽额度。单设备独占租约 150 秒，签名时钟窗口一分钟，nonce 防重放两分钟。
- 设备签名不等于用户订阅，也不能阻止新建身份。未来服务端权益验证应在占用额度和连接阿里云之前完成，不信任客户端 Pro 标记。
- 新客户端请求 `x-speech-protocol: 2`：拒绝原因通过一次 WebSocket error frame 返回，以避开 RN 无法读取失败握手响应体的问题；旧客户端继续收到原来的 HTTP 401/429/503/502。ready/error/result 可附服务端生成 UUID `requestId`；错误可附 `retryAfterMs`。
- 错误区分：`speech_busy`（前次占用尚未释放）、`speech_auth`（签名/时钟/重放）、`speech_device_limit`、`speech_ip_limit`、`speech_daily_limit`、`speech_admission_failed`（准入基础设施）、Provider 的 busy/auth/quota/upgrade/unreachable/start_timeout/failed，以及连接、音频闲置和结束超时、协议/大小、原生采集和本机存储问题。
- 服务端释放设备占用后才向客户端确认完成，避免连续新建录音竞争旧租约。清理幂等，旧调用不会释放新 nonce 的租约。客户端重试入口在本次 native teardown 完成后才展示，旧 finally 不能停止新录音。
- Worker 日志全采样，仅显式结构化记录 requestId、阶段、稳定错误码、字节数、耗时/状态；关闭自动 invocation request logs，避免签名请求头和 IP 被默认记录。绝不记录音频、文本、原始 provider 错误内容或 Key。此前历史日志采样/缺字段，无法据此认定负责人 09-20 下午故障根因。
- Mobile `chat_voice_input_failed` 保留稳定 code 和服务端 request_id；`chat_voice_input_timing` 记录从开始操作到 native_started/first_buffer 的毫秒数，不附会话、文字或录音。真机启动性能以这些观测为准，自动测试不声称达到固定毫秒数。

## 配置与运维

- Preview：`wss://clawket-speech-preview.clawket.workers.dev/v1/speech`；Mobile 本地 `.env.local` 设置 `EXPO_PUBLIC_SPEECH_URL`。它是公开 URL，绝不能填写 Key。未配置时隐藏麦克风/长按入口。EAS 本地同步只将它送到 development，Production 必须显式配置隔离服务。
- Key 只放 Worker secret `ALIYUN_SPEECH_API_KEY`；`SPEECH_ENABLED=false` 停用。私有备份在仓库外 owner-only 目录。公开 URL 不等于公开 Provider Key；知道 URL 的自建客户端可能使用我们尚未接订阅授权的 Preview 服务。
- `npm run speech:typecheck`、`npm run speech:test`、Mobile 语音套件与 `npm run check:required`。真实验证：`node scripts/speech/smoke.mjs <wss endpoint> <16k mono PCM file>`，只用合成或明确授权音频。v1 smoke 继续验证旧手机协议；v2 验证错误码与连续录音。
- 本轮不增加原生依赖；设备必须已有 Expo SDK 57 / Expo Audio 和 FileSystem 的开发构建。模型、Relay、Registry、Bridge 配对和订阅行为不变。

## 验收

自动检查覆盖持久文件恢复/损坏输入、限额与分段检查点、十分钟六任务、发送拥塞、断网后继续录音、后台/卸载组件/切会话恢复、取消和迟到清理、双后端只发送一次、重试不发送、具体错误帧和服务端释放先于结果。真机仍须验收 iOS/Android 首次及重复启动、蓝牙/来电、断网一分钟后继续讲话、十分钟录音、杀 App 后回原会话恢复、磁盘不足、连续短录音和长按触摸。

2026-09-22 负责人要求：桌面小组件语音入口直接进入现有录音流程，不再弹「开始录音」确认层。等待 App 前台、线程聚焦和原会话草稿恢复，导航过渡后一次性启动；切换目标或卸载取消待启动动作。系统权限、已有录音恢复及停止/取消沿用聊天录音行为，不自动发送。界面由负责人验收，不操作模拟器。
