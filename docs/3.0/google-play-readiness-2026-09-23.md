# Google Play 3.0 发布准备检查 · 2026-09-23

当前进展：**负责人已确认 Android 基础功能及语音修复实测通过，授权继续推进正式发布。** 正在构建正式签名的 3.0.0 / 30001 AAB；下文初次审计为历史记录，后续进展以文末为准。Play 已有 2.1.0 正式版，本次属于 3.0 更新。

负责人明确要求隐私相关内容保持原样：不修改 Google Play 数据安全、隐私政策或相关设置。本任务仅推进签名、构建及发布操作，历史审计意见不构成修改授权。

## 已交付测试包

- Samsung SM-A566B 上成功覆盖安装并启动 **Clawket QA 3.0.0 / 30000**，包名 `com.p697.clawket.qa`。保留原商店包 `com.p697.clawket` 2.1.0 / 20109 与 QA 数据，未卸载或清空数据。
- 独立 arm64 Release APK，内置 JS，不依赖 Metro；本次构建关闭强制 Pro 解锁及 RevenueCat 测试 key。不同包名的 QA 不作为正式购买、恢复购买或旧商店包覆盖升级证据。
- 源码为 `558ba25` 加当时工作区的未提交改动；不是干净提交对应的正式候选。测试修正仅涉及两个 Mobile 测试模拟，未改生产行为。
- 构建使用 JDK 17、生成的 Gradle 9.3.1 和本机外置磁盘上的真实路径 `GRADLE_USER_HOME`，成功执行 950 个任务。旧 HT-ANDROID-0919 的本机缓存问题在这个配置下不再阻塞构建。
- min SDK 24 / target SDK 36；27 个 arm64 原生库的 ELF LOAD alignment 全部至少 16 KB，`zipalign -c -P 16 -v 4` 通过。手机实际页大小 4096，未宣称 16 KB 设备运行实测。正式 AAB 仍需检查其所有 ABI 和 Play 处理结果。
- APK：`evidence/google-play-2026-09-23/clawket-qa-3.0.0-30000.apk`，SHA-256 `892a339534aba54bad71761631ef041a9b00d85b9454bbe45c95d3601c254504`。
- 安装经历 Play Protect 确认页面，最终 ADB 返回 Success；启动返回 Status ok / WARM，进程存活，读取 crash buffer 未见 Clawket 崩溃。没有把启动检查等同于功能、连接稳定性或连续冷启动验收。

## Google Play 后台只读结果

| 项目 | 当前状态与结论 |
|---|---|
| 正式版本 | 最新 bundle 20109 / 2.1.0，正式轨道全面发布至 177 个国家/地区；尚无 3.0 bundle。封闭测试为 20108，内部测试仍是 10700 / 1.7。 |
| 商店素材 | 19 种语言及中文图标、手机/7 英寸/10 英寸截图和置顶图已保存；发布概览列出 26 项待送审更改。沿用 09-22 全语言图片逐张验收记录，本次没有重新上传。 |
| 发布控制 | 已开启自管式发布。素材“可以送审”提示不等于 3.0 包或政策内容通过。 |
| 政策状态 | 页面显示没有政策问题、没有待处理声明；11 个已处理声明最后修改日均为 03-30，需要按 3.0 行为复核。 |
| 数据安全 | 当前“是否收集或分享必须披露的数据”选 **否**。本地严格发布配置检查确认 PostHog 和 RevenueCat enabled；PostHog 开启 lifecycle capture。现有申报不应直接沿用。 |
| 公开隐私政策 | `https://clawket.ai/privacy/` 仍称无 analytics、无第三方共享，且只描述 OpenClaw。必须按实际分析、支付、Relay/语音等数据流核对并更新，不能推断所有数据都属于同一种收集或分享。 |
| 审核访问 | “是否有任何部分设有限制”选 **否**。实际存在配对、另一台设备和付费访问；需提供稳定、可复现且覆盖核心/Pro 功能的审核访问说明。不能只提供短期、单次配对码。 |
| 月付/年付 | `com.p697.clawket.pro.monthly` 下 monthly 和 yearly 两个自动续订基础方案均有效，各覆盖 174 个国家/地区。商品名带 Monthly 不代表缺少年付。 |
| 终身商品 | `com.p697.clawket.pro.lifetime` 存在，列表显示 1 个有效购买选项。未在本轮认证 RevenueCat offering/entitlement 映射、所有地区价格或 license tester 资格。 |
| 旧包提示 | 页面提示旧正式版的 edge-to-edge API、大屏方向限制，以及过时 alpha 轨道。未将旧包提示当作新包已失败，也未擅自暂停轨道。 |

后台入口：[发布概览](https://play.google.com/console/u/0/developers/5699297822309520683/app/4975023616700245417/publishing)、[应用内容](https://play.google.com/console/u/0/developers/5699297822309520683/app/4975023616700245417/app-content/overview)。

## 自动检查与剩余工程项

- 首次 Mobile 测试 328 套通过、2 套失败：Sheet mock 未渲染新 footer，navigation mock 未提供 useIsFocused。只补齐这两个测试模拟；相关 20 项通过，随后 Mobile 全量 **330 套 / 3,415 项通过**。
- 全部工作区 typecheck、协议覆盖、Relay 测试通过。v1 replay **5 files / 39 tests** 通过；其余 CLI、70 项脚本测试、speech、设计系统（211 个 UI 源文件）及 docs 检查通过。
- **全仓 required 仍不是绿灯**：Bridge Runtime 报文录制测试 1 项失败（39 files / 336 tests 通过），当前并行 Hermes 改动新增 `lastActivityAt` 而录制预期未更新。未修改他人 Bridge 改动或放宽断言。
- 单独运行后续门禁：i18n strict 因既有 `settings:About me` 未使用键失败；19 语言没有缺失翻译。其他后续检查通过。
- APK 仍声明 READ_MEDIA_IMAGES/VIDEO/AUDIO 和位置权限。后台 READ_MEDIA_IMAGES/VIDEO 已声明，用途包括配对/聊天选图及 OpenClaw Node 接收用户授权的远程照片/视频命令；不能简单视为漏填。Android 图片选择路径使用系统 picker，发布前仍需确认 3.0 的节点能力与这些广泛权限用途一致。本次未贸然删除权限影响照片保存、分享或双后端节点能力。
- 本机没有生成的 `android/app/keystore.properties`。本次仅采用明确 debug-sign fallback 构建 QA；正式 upload key / EAS credentials 的可用性与 Play 匹配尚未验证，不能据此声称签名已就绪或密钥丢失。

日志和包均保存在本机忽略目录 `evidence/google-play-2026-09-23/`：`android-build.log`、`required.log`、`focused-tests.log`、`required-final.log`、`remaining-gates.log`、`public-config.log`、`elf-alignment.json`、`zipalign.log`、`permissions.txt`、`device-install.txt`。

## 下一步验收

### 负责人语音失败反馈（09-23）

截图请求 `85ead65e-b1ab-40a2-9081-25b583f85c8d` 已在 `clawket-speech-preview` 日志定位：UTC 23:25:48.346 connected（上游建立耗时 1138 ms），23:25:57.268 disconnected，收到 915200 字节 PCM。线上版本 `872fdcdf-752b-4388-a3a9-83c033895095` 源码确认 session 的 speech_disconnected 来自 provider close/error，手机客户端 close/error 走另一个终止分支。因此本次已定位为 Worker–识别供应商连接中断，不能归因于漏打语音地址、未连接或未授权麦克风（设备 RECORD_AUDIO granted=true）。音频字节到达不证明内容/编码正确，也未排除 Android 音频触发上游问题。

此前另一请求 `0afcf063-75f0-4dd0-9841-7d74cda0513a` 同样在连接后约 9 秒断开（348800 字节）。稍后 `2fcef682-8904-4405-aa36-586be3d5141b` 记录 speech_complete（156416 字节）；日志不标平台且完成码也用于客户端退出，不能拿它认证 iOS/Android 转录成功。现有日志没有 provider close code 或安全归类后的关闭原因，尚不能确定供应商为何关闭。负责人报告 App Store 版本正常；本轮未读取其实际包配置，也未重传私人录音、修改服务或重新打包。Android 语音验收仍待关闭。

后续定位（覆盖上面的初步未定结论）：线上源码仍使用 `AbortSignal.timeout(10000)` 发起 Provider upgrade；成功返回后该信号继续计时，误关已建立的 WebSocket。最新非合成探针请求 `4c66acd9-dee3-4edc-ac6b-b8fa189919f3` / `f5f368d2-a101-4301-a944-1f1f88bfc792` 分别在 connected 后 9328 / 9452 ms 断开；无法只凭日志归属到某台手机。合成 110 秒音频分别以 1 倍和 5 倍发送都在约 11.3 秒总耗时失败，排除只由 Android 采集或加速补传引起的解释。40 秒音频以 5 倍发送，在截止前结束并取得非空最终结果。

本地 workerd 对照（兼容日期 2026-09-17，受已安装运行时支持日期限制）：旧写法 10006 ms 收到 upstream_closed，清理握手计时器后 12 秒仍能往返消息。已修正服务端为 AbortController + 可清理 timer，保留卡住握手时的 10 秒保护；新增回归先在旧代码失败，再在修复后通过。Speech 6 文件 / 33 项及 typecheck 通过；Mobile 分段/流式 13 项通过。修复尚未部署，不能据本地对照声称线上长录音已恢复，Android/iOS 端到端仍待修复部署后复验。

负责人补充短录音点击完成立即失败、重试可成功：客户端会将提前断连保存为 op.error，继续采集并等待 stoppedPromise，按完成才报告；重试已保存音频可按最高 5 倍发送，故同一内容可能避开截止。若严格小于 10 秒的完整连接仍断开，不能直接归为此原因，需对应请求 ID 另查。证据在忽略目录 `evidence/speech-long-0923/`，仅合成音频和诊断元数据，未读取私人录音。

1. 负责人打开 **Clawket QA**：OpenClaw/Hermes 各连续发几轮，检查用户气泡、思考/工具/回复顺序、停止、切会话；息屏/后台数分钟后回来继续发送；测试软键盘、照片/文件/语音入口和主页 widget。
2. 更新数据安全与公开隐私政策，补可实际使用的审核访问说明，核对权限用途；关闭上面的两个工程门禁问题。
3. 固定源代码候选，验证正式签名，生成正式包名的 3.0 AAB，上内部测试。通过 Play 安装验证旧版数据迁移；用许可测试账号完成一次购买、恢复和月/年切换，确认是真正的测试支付工具。
4. 最后查看 Play 新包兼容性/预发布报告、实际发布地区、商品价格与 RevenueCat 映射，再提交更新。历史记录中的云端问题需看后续修复和当前实测，不能从 09-20 旧报告直接推断仍未修复；本轮未重新做生产端到端检查。

参考：[Google 数据安全（包含第三方 SDK 与临时处理的数据）](https://support.google.com/googleplay/android-developer/answer/10787469)、[Billing 测试](https://developer.android.com/google/play/billing/test)、[16 KB 页面兼容](https://developer.android.com/guide/practices/page-sizes)、[当前 target API 要求](https://support.google.com/googleplay/android-developer/answer/11926878)。

## 语音部署后复验更新

负责人明确要求部署后，独立 Speech 服务于 2026-09-23 00:06:56 UTC 更新至 `ddeaf1b0-cb86-44e7-a639-f920347d2df4`（100%）；本节覆盖此前“尚未部署”的状态。5 秒和 10 秒实时合成语音均返回非空最终结果，10 秒音频总耗时 12.3 秒，已跨过旧错误截止。仍有单独的长音频 5 倍补传 `speech_protocol`：新版本请求 `c723515b-7115-429e-96fc-43a40ff52a37` 在接收 2374400 字节后失败。不能将长录音验收标记为完成。部署刚结束的一次旧版本断连已通过 Cloudflare scriptVersion 确认，不应混算为新版本超时回归。手机无需重装；Google Play 发布门禁保持原结论。

补充实测：110 秒实时合成音频也完整接收（3520000 字节 ACK）并发出 finish，但总耗时 114.5 秒后返回 speech_protocol，请求 e824fdda-b08a-4df8-9489-0fc76163c8ec。10 秒误断已解除，长音频结果/协议处理仍需另查，不能仅归因于 5 倍补传。

### 2026-09-23 — Formal bundle built and uploaded

Complete `npm run check:required` passed after the narrowly scoped test/catalog fixes (Mobile 330 suites / 3415 tests). Release AAB built successfully for all four ABIs, followed by a final incremental rebuild after source validation. `bundletool validate` and `jarsigner -verify` pass; package com.p697.clawket, version 3.0.0/30001, min 24/target 36, upload certificate matches Play. Bundle requests PAGE_ALIGNMENT_16K; 108 native libraries checked, all 54 64-bit libraries have LOAD alignment >= 16KB. Artifact `evidence/google-play-2026-09-23/clawket-3.0.0-30001.aab`, SHA-256 `bc561dfed801c4479def917c44f664a3b1a59e86ac34a391ed2d4c36a8343793` (98.8 MB). Existing in-app release copy supplies all 19 localized release notes. Play production draft release 2 created, bundle upload completed and processing. Privacy forms, policy, settings and product pricing untouched. Existing speech long-recording protocol failure remains recorded separately; user accepted basic Android/short speech tests, not a full long-recording pass.

### 2026-09-23 — Google Play submission accepted

Submitted production release `Clawket 3.0.0 (30001)` together with the 26 pre-existing store-listing changes (27 total). Play publishing overview now places them under “正在审核中的更改”; automated quick checks are still running and the UI says successful checks will forward the changes for review. Release validation showed no blocking errors, one missing deobfuscation-file warning, and no reduction in supported devices. Existing 100% target rollout/all target countries and managed publishing remain unchanged; this is not yet a public launch, and approved changes require the managed-publication step. No privacy/data-safety/policy/settings or billing changes were made.

Console: https://play.google.com/console/u/0/developers/5699297822309520683/app/4975023616700245417/publishing
