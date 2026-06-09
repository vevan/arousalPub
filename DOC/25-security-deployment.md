# 安全部署与硬化 — 定案与实现参考

> **状态（2026-06）**：**已实现**（§2–§10；messages 分页仍待 `DOC/15`）。  
> **读者**：部署者、后续改 auth / 出站 / 插件的开发者。  
> **关联**：`DOC/17`（运维台 loopback）、`DOC/13`（API Key 隔离）、`DOC/24`（审计与 `customParams`）、Codex 2026-06 安全审计。

---

## 1. 威胁模型

| 部署形态 | 主要风险 |
|----------|----------|
| **本机单用户**（`127.0.0.1`） | 低；本地 Ollama 等私网 upstream 为正常用法 |
| **局域网**（`0.0.0.0` + 手机/另一台电脑） | 抢装、开放注册、暴力登录、LAN 内未授权访问 |
| **误暴露公网**（端口转发 / 反代） | 上述 + SSRF、CORS 任意 Origin、插件路径穿越 |

硬化项按**可配置**设计：默认尽量兼容现有单机用法；暴露部署时显式收紧 `config.json`。

---

## 2. `config.json` 字段

`config.json` / `config.example.json` 支持 **JSONC 行注释**（`// …`），服务端解析前会自动剥离（`server/src/config-jsonc.ts`）。可在行尾写说明，例如：

```jsonc
"allowPublicRegister": true, // 开放公共注册
```

仍可用顶层 `"_comment"` 字段写长说明（会读入配置对象，但不影响逻辑）。

| 字段 | 默认 | 说明 |
|------|------|------|
| `host` | `0.0.0.0` | **监听地址**（bind），不是客户端白名单。见 §3。 |
| `clientWhitelist` | `[]`（空=不限制） | 客户端源 IP 白名单（SillyTavern 风格 `*` 通配）。非空时**全局**校验 `request.ip`。 |
| `allowPublicRegister` | `true` | `false` 时 `POST /api/auth/register` 返回 `403`；开户改走 `POST /api/admin/users`（`DOC/17`）。 |
| `corsOrigins` | `[]` | 允许的浏览器 `Origin` 列表。空=仅放行无 `Origin` 的请求（同源/curl）；**不再** `origin: true`。 |
| `upstreamUrlPolicy` | `"open"` | `"open"`：允许 `127.0.0.1`/私网（本地 Ollama）。`"public-only"`：出站 `baseUrl` 禁止 loopback/私网/链路本地（多用户暴露部署）。 |

环境变量（可选覆盖）：`CLIENT_WHITELIST`（逗号分隔）、`ALLOW_PUBLIC_REGISTER=0|1`、`CORS_ORIGINS`（逗号分隔）、`UPSTREAM_URL_POLICY=open|public-only`。

**loopback 保底**：`clientWhitelist` 非空时，`127.0.0.1` / `::1` / `::ffff:127.0.0.1` **始终允许**（防配错锁死本机）。

---

## 3. `host` 与 `clientWhitelist`

```text
host: "0.0.0.0"     → 在所有网卡上监听（Docker/LAN 常见）
clientWhitelist      → 连上以后，源 IP 是否在名单内
```

示例（家中 LAN + Tailscale，与 SillyTavern 类似）：

```json
{
  "host": "0.0.0.0",
  "clientWhitelist": [
    "::1",
    "127.0.0.1",
    "192.168.0.*",
    "192.168.1.*",
    "100.*.*.*"
  ]
}
```

| 访问方式 | 源 IP | whitelist | setup（§4.1） | admin（DOC/17） |
|----------|-------|-----------|----------------|-----------------|
| 本机 `http://127.0.0.1` | loopback | ✅ | ✅ | ✅ |
| 手机 `http://192.168.1.x` | LAN | ✅（若在名单） | ❌ 仅 loopback | ❌ 仅 loopback |
| 公网扫端口 | 公网 IP | ❌（若未写入名单） | — | — |

**Docker**：宿主机访问容器时源 IP 常为 `172.x` 网桥，需加入 whitelist 或使用 `network_mode: host`（见 `docker-compose.yml` 注释）。

**反代**：默认**不信任** `X-Forwarded-For`（与 `DOC/17` 一致）。仅在明确配置 `trustProxy` 后才用代理头解析客户端 IP（后续扩展）。

---

## 4. 认证与限流

### 4.1 首次设置 — 仅 loopback

`POST /api/auth/setup` 除全局 `clientWhitelist` 外，**必须** `isLoopbackAddress(request.ip)`，否则 `403 setup_localhost_only`。

`GET /api/auth/status` 仍公开（前端需知 `setupRequired`）。

### 4.2 公开注册开关

`allowPublicRegister: false` → `POST /api/auth/register` → `403 public_register_disabled`。

### 4.3 按 IP 限流（内存滑动窗口）

| 路由 | 限额（每 IP） |
|------|----------------|
| `POST /api/auth/setup` | 10 次 / 15 分钟 |
| `POST /api/auth/register` | 10 次 / 15 分钟 |
| `POST /api/auth/login` | 30 次 / 15 分钟 |
| `POST /api/auth/refresh` | 60 次 / 15 分钟 |
| `POST /api/api-keys/:id/reveal` | 10 次 / 15 分钟 |

超限 → `429 auth_rate_limited`。密码策略保持 **≥6 位**（不变）。

---

## 5. 插件 ID 与路径

- **ID 格式**：`^[a-z0-9][a-z0-9-]{0,63}$`（与 bundled 插件一致）。
- **路径**：`getInstalledPluginDir` 解析后 `path.resolve` 必须仍在 `data/plugins/` 下。
- **注册表**：`registry.plugins[].id` 须与对应 `manifest.json` 的 `id` **一致**（`PUT /api/plugins/registry` 与加载时校验）。

---

## 6. `customParams` — 保护字段黑名单

`customParams` **不得**覆盖下列顶层键（浅合并时跳过）：

`messages`, `model`, `stream`, `input`, `prompt`, `tools`, `tool_choice`

合并顺序：

```text
结构化采样字段 → mergeCustomParams（跳过保护键）→ 强制 stream / thinking（与 requestReasoning、插件路径一致）
```

UI 文案：仅补充网关扩展参数（如 `stop`），不可改 `messages`/`model`。

审计（`DOC/24`）：记录**最终**出站 payload 或与其一致的摘要。

---

## 7. CORS

- 废除全局 `origin: true`。
- `corsOrigins: []`：无 `Origin` 头的请求放行；带 `Origin` 且不在列表 → 浏览器 CORS 失败。
- dev：在 `config.json` 增加 Vite 源，如 `http://localhost:6699`、`http://127.0.0.1:6699`。

---

## 8. 出站 URL（SSRF）

`upstreamUrlPolicy`:

| 值 | 行为 |
|----|------|
| `open`（默认） | 允许 `http://127.0.0.1:11434` 等本地推理服务 |
| `public-only` | 拒绝 loopback、RFC1918、链路本地、`169.254.169.254`、**纯数字主机名（十进制 IP）** 等；仅 `http:`/`https:` |

用于：`resolveChatCredentials`、`POST /api/models`、embedding、`plugin-complete` 等一切服务端 `fetch(baseUrl)`。

**重定向**：`public-only` 下 `fetchWithTimeout` 改用手动跟随（最多 5 跳），每一跳目标 URL 均重新校验；私网/非法目标返回 `502`（`upstream_url_*`）。`open` 策略仍使用原生 `fetch` 默认重定向。

**已知限制**：DNS 重绑定、连接时 IP 与校验时不一致等高级 SSRF 未覆盖；反代场景见 §11 `trustProxy`。

---

## 9. 上游超时

统一 `fetchWithTimeout`（`AbortSignal.timeout`）：

| 用途 | 默认超时 |
|------|----------|
| chat 非流式 / models / embedding / plugin complete | 120s |
| chat SSE 上游连接 | 300s |

客户端断开**不保证**立刻终止上游（已知限制）；超时后释放服务端连接。

---

## 10. 聊天富文本

- DOMPurify **禁止** `<style>` 标签（从 `ADD_TAGS` 移除）。
- 完整 HTML 文档解析时**剥离** `head` 内 `<style>`，避免模型输出污染整页 UI。
- 仍允许常见内联标签；脚本类 XSS 继续由 DOMPurify 剔除。

---

## 11. 刻意暂缓

| 项 | 说明 |
|----|------|
| messages 默认分页 | `DOC/15` S2–S4；非安全缺陷 |
| `trustProxy` 全自动 | 需与反代文档一并设计 |

---

## 12. 推荐硬化配置（暴露 LAN）

```json
{
  "host": "0.0.0.0",
  "clientWhitelist": ["::1", "127.0.0.1", "192.168.0.*", "192.168.1.*"],
  "allowPublicRegister": false,
  "corsOrigins": [],
  "upstreamUrlPolicy": "public-only"
}
```

仅本机：

```json
{
  "host": "127.0.0.1",
  "allowPublicRegister": false
}
```

---

## 13. 文件速查

| 区域 | 路径 |
|------|------|
| 配置读取 | `server/src/config.ts` |
| 客户端 IP / loopback | `server/src/client-ip.ts` |
| 认证限流 | `server/src/auth-rate-limit.ts` |
| 认证路由 | `server/src/auth.ts` |
| 全局 IP / 插件 ID 钩子 | `server/src/index.ts`（`clientWhitelist`、`preHandler`） |
| 插件 ID | `server/src/plugin-system/plugin-id.ts`、`paths.ts` |
| customParams | `server/src/custom-params-merge.ts` |
| 出站 URL | `server/src/upstream-url-guard.ts` |
| fetch 超时 | `server/src/fetch-with-timeout.ts` |
| 富文本 | `web/src/utils/render-rich-message.ts` |

---

## 14. 修订记录

| 日期 | 说明 |
|------|------|
| 2026-06 | 初版：汇总 Codex 审计定案 + ST 式 clientWhitelist + customParams 黑名单 |
| 2026-06 | 二轮：`public-only` 重定向逐跳校验、十进制 IP 拒绝、插件路由 `invalid_plugin_id`、JSONC 配置注释 |
