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
- 重装：连接需要重新配对，`freeConnectionId` 随第一次配对确定；宽限标记随设备 identity 保存，不重发。

- `isMain`：OpenClaw 为 `agentId === 'main'`（或 Gateway 配置的 mainKey）；Hermes 与 YouMind 恒为 true。
- 锁定的 Agent：花名册可见（去饱和 + 锁），点开 → 付费墙情境版 `agents`；置顶会话若属于锁定 Agent 同样锁定。
- **宽限期**：首次以 3.0 启动时，若该设备非 Pro，且（已保存的连接数 > 1，或本地 `chat-cache` 里存在任一非 main Agent 的会话），则写 `graceUntil = now + 14 天`（`StorageService`），花名册顶部横幅显示剩余天数；到期后横幅消失并按上面的规则上锁。宽限只计算一次，重装不重置（存于 SecureStore 的设备 identity 旁）。
- 免费用户的 `agentCreate` 入口（花名册「+」→ 新建 Agent、设置身份页）保留可见，点击即付费墙。

## 2. 付费墙页面 `Paywall`

全屏原生模态（`presentation: 'fullScreenModal'`，iOS 下滑可关），一屏放完不滚动（小屏设备允许收益区滚动，方案卡与按钮固定底部）。

**结构（自上而下）**：
1. 顶栏：左 28 圆形关闭键（`inkTertiary`）；右「恢复购买」文字键（`caption`）。
2. 英雄图区（高 ≈ 屏幕 22%，圆角 16，`surface` 底）：五套之一，由 `hero` 决定；唯一允许多色（`agentPalette`）与渐变的区域。
3. 标题（`display`）+ 副标题（`secondary inkSecondary`）：按触发点取自下表。
4. 收益 3 行（Lucide 图标 18 + `body`，每条 ≤ 10 个汉字）：第一条永远是触发点对应的能力。没有第四条，没有解释句。
5. 社会证明一行（`caption`）：「★★★★★ 4.4 · “更新快，一直走在最前面”」；评分与引用来自 `src/config/public.ts` 的常量，便于更新。
6. 方案卡两张（`SettingsGroup` 形状，选中卡 accent 2pt 描边 + `accentSoft` 底）：年付（默认选中；副标题「折合 {monthlyEquivalent} / 月 · 省 {savings}%」；右侧「最划算」chip）、终身（副标题「一次买断」）。
7. 「查看月付方案」文字键 → 展开第三张卡（月付）；展开后可选。
8. 主按钮（全宽胶囊，`ink` 底白字）：文案带价格：「开通 Pro · {price} / 年」；情境版：「开通 Pro，继续{action}」。
9. 法务小字：「随时在 App Store 取消 · 条款 · 隐私」（Android：Google Play）。

**英雄图与文案表**（`hero` 枚举）：

| `hero` | 触发点 `blocked_feature` | 标题 | 副标题 | 收益第一条 |
|---|---|---|---|---|
| `connections` | `gatewayConnections` | 把所有 Agent 装进一个口袋 | OpenClaw 与 Hermes 同屏，随时接管 | 不限连接数 |
| `agents` | `agents` | 让每个 Agent 都出现在花名册 | main 之外的 Agent 属于 Pro | 不限 Agent 数 |
| `manage` | `openclawPermissions` / `configBackups` / `openclawDiagnostics` / `configManage` | 从手机修好你的 OpenClaw | 你刚点的「{feature}」是 Pro 能力 | 一键修复权限与诊断 |
| `logsFiles` | `logs` / `coreFileEditing` | 看日志、改文件，不用回电脑 | — | 日志与文件编辑 |
| `search` | `messageHistory` | 找回任何一句话 | 跨会话搜索的消息详情属于 Pro | 跨会话搜索与收藏 |
| `generic` | 冷启动 / 设置入口 / `appIcons` | 把所有 Agent 装进一个口袋 | OpenClaw 与 Hermes 同屏，随时接管 | 不限连接数 |

其余两条收益固定顺序：「从手机修好 OpenClaw」；「日志、文件与搜索」；当触发点已是其中之一时，用「不限连接与 Agent」补位。副标题只在情境版出现，通用版只有标题。

**状态**：加载 offering（骨架方案卡）；offering 不可用（文案 + 「重试」，按钮禁用）；购买中（按钮 loading，页面锁定）；成功（页内变成功态：标题「你已是 Pro」，2 秒后自动关闭并继续被拦动作）；失败（`reason` 为 cancelled 时静默回到页面；其他显示一行错误）；恢复成功 / 失败同理。

## 3. 触发规则

**情境触发（不限次数）**：`gatewayConnections`（添加第 2 个连接）、`agents`（锁定 Agent 打开、新建 Agent）、`openclawPermissions` / `configBackups` / `openclawDiagnostics` / `configManage`（OpenClaw 管理任一分段）、`logs`、`coreFileEditing`（文件保存）、`messageHistory`（搜索结果消息详情）、`appIcons`、设置页 Pro 行的锁图标。

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

**常驻入口**：花名册左上头像的「Pro」徽标；账户设置顶部横幅；版本更新公告末尾一条。

**历史用户**：升级到 3.0 的第一次启动，用「3.0 + Pro」介绍页替代当次更新公告（复用付费墙布局，英雄图 generic，标题「Clawket 3.0」，收益为 3.0 的四个变化）。

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
