# 通知中心 — 宿主核心场景迁移方案

> **状态**：**✅ 已完成并归档**（2026-07-09 · NC-V / NC-F1.V 签核 · [`DOC/45`](45-notification-center-core-migration.md) §6.10）  
> **目标**：**所有用户可见瞬时消息**均由 **通知中心统一发出**；业务组件禁止自建 snackbar。浮层用 `v-snackbar-queue`；列表落盘规则见 `[DOC/40](40-notification-center.md)` §3.1。  
> **前置**：NC1–NC5 已落地（store · bell · 插件 `host.ui.notify` · `level`）。  
> **关联**：`[DOC/40](40-notification-center.md)` · `[DOC/04](04-TODO.md)` §NC-F1 · `web/src/utils/core-notify.ts`

---

## 1. 范围界定

### 1.1 纳入（须迁移）

满足：**用户操作或后台任务结束后**，以 **底部浮层 / 类似 toast** 形式出现、**不依附于当前表单控件** 的短消息。


| 类型                  | 现实现                   | 迁移后                 |
| ------------------- | --------------------- | ------------------- |
| 独立 `v-snackbar`     | ~~6 处组件内自建 state~~    | ✅ 已删；改 `coreNotify` |
| 插件 `host.ui.notify` | 已走 `sendPluginNotify` | **已完成**，维持          |




### 1.2 不纳入（保持现状）


| 类型                           | 示例                                 | 理由                                         |
| ---------------------------- | ---------------------------------- | ------------------------------------------ |
| **面板内** `v-alert`            | 连接测试失败条、导入预览警告、角色库列表错误、对话页 load 失败 | 与当前 UI 上下文绑定；用户未离开面板即需看到；非「事后回顾」类消息        |
| **对话框正文**                    | memory 重建确认、分支命名、confirm           | 交互流的一部分，不是通知                               |
| `host.ui.progress` **/ 进度条** | 插件批处理、摘要生成                         | 进行中状态，非完成通知（完成时再 `notify`）                 |
| **内联校验**                     | 表单字段错误、禁用按钮 tooltip                | 非通知语义                                      |
| **Auth 登录页错误**               | `AuthView` alert                   | 留在表单上下文；可选 Phase 2 对「账户锁定」类安全事件单独 `notify` |


**原则**：`v-alert` = **当前屏幕的状态说明**；通知中心 = **可跨页面回顾的事件记录**。二者不强行合并。

### 1.3 灰区（本方案定案）


| 场景                                      | 定案                                                                 |
| --------------------------------------- | ------------------------------------------------------------------ |
| **群聊会话内提示**（`HomeChat` · `@` 未匹配、额度衰减等） | **纳入** · `level: 'warning'` · 可设 `dedupeKey` 防刷屏 · 仍弹 snackbar     |
| **memory 向量重建完成**                       | 对话框内已有进度/错误；**重建成功结束**时额外 `coreNotify` success（用户关对话框后仍可于 bell 回顾） |
| **memory 重建失败**                         | 对话框内 `v-alert` 保留；可选同步一条 `level: 'error'` 通知（与 alert 重复但可回顾）       |


---



## 2. 现状盘点（宿主 `v-snackbar`）


| #   | 文件                                      | 触发场景（约）                     | `level` 映射                      | 操作按钮                |
| --- | --------------------------------------- | --------------------------- | ------------------------------- | ------------------- |
| 1   | `ConnectionSettingsCard.vue`            | API 密钥增删改、预设保存/测试/导入导出、全局预设 | success / warning / error       | 无                   |
| 2   | `ImportSettingsPanel.vue`               | ST 世界书/聊天记录导入成功或失败          | success / error                 | **有**（打开世界书 / 跳转对话） |
| 3   | `PromptsView.vue`                       | 设为默认预设成功/失败；预设加载失败          | success / error                 | 无                   |
| 4   | `CharactersView.vue`                    | 创建/编辑/导入/用户标记失败             | success / error（现未区分，统一无 level） | 无（仅 OK 关 snackbar）  |
| 5   | `ChatConversationView.vue`              | 分支创建成功/失败                   | success / error                 | 无                   |
| 6   | `HomeChat.vue` ← `use-chat-outbound.ts` | 群聊 4 类会话提示                  | warning                         | 关闭（非导航）             |


**合计**：约 **35+** 处 `snackbar.value = true` / `showSnackbar` 调用，集中在 6 个文件。

**插件通道**：`plot-summary` · `conversation-export` · `swipe-cleaner` · `guidance-generate` 已 `notify` + `level`，**不在本方案重复改造**。

---



## 3. 目标架构



### 3.1 统一出口：`coreNotify`

新增 `web/src/utils/core-notify.ts`，**仅**调用通知中心 `notify`，不复制浮层或落盘逻辑：

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
- `notify` **默认**：立即写入列表 + 浮层（若 `snackbar !== false`）；**手动关闭浮层**从列表删除；超时/业务钮仅关浮层。



### 3.2 浮层：`v-snackbar-queue`（2026-07-09 定案）


| 项         | 定案                                                                                     |
| --------- | -------------------------------------------------------------------------------------- |
| **挂载**    | 单例：`App.vue` 或 `PluginUiHost.vue`（与 `PluginUiHost` confirm/progress 并列）                |
| **数据源**   | `notificationCenter.snackbarQueue`（Pinia）；`notify` 默认 `snackbar !== false` 时 `enqueue` |
| **关闭控件**  | **仅** `v-btn icon="mdi-close"`；**禁止**文字「OK」「关闭」                                        |
| **手动关闭**  | `dismissSnackbar(id, 'close')` → 出队，**从列表删除**                                          |
| **业务文字钮** | 执行 `action` 后出队，**从列表删除**                                                              |
| **超时**    | 出队浮层，列表**保留**                                                                          |
| **废除**    | `plugin-ui-state` 的 `pluginSnackbar` 单条 ref · `PluginUiHost` 内旧 `v-snackbar`           |


实现参考：[Vuetify 3](https://vuetifyjs.com/en/components/snackbar-queue/) `v-snackbar-queue`（或等价队列绑定 store）。

### 3.3 操作按钮与导航：`executeNotificationAction`

当前缺口：


| 能力                           | 插件 notify | 列表 `NotificationBell` | `v-snackbar-queue`                |
| ---------------------------- | --------- | --------------------- | --------------------------------- |
| 调度                           | ✅ store   | —                     | ✅ 同源队列                            |
| `action` / `snackbarActions` | ✅         | ❌ 未执行                 | 业务钮待接 `executeNotificationAction` |


**NC-F1 基础设施**须补齐：

1. **Store 重构** — `notify` · `snackbarQueue` · `enqueueSnackbar` · `dismissSnackbar(id, reason)`（§3.1 `DOC/40`）
2. `NotificationSnackbarQueue.vue` — 唯一 `v-snackbar-queue`；关闭图标；超时 timer
3. `web/src/utils/notification-action.ts` — `executeNotificationAction`
4. `PluginUiHost` — 移除旧 `v-snackbar`；保留 confirm/progress
5. `NotificationBell` — 列表项点击标已读 + 可选 `action`



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


| 原 Import 行为 | 新 `action`                                               |
| ----------- | -------------------------------------------------------- |
| 打开世界书       | `{ type: 'library-panel', panel: 'lorebooks', focusId }` |
| 跳转对话        | `{ type: 'conversation', conversationId }`               |


`executeNotificationAction` 内部调用现有 `uiContext.requestOpenLorebooksDialog` / `router.push` 等，**不**在组件里散落导航逻辑。

### 3.4 列表与浮层行为（`[DOC/40](40-notification-center.md)` §3.1）


| 用户操作              | 浮层  | 通知列表                |
| ----------------- | --- | ------------------- |
| 点 **关闭图标**        | 出队  | **删除**该条            |
| 点 **业务文字钮**       | 出队  | **删除**该条（已互动知晓）     |
| 超时                | 出队  | **保留**（notify 时已写入） |
| `snackbar: false` | 无   | **立即写入**未读          |
| 列表项点击             | —   | 标已读（+ 可选 `action`）  |


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

与 `[DOC/04](04-TODO.md)` 对齐，建议顺序：


| 子任务         | 内容                                                                     | 状态         |
| ----------- | ---------------------------------------------------------------------- | ---------- |
| **NC-F1.0** | Store 队列语义 · `v-snackbar-queue` 单例 · 立即落盘 · 图标关闭 · 废除 `pluginSnackbar` | ✅          |
| **NC-F1.1** | `NotificationSnackbarQueue` / `NotificationBell` 执行 `action`           | ✅          |
| **NC-F1.2** | 迁移 `PromptsView` · `CharactersView` · `ChatConversationView`           | ✅          |
| **NC-F1.3** | 迁移 `ConnectionSettingsCard`                                            | ✅          |
| **NC-F1.4** | 迁移 `ImportSettingsPanel`（含 action）                                     | ✅          |
| **NC-F1.5** | 迁移群聊提示（`use-chat-outbound`）                                            | ✅          |
| **NC-F1.6** | memory 重建成功/失败 `coreNotify`                                            | ✅          |
| **NC-F1.V** | 验收：§6 手动清单 + 单测回归                                                 | ✅ 2026-07-09 |


---



## 6. 验收清单（NC-V / NC-F1.V）

> **用法**：单 Tab、已登录。每项打 `[x]`；失败项记录浏览器、步骤、截图。  
> **语义速查**（`[DOC/40](40-notification-center.md)` §3.1）：`notify` 默认 → 浮层 + **立即**入铃铛未读；**×** → 删列表；**超时** → 仅关浮层、列表保留；**业务钮** → 执行 action + 删列表。



### 6.1 自动化（已通过，回归时跑）

- [x] `npm test -w server` — 含 `notification-center.test.ts` · `notification-action.test.ts`
- [x] `npm run check:host-no-plugin-ids`
- [x] `web/src` 内除 `NotificationSnackbarQueue.vue` 外无分散 `v-snackbar`
- [x] 全库无 `host.ui.toast` / `pluginSnackbar`



### 6.2 浮层 × 列表（核心语义）


| #   | 操作                            | 预期                            | ✓   |
| --- | ----------------------------- | ----------------------------- | --- |
| A1  | 任意触发一条 success 通知（如保存 API 预设） | 底部浮层出现；铃铛角标 +1；打开列表可见**未读**条目 | [✓] |
| A2  | 同上，在浮层未消失时点 **×**             | 浮层关闭；铃铛角标归零；**列表无该条**         | [✓] |
| A3  | 同上，**不点 ×**，等浮层超时（默认 ~4s）     | 浮层消失；角标仍 +1；列表**仍保留**未读       | [✓] |
| A4  | 对 A3 保留的条目点列表 **删除** 图标       | 条目移除；角标正确                     | [✓] |




### 6.3 业务钮与铃铛跳转


| #   | 场景                             | 操作            | 预期                                      | ✓   |
| --- | ------------------------------ | ------------- | --------------------------------------- | --- |
| B1  | **设置 → 导入** · ST 聊天记录导入成功      | 浮层点「打开对话」     | 跳转到对应对话；浮层关闭；**列表无该条**                  | [✓] |
| B2  | **设置 → 导入** · ST 世界书导入成功       | 浮层点「打开世界书」    | 资料库/世界书面板打开并聚焦；列表**无该条**                | [✓] |
| B3  | memory 向量重建**成功**（对话内触发，关对话框后） | 等浮层超时，打开铃铛点条目 | 跳转到该对话；条目标**已读**并**保留**（无 snackbar 业务钮） | [✓] |
| B4  | 分支创建成功（对话页）                    | 等超时后在铃铛回顾     | 有 success 通知；可手动删除                      | [✓] |




### 6.4 插件通知


| #   | 场景                | 预期                                | ✓   |
| --- | ----------------- | --------------------------------- | --- |
| C1  | **对话导出**插件 · 导出完成 | 浮层 success；超时后铃铛**可回顾**（原 bug 回归） | [✓] |
| C2  | **剧情摘要**等 · 任务失败  | error 浮层 + 铃铛未读；× 删除或超时保留符合 A2/A3 | [✓] |
| C3  | 插件通知来源            | 铃铛条目显示**插件名**来源标签（非仅「宿主」）         | [✓] |




### 6.5 铃铛面板


| #   | 操作                        | 预期                  | ✓   |
| --- | ------------------------- | ------------------- | --- |
| D1  | **全部 / 未读** 切换            | 列表过滤正确              | [✓] |
| D2  | **级别** 下拉                 | 仅显示对应 level         | [✓] |
| D3  | **搜索** 标题/正文              | 匹配过滤；清空恢复           | [✓] |
| D4  | **全部已读**                  | 角标归零；未读高亮消失         | [✓] |
| D5  | **删除全部** / 筛选后删除          | 对应条目清空；**列表截断时**「删除已显示」仅删当前 50 条，其余仍可继续查看/分批删 | [✓] |
| D6  | 列表 >50 条（可选，devtools 灌数据） | 底部截断提示（shown/total） | [✓] |




### 6.6 宿主场景抽样


| #   | 场景                    | 预期                                | ✓    |
| --- | --------------------- | --------------------------------- | ---- |
| E1  | **连接设置** · 保存/测试失败    | error 通知；语义符合 A1–A3               | [✓]  |
| E2  | **提示词库** · 设为默认成功/失败  | success / error                   | [✓]  |
| E3  | **角色库** · 创建/导入失败     | **N/A** · §1.2 对话框/面板内 `v-alert`，不进通知中心 | [—]  |
| E4  | **群聊** · `@` 未匹配或额度提示 | warning；连续触发时**合并为一条**（dedupeKey） | [✓] 单测 + 代码 |




### 6.7 会话与持久化


| #   | 操作                 | 预期                                           | ✓                                                                    |
| --- | ------------------ | -------------------------------------------- | -------------------------------------------------------------------- |
| F1  | 产生若干未读通知后 **刷新页面** | 铃铛角标与列表从 localStorage **恢复**                 | [✓]                                                                  |
| F2  | **登出**             | 角标归零；列表空；无残留浮层                               | [✓]                                                                  |
| F3  | 登出 → 换用户登录         | 仅见当前用户通知（键 `arousal-notifications-{userId}`）；登出清内存、再登录从 localStorage 恢复 | [✓] 单测 |




### 6.8 桌面系统通知（可选）


| #   | 操作                        | 预期                     | ✓   |
| --- | ------------------------- | ---------------------- | --- |
| G1  | 铃铛内开启「桌面通知」并授权            | 开关保持                   | [✓] |
| G2  | 切到**其他 Tab/窗口**后触发 notify | OS 级通知弹出（须 **notify 时 Tab 已在后台**；前台触发后切走不补弹） | [✓] |




### 6.9 非目标（不测 / 已知限制）

- **多 Tab 实时同步**：已移除；第二 Tab 不会自动更新角标（单 Tab 主路径）
- **NC-F2 Server 推送**：未实现
- 面板内 `v-alert`（连接测试条、导入预览警告等）仍独立，**不进**通知中心
- 铃铛点击带 `action`：**标已读并保留**；与浮层业务钮「删列表」 intentionally 不同



### 6.10 签核


| 项   | 内容              |
| --- | --------------- |
| 验收人 | vevan           |
| 日期  | 2026-07-09      |
| 环境  | Chrome · 单 Tab 主路径 |
| 结果  | ☑ 通过 ☐ 有问题（见备注） |
| 备注  | §6.2–6.5 · §6.8 手动通过；A2 浮层 × 竞态已修；D5 截断列表「删除已显示」已修；C2 摘要 parse 失败通知已验；E3 按 §1.2 不纳入；E4/F3 单测 + 代码审计；811 项 `npm test -w server` · `check:host-no-plugin-ids` 通过 |




## 7. 非目标（本方案不做）

- 将面板内 `v-alert` 迁入通知中心
- Server 推送 / SSE `notifications[]`（**延后** · NC-F2 · 见 `DOC/40`）
- `dedupeKey` 全场景强制（仅群聊等高频点建议）
- 通知列表内嵌「操作按钮」UI（v1 靠 snackbar 钮 + 点击整项执行 `action` 即可）

---



## 8. 文档与类型同步


| 文件                                          | 变更                                                    |
| ------------------------------------------- | ----------------------------------------------------- |
| `[DOC/40](40-notification-center.md)`       | NC-F1.0–F1.5 已实现；代码索引更新                               |
| `[DOC/04](04-TODO.md)`                      | NC-F1 子任务勾选                                           |
| `[DOC/18](18-plugin-host-developer-api.md)` | 宿主 `coreNotify` 与插件 `notify` 共用存储                     |
| `web/src/utils/notification-storage.ts`     | ✅ `NotificationAction` 增加 `library-panel`             |
| `web/src/plugins/types.ts`                  | ✅ `PluginNotifyOptions.action` · `snackbarActions` 同步 |


---



## 9. 修订记录


| 日期         | 说明                                                                                 |
| ---------- | ---------------------------------------------------------------------------------- |
| 2026-07-09 | **NC-V / NC-F1.V 签核**：A2 · D5 体验修复 · plot-summary parse 通知 · §6.10 |
| 2026-07-09 | 移除 `persist` 选项；对齐 §3.1（立即落盘 · 手动 × 删列表）                                           |
| 2026-07-09 | **NC-F1.0–F1.5 落地**：6 处宿主 snackbar 迁移 · `coreNotify` · `executeNotificationAction` |
| 2026-07-09 | 对齐 `DOC/40`：`v-snackbar-queue` · 图标关闭 · 手动 × 删列表 · 超时保留                            |
| 2026-07-09 | 首版：宿主 6 处 snackbar 盘点 · `coreNotify` · action 路由 · 分期与验收                           |


