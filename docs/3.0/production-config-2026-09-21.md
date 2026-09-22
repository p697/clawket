# 生产配置准备 · 2026-09-21

负责人授权处理发布前生产配置。本任务保留现网 Worker 代码与配对数据，不执行 3.0 代码发布或 npm 发布。

## 任务边界

23:21 JST 收到专门负责「限流与告警」任务的接管通知后，本任务停止对 WAF、rate limiting、alerting 的所有修改；最终限流/告警结论以该任务为准。本任务继续密钥、内部服务绑定、健康检查、生产可观测性与发布配置/恢复证据同步。

接管前已执行并告知该任务：API skip 规则移除 `http_ratelimit` / `rateLimit`，添加两个生产 Relay `/v1/health` 的浏览器挑战豁免；Pro 两条边缘规则为 WS 30/min、pair session 20/min，按 IP+colo 计数、block 60 秒；新增账户范围 $50 / $100 用量金额预算邮件通知，保留原默认 $62.55 通知，未配置 webhook。Pro 两规则及一分钟窗口无法原样满足旧文档四规则/一小时统计，专门任务将评估共享 IP 误伤与后续告警方案；这里不宣称该项已完整关闭。

## 已完成配置

- 在生产 OpenClaw Registry/Relay 安装同一份 384-bit 随机 `PAIRING_TICKET_SECRET`；生成与写入在同一执行过程内，未输出明文、未写入仓库、未轮换既有配对凭据。Hermes 不启用 OpenClaw 六位码协议。
- 两个生产 Registry 分别添加 `RELAY_SYNC_SERVICE` 指向自身生产 Relay；没有混用 OpenClaw/Hermes 或 Production/Preview 资源。Cloudflare 读回绑定正确。
- 四个生产服务启用应用日志，`invocation_logs=false`、`redact_query_string=true`、traces disabled。仅收集已有脱敏应用日志，不开启完整请求调用日志。源码复核现网日志已过滤凭据/身份字段。
- 本机四份忽略的生产 Wrangler 配置同步上述 observability；两份 Registry 配置同步 service binding，避免下一次源码部署覆盖配置。
- 修改前 v1 compat 5 files / 39 tests 全绿。修改后四个自定义域名 health 全为 200；先前两个 Relay health 的 403 已消失。
- 配置操作生成新部署版本；重新下载四个线上脚本并计算 SHA-256，均与原生产快照逐字节一致：代码没有升级，Registry 没有提前执行新 DO 迁移。

## 尚待新版部署后的验证

现网旧代码不声明六位码能力，因此“密钥与调用路径准备好”不等于“生产六位码已上线”。3.0 Registry/Relay 部署后再执行一次性六位码、过期/重复领取、旧 QR/12 位邀请兼容与真实旧 App 抽验；不要为这次配置准备重新配对日常客户端。生产旧 Relay 的休眠恢复修复也仍需新版代码发布。

## 验证与发布锚点

证据目录：`evidence/production-config-2026-09-21/`。`production-snapshots/manifest.json` 保存新部署版本与原代码哈希；`registry-recovery/` 是新建的不可覆盖恢复目录。两个恢复 bundle 与今天已云端演练的版本逐字节相同，仅部署配置加入 service binding 与安全日志设置，未重新运行云端迁移演练。

| 服务 | 配置更新后版本 ID |
|---|---|
| OpenClaw Registry | `ad99420c-aada-47d4-8b3e-e01d73cc4224` |
| OpenClaw Relay | `d405823c-ea3f-4084-be6a-44b9a474ea58` |
| Hermes Registry | `e4ec9aaf-1d25-493e-a669-191e9a20699a` |
| Hermes Relay | `3f4b3e5b-b6f1-4f9f-8b4c-b03453d5c779` |

固定恢复完整性校验通过。用新快照 manifest 与固定恢复包运行 `test:release:compat`：双后端 × 新旧 Bridge × 六阶段全部通过（4 tests、24 phases）。生成恢复包只有 dry-run，没有部署服务代码。`check:docs`（5 regression tests）与 `git diff --check` 通过。未修改产品代码，不重复声称新的全仓/原生包认证。

生产应用日志已实际可查询：两个 Registry 的 health 请求日志均出现，两个 Relay 的生命周期日志均出现。日志同时暴露旧 Hermes Relay 的持续 owner 重连与无 active client 丢帧：14:22–14:24 UTC 窗口的断连聚合 45 条均为 `role=gateway`，不能直接判作 45 名用户失败或归因为本次 WAF。已交给限流/稳定性任务核对，不因 health 200 而宣称端到端稳定性通过。该问题的修复仍需按正式发布流程验证候选，不在本配置任务自动升级现网。
