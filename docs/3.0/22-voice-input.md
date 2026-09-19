# Chat 云端语音输入

2026-09-19 负责人授权：参考 Isaac Codex 的录音/流式转录链路，删除原有 iOS 系统语音识别；iOS、Android 共用阿里云转录。交互保留 Clawket 底部常驻模型选择器。本次开放 Preview 验证，付费墙接入属于后续阶段。

## 交互

- 麦克风在一次点击完成后开始持续听写（不是触摸按下时启动）；准备中重复点击不取消。空白或未聚焦的紧凑输入区整块支持长按说话，点按进入原生文字编辑；空白提示“打字，或按住说话”，过短长按提示“按住久一点再说话”。停止键结束并回填草稿，发送键结束后发送。
- 按住进入语音模式，松手发送最终文本；上滑取消，滑回恢复。触摸被系统取消、权限尚未获批或录音太短时不发送。
- 录音显示随音量变化的主题色波形；准备和收尾显示等待状态。模型选择器保持原位置，原生输入框保留挂载，录音期间锁定草稿。减少动态效果时波形静止。
- 两分钟上限自动结束并回填草稿；切后台不自动发送；切会话、换连接或离开页面取消并忽略迟到结果。
- 失败可手动重试保留在内存的音频，成功仅回填草稿。取消、退出和下一次录音丢弃保留音频；不自动重试聊天发送。取消只等待原生录音清理即可开始下一次，旧身份/连接请求的迟到清理不能影响新录音。

## 数据路径与边界

`Expo Audio → 16 kHz / mono / PCM16 → signed WSS → speech Worker → Alibaba Qwen → final transcript → existing chat send/queue`

`expo-audio` 负责麦克风采样，不依赖 Apple Speech/SpeechAnalyzer。采样先于云端握手，首字缓存；重采样支持硬件采样率变化。`useChatVoiceInput` 管理完整录音生命周期，`useVoiceGesture` 管理触摸语义。`speechStream` 使用现有 SecureStore Ed25519 identity 签署独立的 `clawket-speech-v1|host|timestamp|nonce` 请求，身份密钥不传输。转录结果经现有发送流程，OpenClaw/Hermes 不增加后端协议分支。

独立 `apps/speech-worker` 不复用 Relay/Registry 资源，模型固定为 `qwen-audio-3.0-asr-flash-streaming`。端点与模型由服务器控制，Provider Key 只在 Worker secret。客户端最多保留 3.84 MB / 120 秒 PCM，单帧有限额，慢连接、准备、闲置和收尾均有超时。Worker 明确指定 `binaryType=arraybuffer`，上游重定向不跟随。音频和转录文本不落盘、不进入日志；阿里云仍会接收音频并按其服务条款处理。

Admission Durable Object 仅保存计数、nonce 和短时互斥租约：设备 60 次/小时、哈希 IP 120 次/小时、服务总量 200 次/天，每次按完整两分钟预留；失败/取消也计入额度。签名时钟窗口一分钟，nonce 防重放两分钟，单设备一次活动录音。签名仅证明设备持有密钥，不能证明订阅或阻止创建新身份；总额度用于限制 Preview 成本，不是正式商业授权方案。

## 配置与运维

- Preview：`wss://clawket-speech-preview.clawket.workers.dev/v1/speech`。
- Mobile：本地 `.env.local` 中设置 `EXPO_PUBLIC_SPEECH_URL`；此变量是公开端点，禁止填写 API key。未配置时隐藏麦克风；本地 EAS 同步脚本只把此值同步至 development，其他构建环境必须显式配置自己的端点，不能把 Preview 服务作为 Production 默认值。
- 阿里云专用 Key：备注 `clawket-speech-20260919`，ID `7334968`，仅允许 Qwen-Audio-3.0-ASR-Flash-Streaming。凭据备份在开发机仓库之外的 owner-only 配置目录；不将其复制到文档或 Git。
- Worker secret 名称 `ALIYUN_SPEECH_API_KEY`；`SPEECH_ENABLED=false` 为停用开关。首次部署先创建 Worker，再使用 `wrangler secret put ALIYUN_SPEECH_API_KEY --config apps/speech-worker/wrangler.jsonc` 安全输入凭据，最后启用服务。
- `npm run speech:typecheck`、`npm run speech:test` 为自包含检查，已接入仓库 required 门禁。`node scripts/speech/smoke.mjs <wss endpoint> <16k mono PCM file>` 是显式真实服务测试；只传合成或明确授权音频，失败必须非零退出。
- 原生依赖已改变，必须重建 App；旧开发壳或单纯 OTA 不会获得 Expo Audio 模块。最低系统版本继续遵循 App 的 Expo SDK 57 配置（iOS 16.4），并非支持任意旧版 iOS。

## 后续付费阶段

在 Worker 创建上游连接和占用额度之前，验证服务器可信的用户登录与订阅权益；接入现有 `requirePro`/购买恢复续做体验，但绝不能以客户端 `isPro` 布尔值作为云端授权。先确定录音配额/计费方案和 RevenueCat 身份绑定，再配置独立 Production 服务、密钥、额度和告警。此次不自动修改商品、价格或现有付费权益。

## 验证

自动化覆盖重采样、签名/跨域防重放、计数/互斥、音频帧与超时、取消和迟到结果、权限竞争、手势、后台抑制发送、失败显式重试、模型工具栏保留。真实 Preview 合成音频验证覆盖云端签名准入、阿里云握手、PCM 传输和最终文本。

真机验收在 `PROGRESS.md` 的 HT-VOICE-0919：双平台麦克风权限、长按/点击、蓝牙、来电/后台、弱网与重试，以及浅/深色、大字体、RTL、减少动态效果。自动测试与编译不能替代实际触摸和听感验收。
