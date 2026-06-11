# 本机运维台（Admin Console）— 实现方案

> **状态**：**已实现**（Phase 1 + Phase 2，2026-06）  
> **优先级**：P1（见 `DOC/04-TODO.md`）  
> **定案（用户确认）**：**仅本机可访问**；**初始用户 `00000000`（种子账号）即管理员**，不引入 `role` 字段。  
> **关联**：`server/src/short-id.ts`（`RESERVED_USER_ID`）、`users-index.ts`、`DOC/25` §15.2 密钥轮换。

---

## 1. 目标

在**同一 Fastify 端口**上提供轻量运维能力，供部署者在本机管理实例，而不扩展主 Vue SPA 权限模型。

| 能力 | 说明 |
|------|------|
| 用户管理 | 列表、创建、删除（非自助）、查看各用户磁盘占用 |
| 密钥轮换 | 手动触发 `DOC/25` §15.2 DEK 重加密（维护模式 + 进度） |
| 扩展位 | 健康检查、插件/registry 只读、审计日志等 |

**非目标**：外网运维、多管理员角色、完整 RBAC、替代 Syncthing 控制台。

---

## 2. 安全模型（双因子）

访问 `/admin` 与 `/api/admin/*` **同时**满足：

### 2.1 本机来源（网络层）

请求来源 IP 须为 **loopback**：

- `127.0.0.1`
- `::1`
- `::ffff:127.0.0.1`（IPv4-mapped）

实现：`isLoopbackAddress(request.ip)`（注意 Fastify `trustProxy` 配置，避免伪造 `X-Forwarded-For`；默认不信任代理）。

不满足 → **`403 admin_localhost_only`**（不区分存在与否，避免探测）。

**使用约定**：运维页须通过 **`http://127.0.0.1:<port>/admin`** 或 **`http://localhost:<port>/admin`** 打开（二者等价为 loopback 连接）。若用局域网 IP（如 `http://192.168.x.x`）即使用户在本机浏览器，TCP 源地址通常**不是** loopback，会被拒绝——这是预期行为。

**FAQ · `localhost` 是否支持？**  
支持。浏览器访问 `localhost` 时，系统解析为 `127.0.0.1` 或 `::1`，服务端 `request.ip` 落在 loopback 白名单即放行。校验依据是 **socket 源 IP**，不是 `Host` 头（`Host: localhost` 不能单独作为凭据，防伪造）。

可选配置（后续）：`config.json` → `adminAllowLanLoopback: true` **不做**，保持简单。

### 2.2 管理员身份（应用层）

- **管理员** ≡ 当前 JWT 的 `sub === RESERVED_USER_ID`（`00000000`）
- 须 `setupComplete === true`（完成首次 `/api/auth/setup`）
- 其它用户即使在本机登录 → **`403 admin_seed_user_required`**

不新增 `users.index` 的 `role` 字段；种子 id 恒定、注册逻辑已禁止分配 `00000000`。

### 2.3 与公开注册

已实现（**`DOC/25-security-deployment.md`** §4.2）：

- `config.json` → `allowPublicRegister: false` 时关闭 `POST /api/auth/register`，仅 `POST /api/admin/users` 开户
- 默认 `true`，暴露 LAN/公网时建议显式关闭

---

## 3. 路由与静态资源

```text
GET  /admin              → 极简 HTML（或 admin/index.html）
GET  /admin/*            → 静态资源（若拆分 js/css）
/api/admin/*             → JSON API（本机 + 00000000 JWT）
```

主 Vue SPA（`/`）**不**承载运维 UI；种子用户登录主站后展示「本机运维」超链接，URL 由**服务端**生成（见 §2.4），仍须在本机打开该链接才能通过双因子校验。

### 2.4 运维入口 URL（`process.env` / 监听端口）

主站**不要**写死端口或拼 `window.location`（dev 下主站端口 ≠ 后端端口）。由 server 在 `GET /api/auth/status`（或 bootstrap）返回：

```ts
adminConsoleUrl: `http://127.0.0.1:${resolveServerPort()}/admin`
```

`resolveServerPort()` 与现网一致：`process.env.PORT` / `SERVER_PORT` → `config.json` `serverPort` → 默认（`server/src/config.ts`）。dev 时 `run-dev.mjs` 注入的 `PORT` 与 Vite 的 `webPort` 分离，链接自动指向**后端端口**；prod 单端口时与主站同源仅路径不同。

仅当 `sub === 00000000` 时前端展示该链接（字段可始终返回，由 UI 决定是否显示）。

实现位置建议：

- `server/src/admin/` — 中间件、`routes.ts`、`localhost.ts`
- `server/src/admin-console/` 或 `server/public/admin/` — 单页 HTML
- `registerAdminConsole(app)` 在 `index.ts` 于 `registerAuth` 之后注册

---

## 4. API 草案（Phase 1）

均需：`isLoopback` + `sub === 00000000` + 有效 JWT。

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/admin/status` | 本机可达、当前是否管理员、data 路径、DEK 是否配置 |
| GET | `/api/admin/users` | 用户列表（`publicUser` + `setupComplete` + `createdAt`） |
| GET | `/api/admin/users/:id/stats` | 复用 `getUserStorageStats`；可扩展分项 |
| POST | `/api/admin/users` | `{ username, password, displayName? }` → `registerUser` |
| DELETE | `/api/admin/users/:id` | 删用户 + `data/{id}/`；不可删 `00000000` |
| POST | `/api/admin/users/:id/password` | 重置密码（无需旧密码）；可选 `revokeAllSessionsForUser` |

错误码（示例）：`admin_localhost_only`、`admin_seed_user_required`、`admin_cannot_delete_seed`。

---

## 5. API 草案（Phase 2 · 密钥轮换）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/admin/crypto/rotate-data-key` | Body：`{ newKeyMaterial, confirm: true }`；旧钥从当前 `resolveDataEncryptionKey()` |
| GET | `/api/admin/crypto/rotate-data-key/status` | 轮询或 SSE：`{ phase, done, total, errors[] }` |

流程：

1. 置全局**写锁**（拒绝 `/api/chat` PUT、settings 写等，或 503 `maintenance`）
2. 遍历各用户 `api-keys.json`、`api-settings.json`、`user-preferences.json` 重加密
3. 成功 → 更新 `data/.data-encryption-key` 或提示改环境变量
4. 释放写锁

**仅手动触发**；无定时轮换。

---

## 6. 运维页 UI（轻量）

单页、无 Vuetify：

- 顶栏：当前登录名、须为种子用户提示、退出
- **用户**：表格（用户名、id、占用、对话数、创建时间）+ 新建 / 删除
- **存储**：点击用户展开 `stats` 明细
- **密钥**：轮换表单 + 进度条（Phase 2）
- 未登录 → 跳转主站登录或内嵌最小登录表单（`POST /api/auth/login` 后带 JWT 调 admin API）

认证：与主站共用 JWT（`localStorage` / cookie 同源 `127.0.0.1`）。若主站用局域网 origin 登录，token 在 `127.0.0.1` 下可能不共享——文档要求**登录与运维均用 127.0.0.1**。

---

## 7. 实施顺序

| 步骤 | 内容 | 验收 |
|------|------|------|
| S1 | `isLoopbackAddress` + `requireAdminConsole` 中间件 | 局域网 IP 访问 `/api/admin/status` → 403 |
| S2 | Phase 1 API + 种子用户校验 | `00000000` 本机可列用户；其它用户 403 |
| S3 | `/admin` 静态页 + 用户 CRUD UI | 本机创建/删除用户、看占用 |
| S4 | `rotate-data-key` job + 写锁 + UI（`DOC/25` §15.2） | 轮换后 chat 仍可用 |
| S5 | `DOC/04`、`cursor.md`、`data/README.md` | — |

---

## 8. 验收标准

- [ ] 非 loopback 访问 `/admin` 与 `/api/admin/*` 一律 403
- [ ] 本机非 `00000000` 用户 JWT → 403
- [ ] 本机 `00000000` 可列全员 stats、创建/删除其它用户
- [ ] 不可删除 `00000000`
- [ ] 主站 Vue 功能与权限不变；无 `role` 字段

---

## 9. 风险

**FAQ · 把 `data/` 下自己的目录改名为 `00000000` 能否绕过管理员校验？**  
**不能。** 管理员判定看 **JWT 的 `sub`**（登录时由 `users.index.json` 里的 `user.id` 签发），**不看**磁盘目录名。用户 `a1b2c3d4` 登录后 `sub` 仍是 `a1b2c3d4`，改文件夹只会导致：

- 该用户读写落到 `data/a1b2c3d4/`（目录不存在则像新号），**拿不到**种子用户数据；
- 可能污染真正的 `data/00000000/`（与种子用户数据混在一起），属于**破坏/串数据**，不是提权。

真正能冒充 `00000000` 的路径是 **篡改 `users.index.json`**（或偷种子账号密码在本机 loopback 登录），属于**已有磁盘写权限**的威胁，超出「仅改文件夹名」范畴。

| 风险 | 缓解 |
|------|------|
| 用户用 LAN IP 开浏览器以为「本机」 | 文档 + 页内提示「请用 127.0.0.1 或 localhost」 |
| 手改 `users.index` 换 id | Syncthing 单写者；运维台仅本机；可选校验 seed 用户名唯一 |
| 反向代理把 admin 暴露到外网 | 默认不信任 `X-Forwarded-For`；不在公网反代 `/admin` |
| 种子密码弱 | setup 时仍须强密码；运维台不降低主站安全 |
| 轮换中途失败 | 写锁 + 旧钥重试；job 日志 |
