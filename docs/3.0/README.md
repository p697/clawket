# Clawket 3.0 实施规格（运行手册）

> 本目录是 Clawket 3.0 的唯一实施依据。读者是实现代理（Codex goal 模式）与人类验收者。
> 背景研究与线框图在产品负责人的蓝图页面里，本目录已把其中的全部决策冻结进 `00-decisions.md`，实现时不需要再看蓝图。

## 阅读顺序

1. `00-decisions.md` — 冻结的决策、非目标、硬约束、关键数据。**不得修改，不得重新讨论。**
2. `08-milestones.md` — 里程碑与验收标准。这是执行计划，按顺序做。
3. `PROGRESS.md` — 进度日志。每次开工先读，每完成一个里程碑必须更新。
4. `01` – `07`、`09`、`10` — 各领域的详细规格，在对应里程碑开始前通读该章。

## 偏离规则：整体按规格来，局部允许变通

这套规格是调研的产物，没有实际落地过，几千字里一定有说错的地方。实现者不是执行机器：**发现规格明显说错、按规格做会让体验明显更差、造成严重功能缺失，或者有成本相当但明显更好的做法时，可以按自己认为更好的方式实现**，不需要事先请示，只需要记录。

分三层：

| 层 | 内容 | 能否偏离 |
|---|---|---|
| 硬约束 | 老客户端不坏；成本与安全口子；隐私（Relay 不落盘、消息只在设备）；不提交密钥；删除清单必须执行 | 不能 |
| 产品决策 | 定位与后端范围（不加第四后端）；方案 D 的骨架（无 Tab、花名册、线程、会话面板、Agent 设置）；免费额度与价格；付费墙触发；YouMind 只做精灵聊天；视觉原则（白底、两层字、颜色只在头像上、自绘导航） | 不能改结论；实现方式可以变通 |
| 实现细节 | 页面里每一行的具体形态与文案、组件选择、卡片样式、状态处理、技术实现、里程碑内部顺序、删除清单里的个别文件、埋点属性 | 可以，记录即可 |

记录方式：`PROGRESS.md` 的「偏离记录」表，每条写位置、原文、改为、理由、影响；最终报告里汇总。不允许的偏离：以「更简单」为由砍掉功能而不记录；改动硬约束；为了绕过验证。

判断不了属于哪一层时，按「实现细节」处理并记录；人早上会看记录，改回来的成本远低于卡住一晚上。

## 三条硬规则

1. **老客户端不能坏。** 已发布的 2.1.x App 在 3.0 的 Relay / Registry / Bridge 上必须原样工作 90 天以上。`tests/compat/` 下的 v1 协议回放测试是所有服务端部署的门槛，任何一次红灯都不允许部署。
2. **成本与安全底线。** 不得在仓库里提交任何密钥；不得放宽 `00-decisions.md` §硬约束里的限速与大小上限；不得新增服务端持久化用户消息的功能。
3. **减法是硬的，行数是目标。** `10-migration-map.md` 里标注删除的文件必须删除，重复与过时的文档必须删除——这两条可验证，不可商量。仓库非测试代码总行数与文档数量**以低于基线为目标**（M0 记录基线到 `PROGRESS.md`；文档计数包含 `docs/3.0`，基线与终值同口径），每个里程碑报告 `metrics:loc`；结束时若高于基线，在 `PROGRESS.md` 里说明增长在哪、为什么、以后能删什么，不算失败。**禁止为了数字作弊**：不得删测试或降低覆盖、不得把多个文件合并成一个、不得压缩排版、不得删除仍然成立的文档、不得砍掉规格要求的功能。

## 工作循环

```
读 PROGRESS.md → 取 08-milestones.md 里第一个未完成的里程碑
→ 通读该里程碑引用的章节 → 实现 → 跑该里程碑的验证命令
→ 全绿 → 更新 PROGRESS.md（完成项、指标、决策、遗留）→ 提交 → 下一个
```

- 验证不过就修，不允许跳过或注释掉测试。
- 不扩大范围：规格没写的功能不做。发现规格有矛盾或明显不对，按「偏离规则」处理并写进 `PROGRESS.md` 的偏离记录，继续做。
- 遇到标记 **HUMAN CHECKPOINT** 的步骤，停下来把需要人做的事写清楚，等待回复；其余一律不问。
- 每个里程碑一个或多个提交，提交信息以 `3.0(M<n>): ` 开头。

## 验证命令速查

| 目的 | 命令 |
|---|---|
| 仓库必需门禁（类型、单测、设计系统、文档） | `npm run check:required` |
| 全量本地测试 | `npm test` |
| 老客户端协议回放（M0 建立，之后每次服务端改动必跑） | `npm run test:compat` |
| Relay 集成测试（需本地 wrangler dev） | `npm run relay:test:integration` |
| Preview 产品级冒烟（真实 Preview 环境） | `npm run relay:test:preview-product` |
| 部署 Preview Relay / Registry | `npm run relay:deploy:preview-worker` / `npm run relay:deploy:preview-registry` |
| 部署 Production Relay / Registry | `npm run relay:deploy:worker` / `npm run relay:deploy:registry` |
| 部署 Hermes 实例（M2 后由同一代码提供） | `npm run relay:deploy:hermes-worker` / `npm run relay:deploy:hermes-registry` |
| Bridge 构建与发布 | `npm run bridge:build` / `npm run bridge:cli:verify-package` / `npm run bridge:publish` |
| 移动端类型检查 / 测试 / 设计系统 | `npm run mobile:typecheck` / `npm run mobile:test` / `npm run mobile:check:design-system` |
| iOS 模拟器运行 | `npm run mobile:sync:native && npm run mobile:dev:ios` |
| Android 模拟器运行 | `npm run mobile:dev:android` |
| 代码行数与文档数报告（M0 新增） | `npm run metrics:loc` |

环境前提（已在这台机器上确认）：`wrangler` 已 OAuth 登录；`apps/relay-worker` 与 `apps/relay-registry` 的 `wrangler.local.toml` 与 `wrangler.preview.local.toml` 在位；`apps/mobile/.env.local`、`apps/bridge-cli/.env.local` 在位。这些文件都在 `.gitignore` 里，绝不提交。

## 无阻塞运行与 HUMAN TODO

这次是通宵一次跑完，**过程中没有任何需要人点头的节点**。凡是只有人能做的事（后台配置、发布凭据、商店提交、真机），实现者把「要做什么、怎么做、验证方法」写进 `PROGRESS.md` 的 **HUMAN TODO** 表，然后**继续做下一件不依赖它的事**。运行的终点是「Preview 环境上的验收清单全部完成（可自动验证的部分打勾，界面与真机部分标为待人）」。次日由人按 `09` §1 做 Production 服务端发布、Bridge 正式发布与商店提交。

| 编号 | 事项 | 实现者的替代动作 |
|---|---|---|
| HT-1 | Cloudflare WAF 四条限速规则与三条告警（`02` §5） | 代码层限速已实现即可继续；把规则原文写进 HUMAN TODO |
| HT-2 | npm 发布 `@p697/clawket` 3.0 | 用 `npm pack` 生成 tarball，Preview 测试用 `npm install -g <tarball>`；正式发布留给人 |
| HT-3 | RevenueCat 后台改终身价格、建实验 | App 侧按 offering 动态读价；沙盒测试用现有商品；配置说明写进 HUMAN TODO |
| HT-4 | Production 服务端部署与老 App 验证 | 不做；Preview 全绿即停 |
| HT-5 | App Store / Play 提交、截图、隐私标签 | 生成商店文案草稿与隐私标签清单到 `PROGRESS.md` |
| HT-6 | 界面与真机验收 | 双端构建通过即可；界面观感与真机验收留给人，实现者只做代码层自检 |

唯一允许中断运行的情况：`tests/compat` 红灯且修不好、或 Preview 部署反复失败。此时把现状写清楚后停止，不要绕过门槛。

## 给实现者的启动指令（复制即用）

```text
目标：按 docs/3.0/README.md 交付 Clawket 3.0，跑到 Preview 环境验收清单全部完成为止。
规则：
1. docs/3.0/00-decisions.md 是产品决策，不要重新讨论；实现细节允许变通，规则见 README 的「偏离规则」。
2. 按 docs/3.0/08-milestones.md 的顺序做；每个里程碑先读 docs/3.0/PROGRESS.md 确认起点，做完跑该里程碑的验证命令，全绿后更新 PROGRESS.md 再进入下一个。
3. 验证不过就修，不跳过、不扩大范围；tests/compat 是服务端部署门槛。
4. 过程中不要问我。只有人能做的事写进 PROGRESS.md 的 HUMAN TODO，然后继续做不依赖它的事。发现规格说错或按规格做会更差，按你认为更好的方式做，并写进 PROGRESS.md 的偏离记录。
5. 界面以 docs/3.0/05-visual-system.md 的 token 与 §11 列出的 youmind-mobile 组件为准；docs/3.0/mockups 只是风格参照，不要照抄。
6. 尽一切办法自测：单测、类型、组件渲染测试、协议回放、集成测试、双端构建；不要做模拟器截图，界面观感与真机验收留给人。
7. 减法：删除清单里的文件必须删；代码行数与文档数量以低于基线为目标，做不到就在 PROGRESS.md 说明原因；不得删测试、合并文件、压缩排版或删仍然成立的文档来凑数字。
```

## 并行轨道

Ultra 模式下可并行的三条轨道，前提是 M1（契约）先完成：

- **轨道 S（服务端与 Bridge）**：M2、M3
- **轨道 A1（App 连接层）**：M4
- **轨道 A2（App 界面）**：M5，用 `agent-protocol` 的 mock 适配器先行

M6 之后回到串行。合并时以 `main` 为基线、`release/3.0` 为集成分支。

## 测试期望

- 每个新模块必须带单元测试；改动既有逻辑必须补回归测试。
- 适配器用录制的真实报文做测试（`tests/fixtures/`），不用手写假数据。
- 传输层的重连状态机、未读水位线、能力矩阵显隐、付费额度都是纯函数或状态机，必须 100% 覆盖分支。
- 不做模拟器截图。界面的视觉检查与真机端到端留给人；实现者的自测是类型、单测、组件渲染测试、协议回放、集成测试，以及 iOS 模拟器构建与 Android debug 构建能编译通过。构建与测试日志放在本地 `docs/3.0/evidence/`（不提交）。
- 实现者要预期：真机首启可能仍有错误，人类会把错误贴回来，届时按报错修，不重构。

## 减法期望

- 删除清单在 `10-migration-map.md`。列在「删除」里的文件必须删除，不得改名保留；这是减法里唯一的硬要求。
- 文档：重复的、过时的、描述已删功能的文档一律删除；`AGENTS.md` 只保留仍然成立的规则，并在每个里程碑同步更新。
- 用 `knip`（或等价工具）在 M7 做一次死代码与死导出扫描，报告写进 `PROGRESS.md`。
