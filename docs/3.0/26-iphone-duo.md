# iPhone Duo 适配与验收

负责人授权：2026-10-13。目标是可以在官方 Duo 模拟器中亲自验收的完整应用；编辑推荐是品质方向，不是可保证的结果。此任务不包含商店发布、版本升级或生产服务变更。

## 当前验收结论（2026-10-13）

本轮原生交互已完成下表列出的范围，发现的选图崩溃、Sheet 越界、扫码操作消失、系统栏遮挡及半折扫码区相交均已修复并复验。840pt 双栏阈值已以实际 867pt 可用宽、300pt 侧栏和 567pt 聊天区验证。源码已重基到 `cd859de5`；最终 CI、合并 SHA 和 main 安装记录以 PR #220 与本机交付目录为准，不把候选包写成已发布版本。

环境：macOS26.7.1/25G241，Xcode27.1 RC/27A9275，iOS27.1 SDK/runtime24A94232；Clawket3.1.2 arm64 Debug、134 Pods、标准模拟器 ad-hoc 签名。专用设备为 **Clawket Duo Acceptance**，UUID `BA8E3218-8B4E-43EA-9DFC-17D920529B02`。证据根目录 `/Users/p697/.codex/iphone-duo-acceptance`；仅合成会话，没有使用用户已有聊天进行推理测试。XCTest 原始命令、完整 AX 快照与 xcresult 位于其 `xcuitest/` 子目录，截图名称仅为索引，结论以这里的实际观察为准。

| 实际场景 | 结果与证据 |
|---|---|
| 折叠、展开、内屏旋转、半折 | 同一 Codex 会话及中文草稿精确断言保留；展开双栏、收窄单栏，27–30。真实长文阅读、运行面板、长按菜单及旋转已操作，35–37；不宣称像素级滚动锚点/FPS测量。 |
| 中文软键盘与组合输入 | 39/40 原生只读日志：折叠前后同一 PasteInput_RCTUITextView、同一 window、firstResponder=true、hasMarkedText=true、选区位置20/长度0。随后点选中文候选「你」，精确草稿 `Split View 草稿 2026你` 断言通过。早期33/34候选栏视觉变化不能证明组合被取消。 |
| 真实 Split View 左右位置 | 与系统设置并排，43/44左侧、48右侧、49半折，51重命名与软键盘。右侧469pt窗口扣84pt系统栏后385pt可用，操作完整。旋转至竖屏时系统退出分屏，回横屏不自动恢复组合；应用草稿仍保留（45/46），不把系统组合恢复计为应用承诺。 |
| 同一扫码 Modal 的有效折叠区域 | 21–24 UIKit日志/截图证明同bounds/insets的展开↔半折事件确实更新observer；扫码框、44pt操作均不与active division/occlusion相交。实际系统选照片QR后分别保存Codex/Hermes隔离连接；物理相机送码未测。 |
| 长内容、真实后端与后台恢复 | Codex真实生成8段含代码的合成答复；Hermes真实60段答复、第二回合在Stop可用时停止并得到partial abort，切系统设置后返回可读同一main历史（61/62、session08步骤33–49）。61文件名含stream，但折叠后该回合已完成，不能证明那一帧仍在流式输出。没有本机OpenClaw可用端点，OpenClaw证据限于CI/既有协议和组件回归。 |
| 图片、海报与导出 | 56海报滚动/换色后折叠，57为实际保存的完整1002×4148 PNG，8段、代码和页脚均在；不是预览裁切。仅授予合成海报的有限照片访问，添加为未发送附件、缩放控制/拖拽、折叠→展开、关闭后草稿和附件保留（59/60，session08步骤22断言）。未测双指pinch或外部分享。58含私有测试配对图片，不加入交付图集或公共附件。 |
| 弹层编辑连续性 | Codex真实重命名输入跨折叠/展开精确全文断言通过，63；取消未保存，原名保持。确认清缓存仅打开/旋转/取消，未执行删除（54）。 |
| 明暗、大字号、RTL | 最大常规系统字号extra-extra-extra-large、深色外屏及确认/购买层操作完整（53–55）；购买页是community不可用offering，仅验证布局，无交易。阿拉伯语真实重载：侧栏移至阅读方向右侧、窄Sheet避开物理右栏（64/65），中文草稿精确保留。结束恢复系统中文、Large默认字号、浅色、关闭QA模拟免费开关。44pt目标有AX/几何证据，未完成VoiceOver逐项遍历。 |

**执行结果与限制分开记录：** session06、session08 的 xcodebuild 均 `TEST EXECUTE SUCCEEDED`；session08含85条操作。session01为真实选图崩溃；02正常结束但暴露未签名Keychain问题；03断言成功后因提前关闭模拟器teardown失败；04/05为过期面板/输入焦点和工具执行失败；07因误查询未运行的Photos主应用而失败，实际选择器是独立bundle。原始失败全部保留，不把所有runner概括为全绿。session08在最后stop后等待完整退出，再关闭模拟器。

**已知边界：** 模拟器不等于真机；物理相机、完整VoiceOver、外接设备、多实例窗口、支付与多数扩展未纳入已通过声明。既有Markdown渲染器在列表内嵌表格时会合并为文本，聊天/海报均可见；根层表格不受此说明影响。本轮不重写渲染器。OpenClaw没有本轮原生端到端证明，不能将Codex或Hermes结果代替它。13项既有Expo57 patch建议仍存在，未扩大依赖升级。编辑推荐是产品方向，没有将主观赞美作为验收结果。

### 负责人复现

1. 在 Xcode27.1 的 Device Hub 打开上述设备并启动 Clawket；使用已有专属 Codex/Hermes 连接和合成会话。保留本机QA服务与主分支Metro；重启说明、最终main SHA和截图入口见交付目录的 `acceptance.html`。
2. 在聊天输入草稿，依次 Closed → Open → Rotate → Partially Open → Closed，检查会话、草稿、输入焦点与操作；展开横屏查看侧栏和当前聊天并排。
3. 展开横屏并收起键盘，从底部中间将窗口拖向左/右，选择「设置」作为另一应用。XCTest可复现手势基于 `targetApp.windows.firstMatch`：从(0.5,0.995)拖到(0.025,0.5)或(0.975,0.5)，持续0.6秒；稳定后再断言，不使用尺寸可能滞后的App frame。
4. 打开会话重命名/长按菜单/图片预览/海报，再折叠或旋转；取消重命名，检查未发送草稿仍在。海报导出仅保存合成内容；购买与删除不需要确认执行。
5. 如需重跑XCTest，使用交付目录的独立runner和control.py，在新session目录保存命令/结果。先等 `TEST EXECUTE SUCCEEDED` 再关闭设备。失败与已执行的产品步骤分别报告。

下方保留按阶段记录的历史证据，其中“待验收”描述的是当时状态；当前覆盖范围以上表为准。

## 官方依据与审计

- [Apple Prepare](https://developer.apple.com/iphone-duo/prepare/)：iOS 27.1 SDK 才获得完整显示区域；从当前视图/窗口取尺寸，响应持续变化，不用设备身份或屏幕方向代替布局能力。`xcrun agent skills export` 导出随 Xcode 分发的 App Resizability Skill；技能检查不能代替原生模拟器。
- [Prepare your app](https://developer.apple.com/videos/play/tech-talks/111461/) 与 [Duo HIG](https://developer.apple.com/design/human-interface-guidelines/designing-for-iphone-duo)：展开使用更多信息层级；四边安全区独立处理；保持当前任务与功能；系统 Split View 包括左右位置交换。
- [Raise the bar](https://developer.apple.com/videos/play/tech-talks/111462/) 与 [Strike a pose](https://developer.apple.com/videos/play/tech-talks/111463/)：自绘控件应响应其实际系统布局环境；`verticalBarEdge` 表达控制栏边缘，reserved regions 表达系统占用/折叠区域。有具体受影响控件时接入对应数据，不为 API 覆盖率增加通用桥；新 API 只有在真实 27.1 SDK 编译、运行后才能记录为实现验证通过。
- [Xcode 27.1 RC](https://developer.apple.com/documentation/xcode-release-notes/xcode-27_1-release-notes)：要求 Apple silicon、macOS 26.6+；Duo 模拟器不支持 StandBy 和多数扩展，这些不属于此任务的可验收承诺。
- 用户提供的 X 分享当前未能读取，不作为决策依据。

基线 `76b2f9e2`：Expo 57 / RN 0.86.3、官方 Expo Scene delegate 和单 React runtime 已就绪。现有 `AdaptiveWorkspace` 保持 navigator 位置，复用花名册、300pt 侧栏、760pt 阅读上限、会话/草稿及连接管理。缺口是布局仍由 `isIPad` 门控、居中 Sheet 未计左右安全区、自绘控件未接入局部系统布局环境。官方 Skill 明确允许 iPhone portrait 声明，不能把它单独判作缺陷。已有 iPad 测试不能证明 Duo、IME、系统多任务和长文重排正确。

## 最小方案与范围

1. 保留现有设计 token、自绘导航、Sheet、聊天和后端能力模型。布局只依据当前窗口空间、字号与经验证的 UIKit 环境；不将全局 `isIPad` 改成大屏判断，它仍承担真实平台/键盘语义。
2. 宽窗口复用花名册 + 当前会话；收窄时收起辅助栏，不替换 navigator、列表、输入或 adapter。尺寸改变不能触发发送、切会话、重连或重放。
3. Sheet 和内容限宽使用一致的可用矩形。四边 inset 分开计算，背景与交互区域分开；保留打开中的 Sheet、页脚及编辑状态。
4. 自绘栏适配以官方 Skill、系统 trait 和实测为依据。必要的原生桥接只提供当前所属视图的布局数据；不引入第二个聊天运行时、全局 window 猜测、姿态机型表或铰链角度布局。
5. 保留现有 iPhone 方向声明、iPad 四向和 Scene 配置，旋转后行为由真实设备环境验证，必要变更须有实测依据。系统多任务纳入验收，同 App 多实例窗口、StandBy、外屏副显示内容不扩入本轮。

窗口布局已移除 iPad 身份门控，仅对非 Catalyst iOS 启用，采用候选 840pt 双栏阈值（300pt 侧栏 + 540pt 详情最小空间）和既有 760pt 阅读上限，保留字号保护；600pt 以上可用宽度提供抽屉/居中面板，更窄保留返回导航。相同窗口仅 inset 变化也可能越过断点，必须清除已失效的抽屉状态。工作区和抽屉分别消费物理安全区并正确映射 RTL；花名册按钮不再次叠加已消费的右 inset。

840pt 阈值已通过本轮双栏、字体和窄窗原生验证；它是产品内容约束，不是苹果规定值。iOS 的 RosterController 固定在工作区外，四个任务弹层作为工作区的稳定兄弟，route/侧栏/抽屉只呈现受控 RosterView。重命名草稿、保存中状态、操作目标和 Add 关闭后导航已由定向回归覆盖；列表滚动/swipe、原生 IME 与焦点连续性仍待真实验收。Android/Catalyst 保留 route 挂载方式。

原生观察到内屏951pt、右侧安全区84pt，可用宽867pt，900pt门槛确实无法提供双栏；候选840pt为产品内容约束，不是苹果规定值，需验证剩余567pt详情与大字号。依据 [Raise the bar](https://developer.apple.com/videos/play/tech-talks/111462/)，当前有意义文本的 HeaderPill 和输入附件保留水平；单独移动两个图标既不能消除标题行，又会压缩正文，暂不新增 verticalBarEdge 桥。四边系统栏占用由真实 safe area 处理。依据 [Strike a pose](https://developer.apple.com/videos/play/tech-talks/111463/)，safe area 不能表达中间折叠区：半折必须验证独立确认框、HeaderPill 和菜单；有实际相交时再以 view-local reservedRegions 桥移动受影响控件。连续聊天列表保持连续滚动，不挖空或换 pane；region frame 已含 margins。

## 阶段与完成门槛（当前）

| 阶段 | 完成门槛 | 状态 |
|---|---|---|
| 调研 | 官方资料、现有架构与工具链审计；按官方 Skill 完成覆盖审计 | 完成 |
| 方案 | 最小范围、状态不变量、原生数据与验收矩阵明确 | 完成；沿用单runtime、现有workspace与业务owner |
| 开发 | 有限布局改动与必要原生配置；定向回归和类型/文档门禁 | 完成；仅增加扫码局部区域桥及两项限定版本依赖修补 |
| 测试 | 27.1 编译，真实 Duo 安装启动，关键交互矩阵 | 上述实际覆盖完成；环境限制单列，不宣称全后端/全无障碍认证 |
| 体验优化 | 根据实际截图/交互修复控件遮挡、任务状态丢失 | 本轮发现的阻断已修复并原生复验 |
| 最终验收 | CI/合并完成；main对应模拟器应用、截图、复现步骤 | 收尾中；最终固定SHA、CI与安装结果写入PR和本机交付记录，负责人随后亲自验收 |

## 原计划矩阵与证据边界

记录 Xcode/SDK/runtime/build、源码 SHA、模拟器 UUID；截图仅使用专属测试会话。每项记录实际结果和证据路径，不把 mock 尺寸称作设备实测。

| 场景 | 必须验证 |
|---|---|
| 外屏竖/横 → 展开内屏竖/横 → 折回 | 花名册、聊天、设置正确布局；选择、草稿、附件和输入实例连续；无多余发送/连接重建 |
| 书本/桌面半折叠 | 控件与弹层不落入有效折叠占用区域；聊天阅读不中断 |
| Split View 左/右、缩窄与恢复 | 控制栏、安全区正确换边；辅助栏按空间收起；页面、弹层状态保留 |
| 键盘显示中调整窗口 | 输入、中文组合、选区、发送/停止及展开编辑可达；无草稿丢失 |
| 长文阅读、流式回复中调整窗口 | 阅读位置可追踪；保持已有底部跟随意图；不跳会话或重发 |
| 后台/前台、OpenClaw 与 Hermes | 各自实际发收/停止与恢复；后台恢复沿用现有协调器，UI 证据与独立协议证据分别记录 |
| 明暗、大字号、RTL | 核心页与 Sheet 不截断关键操作；44pt 目标、VoiceOver 顺序与隐藏栏可访问性正确 |

完成以上必要矩阵并处理发现的阻断缺陷后停止扩大范围。实际设备、支付和模拟器不支持的扩展能力单独列明，不能以编译或截图替代。

## 本机准备记录

2026-10-13：macOS 26.2，Xcode 26.6 (`17F113`)，仅 iOS 26.5 runtime。旧 `xcrun agent skills export` 返回 `No skills available to export`。Xcode 27.1 RC (`27A9275`) 已从 Apple 下载、解压并通过 codesign 验证，安装于 `/Applications/Xcode-27.1-RC.app`，保留旧版与全局选择。负责人已同意 Xcode/SDK 许可；接受命令仍需本机管理员认证。官方 Skill 主文及五项引用直接来自新安装包的 IDEIntelligenceChat resources，已提取并阅读，未凭空补写技能内容。

负责人随后明确授权安装和重启；macOS 26.7.1 (`25G241`) 已安装，`sw_vers` 与重启时间已核实。Xcode/SDK 许可已接受，首次初始化检查通过；iOS 27.1 SDK 和 runtime (`24A94232`) 已安装。Device Hub 创建独立 `Clawket Duo Acceptance`，型号 `iPhone-Duo`，UUID `BA8E3218-8B4E-43EA-9DFC-17D920529B02`。首次 arm64 Debug 模拟器编译成功，已安装并启动 Clawket，欢迎页/设置页/主题弹层可以交互。实际折叠、展开和旋转已执行；核心聊天和完整矩阵仍待验收。

任务工作树的 Expo prebuild 与 Pods 安装成功（133 pods），无依赖或版本变更。生成 plist 核实单 `ClawketSceneDelegate`、多 scene=false、full-screen=false、iPhone 竖屏/倒置与 iPad 四向；Debug 使用既有独立 entitlement 准备脚本和 Node 22.23.2。构建采用专属 DerivedData、`-jobs 2`、iOS 27.1 simulator SDK，不是 Archive 或分发包。海报/加载层提交 `32f59ad8` 的完整 CI38347250732 已通过。

工作树：`codex/iphone-duo`，由仓库脚本创建到当前机器解析的 `clawket-worktrees`；当前未挂载 Lucy-SSD。依赖独立安装，不复用主检出 node_modules。主检出不编辑、不测试。

## Skill 覆盖与文件处置

按 UIScreen、orientation、scene lifecycle、safe area、idiom 五项完成两个独立只读审计。以下路径相对 `apps/mobile/`；依赖源码不作机械替换。

| 文件或明确范围 | 处置与依据 |
|---|---|
| `src/utils/ipad-layout.ts`、`src/components/ui/AdaptiveBottomSheetModal.tsx`、`Sheet.tsx` | 四边几何、仅 inset 改变时重算及窄/短窗口边界已修复；居中由当前可用宽度决定，FullWindowOverlay 内本地 Provider 已实测，短动态内容按自然高度收紧。 |
| `src/navigation/AdaptiveWorkspace.tsx`、`workspace-context.ts`、`App.tsx`、`src/screens/Thread/ThreadView.tsx` | 已把布局身份门控改为当前空间能力；保持 detail 槽位、列表、输入实例与 adapter，workspace/抽屉物理 inset 正确映射 RTL。真实键盘、滚动锚点与原生 Sheet 行为待验。 |
| `src/components/ui/ThemedFullWindowOverlay.tsx` | Sheet 在稳定容器内放置本地 Provider，并将 metrics 回传原 owner 计算；折叠/旋转保持正文实例。 |
| `src/screens/Roster/RosterScreen.tsx` | 已去除 Add 按钮重复消费 workspace 的 right inset；iOS controller/四任务弹层固定挂载，保持重命名、保存、操作目标与 Add 延迟回调；保留 bottom 与独立/非目标平台原行为。 |
| `src/components/chat/ImagePreviewModal.tsx`、`src/screens/Thread/components/ThreadOverlays.tsx`、`ThreadScreen.tsx` | 已移除外层窗口尺寸/pane inset 传递，预览从 Modal 本地测量；chrome 四边与 RTL 避让、媒体 full bleed；保留索引、缩放实例与保存锁，帧变化使旧拖拽失效。真实缩放焦点与手势待验。 |
| `src/screens/Thread/components/ThreadMessageActionsOverlay.tsx`、`messageActionsLayout.ts` | 已用本地四边夹紧当前菜单与动画帧，RTL 对齐、窄窗换行/短窗菜单滚动；保留 anchor 窗口坐标，迟到测量与关闭回落有 owner/代际防护。 |
| `src/components/ui/PresentationSafeAreaProvider.tsx`、`ConfirmationModal.tsx` | 使用已有 safe-area-context 的原生测量边界，隔离父 pane 的 frame/insets，不以 initialWindowMetrics 初始化弹层；确认框四边约束，短窗口正文/操作可滚动且保留键盘首击。真实原生测量与短窗布局待验。 |
| `src/components/chat/ChatSharePosterModal.tsx`、`src/components/poster/PosterThemePicker.tsx` | 已使用本地四边安全矩形；44pt 关闭/色点、流内换行调色板与短窗可滚动操作。离屏导出保持完整自然高度、360pt 宽上限，与预览同宽；窗口变化可能改变 PNG 宽度，不宣称固定分辨率。导出绑定目标及 presentation generation，锁跨 resize 保留。 |
| `src/components/ui/GlobalLoadingOverlay.tsx` | 已在 FullWindowOverlay/Modal 内测量，四边约束可滚动卡片；全幅 scrim、场景与动画 owner 保留，inset 换边不重播。首次测量前的背景出现时序、触摸拦截待原生验证。 |
| `src/components/pro/ProPaywallOverlay.tsx`、`src/screens/Paywall/PaywallScreen.tsx` | 已采用本地 Provider 和四边避让，套餐根据局部可用宽度变化；购买请求锁/统计状态在原 owner 保持。真实购买及原生呈现待验。 |
| `src/contexts/GatewayScannerContext.tsx`、`src/connection/pairing/QRScannerScreen.tsx` | 已测量本地四边与 controls 自然高度，扫描框按剩余空间缩小、短窗操作滚动，物理遮罩保持 RTL 正确；保留 camera 与配对 owner，主动重测并拒绝迟到/错尺寸回调。 |
| `src/contexts/NodeCameraCaptureContext.tsx` | 保留：纯媒体表面允许 full bleed。 |
| `src/bootstrap/AppProviders.tsx`、`src/screens/Onboarding/OnboardingScreen.tsx`、`OpenClawDirectScreen.tsx` | 保留既有 iPad 键盘/预热语义，Duo 实测后再决定，不机械替换为宽度。 |
| `src/utils/platform.ts` | 保留真实平台/设备身份用途；仅迁移布局消费者。 |
| `src/components/chat/ModelSheet.tsx`、`src/screens/Thread/ConversationEntry.tsx` 及 workspace 内普通页面 | 保留动态高度与 top/bottom 避让；不要重复消费父层已处理的左右 inset。 |
| `src/components/ui/ModalScreenLayout.tsx` | 保留纯布局职责；由拥有 native presentation 的调用层提供来源。 |
| `modules/clawket-app-icon/ios/ClawketAppIconModule.swift` | 保留：UIApplication.shared 用于应用图标，不是全局窗口几何。 |
| `modules/clawket-voice-capture/ios/ClawketVoiceCaptureModule.swift` | 保留：无目标几何/scene API。 |
| `native-widgets/ios/ClawketWidget.swift` | 保留：本地 GeometryReader.size，无重复安全区扣除。 |
| `plugins/with-paste-input-setup.js` 与对应测试 | 保留 ExpoAppSceneDelegate 与官方 factory；测试旧委托片段属于回归夹具。 |
| 其余 10 个配置插件 | `with-alternate-app-icons`、`with-android-qa-variant`、`with-android-release-signing`、`with-android-system-bars`、`with-home-widgets`、`with-ios-pod-deployment-target`、`with-ios-signing`、`with-locales`、`with-openclaw-direct-networking`、`with-xcode-env` 无目标缺陷，保留。 |
| `app.json`、`app.config.js`、`scripts/check-app-config.mjs` 与对应测试 | 保留 scene/四向/fullscreen 验证；新 prebuild 后核对最终 plist、pbxproj、xcconfig。 |

主检出的既有生成工程只读检查了 270 个 project/xcconfig：SplashScreen、iPad 四向、UIRequiresFullScreen=false、单 ClawketSceneDelegate，无覆盖项。这只是基线，不能替代任务分支生成工程检查。

React Native 0.86.3 的 RCTI18nUtil 默认开启左右交换，Fabric/Yoga 在 RTL 把物理 marginLeft/right 转为 start/end。因此将独立物理边转换为对应 marginStart/end，并清除 caller 的物理边覆盖，不全局改变 RTL 设置。

先行修复在 Node 22.23.2 下逐文件串行验证：`ipad-layout.test.ts` 14 项、`AdaptiveBottomSheetModal.test.tsx` 4 项、`Sheet.test.tsx` 5 项通过；Mobile typecheck、设计系统检查（260 UI 文件、66 checker 用例、9 配置与5设计文档用例）、`check:docs`（8 指令对、5 回归）通过。独立只读复核未发现该小范围 diff 的阻断问题。组件替身仅证明 inset 换边、LTR/RTL 与窄/宽切换时正文草稿和挂载连续，不能证明原生 IME 或 Duo 行为。完整仓库门禁由 PR CI 执行。

窗口布局基础的第二批回归：`ipad-layout.test.ts` 18、`AdaptiveWorkspace.test.tsx` 7、`AdaptiveBottomSheetModal.test.tsx` 7、`Sheet.test.tsx` 6、`ThreadView.test.tsx` 226、`RosterScreen.test.tsx` 27，共291项逐文件串行通过；Mobile typecheck、设计系统及文档门禁通过。独立只读复核未发现本批阻断。覆盖紧凑返回/抽屉关闭、有效pane与无provider回退、输入/列表实例连续、紧凑输入框原间距、非目标平台保持和花名册按钮避让；仍不替代原生矩阵。

第三批状态连续性：`RosterScreen.test.tsx` 30项串行通过，包含真实 RenameSheet 中文输入实例保持、保存防重/失败重试、确认目标和 Add 动画结束回调恰好一次；Mobile typecheck通过，独立只读复核无阻断。前两批固定提交 `adfa6016` 的 CI38340160691 所有 required jobs通过；桌面选择器判定无桌面变更，桌面套件正常跳过。


第四批原生弹层边界：复用 safe-area-context 5.7.0，不添加新的测量桥。已按实际安装包与双锁文件复核版本，修正文档先前的 5.6.2 误记。该库默认继承父 Provider 的首帧数据，所以本地 Provider 显式隔离两个公开 context，等待所属原生 presentation 的首个事件，再持续更新。`frame.x/y` 相对所属 UIViewController，不作为 `measureInWindow` 坐标原点相减。图片预览通过测量回调更新既有手势 owner，不重建业务状态；递增 generation 防止 A→B→A 尺寸循环恢复旧手势，关闭与重新打开分别保持一次性语义。

本批逐文件串行回归：`PresentationSafeAreaProvider.test.tsx` 1、`ConfirmationModal.test.tsx` 4、`NavigationPrimitives.test.tsx` 24、`ProPaywallOverlay.test.tsx` 16、`PaywallScreen.test.tsx` 49、`ImagePreviewModal.test.tsx` 11、`useChatImagePreview.test.ts` 1、`ThreadScreen.test.tsx` 74，共180项通过；Mobile 类型、设计系统（261 UI 源文件、66 checker 用例）与文档门禁（8 指令对、5 回归）通过。覆盖实际 Provider 的测量事件边界、左右换边/RTL、购买与保存防重、菜单动作、旧拖拽、关闭前/中测量和另一个索引重新打开。独立只读复核无剩余源码阻断；原生缩放焦点、RTL 分页位置、拖拽取消和 Android 首次呈现仍需设备验证。第三批提交 `21199f46` 的 CI38341351635 已通过；本批与整个 Duo 任务尚未完成原生验收。

CI38344065868 首轮发现5个既有调用方夹具缺少新增原生测量边界：ThreadView/historyPrepend 在加载时进入 native Flow 模块，Document/Identity/Cron 的简化 safe-area mock 缺 context。仅补齐测试边界与 RTL mock，保留真实确认框和原有断言；逐文件复验 ThreadView226、historyPrependNativeStages5、Document16、Identity8、CronEditor25，共280项通过。未跳过测试或修改生产行为。


第五批海报与加载层：`ChatSharePosterModal.test.tsx` 11项、`GlobalLoadingOverlay.test.tsx` 4项逐文件串行通过；Mobile 类型、设计系统、文档与 i18n 严格检查通过。独立复核提出的导出代际与连续测量问题已修复并补回归。覆盖本地窄/短窗口、仅 inset 换边、LTR/RTL、主题与模型开关实例保持、完整 capture 目标不进入 ScrollView、保存/分享共用锁、相册权限及原生 capture 晚回调、关闭重开/消息替换隔离，以及连续 ready→unready→ready 后同一个保存继续。旧测量回调由序号作废，A→B→A 显式 remeasure 不依赖系统一定产生新的 onLayout。原有 iOS 截图 fallback 保留且固定同一个 native target；关闭或内容变更取消布局等待。

加载层的 iOS/Android presentation 边界、四边安全区与 scene/opacity 不重建由定向回归覆盖。首次测量前 Provider 仍挂载，但 scrim 内容要等首个事件；原生命中不穿透属于源码审计结论，非 Jest 可证明。海报 Markdown 的异步绘制、头像加载、RTL 实际 PNG 以及内外滚动在短窗口中的交接仍须真实模拟器验收；布局 measure 成功不是像素就绪证据。前四批与调用方夹具修复的提交 `8119681a` 已通过完整 CI38344733497。

## 首轮原生运行与弹层回归

源码 `32f59ad8`，Xcode27.1 `27A9275`，runtime27.1 `24A94232`，专属 Duo UUID 见上。Debug构建 `BUILD SUCCEEDED`，包内SDK=iphonesimulator27.1，版本3.1.2，133 Pods。私有截图目录 `/Users/p697/.codex/iphone-duo-acceptance`：01折叠欢迎页、02展开欢迎页、03展开设置、04展开主题、05保留主题后折叠、06重新展开并右旋、07半展开、08关闭后重开主题。外屏截图须指定 `--display=primary`（1398×2034）；展开内屏用 `primary-1`（横向2853×2007／竖向2007×2853），不能用默认外屏截图代替。

首轮真实缺陷：主题选择保留，但展开横向→折叠→展开→右旋至竖向后，弹层底部越界；关闭/重开恢复。库的两个高度reaction忽略稍后变化的insets，与失败路径一致。新增限定5.2.14、六入口的安装补丁，保留内容及shared state；9项Node回归通过，原hook同序列算903pt而目标720pt，补丁覆盖两高度来源/两到达次序/inset-only/未测量和非Modal。第一轮仅修有效高度仍在原生失败；观测证实高度已正确更新，继续定位resize setter把合法0坐标拒绝。追加精确补丁及实际setter回归后，同一路径与返回横向均通过，截图11/12保留完整面板与主题选择。临时元数据诊断已移除。

Sheet 的稳定 portal 容器内接入本地 Provider，metrics 回传原 owner；短动态内容使用自然高度加既有 handle 区域，固定 detent 长列表保留原滚动策略。测量上限独立于实际面板高度，旧宽度的迟到测量无效，避免反馈循环与重挂载。原生截图13/14验证主题面板在展开横向/竖向按内容收紧，底部完整。语言长列表可以呈现；自动化拖动/滚动返回窗口绑定错误，该手势尚未验收。定向回归 AdaptiveBottomSheetModal 8、Sheet 7、ipad-layout 19 项与 Mobile 类型通过，独立只读复核无阻断。中文组合输入、footer 键盘场景、核心聊天及系统布局栏仍待验收。


## 聊天菜单与扫码边界

菜单改用 Modal 本地四边与 RTL，当前宽度与受限高度同时供定位和渲染，动画值也夹紧当帧边界；菜单尺寸含 surface hairline。窄窗多行保留44pt操作，短窗先保证菜单滚动，消息区域允许缩至零。原确认反馈及关闭后交接保留，迟到 favorite/测量回调不能影响替换后的 selection。Thread 行测量在回调中复核 node、message 与 mounted；窗口变动/clone滚动后关闭淡出，不回落到旧几何。

扫码界面在原 Modal 内测量；Camera 不重挂，cutout 仍以相机 host 为坐标系。四边和 controls 自然高度限制扫描框，短窗口让 controls 滚动，左右物理遮罩不随 RTL 再翻转。frame/inset 变化主动清旧框并重新测量，旧 generation、过期尺寸和零框不能选码；合法缩小框仍能完成原配对路径。

本批定向串行验证：messageActionsLayout14、ThreadMessageActionsOverlay25、ThreadView228、QRScannerScreen18、QRScannerScreen.view6、GatewayScannerContext5，共296项通过；Mobile 类型、设计系统与文档门禁通过，独立只读复核无剩余源码阻断。原生长按/文本选择、短窗滚动及真实扫码入口仍待模拟器。此前 Sheet 提交 `789b2461` 的 CI38364335918：Mobile/类型/静态/协议/macOS 通过；Windows legacy-owner contention 回放首轮收到意外已打开 socket，保留失败证据后同一源码重试通过，未改后端或放宽断言。


## 扫码原生回归与双栏候选

### 有效分割区域的实测补充

冷启动提交7d4b6e35后，截图19确认折叠态扫码操作完整。半展开同一Modal的只读UIKit查询记录：bounds951×669，insets{top0,left0,bottom34,right84}；active division={x455.5,y0,width40,height669}；active occlusion={x867,y0,width84,height120}，另有inactive58×37区域。原cutout x308.5…558.5确实跨division，截图20与数值日志保留。右侧occlusion已由safe area消费，inactive区域不参与布局。

据此新增仅扫码使用的view-local Expo observer：`layoutSubviews`同步读取两种active区域，派发去重快照，空数组恢复原布局；旧SDK以ObjC guard隔离新符号。四边safeRect扣除active区域后，cutout/提示/操作在同一最大可用矩形内；相机保持全幅且不重挂。上述场景选择左侧455.5×635，250pt框x102.75…352.75。region-only变化推进扫码测量generation，并校验x/y及尺寸，拒绝新generation暂时读到旧位置。依据[Apple DTS关于目标UIView与Observation的答复](https://developer.apple.com/forums/thread/847876)和[UIKit自动Observation](https://developer.apple.com/documentation/uikit/automatic-observation-tracking)。静态查询不证明动态通知，本实现仍需同bounds/insets的展开↔半折真实验证。

提交 `442e0ca5` 的 CI38368112204 全部通过，含 Windows/macOS。其后首次真实扫码呈现发现底部操作消失：原生测量 controls 自然高75.67pt，但 flexBasis 未保留预期 viewport，底部只剩24pt上间距和34pt下安全区，ScrollView实际高度0；失败截图15保留。改为显式有界高度，充足空间保持扫描框居中，短窗优先44pt可滚动操作；角标改用既有 onMedia 白色，提高相机背景上的对比度。截图16（展开横向）、17（折叠）、18（展开旋转）均显示完整扫码框与操作；点击相册后系统选择器实际打开。临时测量日志已移除。

坐标点击/拖动在 Device Hub 自动化通道持续返回 `noWindowsAvailable`，键盘输入未生效；重绑、紧凑窗口及工具会话重建未解决。相册图片尚未选中，不能记为配对成功或完整扫码验收。已请求允许使用苹果 XCTest/XCUITest 完成本地原生输入验收，等待明确答复期间只继续源码与定向回归。

840pt候选复用既有布局和状态结构；无设备型号分支、不改连接/后端。原生已测内屏867pt可用空间，候选双栏仍需真实聊天、输入、媒体和大字号验收后冻结。

本批定向串行回归 QRScannerScreen.view 8、ipad-layout 19、AdaptiveWorkspace 8，共35项通过；Mobile类型（修正测试host类型比较后）、设计系统、文档及diff检查通过。独立只读复核无源码阻断，已同步iPad章节的候选门槛。截图16–18对应442e0ca5加本批扫码修复，不能证明840pt真实聊天体验。

原生模块批次已完成134 Pods同步，现有Expo57/RN0.86.3锁文件未变。`expo install --check`返回1，报告13项已有SDK57包的较新patch建议（含expo57.0.28、camera57.0.6），不记为依赖兼容检查通过，也不因本局部模块改动扩大为整套升级；原生编译和动态验收结果另记。

原生验收补充：本批Xcode27.1 Debug模拟器构建成功；ObjC helper另以Xcode26.6/iOS26.5 SDK语法编译通过。截图/日志21–24在同一真实扫码Modal完成展开→半折→展开→半折旋转：横向bounds/insets保持951×669/{0,0,34,84}，cutout x≈308.67→102.67→308.67，半折division为x455.5…495.5；旋转后bounds669×951，division y455.5…495.5，cutout y≈567.33…817.33。扫码框/两个按钮实际frame均不与任何active区域相交，按钮高度44pt（舍入误差<0.001）。包围提示与操作的容器455.5pt逻辑宽度舍入为455.6667pt，容器检查明确使用1物理像素容差，操作本身仍严格不相交。数值断言和截图保存在本机验收目录。证明UIKit区域变动确实通知当前observer并能清除旧division，无需附加hinge监听。尚未完成相册实际选图、相机送码、短窗滚动或连接后聊天矩阵，不能把这批几何证据写为整体完成。

本批定向文件：scanner-available-rect9、QRScannerScreen19、QRScannerScreen.view10、GatewayScannerContext5，共43项通过；Mobile类型、设计系统、文档和diff检查通过。独立只读复核无源码阻断。原生环境已确认OpenClaw/Hermes配对入口均在真实引导页可达，但尚未验证两条实际连接/推理路径。


### 2026-10-13 XCUITest 输入授权与选图崩溃

负责人明确允许专用本地模拟器使用 XCTest/XCUITest。独立测试 runner 已成功驱动欢迎→扫码→系统照片选择器→QR 图片；实际选图导致 App SIGABRT，原始失败保留在 `xcuitest/session-01.xcresult`。崩溃栈定位 Expo image-picker 57.0.18 `MediaHandler.swift:33`：先调用 PHLivePhoto capability probe，再检查本次请求是否允许 livePhotos；扫码请求实际仅 images。回移[Expo官方PR #50435](https://github.com/expo/expo/pull/50435)：先检查opt-in，再查询UTType.livePhoto，避免PHLivePhoto类自省；保留其他图片/视频分支，安装补丁以版本及完整源码hash防漂移。4项安装/幂等/损坏输入回归通过；原生重建后，同一张QR照片选取/解码不再崩溃。随后发现无签名开发构建在本地SecureStore持久化失败；固定阶段临时日志证实upsert前失败于Keychain，未进入activate，日志代码已移除。旧主可执行文件无模拟权限段；恢复Xcode标准模拟器ad-hoc签名后，权限段及模拟application-identifier存在，相同二维码成功保存Codex隔离连接并打开空会话列表。未修改生产权限组或后端协议。

会话列表真实验收又发现窄屏分支未消费左右安全区：466pt外屏的84pt右系统栏挡住新建按钮（x406…450，截图25）。共用AdaptiveBottomSheetModal的紧凑iOS分支改用本地物理左右inset与RTL方向映射，保留host/detent/content；面板宽度变382、按钮x322…366，高44pt（截图26），实际点击创建专属Codex会话成功。

XCTest session03在同一会话输入合成中文草稿，依次展开、旋转、半折、折回外屏；四次精确文本值断言通过（截图/JSON27–30），展开时真实侧栏300pt、聊天区567pt。截图显示光标保留，但XCTest直接输入不能替代中文IME组合态或软键盘验收。长内容/长按/滚动、真实Split View、其他后端与最终main验收仍未完成。session02 runner成功退出只证明已执行步骤；session03已返回四次断言和stop结果，但随后关闭模拟器使测试teardown未完成，xcodebuild最终65；保留这项执行限制，不将该runner记为全绿，更不能计作整体矩阵通过。后续执行必须等runner正常完成再关闭模拟器。

本轮窄验证：图片选择安装补丁4项、AdaptiveBottomSheetModal8项（含紧凑RTL/inset-only/状态保持）通过；Mobile类型、设计系统、8指令对/5文档用例与Xcode27.1 arm64 Debug原生构建通过，独立只读复核无阻断。证据目录保留原始崩溃、失败/成功xcresult、逐操作AX快照及截图25–30。


## 最终重基与评分邀请交集

重基 `cd859de5` 时保留主分支原生评价hook及其资格/冷却逻辑。稳定RosterController向各host传递触摸取消，并持续报告refresh/四类任务的busy状态；否则任务已打开后才发生Thread→Roster可能重新创建邀请机会。App safe gate消费该状态，折叠/展开不创造导航事件。Roster原重命名/保存锁/host切换回归同时验证busy保持及触摸取消，未新增第二个owner。

重基后窄验证：RosterScreen30项、useAutomaticAppReview6项逐文件串行通过，Mobile类型检查、8指令对/5文档回归与diff检查通过；独立只读复核无阻断。完整门禁由最终PR提交的CI执行。
