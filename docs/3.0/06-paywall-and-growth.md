# 06 · 付费墙、免费额度与增长

## 1. 免费额度（`src/utils/pro.ts` 重写）

```ts
export const FREE_CONNECTION_LIMIT = 1;
type Entitlement = { isPro: boolean; graceUntil: number | null; now: number; freeConnectionId: string | null };

export function canAddGatewayConnection(count: number, e: Entitlement) { return e.isPro || count < FREE_CONNECTION_LIMIT; }
export function canUseConnection(c: ConnectionDescriptor, e: Entitlement) {
  if (e.isPro) return true;
  if (c.id === e.freeConnectionId) return true;
  return e.graceUntil != null && e.now < e.graceUntil;
}
export function canUseAgent(agent: AgentDescriptor, c: ConnectionDescriptor, e: Entitlement) {
  if (!canUseConnection(c, e)) return false;
  if (e.isPro) return true;
  if (agent.isMain) return true;
  return e.graceUntil != null && e.now < e.graceUntil;
}
export function canCreateAgent(e: Entitlement) { return e.isPro; }
```

**免费连接的确定与切换**：
- `freeConnectionId` 存在设备 identity 旁（SecureStore）。首次以 3.0 启动时取当时的活动连接；只有一个连接时就是它。
- 账户设置 → 连接列表里，非 Pro 用户可以把另一个连接设为免费连接，每 24 小时最多一次（防止靠切换白嫖多连接）；切换后原免费连接立即上锁。
- 其他连接在花名册里可见但整组带锁；点开任一带锁行 → 付费墙 `gatewayConnections`。
- Pro 到期：按同一规则上锁，`freeConnectionId` 若为空则取当时的活动连接；恢复购买或续订即全部解锁。
- 重装：连接需要重新配对，`freeConnectionId` 随第一次配对确定；宽限标记随设备 identity 保存，不重发。iOS Keychain 不随删 App 清除，所以首启用 AsyncStorage 里的安装标记（`clawket.installMarker.v1`）判定全新安装：无标记且沙盒无 `clawket.*` 键 → 清掉连接、凭据与本地偏好，保留 identity 与宽限记录，再走首启引导。

- `isMain`：OpenClaw 为 `agentId === 'main'`（或 Gateway 配置的 mainKey）；Hermes 与 YouMind 恒为 true。
- 锁定的 Agent：花名册可见（去饱和 + 锁），点开 → 付费墙情境版 `agents`；置顶会话若属于锁定 Agent 同样锁定。
- **宽限期**：首次以 3.0 启动时，若该设备非 Pro，且（已保存的连接数 > 1，或本地 `chat-cache` 里存在任一非 main Agent 的会话），则写 `graceUntil = now + 14 天`（`StorageService`），花名册顶部横幅显示剩余天数；到期后横幅消失并按上面的规则上锁。宽限只计算一次，重装不重置（存于 SecureStore 的设备 identity 旁）。
- 免费用户的 `agentCreate` 入口（花名册「+」→ 新建 Agent、设置身份页）保留可见，点击即付费墙。

## 2. 付费墙页面 `Paywall`

Session 只读预览底部按钮使用「升级 Pro」。Thread 内的升级入口直接打开全局付费墙，保留当前会话；不能先推入空白全屏导航页再同时展示原生 Modal，以免原生展示竞争覆盖付费墙。关闭回到原会话，购买 / 恢复后按权益原地解锁。

全屏原生模态。采用负责人认可的 Lumen 深色视觉：银色猫头、轻微浮动与眨眼、浅色主按钮；不显示评分或评论。完整内容与结账区共用纵向滚动，小屏与大字号不截断文案。

**2026-09-16 文案与布局定稿（替代旧的三条权益与固定底部布局）**：

1. 顶栏保留关闭与恢复购买。
2. 猫头区域保留随屏高变化的 104–164 pt 最小高度；页面剩余高度分给该区域，不再空在权益与价格之间。插画按比例居中，动画继续遵守减少动态效果和后台暂停。
3. 标题、副标题和四条权益作为阅读区；权益最后一行与价格卡间距固定为 32 pt。长文案自然换行，内容超高时整页滚动。
4. 通用版采用聊天优先标题：「和你的 Agent，聊得更多」（英文：More conversations with your Agents）；不显示副标题（负责人真机反馈：与权益重复，删除后留出空间）。四条权益依次为查看聊天和任务的完整记录；连接数量、Agent 数量不限；修改 Agent 的人格与记忆；管理 OpenClaw 配置、备份和日志。
5. 两张价格卡为「按年订阅」「终身使用」，月付折叠在「按月订阅」入口；年付月均前加「折合」，终身标「一次购买」。全部金额来自商店。
6. 通用购买按钮为「升级到 Pro」，Agent 入口为「升级，使用更多 Agent」。周期、总价、自动续订和随时取消继续独立显示；终身不显示订阅取消说明。会员换方案、恢复购买与法务入口保持原行为。

**情境标题**（文案直接说明被拦动作，不出现「花名册」或 `main`，不承诺任意消息恢复或一键修好）：

| `blocked_feature` | 标题 | 补充说明 |
|---|---|---|
| `gatewayConnections` | 连接更多电脑或服务器 | 在一个 App 里，使用不同设备上的 OpenClaw 和 Hermes。 |
| `agents` | 把其他 Agent 也用起来 | 免费版可用默认 Agent，升级后可使用更多 Agent。权益覆盖 Agent、连接、完整记录、记忆。 |
| OpenClaw 权限 / 配置 / 备份 / 诊断 | 在手机上管理 OpenClaw | 升级后即可使用对应功能；首条权益为查看权限、诊断问题。 |
| `coreFileEditing` | 在手机上修改记忆与文件 | 与日志入口拆开，保留人格、记忆和技能文件的共用编辑门槛。 |
| `logs` | 在手机上查看 OpenClaw 日志 | 明确后端范围。 |
| `modelManage` | 在手机上设置 Agent 的模型 | 首条权益也指向模型管理。 |
| `sessionHistory` | 查看完整的聊天记录 | 查看其他聊天和任务的完整记录，支持回复时可继续对话。 |
| `messageHistory` | 打开搜索到的完整消息 | 升级后即可查看搜索结果中的完整消息。 |
| `usage` | 看看最近花了多少 | 查看最近 7 天、30 天的用量和费用变化。 |

文案和排列不改变免费额度、能力矩阵或购买后续接。真机视觉验收由负责人完成，不启动模拟器。

**状态**：加载 offering（骨架方案卡）；offering 不可用（文案 + 「重试」，按钮禁用）；购买中（按钮 loading，页面锁定）；成功（页内变成功态：标题「你已是 Pro」，2 秒后自动关闭并继续被拦动作）；失败（`reason` 为 cancelled 时静默回到页面；其他显示一行错误）；恢复成功 / 失败同理。

2026-09-14 用户授权扩展：设置 → Clawket Pro → 会员卡始终可主动打开方案页，已付费用户可切换计费周期或另购终身版。当前方案标记并禁购；现有终身/历史赠送终身保护保持。购买前刷新商店状态；Google 同订阅基础方案切换使用下次账单日收费模式，跨订阅切换使用延期替换。iOS 同组同等级按商店规则切换。方案变更提交、终身购买后仍需管理原订阅、购买待核实使用可手动关闭的完成页，不触发 2 秒自动关闭或功能续接。新权益只来自 RevenueCat 当前 entitlement；终身不会自动取消原订阅，购买前后说明并提供商店管理链接。19 种语言保持一致。具体商品与验收见 `apps/mobile/docs/pro-plan-management.md`。

埋点新增 `paywall_plan_change_submitted`（与购买事件相同套餐/情境属性，表示商店接受切换，不代表当场收款）与 `paywall_manage_subscription_tapped`（付费墙情境属性）。`paywall_purchase_succeeded` 保留给已核实的新购/买断权益；不发送交易凭证或用户交易标识。

## 3. 触发规则

**情境触发（不限次数）**：`gatewayConnections`（添加第 2 个连接）、`agents`（锁定 Agent 打开、新建 Agent）、`openclawPermissions` / `configBackups` / `openclawDiagnostics` / `configManage`（OpenClaw 管理任一分段）、`logs`、`coreFileEditing`（文件保存）、`messageHistory`（搜索结果消息详情）、`usage`（用量页 7D / 30D 档位的蒙层与今天档趋势里过去几天的柱子；2026-09-16 负责人决定，今天档完整免费）、`modelManage`（模型页的任一写动作：开关、换默认 / 当前模型、备用、思考等级、加模型、成本、删除；2026-09-16 负责人决定，聊天输入框的会话级切换仍免费）、`appIcons`、设置页 Pro 行的锁图标。

**最后一步拦截（2026-09-16 负责人决定）**：付费墙的前提是让用户先知道功能是什么、看到自己的真实数据，再在交付 Pro 价值的那一步拦。能预览的页面不在入口行上锁、不用一条横幅把整页遮掉。OpenClaw 管理：配置列真实 key，展开后 JSON 在 `ProGate` 遮罩下、编辑弹墙；权限显示三项真实状态，详情 / 规则组（遮罩）/ 修复弹墙；诊断免费运行，摘要与前 2 项可读，其余项遮罩（标题写数量），详情 / 尝试修复弹墙；备份列表免费，创建与恢复确认弹墙。运行日志（行名由「日志」改为「OpenClaw 运行日志」）最新 3 条可读，后 4 条遮罩，非 Pro 不轮询。`ProGate`＝真实内容降透明 + 向页面底色渐隐的 SVG 遮罩（无原生模糊依赖）+ 锁 + 一句功能说明 + 命名功能的解锁按钮；被拦动作带 continuation，购买 / 恢复后原地续做。锁定 Agent（`permissionDenied`）仍整页走 `agents` 门。用量页（2026-09-16 负责人决定「差点就看到」的蒙层而不是拦在入口）：今天档完整免费；7D / 30D 可以切进去，真实数据照常加载并渲染在 `ProGate` 之下（蒙层高六行，英雄卡与四张指标卡的数字若隐若现），锁 + 「看整周、整月的用量」+ 一句说明 + 命名功能的「解锁用量趋势」主按钮；今天档趋势图里点过去几天的柱子也直接弹墙；购买后蒙层随 `isPro` 即时消失，无需续做。

**连接就绪触发（自动弹出）**：每个进程生命周期内，活动连接第一次触发 `connect_ready` 且 `Roster` 已渲染后 500 ms：若非 Pro 且无待处理审批 → 弹通用版（`hero: generic`，`blocked_feature: launch`）。同一进程内后续的重连或切换连接不再触发；从后台切回不算；没有连接就绪就不弹；购买或恢复成功后不再弹。实现为连接注册表上的一次性标记 `launchPaywallShownThisProcess`。

**启动状态机**（导航与自动付费墙不竞争，唯一实现在根导航器里）：

```
[冷启动] → 无连接 → Onboarding ──配对成功──→ Roster(pendingAutoOpen = mainSessionKey)
[冷启动] → 有连接 → Roster(pendingAutoOpen = null)
Roster 渲染完成 → 等 connect_ready（活动连接）
  ├─ 应弹（非 Pro、未弹过、无待审批）→ Paywall(fullScreenModal) ──关闭/购买──→ 若 pendingAutoOpen ≠ null → push Thread(main)；否则停留 Roster
  └─ 不应弹 → 若 pendingAutoOpen ≠ null → push Thread(main)；否则停留 Roster
有待处理审批 → 跳过付费墙，直接 push Thread(审批所在会话)，付费墙留到下一次冷启动
connect_failed → 停留 Roster 显示离线横幅，不弹付费墙，pendingAutoOpen 保留到就绪
```

**常驻入口**：花名册左上头像的「Pro」徽标；账户设置顶部横幅。（更新公告不再放 Pro 条目，负责人 2026-09-16 决定。）

**历史用户**（2026-09-16 负责人改定，取代原「3.0 + Pro 介绍页」）：升级后的第一次启动不再走付费墙布局，而是根层的「更新公告」弹层（`AppUpdateAnnouncementSheet`）：大号 `curious` Companion + 版本英雄文案 + 本版条目（3.0.0 为五条，不含 Pro；条目文案一行、小学生能读懂）；花名册渲染完、活动连接 ready、审批扫描新鲜且无待处理审批后弹，消耗本进程唯一的启动机会（`launchPaywallShownThisProcess`），同一次启动不再叠第二个模态。规则：`silent` 版本永不弹；本地记录「上次公告到的版本」，跳版用户一张弹层合并最多 3 个未公告版本；无记录的 2.x 升级只弹当前版本；全新安装把首个版本写成基线、不弹。开发者分组在 Debug 模式下提供「预览更新公告」行。原 `showThreePointZeroIntro` / `threePointZeroIntro` 模式已删除。

## 4. RevenueCat

- offering `pro`：packages 顺序 annual → lifetime → monthly。App 端默认选中的包由 offering metadata `default_package`（`annual` | `monthly`）决定，缺省 `annual`；`social_proof`（布尔）决定是否显示评分行，缺省 true。实验通过切换 offering 变体的 metadata 起作用，客户端不再有自己的「优先 ANNUAL」硬逻辑。
- 价格显示全部来自 `priceString` / `pricePerMonthString`，不写死美元；省百分比用 `(monthly×12 − annual) / (monthly×12)` 实时算。
- **HT-3**（不阻塞）：人在后台把终身价改为 $49.99（各国自动换算），并配置两组实验：`default_package: annual` vs `monthly`、`social_proof: true` vs `false`，均通过 offering 变体的 metadata。终身价格不做实验（已决定；若以后要做需要第二个商店 SKU）。
- `paywall_purchase_failed` 增加 `reason`：`cancelled` / `pending` / `store_error:<code>` / `offerings_unavailable`；来自 `pro-subscription.ts` 已有的错误码映射。

## 5. Android 结账排查（M6 执行并记录）

1. 确认 Play Console 里三个商品（monthly / annual / lifetime）状态为「有效」，且 App 已在正式或公开测试轨道（closed testing 会导致非测试账号购买失败）。
2. 确认 RevenueCat 的 Google 服务账号凭据有效、商品 id 与 Play 一致。
3. 用 license tester 账号在模拟器 / 真机走一次购买与恢复，记录 `reason` 分布。
4. 若失败集中在 `store_error:ITEM_UNAVAILABLE`，问题在轨道 / 国家可用性；集中在 `cancelled` 则是页面说服力问题。
5. 结论写进 `PROGRESS.md`；需要人操作后台的部分标 HUMAN。

## 6. 增长挂钩（规格内只做这些）

- 商店文案（`09` 附）：「OpenClaw 与 Hermes 的手机控制塔——看清每个 Agent 在做什么，随时接管。」
- README 与 README.zh-CN 的首段同步为 3.0 定位；截图更新由人完成（HT-5）。
- 分享：账户设置「分享 Clawket」沿用。
- 评分请求：沿用 `auto-app-review.ts`，触发点改为「首次成功发送后的第 3 次冷启动」。


### 商店原生兑换码（2026-09-19）

负责人授权：付费墙法律链接旁增加「兑换码」。iOS 使用 StoreKit 原生兑换表单，Android 打开 Google Play 兑换页；不建自有兑换码数据库，不接收、存储或上报码。复用 `Clawket Pro` entitlement，商店账号拥有权益，重装走「恢复购买」。只有 RevenueCat 确认新增有效权益才显示成功，原会员取消、无效码、等待确认不发权益；与购买 / 恢复互斥，等待时可关闭，晚到结果不续做已放弃的操作。iOS 一个月赠送配置为免费且不自动续费，永久赠送复用 buyout；Android 永久赠送复用 lifetime，订阅试用自动续费，不作为无负担月度赠送。后台活动、批次、使用和验收说明见 `apps/mobile/docs/pro-redemption.md`；兑换码 CSV 保存在仓库外。
