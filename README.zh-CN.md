<p align="center">
  <img src="./assets/clawket-hero.png" alt="Clawket 3.0 — Agent 列表、聊天与工具调用、Agent 控制台" />
</p>

# Clawket

[![npm version](https://img.shields.io/npm/v/@p697/clawket)](https://www.npmjs.com/package/@p697/clawket)
[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](LICENSE)
[Follow me on X](https://x.com/cavano697)

[English README](./README.md)

**你的 Agent，随时在身边。**

Clawket 是面向 [OpenClaw](https://github.com/openclaw/openclaw) 和 [Hermes Agent](https://github.com/NousResearch/hermes-agent) 的开源 iOS / Android 客户端。在手机上和 Agent 对话、查看工具调用、切换会话，并管理它们的工作。

<table>
  <tr>
    <th>iOS · App Store</th>
    <th>Android · Google Play</th>
  </tr>
  <tr>
    <td align="center"><a href="https://apps.apple.com/app/id6759597015"><img src="./assets/clawket-app-store.png" alt="App Store 下载二维码" width="150" /></a></td>
    <td align="center"><a href="https://play.google.com/store/apps/details?id=com.p697.clawket"><img src="./assets/clawket-google-play.png" alt="Google Play 下载二维码" width="150" /></a></td>
  </tr>
  <tr>
    <td align="center"><a href="https://apps.apple.com/app/id6759597015">App Store ↗</a></td>
    <td align="center"><a href="https://play.google.com/store/apps/details?id=com.p697.clawket">Google Play ↗</a></td>
  </tr>
</table>

图片展示的是全新的 3.0 界面。新版本审核期间，商店中的可下载版本可能有所不同。

## 你可以做什么

- **把 Agent 放在一起。** 在同一列表查看不同连接中的 Agent、最近动态，并快速进入对话。
- **看清每一步工作。** 流式回复和详细的工具调用直接呈现在对话中。
- **带着上下文切换会话。** 查找和继续已有会话；后端支持时，也能查看来自 Slack、Telegram 等渠道的会话。
- **在 Agent 控制台中管理。** 查看用量，进入模型、Skill、定时任务和设置；只展示当前后端支持的能力。
- **自由选择连接方式。** 通过 Relay 远程访问，或使用局域网、Tailscale、自定义端点直连，也可以自建基础设施。
- **使用熟悉的语言。** 支持 19 种界面语言、浅色与深色主题，以及配合可选转写服务的语音输入。

Clawket 连接的是你自己运行的 Agent，需要先安装 OpenClaw 或 Hermes。具体工具和管理功能取决于所连接的后端。

## 开始连接

通过上方商店链接安装 App。在运行 Agent 的电脑上安装 Bridge CLI（需要 Node.js 20.3+）：

```bash
npm install -g @p697/clawket
clawket pair
```

在 Clawket 中扫描生成的二维码。CLI 会检测已安装的后端，为每个后端分别生成带标签的配对结果。默认使用 Relay；Hermes 配对时也会尝试启动由 Clawket 管理的 Bridge 和 Relay runtime。

如果希望通过本地网络直连：

```bash
clawket pair local
```

添加 `--backend openclaw` 或 `--backend hermes` 可指定后端。使用 `clawket status`、`clawket doctor` 和 `clawket logs` 查看连接状态与诊断信息。

## 从源码运行

本仓库使用 **Node.js 22.x** 和 npm。iOS 开发需要 macOS 与 Xcode；Android 开发需要 Android Studio 及其 SDK。

```bash
npm install
npm run mobile:sync:native
npm run mobile:dev:ios
# Android 则运行：
npm run mobile:dev:android
```

可选的公开配置见 [`apps/mobile/.env.example`](./apps/mobile/.env.example)。复制到 `apps/mobile/.env.local` 后即可配置自己的构建。服务商密钥应保留在服务端，不要放入 `EXPO_PUBLIC_*`。

```bash
npm run mobile:config:show
npm run mobile:config:check
```

也支持连接 llama.cpp、Ollama 和 OpenAI 兼容服务提供的本地模型。配置方法与当前限制见[本地模型指南](./docs/3.0/15-local-model.md)。

## 连接方式与自托管

**Relay 模式**下，Registry 负责配对，Relay 在 App 与 Bridge 之间转发实时 WebSocket 流量，Agent 仍运行在你自己的电脑上。**直连模式**下，App 通过局域网、Tailscale 或自定义地址访问后端，不需要 Relay 基础设施。

你可以自行构建移动端并部署服务。OpenClaw 与 Hermes 共用 Relay 实现，但使用独立的服务、存储和配对凭据。

- [自托管指南](./docs/self-hosting.md)
- [Relay 配置](./docs/relay/CONFIGURATION.md)
- [Relay 本地开发](./docs/relay/LOCAL-DEVELOPMENT.md)
- [Relay 架构](./docs/relay/ARCHITECTURE.md)

## 隐私与可选集成

Relay 转发流量，不持久化消息正文。App 在本机缓存消息，删除连接时会清除对应缓存。Agent 后端和模型服务商各自的数据处理规则仍适用。

源码构建可以不配置以下集成，也可以配置自己的服务：

| 组件 | 用途 |
| --- | --- |
| PostHog | 基础使用统计与诊断；分析事件不包含对话正文和提示词。留空统计配置即可关闭。 |
| RevenueCat | 管理商店订阅。未配置的源码构建跳过订阅计费，并开放 Pro 功能。 |
| 阿里云语音服务 | 使用云端语音输入时将音频转写为文字。配置独立的语音服务端点后启用，服务商密钥仅保留在服务端。 |

这些组件与 Agent 连接能力相互独立。详见[配置示例](./apps/mobile/.env.example)和[语音服务说明](./docs/3.0/22-voice-input.md)。商店发行版使用其已配置的集成，相关说明见[隐私政策](https://clawket.ai/privacy)。

## 仓库结构

| 路径 | 用途 |
| --- | --- |
| `apps/mobile` | Expo / React Native 移动端 |
| `apps/bridge-cli` | 发布到 npm 的 `@p697/clawket` CLI |
| `apps/relay-registry` | 配对 Registry Worker |
| `apps/relay-worker` | WebSocket Relay Worker |
| `apps/speech-worker` | 独立的云端语音转写服务 |
| `packages/agent-protocol` | 共享的后端契约与能力定义 |
| `packages/bridge-core` | 配对、配置与服务管理工具 |
| `packages/bridge-runtime` | Bridge 运行时 |
| `packages/relay-shared` | Relay 共享协议与类型 |

## 参与贡献

请阅读 [CONTRIBUTING.md](./CONTRIBUTING.md)。提交代码变更前运行仓库必需检查：

```bash
npm run check:required
```

真实服务与发布集成检查有单独的前置条件，见贡献指南和对应工作区文档。安全问题请按 [SECURITY.md](./SECURITY.md) 中的方式报告。

## 许可证

除子目录另有声明外，本仓库采用 [AGPL-3.0-only](./LICENSE) 许可证。
