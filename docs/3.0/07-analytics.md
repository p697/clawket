# 07 · 埋点

PostHog 项目 337268；SDK 与集中式 `src/services/analytics/events.ts` 沿用。原则：业务事件、低基数属性、无消息内容、无原始 id。

## 1. 超级属性（`usePostHogIdentity`）

| 属性 | 值 |
|---|---|
| `app_platform` | ios / android |
| `connection_count` | 数字 |
| `backend_kinds` | 逗号拼接的去重后端列表，如 `openclaw,hermes` |
| `active_backend` / `active_transport` | 当前活动连接 |
| `is_pro` | 布尔（现有 `subscription-context` 已提供 `is_premium`，统一改名为 `is_pro` 并保留旧名一个版本） |
| `theme_mode` / `theme_accent_id` | 现有 |
| `grace_active` | 布尔 |

删除 `gateway_mode`（由上面两项替代，保留一版做过渡）、`current_agent_id`（不再有全局当前 Agent）。

## 2. 页面曝光

`posthog-navigation.ts` 重写为新路由：`Onboarding`、`Roster`、`Thread`、`SessionPanel`（弹层手动上报）、`AgentSettings` 及子页（`Models`、`Skills`、`Cron`、`Files`、`Usage`、`OpenClawManage`、`Tools`、`ChannelsDevices`、`Logs`、`Identity`、`ConnectionStatus`）、`AccountSettings` 及子页、`Search`、`Paywall`。属性：`screen_area`（onboarding / roster / thread / settings / account / search / paywall）、`screen_kind`、`backend`。

## 3. 事件表

| 事件 | 属性 | 触发 |
|---|---|---|
| `onboarding_viewed` | `source: first_run|add_connection` | 引导页显示 |
| `pairing_code_submitted` | `length_ok` | 提交六位码 |
| `gateway_connect_saved`（现有） | `backend`, `transport`, `source` | 保存连接 |
| `gateway_secure_pairing_finished`（现有） | 现有 | |
| `connect_attempt` | `backend`, `transport`, `reason: launch|switch|foreground|manual|retry` | 传输开始连接 |
| `connect_ready` | `backend`, `transport`, `elapsed_ms`, `attempt` | 三段就绪 |
| `connect_failed` | `backend`, `transport`, `code`, `stage: socket|handshake|ready`, `attempt` | 失败 |
| `reconnect` | `backend`, `transport`, `reason: tick_timeout|socket_close|probe_failed|seq_gap|foreground` | 重连触发 |
| `roster_viewed` | `connection_count`, `agent_count`, `pinned_count`, `unread_count`, `attention_count` | 花名册显示 |
| `roster_row_opened` | `kind`, `unread`, `attention`, `locked`, `cached` | 点行 |
| `roster_pin_toggled` | `action: pin|unpin`, `kind` | |
| `thread_opened` | `backend`, `kind`, `from: roster|panel|search|notification|deeplink` | |
| `chat_send_tapped`（现有） | 现有 + `backend` | |
| `chat_abort_tapped` | `backend` | 停止键 |
| `run_card_opened` | `kind: subagent|cron` | |
| `approval_resolved` | `kind: exec|plugin|pair`, `decision` | 合并现有两事件 |
| `session_panel_opened` | `mode: grouped|list`, `session_count` | |
| `session_panel_mode_changed` | `mode` | |
| `chat_session_selected`（现有） | 现有 + `from: panel|search` | |
| `session_action` | `action: pin|rename|reset|delete|create` | |
| `agent_settings_opened` | `backend` | |
| `settings_row_opened` | `row`, `locked`, `backend` | |
| `search_performed` | `scope: global|panel`, `has_results`, `result_kinds` | 防抖后 |
| `search_message_opened` | `is_pro` | 触发 Pro |
| `paywall_viewed`（现有） | 现有 + `hero`, `variant`, `trigger_screen`, `launch: bool` | |
| `paywall_closed`（现有） | + `seconds_on_paywall`, `plan_toggled` | |
| `paywall_package_selected` / `paywall_subscribe_tapped` / `paywall_purchase_succeeded`（现有） | + `hero`, `variant` | |
| `paywall_purchase_failed`（现有） | + `reason` | |
| `paywall_launch_shown` / `paywall_launch_closed` | `variant`, `first_run: bool` | 连接就绪后的自动弹出单独统计 |
| `grace_banner_viewed` / `grace_expired` | `days_left` | |
| `youmind_sign_in_tapped` / `youmind_sign_in_resolved`（现有） | `method` 固定 email | |
| `sprite_greeting_sent` | — | 首次开场 |
| `app_rating_tapped`（现有） | | |

## 4. 删除的事件

`live_session_opened`、`office_*`、`console_entry_tapped`（由 `settings_row_opened` 替代）、`discover_*`（并入 `settings_row_opened{ row: skills_discover }` 与 `skill_install_tapped`）、`clawhub_*`（同上）、`youmind_material_*`、`youmind_*`（除登录两项）、`chat_reply_notification_*`（保留实现，事件名不变）、`lifetime_upgrade_announcement_*`、`chat_exec_approval_resolved` 与 `pair_request_resolved`（合并）。

## 5. 看板（人在 PostHog 建，规格只定义）

1. 连接健康：`connect_ready` 的 p50 / p90 `elapsed_ms` 按后端 × 传输；`connect_failed` 按 `code`；`reconnect` 每活跃用户每小时。
2. 激活漏斗：`Application Installed` → `gateway_connect_saved` → `thread_opened` → `chat_send_tapped`，按周队列。
3. 付费：`paywall_viewed` → `paywall_subscribe_tapped` → `paywall_purchase_succeeded`，按 `hero` 与 `launch`；年付占比；Android 成交率。
4. 花名册与面板：`roster_row_opened` 的 `kind` 分布；`session_panel_opened` 的 `mode` 分布。

## 6. 校验

- `events.test.ts` 覆盖每个事件的属性白名单（禁止高基数字段）。
- Debug 模式下的 PostHog 诊断页显示最近 20 条事件（现有 `getPostHogDiagnostics` 扩展）。
