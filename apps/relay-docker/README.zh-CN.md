# Clawket 自托管 Relay（Docker）

`relay-docker` 是 Clawket relay 栈的 Docker 自托管部署方式。它把 registry HTTP API 和 relay WebSocket 服务放进同一个 Node.js 进程里运行，共享一套进程内 KV，并可选用 SQLite 做持久化。

## 这套部署实际支持什么

- 一个逻辑部署单元：一个 registry + 一个 relay 进程。
- 可以通过 `RELAY_REGION_MAP` 暴露多个公网 relay URL，但这些 URL 最终都必须回到同一套部署。
- 当 `KV_PERSIST_PATH` 指向可写的 SQLite 文件时，配对记录可持久化。

它不提供跨节点协调、分布式房间所有权，也不提供多实例之间的 token 传播。

## 快速开始

### 1. 配置环境变量

```bash
cp .env.example .env
# 按你的域名和持久化路径修改 .env
```

### 2. 构建并运行

```bash
docker compose up -d --build

docker compose logs -f

curl http://localhost:3001/v1/health
curl http://localhost:3002/v1/health
```

仓库里的 `docker-compose.yml` 默认会直接从当前代码构建镜像，保证容器运行的就是你正在审阅和修改的这份代码。

### 3. 配置 nginx

复制 `nginx.conf.example`，把 `registry.example.com` 和 `relay.example.com` 替换成你的真实域名。relay 域名只暴露：

- `GET /v1/health`
- `WS /ws`

## 架构

```
┌─────────────────────────────────────────────┐
│           Single Node.js Process            │
│                                             │
│  Registry HTTP API (:3001)                  │
│  ├── POST /v1/pair/register                 │
│  ├── POST /v1/pair/access-code              │
│  ├── POST /v1/pair/claim                    │
│  ├── GET  /v1/verify/:gatewayId             │
│  └── GET  /v1/health                        │
│                                             │
│  Relay WebSocket Server (:3002)             │
│  ├── WS   /ws                               │
│  └── GET  /v1/health                        │
│                                             │
│  Shared MemoryKV (+ optional SQLite)        │
│  Room Manager (one room per gatewayId)      │
└─────────────────────────────────────────────┘
```

## 安全说明

- relay 不再暴露 HTTP token 同步接口。registry 和 relay 直接共享同一份进程内 KV 状态。
- registry 的 JSON 请求体做了硬限制，因为它只接受很小的配对请求。
- 如果设置了 `KV_PERSIST_PATH`，但 SQLite 不能打开或写入，服务会立即启动失败或请求失败，而不是悄悄退化成纯内存模式。

## 环境变量

完整说明见 [`.env.example`](.env.example)。

关键变量：

| 变量 | 默认值 | 说明 |
|---|---|---|
| `REGISTRY_PORT` | `3001` | Registry API 端口 |
| `RELAY_PORT` | `3002` | Relay WebSocket 端口 |
| `RELAY_URL` | `ws://localhost:3002/ws` | 对外提供的 relay WebSocket URL |
| `RELAY_REGION_MAP` | _(空)_ | 当前这套部署的可选 region → 公网 WebSocket URL 映射 |
| `KV_PERSIST_PATH` | _(空)_ | 持久化配对记录的可写 SQLite 路径 |

## 与 Cloudflare 部署的差异

| 功能 | Cloudflare | Docker |
|---|---|---|
| KV 存储 | Cloudflare KV | 进程内内存 + 可选 SQLite |
| 房间状态 | Durable Objects | 单进程内存 |
| WebSocket | Hibernatable WS | `ws` 库 |
| 扩展方式 | 边缘平台 / 多区域原语 | 单部署单元 |
| Region 判定 | `request.cf.country` | `X-Real-Country` 请求头 |
| 心跳 | DO alarms | `setTimeout` alarm |

## 持久化

设置 `KV_PERSIST_PATH` 时：

- 配对记录可以跨进程重启保留。
- 活跃 WebSocket 连接会在重启时断开，客户端需要重连。
- 如果 SQLite 文件无法打开，启动会直接失败。

不设置 `KV_PERSIST_PATH` 时：

- 服务以纯内存模式运行。
- 进程重启后所有配对状态都会丢失。

## 开发

```bash
npm install

npm run --workspace=@clawket/relay-docker dev
npm run --workspace=@clawket/relay-docker typecheck
npm run --workspace=@clawket/relay-docker build
```
