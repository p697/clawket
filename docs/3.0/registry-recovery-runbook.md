# Registry 首次 DO 迁移的恢复操作

2026-09-20：已准备 OpenClaw / Hermes 两份恢复包，并在本地 workerd 演练。没有部署生产，也没有执行 Cloudflare 控制面迁移；本地通过不能替代隔离云环境的首次迁移验收。

## 它解决什么

3.0 Registry 新增 `PairRegisterRateLimiter`。旧生产包没有这个 Durable Object 类，跨过这次迁移后，不能假定 `wrangler rollback` 能直接回到旧包。[Cloudflare 回滚限制](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)要求考虑 DO 类的生命周期。

恢复方式是再部署一个准备好的兼容包：普通路由使用校验过的旧生产实现；注册、刷新、领取三个配对写入路由保留候选版安全实现，继续执行每 IP 哈希每小时 10 次限速、未领取记录 24 小时过期，保持邀请失效语义，并继续导出同名 DO 类、保留同一绑定和 migration tag。不删除 DO，不重建 KV，不更换配对密钥。

这是紧急降级：六位码 / 新邀请接口不可用，CLI 应回退旧 QR；已有配对和旧 QR 的刷新、领取仍能工作。恢复包不是 3.0 功能完整版本，也不是任意未来迁移的通用回滚器。这份包主要恢复旧验证/读取路由；三个配对写入逻辑本身的故障仍需要前向修复，不能声称整套 Registry 都回到了旧逻辑。

## 本轮已经准备的产物

本机目录：`docs/3.0/evidence/pre-release-audit-2026-09-20/registry-recovery-safe/`。
每个 Registry 子目录包含固定的 `bundle/index.js`、`wrangler.toml`、原生产快照 `production.js`。总 `manifest.json` 记录生产版本、快照 / 恢复包 / 配置 SHA-256。生产配置来自当前本机对应的两个 `wrangler.*local.toml`，没有导出 Secret 值。该目录按 evidence 规则不进 Git，发布负责人必须将它和测试日志作为受控发布附件保留。

## 后续 Agent 上线前执行

1. 只读检查当前生产版本 ID 是否仍等于快照 manifest；不相同就重新导出生产快照，不能沿用旧包。固定候选代码与本机环境配置。
2. 生成新的不可覆盖产物目录：

```sh
node scripts/release/registry-recovery.mjs \
  "$CLAWKET_RELEASE_SNAPSHOTS" \
  "$CLAWKET_RELEASE_RECOVERY" \
  apps/relay-registry/wrangler.local.toml \
  apps/relay-registry/wrangler.hermes.local.toml
node scripts/release/registry-recovery.mjs --verify "$CLAWKET_RELEASE_RECOVERY"
```

两个环境变量必须是绝对路径；输出目录必须尚不存在。构建只有 `wrangler deploy --dry-run`，不会发布。工具检查空 / 损坏快照和 Worker 名称，保留配置的绑定与迁移。Preview 不得使用这些生产配置。

3. 运行 `npm run check:required`、`npm run test:compat`，然后：

```sh
CLAWKET_RELEASE_SNAPSHOTS="$CLAWKET_RELEASE_SNAPSHOTS" \
CLAWKET_RELEASE_RECOVERY="$CLAWKET_RELEASE_RECOVERY" \
npm run test:release:compat
```

矩阵包含两个后端 × 新旧 Bridge × 六阶段；最后一阶段使用上述固定恢复包，验证已保存配对、握手/健康、聊天、会话、刷新/领取，以及限速在恢复包重启后仍生效。未提供恢复目录时测试会从快照在临时目录生成；生产快照缺失始终失败。

4. 首次生产迁移前，另在**专用隔离 Worker + KV + DO** 完成云端「旧包 → 候选 → 恢复包」演练，验证控制面接受保留 DO 的前向恢复。禁止用生产绑定冒充演练。记录部署 ID、迁移 tag、旧配对复连、新配对与限速结果。此项本轮尚未执行。

## 发布后出现问题时

先暂停继续放量，确认故障属于 Registry 并记录当前版本；对受影响后端执行恢复前校验和 v1 门禁。不要无差别回退两个后端。

在已有生产恢复授权下，OpenClaw 执行：

```sh
node scripts/release/registry-recovery.mjs --verify "$CLAWKET_RELEASE_RECOVERY"
npm run test:compat
npx wrangler deploy --config "$CLAWKET_RELEASE_RECOVERY/clawket-registry/wrangler.toml"
```

Hermes 只把最后一条配置路径换成 `clawket-hermes-registry/wrangler.toml`。不执行删除迁移、不清空 KV、不轮换 Secret、不重新配对所有用户。若同时需要 Relay 恢复，按其独立发布单元处理，不能把 Registry 文件部署到 Relay。

部署后用现有配对凭据做受控复连 / 发收，再验旧 QR 的新领取与日志；确认正常后记录新部署 ID，保持降级并修复候选。上面是未来操作说明，本轮没有执行这些生产发布命令。
