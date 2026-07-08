# 通知中心 — 设计定案（规划）

> **状态**：**规划 · 未实现**（2026-07）· **优先级 P0**（[`DOC/04`](04-TODO.md) §通知中心 · NC0–NC-V）。  
> **关联**：`DOC/04` P0 · `DOC/10` §4.4 `host.ui` · `DOC/18` §3.9 · `web/src/plugins/create-plugin-web-host.ts`

---

## 1. 背景与目标

### 1.1 现状

| 能力 | 实现 | 局限 |
|------|------|------|
| `host.ui.toast` | Vuetify snackbar · 自动消失 | 无持久化、无历史、无已读 |
| `host.ui.notify` | **当前等同 toast**（`title + body` 合并为一行 snackbar） | `PluginNotifyOptions.persistent` 已预留但未落地 |
| 插件 / 宿主各模块 | 分散调用 toast | 无统一队列、优先级、去重 |

用户无法回顾「刚才发生了什么」；插件长任务完成、导入结果、后台摘要失败等 **适合持久化** 的消息与 **瞬时 toast** 混在同一通道，难以管理。

### 1.2 目标

引入 **通知中心（Notification Center）** 模块，作为全产品 **唯一通知出口**：

1. **统一 API**：**仅 `notify`** — 每条通知 **必先** 写入通知中心（未读）；是否同时弹 snackbar 由 `opts.snackbar` 控制（见 §4.2）  
2. **持久化存储**：按 **用户 + 浏览器** 写入 **`localStorage`**；支持 **已读 / 未读**、**删除**、可选过期  
3. **界面**：通知列表（未读角标、筛选、批量已读/删除）；snackbar 为可选即时层，**不可**作为唯一出口（切换 Tab、离开片刻即漏看）

**产品定案（2026-07-08）**：

- **仅 `host.ui.notify`** — **删除** `toast` API 与类型，**不做**兼容别名或转发 shim；全库调用点直接改为 `notify`（NC0 / NC5）。
- **`opts.snackbar` 默认 `true`** — 常规通知同时弹浮层；**静默**须显式 `snackbar: false`。
- 移除 `PluginNotifyOptions.persistent` 等历史预留字段。

---

## 2. 能力边界（定案方向）

| 项 | 定案 |
|----|------|
| 作用域 | **用户级 · 浏览器本地** — 键名 **`arousal-notifications-{userId}`**（对齐 `arousal-composer-draft` 等 `arousal-*` 前缀惯例） |
| 存储介质 | **`localStorage` 单键 JSON**（`{ schemaVersion, unreadCount, items: NotificationRecord[] }`）；**不写** Server 用户 data 目录 |
| 发送 API | **仅 `notify`**；**无** `toast` |
| snackbar | `opts.snackbar` 默认 **`true`**（弹浮层 + 写中心）；**静默**须显式 **`snackbar: false`**（仅角标/列表） |
| 已读规则 | 列表内 mark read · 批量已读；**snackbar 上任意互动按钮**（关闭 / 自定义操作）点击 → **标已读**；仅超时自动消失 → **保持未读** |
| 与 chat-audit | **正交**；通知中心不存完整 prompt，仅存摘要文案与跳转链接 |
| 插件 | 经 `host.ui.notify` / `notificationCenter` API；**禁止**插件直读写 `localStorage` |
| 登出 | 随 `clearUserSessionLocalStorage()` 清除（`arousal-notifications-*` 不在 `PRESERVED_LOCAL_STORAGE_KEYS` 内） |
| 跨设备 / 跨 Tab | v1 **不** Syncthing、**不** Server 落盘；同浏览器多 Tab 可经 **`storage` 事件** 同步角标与列表；换设备/换浏览器 **不** 同步历史 |

---

## 3. 数据模型（初稿）

```ts
type NotificationId = string  // uuid

type NotificationRecord = {
  id: NotificationId
  createdAt: string            // ISO
  readAt?: string | null       // null / 缺失 = 未读
  title: string
  body?: string
  level?: 'info' | 'success' | 'warning' | 'error'
  source?: {
    kind: 'core' | 'plugin'
    pluginId?: string
  }
  /** 点击通知后的导航（可选）；列表项点击或 snackbar 操作按钮可触发 */
  action?: {
    type: 'route' | 'conversation' | 'settings-tab' | 'external'
    href?: string
    conversationId?: string
    settingsTab?: string
  }
  /** snackbar 浮层上的操作按钮（可选）；任一点击 → markRead(id) 并执行 action */
  snackbarActions?: Array<{
    label: string
    /** 缺省 = 仅关闭浮层并标已读 */
    action?: NotificationRecord['action']
  }>
  /** 同 source + 同 dedupeKey 在窗口内合并为一条（可选） */
  dedupeKey?: string
  expiresAt?: string           // 可选自动清理
}
```

**持久化 envelope**（写入 `localStorage`）：

```ts
{
  schemaVersion: 1
  unreadCount: number
  items: NotificationRecord[]   // 时间倒序或实现时排序
}
```

单键 JSON；条目量大时 Phase 3 再议分片或上限裁剪（v1 可设条数上限如 200）。

### 3.1 已读语义

| 场景 | 结果 |
|------|------|
| 用户在通知列表 mark read / delete | 已读或移除 |
| snackbar **互动按钮**（关闭 ×、或 `snackbarActions` 自定义按钮）被点击 | **标已读**；若有 `action` 则一并执行导航 |
| snackbar **仅超时**自动消失（用户未点任何按钮） | **保持未读**；仍可在顶栏 bell 回顾 |
| `snackbar: false`（**静默通知**，须显式传入） | 仅列表/角标；未读直至用户主动已读 |

---

## 4. API（规划）

### 4.1 宿主内部 / Web

| 方法 | 说明 |
|------|------|
| `notificationCenter.send(record)` | 创建通知（未读）；按 `record` / opts 决定是否弹 snackbar |
| `notificationCenter.list(filter?)` | 分页列表 · `unreadOnly` · `source` |
| `notificationCenter.markRead(id \| ids \| 'all')` | 标记已读 |
| `notificationCenter.delete(id \| ids)` | 删除 |
| `notificationCenter.unreadCount()` | 角标订阅源 |

### 4.2 插件 `host.ui`（迁移定案 · 2026-07-08）

**唯一出口 `notify(title, body?, opts?)`**：

```ts
interface PluginNotifyOptions {
  /** 是否弹 snackbar；默认 true；静默通知显式 false */
  snackbar?: boolean
  color?: string
  /** snackbar 自动关闭毫秒；默认 4000；仅影响浮层，不影响中心未读 */
  timeout?: number
  level?: 'info' | 'success' | 'warning' | 'error'
  action?: NotificationRecord['action']
  snackbarActions?: NotificationRecord['snackbarActions']
  dedupeKey?: string
}
```

| API | 行为 |
|-----|------|
| **`notify(title, body?, opts?)`** | **始终**写入通知中心（未读）；`snackbar !== false`（默认）时弹浮层；浮层带关闭钮 + 可选 `snackbarActions` |

**NC5 迁移（无兼容层）**：

- 从 `PluginWebHost.ui` **删除** `toast`；删除 `PluginToastOptions`（字段并入 `PluginNotifyOptions`）。
- 原 `host.ui.toast(msg, opts)` 调用 → `host.ui.notify(msg, undefined, opts)`（默认已有 snackbar，**勿**重复传参）。
- 原单行 `notify` 合并 snackbar 的实现 **整段替换**为「写中心 + 条件 snackbar」。
- 涉及：`create-plugin-web-host.ts` · `plot-summary` · `guidance-generate` · `conversation-export` · `swipe-cleaner` · Web 宿主核心等（NC0 清单）。

**snackbar 浮层**（实现参考 Vuetify `v-snackbar` + actions）：

- 默认展示 **关闭** 按钮 → 点击 `markRead(id)` 并关浮层  
- `snackbarActions` 自定义按钮 → 点击 `markRead(id)` + 执行 `action` + 关浮层  
- 超时自动关 → **不** mark read

### 4.3 Server 侧产生通知（Phase 2 · 可选）

Server **不** 持久化通知列表（无磁盘 / DB）。插件 `server.mjs` 或宿主核心若需「服务端任务完成」类通知，Phase 2 可选：

- WebSocket / SSE 推至当前已连接浏览器 → 前端 `notificationCenter.send` 写入 **localStorage**；或  
- 响应体携带 `notifications[]` 由 Web 层入库（仅当次会话在线时可见）

v1 **仅 Web Pinia + localStorage**；REST 路由 **不开**。

---

## 5. UI（规划）

| 入口 | 说明 |
|------|------|
| **顶栏 / 页脚 bell 图标** | 未读角标；点击打开通知抽屉或全屏列表 |
| **通知列表** | 时间倒序；未读高亮；单条 mark read · delete；批量操作 |
| **空态** | 无通知时的占位文案 |
| **snackbar** | 可选即时层；**必有**关闭或操作钮；互动即已读（§3.1） |
| **i18n** | 宿主壳文案；插件通知 title/body 由发送方负责（通常已 i18n） |

布局位置与 `DOC/31` 顶栏/页脚协调；**不**占用插件 rail。

---

## 6. 分期（规划）

与 [`DOC/04`](04-TODO.md) §通知中心子任务对齐：

| 子任务 | 内容 |
|--------|------|
| **NC0** | 调用点盘点 · 统一 `notify` 语义定案 |
| **NC1** | `notification-storage.ts` · localStorage envelope |
| **NC2** | Pinia store · send/list/markRead/delete/unreadCount |
| **NC3** | 顶栏 bell + 列表面板 |
| **NC4** | 多 Tab `storage` 同步 |
| **NC5** | 仅 `notify` · 删 `toast` · 全库改调用 · snackbar 互动已读 |
| **NC-V** | 单测 + 手动验收 |
| **NC-F** | 宿主场景 · Server 推送 · dedupe/筛选（非阻塞） |

### Phase 1 — 核心（P0 · NC0–NC-V）

- [ ] `NotificationCenter` 模块（Pinia store + `localStorage` 读写 · `web/src/utils/notification-storage.ts`）
- [ ] `send` / `list` / `markRead` / `delete` / `unreadCount`
- [ ] 顶栏入口 + 通知列表面板
- [ ] 同浏览器多 Tab：`storage` 事件同步未读角标与列表
- [ ] **仅 `notify`**：写中心；`snackbar` 默认 true；**删除 `toast`**；全库改调用；互动按钮 → markRead（§4.2）

### Phase 2 — 整合（NC-F1 · 择机）

- [ ] 宿主核心场景接入（导入完成/失败、memory 重建、登录安全提示等）
- [ ] 插件文档与 `DOC/18` 示例更新
- [ ] 可选 Server → Web 推送（插件 server.mjs 完成回调；仍由 Web 写 localStorage）

### Phase 3 — 增强（NC-F3 · P2/P3）

- [ ] `dedupeKey` 合并 · `expiresAt` 清理任务
- [ ] 筛选（按 plugin / level）· 搜索
- [ ] 与移动端 / 系统通知集成（若产品需要）

---

## 7. 非目标（v1）

- Syncthing / Server 磁盘同步通知历史
- 跨设备通知一致（localStorage 为 **本机本浏览器** 状态）
- 邮件 / 第三方 push
- 替 chat-audit 或插件 debug 日志

---

## 8. 代码索引（现状 · 待替换）

| 路径 | 说明 |
|------|------|
| `web/src/plugins/create-plugin-web-host.ts` | 实现统一 `notify`；**删除** `toast` |
| `web/src/plugins/types.ts` | `PluginNotifyOptions`（`snackbar` 等）；**删除** `toast` / `PluginToastOptions` / `persistent` |
| `plugins/plot-summary/` · `guidance-generate/` · `conversation-export/` · `swipe-cleaner/` | `host.ui.toast` → `notify`（NC5） |
| `web/src/utils/user-session-storage.ts` | 登出清 `arousal-*` 会话键（通知键随清） |
| `web/src/utils/composer-draft-storage.ts` | **参考**：按 `userId` 分键的 localStorage 模式 |
| `DOC/10` §4.4 | 仅 `notify` 产品说明 |

---

## 9. 修订记录

| 日期 | 说明 |
|------|------|
| 2026-07-08 | **无兼容**：删除 `toast` API；`snackbar` 默认 true、静默显式 false |
| 2026-07-08 | **API 定案**：仅 `notify`；互动按钮标已读 |
| 2026-07-08 | 优先级升至 **P0**；与 `DOC/04` NC0–NC-F 子任务对齐 |
| 2026-07-07 | 首版：统一通知中心需求、存储/已读/删除、列表 UI、分期 |
| 2026-07-07 | 存储定案改为 **localStorage**（非 Server 磁盘）；登出清除；跨 Tab `storage` 事件 |
