# 通知中心 — 设计定案（规划）

> **状态**：**规划 · 未实现**（2026-07）。  
> **关联**：`DOC/04` P1 · `DOC/10` §4.4 `host.ui` · `DOC/18` §3.9 · `web/src/plugins/create-plugin-web-host.ts`

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

1. **统一发送**：宿主核心、插件（经 `host.ui`）、未来服务端 push 均经同一 API 入队  
2. **持久化存储**：按 **用户 + 浏览器** 写入 **`localStorage`**；支持 **已读 / 未读**、**删除**、可选过期  
3. **界面**：通知列表（未读角标、筛选、批量已读/删除）；与 toast 分层（见 §3）

---

## 2. 能力边界（定案方向）

| 项 | 定案 |
|----|------|
| 作用域 | **用户级 · 浏览器本地** — 键名 **`arousal-notifications-{userId}`**（对齐 `arousal-composer-draft` 等 `arousal-*` 前缀惯例） |
| 存储介质 | **`localStorage` 单键 JSON**（`{ schemaVersion, unreadCount, items: NotificationRecord[] }`）；**不写** Server 用户 data 目录 |
| 与 toast 关系 | **toast** = 即时浮层（可配置「同时写入通知中心」）；**notify** = 默认 **仅** 写入通知中心 + 可选轻提示 |
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
  /** 点击通知后的导航（可选） */
  action?: {
    type: 'route' | 'conversation' | 'settings-tab' | 'external'
    href?: string
    conversationId?: string
    settingsTab?: string
  }
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

---

## 4. API（规划）

### 4.1 宿主内部 / Web

| 方法 | 说明 |
|------|------|
| `notificationCenter.send(record)` | 创建通知；更新未读计数；可选触发 toast |
| `notificationCenter.list(filter?)` | 分页列表 · `unreadOnly` · `source` |
| `notificationCenter.markRead(id \| ids \| 'all')` | 标记已读 |
| `notificationCenter.delete(id \| ids)` | 删除 |
| `notificationCenter.unreadCount()` | 角标订阅源 |

### 4.2 插件 `host.ui`（迁移）

| 现 API | 目标行为 |
|--------|----------|
| `toast(msg)` | 保持即时 snackbar；可选 `alsoPersist: true` 写入通知中心 |
| `notify(title, body?, opts?)` | **写入通知中心**；`opts.toast: true` 时额外浮层；`persistent` 废弃或映射为「仅中心、不 toast」 |

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
| **i18n** | 宿主壳文案；插件通知 title/body 由发送方负责（通常已 i18n） |

布局位置与 `DOC/31` 顶栏/页脚协调；**不**占用插件 rail。

---

## 6. 分期（规划）

### Phase 1 — 核心（P1）

- [ ] `NotificationCenter` 模块（Pinia store + `localStorage` 读写 · `web/src/utils/notification-storage.ts`）
- [ ] `send` / `list` / `markRead` / `delete` / `unreadCount`
- [ ] 顶栏入口 + 通知列表面板
- [ ] 同浏览器多 Tab：`storage` 事件同步未读角标与列表
- [ ] `host.ui.notify` 改走通知中心（保留 toast 合并为 opt-in）

### Phase 2 — 整合

- [ ] 宿主核心场景接入（导入完成/失败、memory 重建、登录安全提示等）
- [ ] 插件文档与 `DOC/18` 示例更新
- [ ] 可选 Server → Web 推送（插件 server.mjs 完成回调；仍由 Web 写 localStorage）

### Phase 3 — 增强（P2/P3）

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
| `web/src/plugins/create-plugin-web-host.ts` | `notify` → toast 合并（**待改**） |
| `web/src/plugins/types.ts` | `PluginNotifyOptions.persistent` 预留 |
| `web/src/utils/user-session-storage.ts` | 登出清 `arousal-*` 会话键（通知键随清） |
| `web/src/utils/composer-draft-storage.ts` | **参考**：按 `userId` 分键的 localStorage 模式 |
| `DOC/10` §4.4 | `toast` / `notify` 产品说明 |

---

## 9. 修订记录

| 日期 | 说明 |
|------|------|
| 2026-07-07 | 首版：统一通知中心需求、存储/已读/删除、列表 UI、分期 |
| 2026-07-07 | 存储定案改为 **localStorage**（非 Server 磁盘）；登出清除；跨 Tab `storage` 事件 |
