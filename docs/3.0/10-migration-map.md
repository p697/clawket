# 10 · 迁移映射与删除清单

> 「删除」项必须删除文件与所有引用；「重写」项保留路径职责但内容按新规格重做；「迁移」项移动并换皮。完成后 `metrics:loc` 报告与基线的差值；净减少是目标，删除清单是要求。

## 1. App：屏幕

| 现有 | 处理 | 去向 |
|---|---|---|
| `screens/LiveScreen/*` | 删除 | 头像状态 + 线程卡片 |
| `screens/ConsoleScreen/ConsoleMenuScreen.tsx`、`HermesConsoleMenuScreen.tsx`、`YouMindConsoleMenuScreen.tsx` | 删除 | `AgentSettings` |
| `SessionsBoardScreen.tsx`、`AgentSessionsBoardScreen.tsx`、`sessions-board.ts` | 删除屏幕；`sessions-board.ts` 迁移为 `SessionPanel/list-model.ts` | 会话面板列表模式 |
| `ChatHistoryScreen.tsx`、`ChatHistoryDetailScreen.tsx`、`FavoriteMessageDetailScreen.tsx`、`chatHistory*.ts` | 删除屏幕；搜索逻辑迁移到 `screens/Search` | 全局搜索 |
| `AgentListScreen.tsx`、`AgentDetailScreen.tsx`、`AgentUserInfoScreen.tsx` | 迁移到 `AgentSettings/Identity*` | 身份页 |
| `ModelsScreen.tsx` | 迁移 `AgentSettings/Models` | |
| `SkillListScreen.tsx`、`SkillDetailScreen.tsx`、`SkillContentScreen.tsx`、`ClawHubScreen.tsx`、`screens/DiscoverScreen/*` | 迁移合并为 `AgentSettings/Skills`（已安装 / 发现） | ClawHub 作为发现来源 |
| `CronListScreen.tsx`、`CronDetailScreen.tsx`、`CronEditorScreen.tsx`、`CronWizardScreen.tsx`、`Hermes*Cron*.tsx`、`HermesAwareCronScreens.tsx`、`hermesAwareCronDispatch.ts`、`cronData.ts`、`cronWizardSaveSpec.ts`、`HeartbeatSettingsScreen.tsx` | 迁移为 `AgentSettings/Cron`（心跳作为固定项；Hermes 差异经能力矩阵与适配器，不再有 Hermes 专属屏幕） | |
| `FileListScreen.tsx`、`FileEditorScreen.tsx` | 迁移 `AgentSettings/Files` | |
| `UsageScreen.tsx`、`StatsPosterModal.tsx` | 迁移 `AgentSettings/Usage`；海报功能保留 | |
| `ToolsScreen.tsx` | 迁移 `AgentSettings/Tools` | |
| `ChannelsScreen.tsx`、`DevicesScreen.tsx`、`NodesScreen.tsx`、`NodeDetailScreen.tsx` | 迁移合并为 `AgentSettings/ChannelsDevices` | |
| `LogScreen.tsx` | 迁移 `AgentSettings/Logs` | |
| `DocsScreen.tsx` | 删除 | 帮助页链接 |
| `YouMindBoard*.tsx`、`components/console/YouMind*`、`components/youmind/*`（登录面板除外） | 删除 | |
| `screens/ProfileScreen/*` | 删除 | |
| `screens/ChatScreen/YouMindChatTab.tsx`、`components/YouMindSkill*`、`youmind-skill-picker-data.ts`、`generatedYouMindSkillIconXml.ts`、`hooks/youMindMessageMapping.ts` | 删除；chunk 解析迁到 `connection/adapters/youmind-sprite.ts` | |
| `screens/ChatScreen/index.tsx`、`ChatTab.tsx`、`ChatScreenLayout.tsx` | 重写为 `screens/Thread` | |
| `screens/ChatScreen/hooks/*` | 迁移到 `src/chat/`（运行时不变，删除 YouMind 分支） | |
| `screens/ConfigScreen/ConfigScreenLayout.tsx`（2,162 行）、`ConfigTab.tsx`、`index.tsx` | 重写为 `AccountSettings`（描述符驱动，≤ 500 行） | |
| `screens/ConfigScreen/OpenClawConfig*`、`OpenClawPermissionsScreen.tsx`、诊断与备份页 | 迁移合并为 `AgentSettings/OpenClawManage`（四分段） | |
| `screens/ConfigScreen/ChatAppearanceScreen.tsx`、`HelpCenterScreen.tsx` | 迁移到 `AccountSettings/` | |
| `components/chat/SessionSidebar.tsx`、`session-sidebar-*.ts`、`AgentsModal.tsx` | 删除；筛选逻辑迁移到 `SessionPanel` | |
| `components/chat/ChildSessionActivityStrip.tsx` | 删除 | `RunCard` |
| `components/canvas/*`、Canvas 相关 gateway 事件与设置开关 | 删除 | 3.0 不做 Canvas |
| `components/console/*`（非 YouMind 部分） | 逐个判断：被迁移页面使用的换皮保留，其余删除 | |
| `App.tsx` 的 Tab 导航、`navigation/root-tab-bar.ts`、`hooks/useTabBarHeight.ts` | 删除 | 单根栈 |

## 2. App：服务与工具

| 现有 | 处理 |
|---|---|
| `services/gateway.ts`、`gateway-relay.ts`、`gateway-shared.ts`、`gateway-backend-operations.ts`、`gateway-backends.ts`、`gateway-hermes-*.ts`、`gateway-console-dashboard.ts`、`gateway-hermes-console-dashboard.ts`、`gateway-agent-detail.ts`、`hermes-console-entry-descriptors.ts`、`console-entry-descriptors.ts`、`live-dashboard.ts`、`hermes-connect-debug.ts` | 删除（逻辑按 `01` / `03` 迁入 `connection/`） |
| `services/youmind.ts`（3,032 行）、`youmind-response.ts`、`youmind-chat-attachment-cache.ts`、`youmind-skill-background.ts` | 删除；登录与刷新逻辑迁入 `connection/adapters/youmind-sprite.ts`（≤ 900 行） |
| `services/storage.ts` | 精简：删除 YouMind Board / 素材 / 技能相关 key、Office / Live 相关 key、`activeGatewayConfigId`；新增连接注册表与水位线 key；写迁移函数把旧 `GatewayConfig[]`（url、token、password、bootstrap、relay、hermes、mode、debugMode）逐字段转成 `ConnectionRecord[]`（`01` §3.1），**必须保留全部凭据**。迁移必须：原子（先写新 key 再删旧 key，任一步失败保留旧数据并下次重试）、幂等（重复执行无副作用）、有回滚（保留旧 key 一个版本）；测试用从 2.1.x 真实 SecureStore / AsyncStorage 导出的脱敏 fixture |
| `services/chat-cache.ts` | 保留；增加按连接清理 |
| `services/node-*.ts`、`node-capabilities.ts` | 保留（节点能力属于渠道与设备页） |
| `services/analytics/*` | 按 `07` 重写事件表 |
| `services/pro-subscription.ts` | 保留；增加 `reason` |
| `services/chat-notifications.ts` | 保留；删除 `CHAT_REPLY_NOTIFICATIONS_ENABLED` 常量改为账户设置开关 |
| `utils/pro.ts` | 重写（`06`） |
| `theme/accents.ts`、`ThemeProvider.tsx`、`AppProviders.tsx`、`useAppBootstrap.ts`、`storage.ts` 中的 `customAccent` 分支 | 删除（无界面的自定义强调色）；六种内置强调色保留并按 `05` 重新取值 |
| `utils/posthog-navigation.ts` | 重写（`07`） |
| `utils/agent-session-scope.ts` | 迁入 `connection/adapters/openclaw.ts` |
| `features/app-updates/releases.ts` | 只保留 3.0 一条与「3.0 + Pro」介绍；旧版本条目删除 |

## 3. App：i18n

- 四个命名空间保留；`console.json` 改名 `settings.json`。
- 用 `apps/mobile/scripts/i18n-prune.mjs` 删除源码未引用的 key；YouMind、Office、Live、Console 首页相关文案整批删除。
- 新增文案六语同步；`check:required` 里加一条「六语 key 集合一致」的检查（脚本已存在则复用）。

## 4. 服务端与包

| 现有 | 处理 |
|---|---|
| `apps/hermes-relay-worker`、`apps/hermes-relay-registry` | 删除（M2 完成后） |
| `packages/bridge-runtime/src/hermes.ts` | 拆分（`02` §6） |
| `packages/bridge-runtime/src/runtime.ts` | 移动到 `openclaw/runtime.ts`，抽出 `relay-session.ts` |
| `packages/relay-shared/src/hermes-protocol.ts` | 合并进 `protocol.ts`，Hermes 特有常量保留在同一文件的独立节 |
| `tests/integration/*` | 保留；`tests/compat/` 新增 |

## 5. 文档

| 文档 | 处理 |
|---|---|
| `docs/mobile/*.md`（与 `apps/mobile/docs/*.md` 重复的五份：macos-app-store-submission、macos-catalyst-plan、ios-app-store-release、android-build、macos-dev） | 删除 `docs/mobile/` 副本，保留 `apps/mobile/docs/` |
| `apps/mobile/docs/live.md` | 删除 |
| `apps/mobile/docs/macos-catalyst-plan.md`、`macos-app-store-submission.md`、`macos-dev.md` | 保留一份并在顶部注明「3.0 不在范围」（脚本保留） |
| `apps/mobile/tasks/gateway-settings.md` | 删除（已完成的任务记录） |
| `apps/mobile/strategy/*.md`（未跟踪的本地文件） | 不动（不在仓库里） |
| `SELF_HOSTING_MODEL.md`（根） | 并入 `docs/self-hosting.md` 后删除 |
| `docs/relay/HERMES-RELAY-DESIGN.md` | 重写为「Hermes 实例」一节并入 `docs/relay/ARCHITECTURE.md`，原文件删除 |
| `docs/openclaw-connection-compatibility.md` | 保留，加入能力字符串一节 |
| 根 `README.md` / `README.zh-CN.md` | 同步更新：定位、工作区表、隐私承诺、YouMind 精灵说明；删除 Office 相关段落 |
| 根 `AGENTS.md` | 更新工作区表（删两个 Hermes 目录、加 agent-protocol）、删除 Preview Service Environment 之外已不成立的规则、加「3.0 规格位置」一节；根 `CLAUDE.md` 是符号链接不动 |
| `apps/mobile/AGENTS.md` | 重写：删除 Chat Runtime 双运行时、Console 菜单分屏、YouMind 相关规则；加连接层 v2 与视觉规则。`CLAUDE.md` 是相对符号链接，不动、不复制（`check:docs` 会校验） |
| `packages/bridge-runtime/AGENTS.md` | 按新目录重写 |
| `apps/relay-worker` / `apps/relay-registry` 的 README 与 `docs/relay/*` | 加 `RELAY_BACKEND` 与三实例部署说明 |

## 6. 依赖

删除不再使用的依赖（M7 knip 判定），候选：`@react-navigation/bottom-tabs`、`@react-navigation/drawer`、`react-native-drawer-layout`、`react-native-draggable-flatlist`（若仅 YouMind 使用）、`expo-apple-authentication` 与 `expo-auth-session`（YouMind OAuth 删除后）、`react-native-webview`（若 Docs / ClawHub 网页全部删除；技能发现若仍需网页则保留）。每删一个依赖跑 `mobile:sync:native` 与双端构建。
