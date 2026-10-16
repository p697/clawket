# iOS native 产品与交互研究

日期：2026-10-15。研究代理有时钟记录的资料阅读窗口为 13:38:32–14:08:40 UTC（30 分 08 秒，首次记录前已开始检索）；另有主代理的仓库审计与 USB 实机 WebDriver 研究。实际阅读 Apple HIG、WWDC 文字稿、开发者本人案例、App Store 截图；没有把阅读文字稿说成完整看过视频。未研究 Claude。

本文区分三类证据：**官方原则/文档**、**公开截图或实机观察**、**Clawket 产品决定**。竞品一张截图不能证明键盘、手势、网络恢复或无障碍行为。编辑推荐是质量标尺，不是可以保证的结果。

## 产品判断

保留「Agent 花名册 → 会话 → 引导/审批工作 → 查看结果」这条主线。原生化不等于添加底部 Tab，也不等于把现有全部能力塞进一个聊天页。首页仍包含选定的首页会话、置顶、未读/需要你、创建 Agent 与添加连接两个不同操作；管理深度通过能力明确的原生导航抵达。

使用系统导航、菜单、选择器、确认、Sheet、SF Symbols 与语义字体/颜色。Clawket 的身份体现在 Agent、内容、工作记录和已有 Companion 中。阅读层安静、清晰；系统玻璃留在导航与交互层，不给每条消息/卡片铺玻璃。Apple 的 2026 品牌分享展示了 Slack 的自有会话标题和 Moonlitt 的无 Tab 层级，支持「熟悉的交互 + 有辨识度的内容」，没有要求每个 App 使用同一信息架构。[品牌](https://developer.apple.com/videos/play/wwdc2026/251/)、[设计原则](https://developer.apple.com/videos/play/wwdc2026/250/)、[新设计系统](https://developer.apple.com/videos/play/wwdc2025/356/)。

## 聊天产品参照

| 参照 | 已验证的公开证据 | 对 Clawket 的判断 |
|---|---|---|
| Grok | 官方商店截图：宽松的 Agent 正文、小的右侧用户气泡、媒体/来源内嵌、底部 + / 模式 / 语音；当前 FAQ 记述多文件选择和上传确认 | 优先正文阅读和输入，附件不要形成另一套应用；不照搬其 Auto 语义、文件限制或 Grok Bot 功能 |
| ChatGPT | 官方商店截图：安静的阅读底面、右侧用户气泡、靠近回复的操作、独立附件/听写/语音入口 | 保持操作和对象的空间关系；区分听写、发送与停止 |
| Gemini | 官方商店截图和 iOS 帮助：明确可移除的模式选项，Files / Photos / Camera / Drive 后显式提交，媒体结果嵌入正文 | 当前任务/附件状态可见、可撤销；高级模式不抢占普通聊天 |

来源：[Grok 商店](https://apps.apple.com/us/app/grok-ai/id6670324846)、[Grok FAQ](https://docs.x.ai/grok/faq)（页面更新 2026-10-10）、[ChatGPT 商店](https://apps.apple.com/us/app/chatgpt/id6448311069)、[ChatGPT iOS FAQ](https://help.openai.com/en/articles/7885016-chatgpt-ios-app-faq)、[Gemini 商店](https://apps.apple.com/us/app/google-gemini/id6477489729)、[Gemini iOS 文件帮助](https://support.google.com/gemini/answer/14903178?co=GENIE.Platform%3DiOS&hl=en-419)。旧搜索摘要里的交互说明若已从当前 FAQ 删除，不作为现状证据。

## 输入栏、附件与文本

- 使用持续持有的原生 UITextView，向上增长，Add 与 Send/Mic/Stop 靠底对齐。换行就是换行，发送是明确按钮。长文展开时改变同一个编辑器的容器/布局，不在全屏模态里再造一个 TextEditor；保留中文/日文 marked text、选区、撤销栈、键盘与草稿作用域。[TextKit](https://developer.apple.com/videos/play/wwdc2026/370/)、[SwiftUI 键盘布局](https://developer.apple.com/videos/play/wwdc2023/10281/)。
- 用 safe area / UIKeyboardLayoutGuide 跟踪键盘和窗口；不从键盘通知的绝对高度猜布局。当前部署下限 16.4，不能无条件使用 17/18/26/27 API。原生视觉随系统升级，不在旧系统仿画玻璃。[键盘引导](https://developer.apple.com/documentation/uikit/uikeyboardlayoutguide)、[可变 UIKit 窗口](https://developer.apple.com/videos/play/wwdc2026/278/)。
- 原生文本选择、剪切、粘贴、撤销、听写优先。旧 iOS 上仅给 SwiftUI Text 加 `textSelection` 不能保证长回复/代码/审批命令的局部选择；使用 UITextView/UITextInteraction 或原生选择文字详情。[文本选择](https://developer.apple.com/documentation/swiftui/view/textselection%28_%3A%29)、[编辑菜单](https://developer.apple.com/design/human-interface-guidelines/edit-menus)。
- 系统 PhotosPicker/PHPicker 只读取用户选中的资源；文件/相机使用系统入口，取消不清草稿。附件有准备中、就绪、失败、移除/预览状态；本地/iCloud 准备不叫「已上传」。保持当前六附件、图片标称 5 MiB、完整 UTF-8 JSON/base64 帧 8 MiB 上限，不能复制竞品限制。[Photos picker](https://developer.apple.com/videos/play/wwdc2023/10107/)、[PhotosPickerItem](https://developer.apple.com/documentation/photosui/photospickeritem)。
- 只在点击相机/录音时请求对应权限；显式粘贴不预读剪贴板。语音仍走现有签名 PCM → speech-worker、耐久录音/恢复契约；不以 Apple Speech 或另一套语音聊天替代。进入聊天不激活音频会话。[隐私](https://developer.apple.com/design/human-interface-guidelines/privacy)。
- 录音的按住/滑动取消必须有普通按钮或无障碍操作替代；不在可选文字上覆盖录音长按。每个重要自定义手势都有可发现路径。[手势](https://developer.apple.com/design/human-interface-guidelines/gestures)。

## 时间线与工作

只在用户已跟随底部或主动发送时跟随；拖动、阅读与选区优先。流式文字、媒体加载、历史翻页、重连对账和工具展开都不能夺走阅读位置；离开底部时提供跳到最新。稳定的显示 ID 独立于 wire/message/turn/prompt/tool ID，状态放在模型层，给图片预留比例。

Apple 解释了 lazy stack 的离屏尺寸估计、动态子视图数量和延后改变布局的问题，不能用不稳定的绝对 offset 当阅读锚点。先测量；需要精确分页/选择/锚定时，UIKit 的 UICollectionView 是合理的原生组成部分。[滚动](https://developer.apple.com/videos/play/wwdc2026/321/)、[混用 SwiftUI/UIKit](https://developer.apple.com/videos/play/wwdc2026/272/)、[性能](https://developer.apple.com/videos/play/wwdc2025/306/)。社区开发者的[聊天列表迁移案例](https://brenoxp.com/blog/swiftui-to-uikit-message-list)（2026-09-01）提供具体经验，不能据此宣称 SwiftUI 全部不适合聊天；[Exyte Chat](https://github.com/exyte/Chat)仅用于检查交互功能面，不等于选为依赖。

工作 dock 显示真实步骤/思考/回复/等待，详细记录保留可检查的命令、输出与时钟。审批保留理由、可选择的完整命令、Allow/Reject、等待后端确认、可重试错误及已允许/拒绝/过期记录。「永久允许」以可发现菜单和明确作用域确认呈现，不仅藏在长按。提问和执行同意分开；关闭 Sheet 不作答、不取消。Stop 在确认前表达停止中。

模型面板按真实当前值/最近使用/Agent 默认及原有目录顺序组织，区分本会话与整个连接的设置；Hermes 的全局模型语义不改。打开时位置稳定，原生异步写入只显示确认值。系统会话 Sheet 使用合适 detent 与层级，不叠加多个小应用。[Sheet](https://developer.apple.com/design/human-interface-guidelines/sheets)、[菜单](https://developer.apple.com/design/human-interface-guidelines/menus)。

## 可信状态与无障碍

缓存会话在重连时继续可读，用上下文连接提示与一个相关操作表达状态。socket open、Relay nonce/pong、NWPath 和 backend ready 各有独立含义；不能把超时称为手机网络故障。发送先有本地回显，已派发但丢 ACK 仍是待确认，按确切发送身份对账，禁止自动重发。[Alerts](https://developer.apple.com/design/human-interface-guidelines/alerts)、[连接等待的边界](https://developer.apple.com/documentation/foundation/urlsessionconfiguration/waitsforconnectivity)。

iOS 会挂起后台 App；及时保存草稿/录音/发送恢复信息，前台以真实后端证据恢复，不承诺永远在线。Apple TN3151 当前建议新 WebSocket 优先考虑 Network framework，但 URLSession 仍受支持；本次为既有 wire/关闭/超时行为兼容选择 URLSession，并通过真实 socket 测试证明，而非顺带重设计协议。[后台](https://developer.apple.com/documentation/uikit/extending-your-app-s-background-execution-time)、[网络 API 选择](https://developer.apple.com/documentation/technotes/tn3151-choosing-the-right-networking-api)。

高频操作保持至少 44pt 点击区域；这是本项目标准，当前 HIG 表将 44 列为默认、28 列为最小，不误引为所有场景的绝对要求。语义字体、200%/最大无障碍字号、VoiceOver、深浅色、增大对比度、减少动态/透明度和 RTL 从首批界面验收开始。状态不用颜色单独表达；翻页/更新保持 VoiceOver 焦点，完成/需要操作时适度播报，不逐 token 播报。[HIG](https://developer.apple.com/design/human-interface-guidelines/accessibility)、[VoiceOver 评估](https://developer.apple.com/help/app-store-connect/manage-app-accessibility/voiceover-evaluation-criteria)、[阅读辅助](https://developer.apple.com/videos/play/wwdc2026/219/)、[自定义控件](https://developer.apple.com/videos/play/wwdc2026/220/)。触觉短、明确、可关闭，不逐 token 震动。[触觉](https://developer.apple.com/design/human-interface-guidelines/playing-haptics)。

## 编辑与开发者作品的启发

| 案例与可核对来源 | 采用的原则 |
|---|---|
| [Flighty 设计幕后](https://developer.apple.com/news/?id=970ncww4)（2023-06-05）、[离线说明](https://flighty.com/help/offline-mode) | 最需要时显示关键信息，明确缓存/估计；反复迭代异常场景，而不只打磨正常截图 |
| [Moonlitt](https://developer.apple.com/news/?id=v1nphz91)（2026-05-16）、[2026 奖项](https://developer.apple.com/design/awards/) | 复杂领域可以有清晰主路径而保留深度；Interaction 获奖不等于必须有 Tab |
| [Guitar Wiz](https://developer.apple.com/news/?id=5zi5a25j)（2026-05-16） | 无障碍是完整操作体验，不能只添加 label；2026 Inclusivity 获奖 |
| [Things OS26](https://culturedcode.com/things/blog/2025/09/things-for-os-26/)（2025-09-15）、[OS27](https://culturedcode.com/things/blog/2026/09/things-for-os-27-and-siri-ai/)（2026-09-14） | 采用系统变化时保留内容身份；细节持续演进，不因案例而扩张 Siri 功能范围 |
| [Structured 无障碍](https://help.structured.app/en/articles/4725634)（编辑于 2025-07-01） | 文字、运动、对比、VoiceOver/Voice Control 一起验证；2026 为 finalist，不误写 winner |
| [Slack 的分享](https://developer.apple.com/videos/play/meet-with-apple/255/) | 在真机上反复试验会话标题、输入栏和导航，产品辨识度与系统交互共存 |

Apple 的[编辑推荐说明](https://developer.apple.com/app-store/getting-featured/)关注真实价值、交互/UI 质量、独特性、可访问性、本地化与产品呈现；明确没有一套清单能保证推荐。

## 实机研究记录

仅以 USB IORegistry 序列号、CoreDevice 有线状态及指定设备的 tunnel 确认目标。首次误选无线可用的个人设备已停止，不作为本节验收证据。随后按负责人要求使用 WebDriverAgent 16.15.0，固定正确 USB iPhone Air / iOS27.0.1；每次命令重新核对硬件。未使用 iPhone 镜像完成研究，未操作 Claude。

- Grok 1.4.53：原生附件菜单锚定输入栏 +，键盘保持；相机/照片/文件与连接器/技能分组。三行研究草稿使输入区 49→137pt，底部 Add/模式/发送仍对齐；Return 保留换行，长按→选择后出现原生剪切/拷贝/粘贴菜单。已清空本次草稿，未发送。模型菜单在输入栏上方列出模式、当前勾选和升级入口，本次不改变模型/购买。
- ChatGPT 1.2026.272：通过 WebDriver 打开附件菜单，观察相机/照片/文件及任务选项均在输入栏附近呈现；输入三行研究文字后，原生文本区增长至 93pt，发送与附件操作留在底部。已清空本次草稿，未发送；未验证其流式滚动/重连。
- Gemini 1.2026.3970207：附件操作打开带控制柄的半屏面板，媒体/文件入口与创作任务分层；实际向下拖动关闭。输入三行研究草稿后再次打开/拖动关闭附件面板，文本逐字保留，文本区增长至 113pt，发送/麦克风保持底部对齐。已清空本次草稿，未发送。

本轮未上传私人文件、选择私人照片、购买、改变模型或研究 Claude；没有将上述输入/菜单检查算成竞品完整聊天或网络恢复验收。WebDriver 会话与本次测试运行器均已结束，手机与重编译资源租约在本轮结束时释放。

原始截图与自动化工具只在忽略的本机证据目录，不提交设备标识、账号资料或内容。公开资料截图与实际版本不同的地方，以带版本的实机观察为准。

## 聊天界面二次打磨（2026-10-16）

负责人保留 React Native 默认后的第二轮，另作约20分钟集中研究（UTC 01:06:52–01:26:57），结合此前约30分钟官方/社区研究与上面的有版本 USB 观察。重新核对 Grok/ChatGPT/Gemini 官方资料和已有研究截图；没有把旧截图称为本轮新实机体验，也没有操作 Claude。Grok 和 ChatGPT 资料版本与观察相同；Gemini 当前1.2026.4070303已晚于观察版本，因此仅引用能独立核对的交互原则。

输入区采用一个安静的表面：附件在上、原生多行编辑器居中、Add/模型/展开/Stop/Send 对齐下缘。三行草稿、键盘和任务运行均不挤走主动作；大无障碍字号将完整模型入口移至单独一行。长 Agent 占位文字不参与高度测量。同一 UITextView 保留输入法组合、选区和撤销。Grok 的[官方上传说明](https://docs.x.ai/grok/faq)、ChatGPT 的[iOS 更新](https://help.openai.com/en/articles/6825453-chatgpt-release-notes)、Gemini 的[iOS 文件帮助](https://support.google.com/gemini/answer/14903178?co=GENIE.Platform%3DiOS&hl=en)支持把媒体入口放在聊天上下文中，但不能因此宣称已验证竞品的全部上传或重连行为。

Apple [Photos picker 分享](https://developer.apple.com/videos/play/wwdc2022/10023/)强调长耗时资源应先占位、逐项处理失败；因此本轮保留选择顺序和真实资源身份，在附件本身显示固定错误原因，不用整页阻塞或虚构进度。适度提升图片/文件预览，移除与预览各有独立命中区。[进度指示](https://developer.apple.com/design/human-interface-guidelines/progress-indicators)、[文字层级](https://developer.apple.com/design/human-interface-guidelines/typography)与[菜单](https://developer.apple.com/design/human-interface-guidelines/menus)用于约束细节。发送点击本身不再触发滚动；只有 host 确实插入新的本地 outbox 后，才允许回到底部。

## 实施验收

每屏必须回答：当前 Agent/会话是谁，哪里需要操作，下一步是什么。最小宽度、键盘、长文、附件、审批命令和最大字号都可用；读历史时流式/重连不抢位置；所有可见功能均有真实动作和能力来源。漂亮截图但缺少模型/语音/队列/分享/恢复仍是原型。

执行 [PLAN](PLAN.md) 的真实连接/恢复矩阵及 [PARITY](PARITY.md)，分清模拟器 UI、mock、真实 Relay、后端和推理证据。系统自动可访问性审计有帮助，但不能单独证明完整无障碍。[自动审计](https://developer.apple.com/documentation/accessibility/performing-accessibility-audits-for-your-app)。
