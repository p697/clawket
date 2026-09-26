# 开源可用性与凭据检查（2026-09-25）

## 结论与范围

修复后的源码具备公开协作、无维护者凭据安装、生成工程、构建客户端 JavaScript 和 Bridge 的基本条件。官方发行配置与社区构建已分开。没有在本次扫描范围内发现服务端密钥或签名私钥；这不是对全部历史、二进制资产、线上服务和依赖安全的无限保证。

检查了最初的 1,457 个 Git 跟踪文件、本地所有可达引用的 151 个提交，以及其中 6,563 个历史 blob。使用 Gitleaks 8.30.1 默认规则，输出全部脱敏；另将本机 4 个已配置的 key/secret 值与历史 blob 作精确比对，只报告名称和位置，不输出值。未改写历史、推送、归档、上传、部署、轮换凭据或改变 GitHub 设置。

## 已修复

| 问题 | 修复 |
| --- | --- |
| Xcode Release 强制依赖官方统计、付费和语音配置 | `CLAWKET_OFFICIAL_BUILD=1` 才要求官方集成；社区 Release 可不配置，或接自己的语音服务。官方 EAS profile 和维护者本地环境继续启用严格检查。 |
| Android AAB / EAS 校验混淆社区与官方配置 | 本地 AAB 按环境标记校验；EAS production/testflight 明确要求官方配置，community profile 不继承官方端点。 |
| Apple Team / EAS owner、project 固定在 app.json | 改为环境配置；维护者当前值保留在忽略的本地文件。分发 fork 仍需自己的应用标识、app group、签名和账号。 |
| Speech Wrangler 提交运营账号与专属 Provider 地址 | 跟踪配置改为默认停用的占位模板；原本地配置完整保存为忽略的 `.local.jsonc` 文件。线上未改变。 |
| 防误提交范围不足 | 根目录扩展忽略环境、签名、凭据及 JSONC 本地部署配置。忽略规则不能清理旧提交或阻止强制添加。 |
| 缺少通用密钥扫描 CI | 新增校验下载摘要的固定版本 Gitleaks job，扫描 Git 历史；没有全文件/目录豁免。用随机生成、未签发的模拟 token 验证扫描器会拒绝新密钥。 |
| 安全报告地址、贡献验证步骤和从源码运行文档过时 | 修正安全链接，贡献指南使用自包含 required gate，README 中英同步，按平台生成工程，说明社区及真机签名前置条件。 |
| 文档/fixture 含维护者电脑用户名路径 | 当前受跟踪文本改为通用示例路径；历史提交仍保留原元数据。 |

## 凭据与隐私发现

- 当前源码扫描的 4 项初始告警为配对字符表和测试消息幂等键，均非凭据。规则只豁免这几个精确的合成常量。
- 历史扫描 8 项初始告警包括上述合成常量及初始导入里的 PostHog 客户端 ingestion token。精确比对还找到旧 RevenueCat Apple public SDK key 的历史源码/测试；没有发现本机 YouMind HMAC 值出现在扫描的历史里。
- PostHog ingestion token 与 RevenueCat public SDK key 设计上可在客户端使用，不等同于管理 API key；仍不应将维护者值作为社区默认值，以免混入数据或依赖官方账号。参考 [PostHog API](https://posthog.com/docs/api) 与 [RevenueCat API keys](https://www.revenuecat.com/docs/projects/authentication)。
- Git 历史仍含上述公开 SDK key、旧账号/项目标识、电脑路径及运维记录。清理当前文件不会抹除历史。没有证据支持为了这些非秘密标识擅自重写公共历史。
- **需要单独确认 YouMind 客户端 HMAC 的权限边界**：本机设置了 `EXPO_PUBLIC_YOUMIND_APP_SECRET`，该值会随 App 分发，可以被提取。它未进 Git 不等于它在分发后仍保密。应由服务端确认它仅是公开客户端标识、不能授权特权操作；若它实际承担保密认证，需要独立的协议改造与凭据处置。当前未改动外部 YouMind 服务或破坏既有登录流程。
- Speech 的设备签名、防重放和配额不等于付费账号授权；公开客户端可实现相同协议。官方托管服务的费用边界需要服务端准入机制，不能依赖隐藏 URL 或不开源客户端。
- GitHub 只读检查：仓库公开、许可证为 AGPL-3.0；secret scanning 与 push protection 已开启，当前 secret-scanning alerts 为空。非供应商模式扫描和 private vulnerability reporting 未启用，Dependabot 自动安全更新未启用。公开的邮件渠道仍可报告漏洞；本次未改变设置。

## 验证结果

在 `/tmp` 中复制 Git 跟踪源码（含本次修复），不复制本机 `.env`、签名文件、生成工程或 node_modules：

| 验证 | 结果 |
| --- | --- |
| `npm ci --ignore-scripts --no-audit`，随后 `npm rebuild` 执行安装生命周期 | 通过，独立依赖目录 |
| 空服务配置的 iOS public-config 检查 | 通过，统计、付费、语音均关闭 |
| Expo prebuild（iOS + Android，`--no-install`） | 通过；生成工程，不执行 CocoaPods 安装或原生编译 |
| Bridge 构建 | 通过 |
| 社区 iOS JavaScript / Hermes bundle export | 通过；本地验证产物，未上传 OTA/商店 |
| 配置回归 | 16 项通过，覆盖社区 Release、官方缺配置拒绝、Preview URL 拒绝、Xcode Node 加载、EAS/签名身份注入 |
| 当前工作树 `npm run check:required` | 通过 |
| `npm run test:compat` | 5 文件 / 39 项旧客户端回放通过 |
| 维护者实际 Xcode 环境脚本（精简 PATH） | 通过，正式语音地址与官方标记保留 |
| Gitleaks 当前源码 / 全部本地可达历史，审核最小豁免后 | 通过；原始扫描报告与比对报告仅留本机 |

没有在全新电脑上安装并启动 App，也未在此次审核中完成新生成工程的 iOS/Android 原生编译、真机配对、商店签名或全部第三方资产/许可证溯源。不能把上述结果表述为全平台端到端验收。

## 依赖待办

审计时根锁文件为 33 项 moderate / 1 项 low，Mobile 锁文件为 16 项 moderate；两者均无 high / critical。这是 npm 受影响包节点数，不是独立漏洞数量，两个锁文件之间存在重叠。

直接 advisory 涉及 `decode-uri-component`、`uuid`、Vitest / `@vitest/mocker` 和低危 `esbuild`。部分建议涉及跨主版本甚至 Expo 包降级；本次未自动执行 `npm audit fix --force`。应分别核对可达路径及兼容更新，当前结论不能称为“依赖无漏洞”。详细脱敏 JSON 和验证日志位于本机 `/tmp/clawket-opensource-audit/`，不提交扫描数据或构建产物。
