# 插件系统与首个插件「指导生成」— 设计定案

> **状态**：设计已定；**代码进行中**（首个插件 `guidance-generate`）。  
> **关联**：`DOC/01` §7、`DOC/03` §1.2–1.4、`DOC/03` §6.8 `turn.plugins[]`；Web 预留 `data-plugin-slot`。

---

## 1. 已定原则

| 项 | 定案 |
|----|------|
| 插件代码位置 | **`data/{userId}/plugins/<pluginId>/` 动态加载**（首版可内置 `server/src/plugins/` 验证后再迁出） |
| Hook 冲突 | **`plugin-registry.json` 内 `order` 排序**，同 phase 内小者优先，后者看到已更新的 `ctx` |
| Syncthing | **默认可信圈**；`settings.json`、**`secrets/`（加密）**、代码包与 registry **可同步** |
| 轮次 state | **跟 `turnId`**；存 chunk **`turn.plugins[]`**，不污染可见 `send.userText` |
| Opening / 预览 | **与正常发消息共用 `PluginHost` pipeline**；预览 / dryRun 不写盘 |

---

## 2. 目录布局

```text
data/{userId}/
  plugin-registry.json
  plugins/
    guidance-generate/
      manifest.json
      settings.json          # 用户可改（可选：记住上次指导等）
      secrets/               # 服务端读；Syncthing 同步（可信环境）
      dist/
        server.mjs           # export hooks
        web.mjs              # export UI slot 组件
```

### 2.1 `plugin-registry.json`

```json
{
  "version": 1,
  "plugins": [
    { "id": "guidance-generate", "enabled": true, "order": 10 }
  ]
}
```

- **`order`**：全局 hook 优先级（升序执行）。
- **`enabled: false`**：不加载代码，不跑 hook。

### 2.2 `manifest.json`（每插件）

```json
{
  "id": "guidance-generate",
  "name": "指导生成",
  "version": "1.0.0",
  "permissions": ["turn.read", "turn.plugins.write", "prompt.inject"],
  "hooks": ["afterAssemblePrompts", "onTurnPersisted"],
  "ui": {
    "slots": [
      { "name": "composer-toolbar", "entry": "./dist/web.mjs" },
      { "name": "user-turn-footer", "entry": "./dist/web.mjs" }
    ]
  },
  "connection": { "policy": "userFirst" }
}
```

---

## 3. PluginHost 与 Hook Phase

参考 **`prompt-macros/handlers`** 的有序 handler 表；各 phase 对 `ctx` 只通过声明式字段合并（同 `pluginId` payload 覆盖）。

| Phase | 时机 | 典型用途 |
|-------|------|----------|
| `beforeAssemble` | memory / lore 之前 | 改 scan 语料 |
| `afterMemoryPipeline` | memory 之后 | 追加 memory 文本 |
| `afterLoreResolve` | lore 之后 | 动态 world |
| `beforeAssemblePrompts` | `assemblePrompts` 前 | 扩展 `AssembleContext` |
| **`afterAssemblePrompts`** | 宏 / token 裁切前后 | **插入 messages（指导生成）** |
| `beforeChatRequest` | 上游前 | 改 sampling |
| `afterChatComplete` | 流结束 | 统计 |
| `onTurnPersisted` | chunk 落盘后 | 异步任务 |

**Opening**：`POST .../opening` 与 `buildConversationOutboundMessages` 均调用同一 pipeline（`ctx.dryRun` 区分预览）。

**ctx 合并**：

- 改 `messages[]`：优先 **append** 或带 `injectionKey` 的 replace。
- 改 `turn.plugins`：按 `pluginId` 键合并。

---

## 4. API 与出站

- 插件 HTTP：**仅** `POST /api/plugins/:pluginId/invoke`（及 manifest 声明的 proxy）。
- 发消息扩展（指导生成等）：

```json
{
  "conversationId": "...",
  "userText": "user举起了剑",
  "regenerateTurnOrdinal": 12,
  "plugins": {
    "guidance-generate": {
      "mode": "send",
      "guidanceText": "user手滑了一下"
    }
  }
}
```

- `mode`: `"send"` | `"regenerate"`。
- 密钥解析仍走 `DOC/03` §1.2.1 `resolvedPlugin(pluginId)`（本插件首版无出站）。

---

## 5. Syncthing 分层

| 层级 | 路径 | 策略 |
|------|------|------|
| **权威** | `chats/**/turn-*.json`（含 `turn.plugins`） | 必须同步 |
| **权威** | `plugin-registry.json`、`plugins/*/manifest.json`、`settings.json` | 必须同步 |
| **可信同步** | `plugins/*/secrets/` | 用户确认 Syncthing 圈可信 |
| **派生** | `memory/` Lance、`plugins/*/.cache/`、向量索引 | 可删重建；勿依赖半写 Lance |
| **Sidecar** | `chats/{id}/plugin-data/{turnId}/{pluginId}/` | 大二进制；chunk 内只存 ref |

写盘：整文件 `writeFile`；chunk 滚动顺序见 `DOC/08`。

---

## 6. 首个插件：`guidance-generate`（指导生成）

### 6.1 行为摘要

- **用户输入**（可见）：进入 chunk `send.userText`，显示为 user 气泡。
- **指导输入**（隐藏）：作为 **最后一条 `system`** 插在 **本轮 `user` 消息之前** 注入 `messages[]`；**不**显示为气泡。
- 示例：用户「user举起了剑」+ 指导「user手滑了一下」→ 模型可回复「圣剑掉在地上…」；界面无指导句。

### 6.2 Prompt 插入位置

```text
… character / world / memory / history …
→ [system] 指导内容（插件）
→ [user] 用户输入（可见、落盘）
```

指导正文走 **`applyPromptMacroPipeline`**（与 opening 一致）。

### 6.3 持久化

```json
{
  "pluginId": "guidance-generate",
  "schemaVersion": 1,
  "payload": {
    "guidanceText": "user手滑了一下"
  }
}
```

- 写入 **`turn.plugins[]`**（按 `turnId` / 该轮落盘）。
- **再生**：默认复用同 turn 已存 `guidanceText`；本次弹框可覆盖。
- **`chat-prompt.json`**（debug）：可见完整 messages（含 hidden system）。

### 6.4 界面（两个入口、一个弹框）

**弹框**（始终可通过按钮打开）：

| 区域 | 说明 |
|------|------|
| 上方 | **用户输入**（多行） |
| 下方 | **指导输入**（多行） |
| 按钮 | 取消；**发送** 或 **重新生成**（随模式变文案） |

**发送启用条件**：弹框内 **用户输入与指导输入均非空**（打开按钮本身始终可点）。

#### 入口 A — Composer 工具栏

- **位置**：`data-plugin-slot="composer-toolbar"`（输入框下方）。
- **按钮**：始终可点击 → 打开弹框。
- **预填**：若底部 **`userInput` 非空**，同步到弹框上方用户输入。
- **模式**：`send`（新发一轮）。
- **流程**：与 `send()` 类似 — `appendPendingUserTurn` → `POST /api/chat`（带 plugins）→ 落盘 → `loadMessages`；成功后清空 composer（可选）。

#### 入口 B — 最后一条用户气泡下

- **位置**：**仅列表最后一条 `user.trim()` 非空的 turn** 下方（`user-turn-footer` slot）。
- **预填**：该 turn 的 `user` → 弹框上方。
- **模式**：`regenerate`（不新增 turn）。
- **流程**：对齐 `regenerateAssistant` — `regenerateTurnOrdinal` + `historyBeforeTurnOrdinalExclusive`；**追加**新 `receive`。
- **若弹框内用户文与磁盘不一致**：服务端 **先 PATCH/更新 turn.user** 再组装（避免气泡与 prompt 不一致）。

### 6.5 与普通发送的关系

- 底部主 **「发送」**：无指导的普通发送（不变）。
- **指导发送**：仅经弹框确认，避免混淆。

### 6.6 边界

| 场景 | 行为 |
|------|------|
| 预览组装 | 未带 `plugins.guidance-generate` 时不注入指导 |
| 开场仅助手 | 无 user 气泡 → 不显示入口 B |
| loading / 再生中 | 可开弹框，弹框内发送禁用 |
| opening 路由 | 走同一 hook 链；本插件 UI 不绑 opening |

---

## 7. 实现顺序（代码）

1. **`PluginHost` 骨架** + 内置 `guidance-generate` server hook（`afterAssemblePrompts`）。
2. **`ChatBody.plugins`** + 落盘 **`turn.plugins`** + regenerate 路径。
3. **Web**：共用弹框 + composer 按钮 + 最后 user footer 按钮 + i18n。
4. **`plugin-registry.json` 样例** + `data/README` 路径说明。
5. （后续）动态 `import` 用户目录 `plugins/*/dist/server.mjs`；Web slot 动态加载。

---

## 8. 验收清单

- [ ] Composer 指导按钮始终可开弹框；composer 有字时预填用户框。
- [ ] 弹框双输入；两者非空才可发送。
- [ ] 新发：仅 user 气泡可见；模型受指导影响；`turn.plugins` 有 payload。
- [ ] 最后 user 下按钮仅最后一个 user turn 显示；带指导再生追加 receive。
- [ ] `assemble-messages` / opening 共用 hook；预览无 plugins 时不注入。
- [ ] `chat-prompt.json` debug 可见 hidden system。
