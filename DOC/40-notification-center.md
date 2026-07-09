# 通知中心 — 设计定案（已实现）

> **状态**：**✅ 已完成并归档**（2026-07-09）· NC0–NC5 · NC-F1 · NC-F3 · NC-V / NC-F1.V 签核 · **NC-F2 Server 推送延后**（无对应场景）。  
> **关联**：[`DOC/45`](45-notification-center-core-migration.md)（宿主迁移与验收）· `DOC/10` §4.4 · `DOC/18` §3.9

---

## 1. 背景与目标

### 1.1 现状

| 能力 | 实现 | 局限 |
|------|------|------|
| `host.ui.notify` | 通知中心统一调度（浮层队列 + 列表） | — |

用户无法回顾「刚才发生了什么」；插件长任务完成、导入结果、后台摘要失败等 **适合持久化** 的消息与 **瞬时 toast** 混在同一通道，难以管理。

### 1.2 目标

引入 **通知中心（Notification Center）** 模块，作为全产品 **唯一通知出口**：

1. **统一 API**：**仅 `notify`** — 所有用户可见瞬时消息 **必须由通知中心调度**（浮层队列 + 持久列表）；业务组件 **不得** 自建 `v-snackbar` / snackbar ref。  
2. **持久化存储**：按 **用户 + 浏览器** 写入 **`localStorage`**；支持 **已读 / 未读**、**删除**、可选过期  
3. **界面**：通知列表（未读角标、筛选、批量删除）；即时层由 **`v-snackbar-queue`** 统一渲染（见 §3.2 · §5）

**产品定案（2026-07-08）**：

- **仅 `host.ui.notify`** — **删除** `toast` API 与类型，**不做**兼容别名或转发 shim；全库调用点直接改为 `notify`（NC0 / NC5）。
- **`opts.snackbar` 默认 `true`** — 常规通知同时弹浮层；**静默**须显式 `snackbar: false`。

**产品定案（2026-07-09）**：

- **浮层 UI**：全站 **唯一** `v-snackbar-queue`（由通知中心 store 驱动）；废除 `PluginUiHost` 单条 `v-snackbar` 及组件内分散 snackbar。  
- **关闭控件**：snackbar **仅图标关闭**（如 `mdi-close`），**禁止**文字钮（「OK」「关闭」等）。  
- **列表写入时机**（与旧 §3.1「关闭即已读」**废止**）：
  - **`notify` 默认**（`snackbar !== false`）：**立即写入**通知列表（未读），并显示浮层。
  - **手动点关闭图标**：出队浮层，并从列表**删除**该条（bell 不可回顾；**唯一例外**）。
  - **浮层超时**：仅出队浮层，列表条目**保留**（未读，供 bell 回顾）。
  - **业务文字钮**（如「打开对话」）：执行 `action` 后出队浮层，并从列表**删除**（视为用户已知晓）。
  - **`snackbar: false`**：跳过浮层，**立即写入**列表（静默通知）。

---

## 2. 能力边界（定案方向）

| 项 | 定案 |
|----|------|
| 作用域 | **用户级 · 浏览器本地** — 键名 **`arousal-notifications-{userId}`**（对齐 `arousal-composer-draft` 等 `arousal-*` 前缀惯例） |
| 存储介质 | **`localStorage` 单键 JSON**（`{ schemaVersion, unreadCount, items: NotificationRecord[] }`）；**不写** Server 用户 data 目录 |
| 发送 API | **仅 `notify`**；**无** `toast` |
| snackbar | `opts.snackbar` 默认 **`true`**（入 **snackbar 队列**）；**静默**须显式 **`snackbar: false`**（仅列表） |
| 列表落盘 | 默认：**立即**入列表 + 浮层；**手动关闭浮层**从列表删除；超时保留 · 业务钮删列表 |
| 已读规则 | 列表内点击未读项标已读（+ 可选执行 `action`）；浮层关闭图标**删除**列表项；`snackbarActions` 业务钮执行 `action` 后**删除**列表项 |
| 与 chat-audit | **正交**；通知中心不存完整 prompt，仅存摘要文案与跳转链接 |
| 插件 | 经 `host.ui.notify` / `notificationCenter` API；**禁止**插件直读写 `localStorage` |
| 登出 | 随 `clearUserSessionLocalStorage()` 清除（`arousal-notifications-*` 不在 `PRESERVED_LOCAL_STORAGE_KEYS` 内） |
| 跨设备 / 跨 Tab | v1 **不** Syncthing、**不** Server 落盘、**不** 多 Tab 实时同步；各 Tab 在 `bindUser` / 刷新时从 localStorage 加载；换设备/换浏览器 **不** 同步历史 |

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
  /** snackbar 浮层上的操作按钮（可选）；点击 → 执行 action 并从列表删除 */
  snackbarActions?: Array<{
    label: string
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

### 3.1 浮层与列表语义（2026-07-09 定案）

| 场景 | 浮层队列 | 通知列表（bell） |
|------|----------|------------------|
| `notify` + 默认 `snackbar` | 入 `v-snackbar-queue` | **立即**写入未读；**手动点关闭图标** → **从列表删除** |
| `notify` + `snackbar: false` | 不展示 | **立即**写入未读 |
| 列表内点击未读项 | — | 标已读（+ 可选执行 `action`） |
| 列表删除 | — | 移除 |
| `snackbarActions` 业务按钮（非关闭图标） | 出队浮层 | **删除**（用户已互动知晓）；执行 `action` |

---

## 4. API（规划）

### 4.1 宿主内部 / Web

| 方法 | 说明 |
|------|------|
| `notificationCenter.notify(input)` | 调度通知：按 opts 入 snackbar 队列 / 写列表（§3.1） |
| `notificationCenter.enqueueSnackbar(item)` | 内部：推入 `v-snackbar-queue` 数据源 |
| `notificationCenter.dismissSnackbar(id, reason)` | `reason: 'close'` / `'action'` 从列表删除；`'timeout'` 仅出队浮层 |
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
| **`notify(title, body?, opts?)`** | 经通知中心统一发出：默认入 **snackbar 队列** + **立即写入列表**；见 §3.1 |

**NC5 迁移（无兼容层）**：

- 从 `PluginWebHost.ui` **删除** `toast`；删除 `PluginToastOptions`（字段并入 `PluginNotifyOptions`）。
- 原 `host.ui.toast(msg, opts)` 调用 → `host.ui.notify(msg, undefined, opts)`（默认已有 snackbar，**勿**重复传参）。
- 原单行 `notify` 合并 snackbar 的实现 **整段替换**为「通知中心调度队列 + 条件落列表」（§3.1）。
- 涉及：`create-plugin-web-host.ts` · `plot-summary` · `guidance-generate` · `conversation-export` · `swipe-cleaner` · Web 宿主核心等（NC0 清单）。

**snackbar 浮层**（`v-snackbar-queue` · Vuetify 3）：

- 每条必带 **图标关闭**（`mdi-close`）→ `dismissSnackbar(id, 'close')`，**从列表删除**
- `snackbarActions` 为 **文字业务按钮**（如「打开对话」）→ 执行 `action` 后出队，**从列表删除**
- **超时**自动关 → `dismissSnackbar(id, 'timeout')` → 仅出队浮层（列表已在 `notify` 时写入）

### 4.3 Server 侧产生通知（Phase 2 · 可选）

Server **不** 持久化通知列表（无磁盘 / DB）。插件 `server.mjs` 或宿主核心若需「服务端任务完成」类通知，Phase 2 可选：

- WebSocket / SSE 推至当前已连接浏览器 → 前端 `notificationCenter.notify` 写入 **localStorage**；或  
- 响应体携带 `notifications[]` 由 Web 层入库（仅当次会话在线时可见）

v1 **仅 Web Pinia + localStorage**；REST 路由 **不开**。

---

## 5. UI（规划）

| 入口 | 说明 |
|------|------|
| **顶栏 / 页脚 bell 图标** | 未读角标；点击打开通知抽屉或全屏列表 |
| **通知列表** | 时间倒序；未读高亮；点击标已读；单条/全部删除 |
| **空态** | 无通知时的占位文案 |
| **snackbar** | 全站 **单一** `v-snackbar-queue`；关闭 **仅图标**；手动 × 从列表删除（§3.1） |
| **i18n** | 宿主壳文案；插件通知 title/body 由发送方负责（通常已 i18n） |

布局位置与 `DOC/31` 顶栏/页脚协调；**不**占用插件 rail。

---

## 6. 分期（规划）

与 [`DOC/04`](04-TODO.md) §通知中心子任务对齐：

| 子任务 | 内容 |
|--------|------|
| **NC0** | 调用点盘点 · 统一 `notify` 语义定案 |
| **NC1** | `notification-storage.ts` · localStorage envelope |
| **NC2** | Pinia store · notify/list/markRead/delete/unreadCount |
| **NC3** | 顶栏 bell + 列表面板 |
| **NC5** | 仅 `notify` · 删 `toast` · 全库改调用 · snackbar 互动已读 |
| **NC-V** | 单测 + 手动验收 |
| **NC-F** | 宿主场景 · Server 推送 · dedupe/筛选（非阻塞） |

### Phase 1 — 核心（P0 · NC0–NC-V）

- [x] `NotificationCenter` 模块（Pinia store + `localStorage` 读写 · `web/src/utils/notification-storage.ts`）
- [x] `notify` / `list` / `markRead` / `delete` / `unreadCount` · `dismissSnackbar(id, reason)`
- [x] 顶栏入口 + 通知列表面板
- [x] **仅 `notify`**：删 `toast`；全库改调用；浮层/列表语义 §3.1

### Phase 2 — 整合（NC-F1 · 2026-07-09）

- [x] 宿主核心场景 — [`DOC/45`](45-notification-center-core-migration.md)（`coreNotify` · 6 处 snackbar · `executeNotificationAction` · memory 重建通知）
- [x] `NotificationAction` 扩展 `library-panel`
- [x] memory 重建成功/失败 `coreNotify`（NC-F1.6）
- [ ] **NC-F2 Server → Web 推送** — **延后**（当前无服务端任务完成推送场景；待 SSE/后台 job 定案后再做）

### Phase 3 — 增强（NC-F3 · P2/P3）

- [x] **NC-F3.1** — `dedupeKey` 合并 · `expiresAt` 清理
- [x] **NC-F3.2** — bell 筛选（未读 / level / 宿主·插件 / pluginId）· 搜索 · 全部已读
- [x] **NC-F3.3** — 桌面系统通知（Web Notification API · 后台 Tab · 用户开关）

---

## 7. 非目标（v1）

- Syncthing / Server 磁盘同步通知历史
- 跨设备通知一致（localStorage 为 **本机本浏览器** 状态）
- 邮件 / 第三方 push
- **移动端原生 / OS 级通知**（产品不需要；桌面 Web Notification 已覆盖后台 Tab 场景）
- 替 chat-audit 或插件 debug 日志

---

## 8. 代码索引

| 路径 | 说明 |
|------|------|
| `web/src/stores/notification-center.ts` | Pinia：`notify` · `snackbarQueue` · `dismissSnackbar` |
| `web/src/components/NotificationSnackbarQueue.vue` | 全站唯一 `v-snackbar-queue` |
| `web/src/components/NotificationBell.vue` | 顶栏 bell + 列表 |
| `web/src/utils/core-notify.ts` | 宿主统一出口（`source.kind === 'core'`） |
| `web/src/utils/notification-action.ts` | `executeNotificationAction`（conversation / library-panel / settings-tab 等） |
| `web/src/plugins/plugin-notify.ts` | 插件 `sendPluginNotify` → 同一 store |
| `web/src/plugins/create-plugin-web-host.ts` | `host.ui.notify` |
| `web/src/utils/notification-list-filter.ts` | 列表筛选 / 搜索 / pluginId 聚合 |
| `web/src/utils/desktop-notification.ts` | Web Notification API · 后台 Tab |
| `web/src/utils/notification-bulk-delete.ts` | 列表截断时批量删除策略（仅删已显示） |
| `web/src/components/NotificationSnackbarQueue.vue` | 全站浮层队列 · × / 超时 / 业务钮 |
| `web/src/components/NotificationBell.vue` | 铃铛列表 · 筛选 · 删除已显示 |
| `web/test/utils/notification-bulk-delete.test.ts` | 截断列表批量删除单测 |
| `web/test/utils/desktop-notification.test.ts` | 桌面通知 · 仅后台 Tab |
| `web/test/utils/notification-list-filter.test.ts` | 筛选与搜索单测 |
| `web/test/stores/notification-center.test.ts` | close / timeout / action · dedupe · 搜索 · 上限 · 多用户 |
| `web/test/utils/notification-action.test.ts` | action 路由单测 |

---

## 9. 修订记录

| 日期 | 说明 |
|------|------|
| 2026-07-09 | **已完成并归档**；NC-V / NC-F1.V 签核；A2 · D5 体验修复 |
| 2026-07-09 | **NC-V / NC-F1.V 签核**（[`DOC/45`](45-notification-center-core-migration.md) §6.10）；A2 浮层 × 竞态 · D5 删除已显示 |
| 2026-07-09 | 移除多 Tab `storage` 实时同步（各 Tab 独立，刷新/`bindUser` 读盘） |
| 2026-07-09 | 移除 `PluginNotifyOptions.persist` 与 store `send()`；文档与 §3.1 对齐 |
| 2026-07-09 | **NC-F3 收尾**：F3.4 移动端原生通知列为非目标（产品不需要） |
| 2026-07-09 | **NC-F3.2–F3.3**：bell 搜索/筛选/全部已读 · 桌面系统通知；**NC-F2 延后** |
| 2026-07-09 | **NC-F1.0–F1.5 已实现**：宿主 6 处 snackbar → `coreNotify` · `executeNotificationAction` |
| 2026-07-09 | **浮层定案**：`v-snackbar-queue` · 图标关闭 · 手动 × 删列表 · 超时保留 |
| 2026-07-09 | NC1–NC5 标记已实现；宿主迁移 [`DOC/45`](45-notification-center-core-migration.md) |
| 2026-07-08 | **无兼容**：删除 `toast` API；`snackbar` 默认 true、静默显式 false |
| 2026-07-08 | **API 定案**：仅 `notify`；互动按钮标已读 |
| 2026-07-08 | 优先级升至 **P0**；与 `DOC/04` NC0–NC-F 子任务对齐 |
| 2026-07-07 | 首版：统一通知中心需求、存储/已读/删除、列表 UI、分期 |
| 2026-07-07 | 存储定案改为 **localStorage**（非 Server 磁盘）；登出清除；跨 Tab `storage` 事件 |
