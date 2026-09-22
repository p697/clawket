# 2026-09-21 限流与告警专项

负责人授权检查生产日志并直接做确定的优化，功能和稳定性优先。本次仅调整 Cloudflare 边缘规则、增加邮件告警和维护文档；没有发布 Worker/Bridge/App、修改用户后端或主动触发生产限流。

## 已实施并读回确认

- 与生产配置任务分工：其已移除 API skip 的 rate-limiting 跳过项、创建两条限流和 $50/$100 预算告警；本任务接手后调整这两条规则。
- 双 Relay `/ws`：每 IP、每 Cloudflare colo 120 次 / 60 秒，超限拦截 60 秒，返回 JSON 429。只计 HTTP 建连，不计已建立 WebSocket 的聊天帧。原规则 30 次与观测最高单 IP/分钟成功建连样本 25 次过近；共享 NAT、双后端及新版 secondary channels 需要余量。120 是初始防洪值，不是经过容量验证的绝对安全阈值。
- 配对：20 次 / 60 秒，拦截 60 秒，JSON 429 / `PAIRING_CODE_RATE_LIMITED`。保留 OpenClaw `/pair/session` 匹配，补上原规则遗漏的 Hermes `/v1/hermes/pair/claim-code`。两个后端在同一规则中共享 IP/colo 计数。
- 新增账户级 HTTP DDoS 邮件告警，沿用已配置的账户邮箱；policy `d82cbdeb074045c9b508b971a414fe4b`。已核实 enabled 和收件人数，未发送测试邮件，实际邮件送达未验证。
- 保留配置任务的 $50/$100 和原有 $62.55 预算邮件告警。它们是账户级账期费用告警，不是 Clawket 专属费用，也不会停服或自动封顶。

规则集 `29d210e034e34387a913cd38ca9595c0` 已由 version 1 更新至 3。前后完整脱敏规则见 [证据目录](evidence/security-admission-2026-09-21/)。WS rule `eda7e9847497420f8cbd6d9e807216b2`，pair rule `ac859a6c9637431e8e72ad6b8bf26b8c`。

## 观测依据与限制

时间均 UTC。2026-09-20 14:00 至 09-21 14:00 的 zone adaptive analytics：Hermes bridge-status 200 约 716,276 次、500 21 次；Hermes /ws 101 约 37,819 次，OpenClaw 约 2,009 次。成功建连按 IP/分钟分组的最高返回样本为 25；这些是自适应分析结果，不等同精确用户数或完整容量测量。未保存原始 IP。

Hermes 健康查询是带认证的恢复机制，频繁查询不能直接认定灰产。保留现有健康轮询和消息限制，不对 bridge-status 加笼统封禁，不给机器 API 增加 Managed Challenge。

2026-09-21 14:20–14:29，生产 Hermes 日志聚合：

| 事件 | 观测 |
|---|---|
| gateway ws_disconnected / 4010 | 173 次；平均 socketAgeMs 约 6,142 |
| gateway ws_disconnected / 1006 | 9 次；平均约 90,455 ms |
| rehydrate_summary | 4,137 次，duplicateSocketsClosed 合计 179，orphanSocketsClosed 0 |

生产快照中 4010 为 DEAD_SOCKET，重复/孤儿/失效 socket 清理均可使用它；日志指向重复连接清理，但不能据此确定是多 Bridge 进程、重连竞态还是其他原因，也不能将事件数当作 App 掉线人数。候选 Bridge 已有旧 socket close 不破坏新连接的回归用例，不能因此宣称线上问题已解决。

14:17–14:29:02 的 ratelimit firewall events 查询无返回记录；仅覆盖规则调整后的短窗口且分析可能延迟，不能证明零误伤。调整后四个生产自定义域名 /v1/health 均 JSON 200。没有对生产发送超阈值流量，429 命中行为目前是配置读回验证，真实旧 App 配对/聊天仍需发布冒烟。

## 尚未闭环

后续读回：14:28:14–14:35:27 的 adaptive analytics 返回 Hermes 120 次、OpenClaw 2 次成功升级 101，无 ratelimit firewall events 返回；见 `post-change-analytics.json`。这是短期连通性证据，不能替代用户会话和长时间误伤观察。

验证记录：v1 replay 5 文件 / 39 项、Hermes relay 定向 19 项、文档检查均通过（日志在证据目录）。首次使用 workspace 的普通 test 脚本追加文件名仍展开了整个 src，意外运行外部集成：40 文件通过、3 文件失败，17 个失败含 Python 缺少 hermes_cli/agent 及连带断言；已保留原日志，不能称整体 Bridge 测试全绿。随后直接调用 Vitest 的目标文件获得上述 19 项结果。本次未修改运行时代码，未把外部环境问题当作已修复。

1. 日 Workers 2M、DO 500k、KV 写入 50k 三条阈值没有伪装成完成。Native usage alert 只有产品和总量阈值，未核实可表达日窗口；当前产品选择器没有 KV 写入。DO storage writes 不是 KV writes。应以明确日窗口、Clawket 服务过滤和实际基线建设指标告警；本轮不仓促部署新的监控服务。
2. 没有配置 Discord webhook，账户当前没有现成 webhook destination；邮箱已有配置。DDoS/预算告警不覆盖“服务返回正常但会话不能恢复”的业务故障。
3. 发布观察应优先核实 Hermes 重复 owner 清理：结合单房间的脱敏连接生命周期与 Clawket 管理的 Bridge 进程，验证一小时会话非预期断连 SLO。当前证据不足以安全停止远端进程或改重连协议。
4. 注册 10/IP/hour 的强一致 DO 限制在候选代码中，需随另一任务的正式部署生效验证。本轮 WAF 不能替代该门禁。Pro 当前只有两条规则额度，不能照抄旧文档四条边缘规则；未增加套餐。

## 回退与后续判定

### 后续：Hermes owner 争抢修复（负责人追加授权）

进一步按房间聚合，上述 173 次 4010 分布于两个房间（36 / 137 次），断连事件的 clientCount 最大均为 0。当前 Mac 只有一个产品 Hermes relay CLI；另一个 QA runtime 使用独立 Preview 配对，未发现本机双生产实例证据。没有停止远端进程，也未保存房间原始 ID、请求凭据或 IP。不能由这些统计确定两个房间的主机根因。

确认并修复了可复现的候选 Bridge 缺陷：同一持久化 instanceId 的两个 runtime 在被 Relay 明确替换后仍重连，会反复挤掉对方。现在仅对当前云 socket 的 4010/duplicate_socket、4001/replaced_by_new_bridge 主动让出，停止该 runtime 的传输/探测/重试并报告诊断。普通 1006、4010/dead_socket、4010/orphan_socket、缺失/未知 reason 仍自动恢复；已退休 socket 的迟到 close 不影响新 socket。停止重复实例后可显式启动。

CLI 增加可释放的保活句柄，让主动让出的进程保持可诊断，避免“退出→看门狗重启→再争抢”；不终止 Hermes 本地服务或正在另一个连接上处理的任务。新增真实 Node 子进程用例验证无 socket 时继续存活，SIGINT/SIGTERM 路径调用 stop 并退出；没有修改外部 Hermes 源码。

先运行新增断言得到两个预期失败，再修复至通过；加入双 runtime 收敛测试及五类普通关闭恢复测试。相关日志在 `evidence/hermes-owner-fix-2026-09-21/`。完整 required、连接专项 95 项、CLI 29 项、v1 39 项、Relay integration 8 项及最终 Bridge typecheck 已通过。生产 Worker 已有的旧 socket 心跳污染在候选 Worker 中有独立保护；本次未改 Worker 实现。

**修复尚未发布。** 线上所有旧 Bridge 仍可能互相争抢；升级后应按单房间复查 replacement/重连趋势与真实会话 SLO，不能把候选测试通过写成生产故障已消失。原始关闭信号的确切主机来源仍待关联。

最终发布矩阵也通过：当前生产配置快照 × OpenClaw/Hermes × candidate/published-0.7.0 × 六阶段，共 24 个阶段。本机补查全部 Node/Clawket 入口，仍只发现一个产品 Hermes Relay 进程；本机日志在 14:00–14:29 没有 duplicate_socket 关闭，只有一次 transport pong timeout，14:48 的认证云状态查询返回 200/hasBridge=true/clientCount=0。因此不把两个异常房间直接归因于负责人这台 Mac。云端已脱敏日志无法用 pairing query / requestId 完成可靠关联，events 查询还遇到连接器对缺失 requestId/outcome 的解析错误；没有为了追踪而重新开启可能记录凭据的 invocation logs。

若出现正常用户新建连接/配对 429，先定位对应 rule 和 IP/colo 聚合，必要时仅禁用该 rule，保留其他防护；不要改 API skip 跳过整个 rate-limit phase。回退本轮配置可按 before JSON 的原字段 PATCH 两个已知 rule，并移除新增 response 字段（不要覆盖全 zone 的其他规则）。注意恢复旧 pair 表达式会重新漏掉 Hermes，通常应只撤销有问题的阈值/匹配部分。

删除本轮 DDoS policy 可撤销新增告警，不要删除另一任务或账户原有预算告警。未发生服务版本/DO schema 变更，无须回滚 Worker。

参考：[Cloudflare Pro 限流能力](https://developers.cloudflare.com/waf/rate-limiting-rules/)、[限流参数](https://developers.cloudflare.com/waf/rate-limiting-rules/parameters/)、[预算告警](https://developers.cloudflare.com/billing/manage/budget-alerts/)。本轮是减少明确风险的配置优化，不是 3.0 全量发布签字。
