# Author's Note 分层（全局默认 / 会话 / 角色）— 设计定案

> **状态**：Phase 1 **已实现**（2026-06-10）；Phase 2 角色 AN 未实现。  
> **定案日期**：2026-06-10  
> **关联**：`DOC/03` §15.8（会话作者注已实现）；`DOC/26`（ST 宏对照）；`server/src/authors-note-settings.ts`、`user-preferences-file.ts`。

---

## 1. 背景

### 1.1 现状（2026-06）

| 能力 | 状态 |
|------|------|
| 会话 `authorsNote` 存储 / PATCH / 组装注入 | ✅ |
| 宏 `{{authorsNote}}` | ✅（仅会话启用时的正文） |
| 对话设置「作者注」Tab + Composer 入口 | ✅ |
| 全局 `defaultAuthorsNote` | ❌ |
| 宏 `{{defaultAuthorsNote}}` / `{{charAuthorsNote}}` | ❌ |
| 新建会话从默认 seed `authorsNote` | ❌ |

SillyTavern 在**同一对话面板**内区分：**本聊天作者注**、**角色作者注**、**默认作者注**（见 [ST Macros — authorsNote](https://docs.sillytavern.app/usage/core-concepts/macros/)）。本项目需对齐三层语义，分阶段落地。

### 1.2 与易混字段

| ST / 宏 | 字段 | 是否 Author's Note |
|---------|------|-------------------|
| `{{authorsNote}}` | 会话 `index.json` → `authorsNote` | ✅ 生效注入 |
| `{{defaultAuthorsNote}}` | 用户全局默认模板 | ✅ 模板 + 新会话 seed |
| `{{charAuthorsNote}}` | 角色级模板（ST 扩展设置；本仓库拟 `card.extensions`） | ✅ 模板 + 新会话 seed（后期） |
| `{{charCreatorNotes}}` | `creator_notes` | ❌ 创作者备注，不进组装 |
| `{{charDepthPrompt}}` | `extensions.depth_prompt` | ❌ @ Depth，非 AN |

---

## 2. 产品定案（2026-06-10）

### 2.1 三层关系（核心）

```text
defaultAuthorsNote（用户全局模板）
  │
  │  新建会话时：一次性拷贝 → index.authorsNote
  │  （之后两条线独立；改 default 不 retro 改已有会话）
  ▼
authorsNote（会话）
  │
  │  assemble 注入 + 宏 {{authorsNote}}
  ▼
模型上下文（按 injectionDepth / role 插入 message 栈）

charAuthorsNote（后期）
  └─ 新建会话 seed 时优先于 defaultAuthorsNote（见 §4.3）
```

| 原则 | 说明 |
|------|------|
| **非运行时覆盖** | assemble **只读**会话 `authorsNote`；**不**在发送时用 default 顶替已有会话字段 |
| **非宏 fallback** | `{{authorsNote}}` **不**自动展开为 default 正文；预设引用默认模板须写 `{{defaultAuthorsNote}}` |
| **改 default 不回写** | `PATCH /api/user-preferences` 更新 default **不**批量修改已有会话 |
| **seed 仅一次** | 仅在 **创建新会话**（及后期「绑定角色且会话尚无 authorsNote」等明确定义点）从模板写入会话 |

### 2.2 存储位置

| 层级 | 落盘 | API |
|------|------|-----|
| **默认** | `data/{userId}/user-preferences.json` → `defaultAuthorsNote` | `GET/PATCH /api/user-preferences` |
| **会话** | `chats/{id}/index.json` → `authorsNote` | `PATCH /api/chat/conversations/:id` |
| **角色**（Phase 2） | `characters/{id}.png` 内 `card.extensions.authors_note`（或等价键） | `PATCH /api/characters/:id` |

全局 default 与现有 `lorebook` / `history` / `memory` 等同属 **`user-preferences.json`**，**不**放入 `api-settings.json`。

### 2.3 UI（对齐 ST）

主入口：**对话内** `ConversationContextSettings` →「作者注」Tab，**同一 Tab 内分块**（上 → 下）：

1. **本对话作者注**（已有）— 编辑会话 `authorsNote`  
2. **角色作者注**（Phase 2）— 首绑卡模板；无绑卡时隐藏或禁用  
3. **默认作者注**（Phase 1）— 编辑 `defaultAuthorsNote`；文案说明「仅影响**之后新建**的会话；当前会话请改上方」

Composer 工具栏图标仍反映**本对话**启用态。系统设置页**不强制** duplicate；可选深链说明。

---

## 3. 数据模型

### 3.1 会话 `AuthorsNoteSettings`（已有）

```ts
interface AuthorsNoteSettings {
  enabled: boolean
  content: string
  injectionDepth: number   // 默认 4，上限 200
  role: 'system' | 'user'
}
```

规则（不变）：`content` trim 后为空 → `enabled` 强制 false；仅 `enabled && content` 非空时注入与宏 `{{authorsNote}}` 有值。

### 3.2 全局 `DefaultAuthorsNoteTemplate`（新增）

```ts
interface DefaultAuthorsNoteTemplate {
  content: string
  injectionDepth?: number    // 缺省 4；seed 时写入会话
  role?: 'system' | 'user'  // 缺省 system
  /** content 非空时，新会话 seed 是否默认 enabled；缺省 true */
  enabledForNewChats?: boolean
}
```

- 规范化：`normalizeDefaultAuthorsNoteTemplate`（可放在 `authors-note-settings.ts`）。  
- `content` 全空 → 新会话 **不** seed `authorsNote`（与会话缺省一致）。  
- 宏 `{{defaultAuthorsNote}}` → **始终**返回模板 `content`（trim 后），**与** `enabledForNewChats`、当前会话是否启用**无关**。

### 3.3 角色模板（Phase 2 · 预留）

```ts
// card.extensions.authors_note — 形态与会话 AuthorsNoteSettings 类似，可无 enabled
interface CharacterAuthorsNoteTemplate {
  content: string
  injectionDepth?: number
  role?: 'system' | 'user'
  enabledForNewChats?: boolean
}
```

宏 `{{charAuthorsNote}}` → 首绑卡模板 `content`（空则 `''`）。

---

## 4. 新会话 seed

### 4.1 触发点

**Phase 1**：`createConversationStub`（`server/src/chat-storage.ts`）在写 `index.json` **之前**：

1. `readGlobalDefaultAuthorsNote()`  
2. 若 `content.trim()` 非空 → `idx.authorsNote = seedAuthorsNoteFromTemplate(template)`  
3. 否则不写字段（与今日「无 authorsNote」一致）

**Phase 2**：若首绑卡含 `extensions.authors_note` 且 content 非空 → **优先于** global default seed（见 §4.3）。

### 4.2 `seedAuthorsNoteFromTemplate`

```ts
function seedAuthorsNoteFromTemplate(t: DefaultAuthorsNoteTemplate): AuthorsNoteSettings {
  const content = t.content.trim() ? t.content : ''
  const enabled = (t.enabledForNewChats !== false) && content.length > 0
  return normalizeAuthorsNote({
    enabled,
    content,
    injectionDepth: t.injectionDepth,
    role: t.role,
  })
}
```

### 4.3 Seed 优先级（Phase 2 完整）

```text
创建新会话
  → 若 characterIds[0] 有 charAuthorsNote.content → seed 自角色
  → else 若 global defaultAuthorsNote.content → seed 自全局
  → else 不写 authorsNote
```

**已有会话**：用户修改 default 或角色模板 **均不**触发回写。

### 4.4 明确不做

- assemble 时「会话无 authorsNote 则 fallback 读 default」  
- 修改 default 后批量 PATCH 所有会话  
- `{{authorsNote}}` 合并 default / char 模板  

---

## 5. 宏

| 宏 | 数据源 | Phase |
|----|--------|-------|
| `{{authorsNote}}` | 会话 `authorsNote`（启用且有 content） | ✅ 已有 |
| `{{defaultAuthorsNote}}` | `user-preferences.defaultAuthorsNote.content` | Phase 1 |
| `{{charAuthorsNote}}` | 首绑卡 `extensions.authors_note.content` | Phase 2 |

实现：`handlebars-engine.ts` 注册 helper；`buildPromptMacroContext` / `plugin-macro-expand` / `chat-assemble` 传入 default 文本（读 preferences memo）。

---

## 6. 组装与注入（不变）

注入路径仍为：

`chat-assemble` → `authorsNoteForInjection(idx.authorsNote)` → `assemblePrompts` → `injectAuthorsNoteAtDepth`

**不**为 default 单独增加注入点；default 仅通过 seed 间接进入会话。

---

## 7. HTTP API

### 7.1 `GET /api/user-preferences`

响应增加（缺省归一化后）：

```json
{
  "defaultAuthorsNote": {
    "content": "",
    "injectionDepth": 4,
    "role": "system",
    "enabledForNewChats": true
  }
}
```

### 7.2 `PATCH /api/user-preferences`

Body 可选字段：

```json
{
  "defaultAuthorsNote": {
    "content": "…",
    "injectionDepth": 4,
    "role": "system",
    "enabledForNewChats": true
  }
}
```

传 `null` 表示清除为默认空模板（实现时定案：整对象 null vs 逐字段）。

校验错误码：沿用 `authors_note_*` 命名风格或新增 `default_authors_note_*`。

---

## 8. 前端

| 模块 | Phase 1 |
|------|---------|
| `web/src/utils/authors-note-settings.ts` | 增加 default 类型与 normalize（或与 server 镜像） |
| `web/src/stores/preferences.ts` | load / debounced patch `defaultAuthorsNote` |
| `ConversationContextSettings.vue` | Tab 内增加「默认作者注」区块 |
| `web/src/locales/*.json` | 文案：不影响当前会话、仅新会话 |

---

## 9. 分期

### Phase 1（全局 default）✅

- [x] `user-preferences.json` + read/update helpers  
- [x] `GET/PATCH /api/user-preferences`  
- [x] `createConversationStub` seed  
- [x] `{{defaultAuthorsNote}}`  
- [x] 对话设置 Tab「默认作者注」区块  
- [x] 单测：normalize、seed、宏  

### Phase 2（角色 AN）

- [ ] `card.extensions.authors_note` 读写（角色 PATCH / 导入规范化）  
- [ ] seed 优先级：角色 > default  
- [ ] `{{charAuthorsNote}}`  
- [ ] Tab「角色作者注」区块（首绑卡）  
- [ ] 角色库编辑（可选，与 ST 卡迁移）  

---

## 10. 验收要点

**Phase 1**

1. 设置 default content 非空 → 新建会话 `index.authorsNote` 已写入且 enabled 符合 `enabledForNewChats`。  
2. 修改 default → 已有会话 `authorsNote` **不变**。  
3. 会话启用 AN → assemble 注入；`{{authorsNote}}` 有值；`{{defaultAuthorsNote}}` 仍为全局模板原文。  
4. default content 空 → 新建会话无 `authorsNote` 字段；行为与改前一致。  
5. UI 三块布局：本对话 / 默认（角色块 Phase 2 占位或隐藏）。

**Phase 2**

6. 绑含角色 AN 的卡新建会话 → seed 自角色而非 default。  
7. `{{charAuthorsNote}}` 与角色模板一致，与会话 enabled 无关。

---

## 11. 参考

| 资源 | 路径 |
|------|------|
| 会话 AN 实现 | `server/src/authors-note-settings.ts`、`assemble-prompts.ts` §injectAuthorsNoteAtDepth |
| 用户偏好 | `server/src/user-preferences-file.ts` |
| 创建会话 | `server/src/chat-storage.ts` → `createConversationStub` |
| ST 宏对照 | `DOC/26` §5 |
| ST 官方 | [Macros](https://docs.sillytavern.app/usage/core-concepts/macros/) · [Author's Note](https://github.com/SillyTavern/SillyTavern-Docs/blob/main/Usage/Characters/Author's-Note.md) |

---

*文档版本：2026-06-10 · 定案待实现*
