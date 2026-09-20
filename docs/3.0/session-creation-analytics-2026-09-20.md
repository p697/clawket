# 新建会话历史埋点复核 · 2026-09-20

结论：保持当前不提供 App 新建入口的决定。没有足够证据证明 2.x 用户依赖这个动作；也不能声称“没有人用”，因为 2.x 没有独立的新建埋点。

来源：[PostHog 项目 337268 只读 SQL 查询](https://us.posthog.com/project/337268/ai?chat=74f838c1-1ab1-4dae-997d-bf7ed9f22b08)。本轮通过已登录页面重新查询，只保存聚合结果，不保存个人标识或聊天内容。未创建/修改 Dashboard 或 Insight。

| 查询结果 | 事件数 | 去重 distinct_id |
|---|---:|---:|
| 全历史 chat_session_selected | 32,401 | 1,640 |
| 其中 2.0.0 | 2,990 | 208 |
| 其中 2.1.0 | 8,663 | 572 |
| 其中 2.1.1 | 5,523 | 335 |
| session_action，action=create，全部版本 | 4 | 3 |

四次 create **全部属于未发布的 3.0.0**。不能将它们视为 2.x 商店用户的需求证据，也没有足够依据断言这三个标识都属于内部成员。按版本统计的去重人数不能相加；distinct_id 不是经过核实的自然人人数。

事件发现扫描 `lower(event) LIKE '%session%'`，以及 create/new/reset/clear 与 chat/session 的名称组合。session_action 的实际 action 只有 create。旧版代码 `717f265^:apps/mobile/src/services/analytics/events.ts` 定义 `chat_session_selected`，属性是 source / session_kind / session_key_prefix；它表示选择，不是创建。未发现旧版新建成功的独立埋点。`session_action` 是 3.0 的新增定义，当前 UI 已无 create 调用。

查询口径（历史下界与页面实际查询一致）：

```sql
SELECT event, count() AS total_events, uniqExact(distinct_id) AS distinct_users,
       min(timestamp) AS first_seen, max(timestamp) AS last_seen
FROM events
WHERE timestamp >= '2020-01-01' AND lower(event) LIKE '%session%'
GROUP BY event ORDER BY total_events DESC LIMIT 100
```

页面另按 `$app_version` 与 `session_action.action` 聚合，并查询近 90 个完整日。这里以全历史和确切版本拆分为判断依据，不采用 AI 总结中近 90 天的约数用户合计。

后续若决定重新试验新建入口，应区分点击、成功、失败，附 backend / App version / source 等有限枚举；不能把切换事件当创建成功。此次不新增入口或埋点，不调整会话收费。
