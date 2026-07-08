# 通知中心 — 宿主核心场景迁移方案

> **状态**：定案 · **待实施**（2026-07-09）  
> **目标**：**所有用户可见瞬时消息**均由 **通知中心统一发出**；业务组件禁止自建 snackbar。浮层用 **`v-snackbar-queue`**；列表落盘规则见 [`DOC/40`](40-notification-center.md) §3.1。  
> **前置**：NC1–NC5 已落地（store · bell · 插件 `host.ui.notify` · `level`）。  
> **关联**：[`DOC/40`](40-notification-center.md) · [`DOC/04`](04-TODO.md) §NC-F1 · `web/src/plugins/plugin-notify.ts`

---

## 1. 范围界定

### 1.1 纳入（须迁移）

满足：**用户操作或后台任务结束后**，以 **底部浮层 / 类似 toast** 形式出现、**不依附于当前表单控件** 的短消息。

| 类型 | 现实现 | 迁移后 |
|------|--------|--------|
| 独立 `v-snackbar` | 6 处组件内自建 state | 删除；改 `coreNotify`（通知中心发出） |
| 插件 `host.ui.notify` | 已走 `sendPluginNotify` | **已完成**，维持 |

### 1.2 不纳入（保持现状）

| 类型 | 示例 | 理由 |
|------|------|------|
| **面板内 `v-alert`** | 连接测试失败条、导入预览警告、角色库列表错误、对话页 load 失败 | 与当前 UI 上下文绑定；用户未离开面板即需看到；非「事后回顾」类消息 |
| **对话框正文** | memory 重建确认、分支命名、confirm | 交互流的一部分，不是通知 |
| **`host.ui.progress` / 进度条** | 插件批处理、摘要生成 | 进行中状态，非完成通知（完成时再 `notify`） |
| **内联校验** | 表单字段错误、禁用按钮 tooltip | 非通知语义 |
| **Auth 登录页错误** | `AuthView` alert | 留在表单上下文；可选 Phase 2 对「账户锁定」类安全事件单独 `notify` |

**原则**：`v-alert` = **当前屏幕的状态说明**；通知中心 = **可跨页面回顾的事件记录**。二者不强行合并。

### 1.3 灰区（本方案定案）

| 场景 | 定案 |
|------|------|
| **群聊会话内提示**（`HomeChat` · `@` 未匹配、额度衰减等） | **纳入** · `level: 'warning'` · 可设 `dedupeKey` 防刷屏 · 仍弹 snackbar |
| **memory 向量重建完成** | 对话框内已有进度/错误；**重建成功结束**时额外 `coreNotify` success（用户关对话框后仍可于 bell 回顾） |
| **memory 重建失败** | 对话框内 `v-alert` 保留；可选同步一条 `level: 'error'` 通知（与 alert 重复但可回顾） |

---

## 2. 现状盘点（宿主 `v-snackbar`）

| # | 文件 | 触发场景（约） | `level` 映射 | 操作按钮 |
|---|------|----------------|--------------|----------|
| 1 | `ConnectionSettingsCard.vue` | API 密钥增删改、预设保存/测试/导入导出、全局预设 | success / warning / error | 无 |
| 2 | `ImportSettingsPanel.vue` | ST 世界书/聊天记录导入成功或失败 | success / error | **有**（打开世界书 / 跳转对话） |
| 3 | `PromptsView.vue` | 设为默认预设成功/失败；预设加载失败 | success / error | 无 |
| 4 | `CharactersView.vue` | 创建/编辑/导入/用户标记失败 | success / error（现未区分，统一无 level） | 无（仅 OK 关 snackbar） |
| 5 | `ChatConversationView.vue` | 分支创建成功/失败 | success / error | 无 |
| 6 | `HomeChat.vue` ← `use-chat-outbound.ts` | 群聊 4 类会话提示 | warning | 关闭（非导航） |

**合计**：约 **35+** 处 `snackbar.value = true` / `showSnackbar` 调用，集中在 6 个文件。

**插件通道**：`plot-summary` · `conversation-export` · `swipe-cleaner` · `guidance-generate` 已 `notify` + `level`，**不在本方案重复改造**。

---

## 3. 目标架构

### 3.1 统一出口：`coreNotify`

新增 `web/src/utils/core-notify.ts`，**仅**调用通知中心 `send` / 入队 API，不复制浮层或落盘逻辑：

```ts
import { useNotificationCenterStore } from '@/stores/notification-center'
import type { PluginNotifyOptions } from '@/plugins/types'

export function coreNotify(
  title: string,
  body?: string,
  opts?: PluginNotifyOptions,
): string {
  return useNotificationCenterStore().notify({ title, body, ...opts, source: { kind: 'core' } })
}
```

（插件侧继续 `sendPluginNotify` → 同一 store；**禁止**组件内 `plugin-ui-state.showPluginNotifySnackbar` 直调。）

- **禁止** Vue 组件内 `snackbar` ref / `v-snackbar` / `v-snackbar-queue`（全站 **一处** 挂载，见 §3.2）。
- **禁止** `color`；仅 `level`。
- 须 bell 回顾的结果（导入成功、连接保存失败等）传 **`persist: true`**；纯瞬时提示可依赖默认「超时入列表」。

### 3.2 浮层：`v-snackbar-queue`（2026-07-09 定案）

| 项 | 定案 |
|----|------|
| **挂载** | 单例：`App.vue` 或 `PluginUiHost.vue`（与 `PluginUiHost` confirm/progress 并列） |
| **数据源** | `notificationCenter.snackbarQueue`（Pinia）；`notify` 默认 `snackbar !== false` 时 `enqueue` |
| **关闭控件** | **仅** `v-btn icon="mdi-close"`；**禁止**文字「OK」「关闭」 |
| **手动关闭** | `dismissSnackbar(id, 'close')` → 出队，**不写入**通知列表 |
| **超时** | `dismissSnackbar(id, 'timeout')` → 出队，**写入**列表（未读） |
| **废除** | `plugin-ui-state` 的 `pluginSnackbar` 单条 ref · `PluginUiHost` 内旧 `v-snackbar` |

实现参考：[Vuetify 3 `v-snackbar-queue`](https://vuetifyjs.com/en/components/snackbar-queue/)（或等价队列绑定 store）。

### 3.3 操作按钮与导航：`executeNotificationAction`

当前缺口：

| 能力 | 插件 notify | 列表 `NotificationBell` | `v-snackbar-queue` |
|------|-------------|---------------------------|---------------------|
| 调度 | ✅ store | — | ✅ 同源队列 |
| `action` / `snackbarActions` | ✅ | ❌ 未执行 | 业务钮待接 `executeNotificationAction` |

**NC-F1 基础设施**须补齐：

1. **Store 重构** — `notify` · `snackbarQueue` · `enqueueSnackbar` · `dismissSnackbar(id, reason)` · `persist` 分支（§3.1 `DOC/40`）
2. **`NotificationSnackbarQueue.vue`** — 唯一 `v-snackbar-queue`；关闭图标；超时 timer
3. **`web/src/utils/notification-action.ts`** — `executeNotificationAction`
4. **`PluginUiHost`** — 移除旧 `v-snackbar`；保留 confirm/progress
5. **`NotificationBell`** — 列表项点击标已读 + 可选 `action`

#### 3.3.1 `action` 类型扩展

现有 `NotificationAction`（`notification-storage.ts`）：

```ts
type: 'route' | 'conversation' | 'settings-tab' | 'external'
```

**新增**（服务 `ImportSettingsPanel` 世界书深链）：

```ts
type: 'library-panel'
panel: 'lorebooks' | 'characters' | 'prompts'
/** 世界书 id；打开资料库模态并选中该本 */
focusId?: string
```

| 原 Import 行为 | 新 `action` |
|----------------|-------------|
| 打开世界书 | `{ type: 'library-panel', panel: 'lorebooks', focusId }` |
| 跳转对话 | `{ type: 'conversation', conversationId }` |

`executeNotificationAction` 内部调用现有 `uiContext.requestOpenLorebooksDialog` / `router.push` 等，**不**在组件里散落导航逻辑。

### 3.4 列表与浮层行为（[`DOC/40`](40-notification-center.md) §3.1）

| 用户操作 | 浮层 | 通知列表 |
|----------|------|----------|
| 点 **关闭图标** | 出队 | **不写入** |
| 超时未操作 | 出队 | **写入**未读 |
| `persist: true` 的 `notify` | 可入队 | **立即写入**未读 |
| `snackbar: false` | 无 | **立即写入**未读 |
| 列表项点击 | — | 标已读（+ 可选 `action`） |

---

## 4. 分文件迁移说明

### 4.1 `ConnectionSettingsCard.vue`（工作量：中）

- 删除 `snackbar` / `snackbarText` / `snackbarColor` 与模板内 `v-snackbar`。
- 将所有 `snackbarColor = 'success'|'warning'|'error'` 改为 `coreNotify(text, undefined, { level })`。
- 长文案（含 `path`）作 `body` 或保留单行 `title`，与现 i18n 一致。

### 4.2 `ImportSettingsPanel.vue`（工作量：高）

- 删除 `showSnackbar` 与本地 `v-snackbar`。
- 成功导入聊天记录：

```ts
coreNotify(t('settings.importSuccess'), undefined, {
  level: 'success',
  persist: true, // 须 bell 回顾 + 业务按钮
  snackbarActions: [{
    label: t('settings.importOpenChat'),
    action: { type: 'conversation', conversationId },
  }],
  action: { type: 'conversation', conversationId },
})
```

- 世界书导入成功：同理 `library-panel` + `focusId`。
- 失败：`level: 'error'`，无 action。

### 4.3 `PromptsView.vue`（工作量：低）

- 4 处 snackbar → `coreNotify`；预设加载失败在 deep watch 内同样迁移。

### 4.4 `CharactersView.vue`（工作量：低）

- 5 处 → `coreNotify`；成功 `level: 'success'`，`userMarkFailed` → `error`。

### 4.5 `ChatConversationView.vue`（工作量：低）

- 删除 `branchSnack*`；`showBranchSuccess` / `showBranchError` 改 `coreNotify`。
- 成功可考虑 `action: { type: 'route', href: ... }` 若需刷新分支面板（**可选**，v1 可仅通知文案）。

### 4.6 群聊提示 `HomeChat.vue` + `use-chat-outbound.ts`（工作量：中）

- 删除 `groupChatNoticeOpen` / `groupChatNoticeMessage` 与 `HomeChat` 内 `v-snackbar`。
- 在 `use-chat-outbound.ts` 4 处改为：

```ts
coreNotify(opts.t('chat.groupChat.atNameUnmatched'), undefined, {
  level: 'warning',
  dedupeKey: `group-chat:${conversationId}:at-unmatched`, // 可选，防连发刷屏
})
```

- `useChatSession` 暴露的 notice state **删除**；调用方不再依赖 session 上的 snackbar 字段。

---

## 5. 实施分期（NC-F1 子任务）

与 [`DOC/04`](04-TODO.md) 对齐，建议顺序：

| 子任务 | 内容 | 依赖 |
|--------|------|------|
| **NC-F1.0** | Store 队列语义 · `v-snackbar-queue` 单例 · `persist` · 图标关闭 · 废除 `pluginSnackbar` | — |
| **NC-F1.1** | `PluginUiHost` snackbar 执行 action；`NotificationBell` 列表支持 action 点击 | F1.0 |
| **NC-F1.2** | 迁移 `PromptsView` · `CharactersView` · `ChatConversationView` | F1.0 |
| **NC-F1.3** | 迁移 `ConnectionSettingsCard` | F1.0 |
| **NC-F1.4** | 迁移 `ImportSettingsPanel`（含 action） | F1.1 |
| **NC-F1.5** | 迁移群聊提示（`use-chat-outbound`） | F1.0 |
| **NC-F1.6** | memory 重建成功/失败可选 `coreNotify`；删除残留 snackbar state | F1.0 |
| **NC-F1.V** | 验收：全库 `rg 'v-snackbar'` 仅 `PluginUiHost`；手动清单 §6 | 全部 |

**预估**：F1.0–F1.2 可一个 PR；F1.3–F1.5 可第二个 PR；避免单次 diff 过大。

---

## 6. 验收清单（NC-F1.V）

### 6.1 静态

- [ ] `web/src` 内除 **`NotificationSnackbarQueue.vue`（或等价）** 外 **无** `v-snackbar` / `v-snackbar-queue`
- [ ] 无 `pluginSnackbar` / `showPluginNotifySnackbar` 业务直调
- [ ] snackbar 关闭为 **图标**；无文字关闭钮
- [ ] 手动关闭浮层 → bell **无**该条；超时 → bell **有**未读

### 6.2 功能（手动）

| 场景 | 预期 |
|------|------|
| 保存 API 设置成功 + `persist: true` | 浮层 + 立即 bell 未读 |
| 保存 API 设置成功（仅默认 notify） | 手动点 × → bell 无；等超时 → bell 有 |
| 导入 ST 聊天记录成功 + `persist` | 浮层带业务文字钮；列表可回顾 |
| 设为默认预设失败 | error 通知；超时未点关闭则仍未读 |
| 群聊 `@` 未匹配 | warning；bell 可回顾 |
| 多 Tab | 另一 Tab bell 角标同步 |
| 登出 | 通知清空 |

### 6.3 测试

- [ ] `notification-action.test.ts` — `executeNotificationAction` 路由表
- [ ] 可选：`core-notify.test.ts` — mock store，断言 `source.kind === 'core'`

---

## 7. 非目标（本方案不做）

- 将面板内 `v-alert` 迁入通知中心
- Server 推送 / SSE `notifications[]`（见 `DOC/40` NC-F2）
- `dedupeKey` 全场景强制（仅群聊等高频点建议）
- 通知列表内嵌「操作按钮」UI（v1 靠 snackbar 钮 + 点击整项执行 `action` 即可）

---

## 8. 文档与类型同步

| 文件 | 变更 |
|------|------|
| [`DOC/40`](40-notification-center.md) | 状态改为 NC1–NC5 已实现；§6 Phase 2 指向本文 |
| [`DOC/04`](04-TODO.md) | NC-F1 拆为 F1.0–F1.V 子勾选 |
| [`DOC/18`](18-plugin-host-developer-api.md) | 补充宿主 `coreNotify` 与插件 `notify` 共用存储 |
| `web/src/utils/notification-storage.ts` | `NotificationAction` 增加 `library-panel` |
| `web/src/plugins/types.ts` | `PluginNotifyOptions.action` 同步扩展 |

---

## 9. 修订记录

| 日期 | 说明 |
|------|------|
| 2026-07-09 | 对齐 `DOC/40`：`v-snackbar-queue` · 图标关闭 · 手动关闭不入列表 · `persist` |
| 2026-07-09 | 首版：宿主 6 处 snackbar 盘点 · `coreNotify` · action 路由 · 分期与验收 |
