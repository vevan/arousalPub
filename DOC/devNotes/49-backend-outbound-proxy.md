# 49 · 后端出站代理

## 目标与边界

后端主进程支持通过 HTTP(S) 代理访问模型 API、Embedding API 和词典下载等外部资源。浏览器到后端的请求不受影响；插件 Worker 仍禁止原始 `fetch` / `undici` 访问，只能经 Host API 出站。

## 运行时基线

- 最低 Node.js：`24.14.0`。
- 使用 Node 内置 `http.setGlobalProxyFromEnv()`，不引入第三方代理客户端。
- 代理一次性在后端启动时初始化；修改 `config.yaml` 后需重启。

## 配置

```yaml
enableProxy: true
proxyUrl: http://127.0.0.1:15888
proxyNoProxy:
  - localhost
  - 127.0.0.1
  - ::1
```

| 字段 | 默认值 | 说明 |
|------|--------|------|
| `enableProxy` | `false` | 后端出站代理的唯一启停开关 |
| `proxyUrl` | 示例地址 | HTTP 与 HTTPS 目标共用的代理 URL |
| `proxyNoProxy` | 本机地址列表 | 可选的直连规则列表 |

`enableProxy` 缺省或为 `false` 时不安装全局代理；即使进程继承了 `HTTP_PROXY`、`HTTPS_PROXY` 或 `NO_PROXY`，也不会自动启用。`enableProxy: true` 时必须提供合法的 `http://` 或 `https://` URL；当前不支持 SOCKS URL。

代理 URL 可以包含 Basic Auth 凭据，但 `config.yaml` 应按敏感运维配置保护，避免提交到版本库或开放给非管理员读取。

Docker Compose 会把项目根目录的 `config.yaml` 只读挂载到容器 `/app/config.yaml`。启动容器前应先从 `config.example.yaml` 复制并修改该文件。容器访问宿主代理通常需将 `127.0.0.1` 换成 `host.docker.internal`；Linux 还需配置 `host-gateway` 或使用宿主可达 IP。

## 安全与失败语义

- 日志只记录 HTTP / HTTPS / NO_PROXY 是否启用，不记录 URL 和凭据。
- 开关、URL 或直连列表格式无效时后端启动失败，不静默回退到直连。
- 实现向 Node 传入独立构造的代理环境，不修改 `process.env`，也不受宿主代理变量影响。
- 上游目标仍由 `UPSTREAM_URL_POLICY` 检查；`public-only` 仍在请求和每次重定向前校验 URL。
- `public-only` 是 URL 层检查；使用远程代理时 DNS 由代理侧解析，还需依赖代理的网络策略阻止绕回私网。
- 代理运行时可看到出站元数据；若代理终止 TLS，还可能看到明文内容，应只使用可信代理。

## 覆盖范围

`setGlobalProxyFromEnv()` 在后端主进程中同时接管全局 `fetch`、`http.request` 和 `https.request`，因此覆盖：

- 聊天、模型列表、Embedding 和插件补全的 `fetchWithTimeout`。
- Hybrid FTS 词典下载的直接 `fetch`。
- 后续在主进程使用 Node 全局 HTTP 客户端的功能。

## 验收

- `enableProxy` 缺省或为 `false` 时不替换全局 Agent / Dispatcher。
- `enableProxy: true` 时全局 `fetch` 经配置代理到达。
- HTTP 与 HTTPS 目标共用 `proxyUrl`，`proxyNoProxy` 命中时直连。
- 无效配置快速失败，日志和错误不泄露代理凭据。
- 现有完整测试、类型检查和生产构建通过。
