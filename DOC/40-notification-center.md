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
2. **持久化存储**：按用户落盘；支持 **已读 / 未读**、**删除**、可选过期  
3. **界面**：通知列表（未读角标、筛选、批量已读/删除）；与 toast 分层（见 §3）

---

## 2. 能力边界（定案方向）

| 项 | 定案 |
|----|------|
| 作用域 | **用户级**（`data/{userId}/notifications.json` 或等价索引 + 条目文件，实现时定） |
| 与 toast 关系 | **toast** = 即时浮层（可配置「同时写入通知中心」）；**notify** = 默认 **仅** 写入通知中心 + 可选轻提示 |
| 与 chat-audit | **正交**；通知中心不存完整 prompt，仅存摘要文案与跳转链接 |
| 插件 | 经 `host.ui.notify` / 扩展 API；**禁止**插件直写用户 data 目录 |
| 跨设备 | v1 **不** 做服务端 WebSocket 推送；Syncthing 同步用户 data 时通知文件随用户目录同步（与现有多机模型一致） |

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

**索引文件**（示意）：`{ schemaVersion, unreadCount, items: NotificationId[] }` 或内联数组；实现时权衡单文件 vs 分片。

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

### 4.3 Server REST（若需服务端产生通知）

| 路由 | 说明 |
|------|------|
| `GET /api/notifications` | 列表 |
| `PATCH /api/notifications/:id` | 已读 |
| `DELETE /api/notifications/:id` | 删除 |
| `POST /api/notifications` | 内部 / 插件 server 侧创建（需权限） |

v1 可 **仅 Web 本地 store + 用户 data 文件**，Server 路由 Phase 2 再开。

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

- [ ] `NotificationCenter` 模块（Pinia store + 用户 data 读写）
- [ ] `send` / `list` / `markRead` / `delete` / `unreadCount`
- [ ] 顶栏入口 + 通知列表面板
- [ ] `host.ui.notify` 改走通知中心（保留 toast 合并为 opt-in）

### Phase 2 — 整合

- [ ] 宿主核心场景接入（导入完成/失败、memory 重建、登录安全提示等）
- [ ] 插件文档与 `DOC/18` 示例更新
- [ ] 可选 Server REST（插件 server.mjs 发通知）

### Phase 3 — 增强（P2/P3）

- [ ] `dedupeKey` 合并 · `expiresAt` 清理任务
- [ ] 筛选（按 plugin / level）· 搜索
- [ ] 与移动端 / 系统通知集成（若产品需要）

---

## 7. 非目标（v1）

- 实时 WebSocket 跨 Tab 同步（可依赖 store + 同页；多 Tab 实现时 `storage` 事件或 SSE 再议）
- 邮件 / 第三方 push
- 替 chat-audit 或插件 debug 日志

---

## 8. 代码索引（现状 · 待替换）

| 路径 | 说明 |
|------|------|
| `web/src/plugins/create-plugin-web-host.ts` | `notify` → toast 合并（**待改**） |
| `web/src/plugins/types.ts` | `PluginNotifyOptions.persistent` 预留 |
| `DOC/10` §4.4 | `toast` / `notify` 产品说明 |

---

## 9. 修订记录

| 日期 | 说明 |
|------|------|
| 2026-07-07 | 首版：统一通知中心需求、存储/已读/删除、列表 UI、分期 |
