# 角色卡内嵌世界书（character_book）— 设计定案

> **状态**：设计定案，**未实现**（**P2**，见 `DOC/04-TODO.md`）。  
> **定案日期**：2026-06-10  
> **关联**：`DOC/03` §12（角色卡）、§13（资料库 / Lorebook）、§6.6（组装槽位）；`DOC/26`（ST 迁移）；[Tavern Card V2 — character_book](https://github.com/malfoyslastname/character-card-spec-v2/blob/main/spec_v2.md)。

---

## 1. 背景

### 1.1 现状

- **存储**：`normalizeTavernCardV2Data`（`server/src/character-png.ts`）在导入 / PATCH 时**透传** `character_book`，写入 PNG `chara` 元数据。
- **组装**：`chat-assemble.ts` **不读取**内嵌书；会话 lore 仅来自 `lorebookIds` → `lorebook-resolve.ts` → `ctx.world` / `boundWorld`。
- **UI**：角色库可编辑 `card` 扁平字段，**无**内嵌世界书查看 / 编辑界面。

### 1.2 目标

从 SillyTavern 等生态导入的角色卡，其 **`data.character_book`** 应在聊天组装时参与 lore 注入，与会话绑定的资料库**叠加**，且**内嵌优先**；XML 形态与现有 `<lores>` 管线一致，尽量对齐 V2 spec 的条目语义。

---

## 2. 产品定案（2026-06-10）

| # | 决策 | 说明 |
|---|------|------|
| 1 | **每卡一节 `<lorebook name="…">`** | 多绑卡时按 **`characterIds` 顺序**各输出一节；`name` 取角色卡 `name`，缺省 fallback `角色N`。 |
| 2 | **叠加 + 内嵌优先** | 内嵌书与会话 `lorebookIds` **同时 resolve**；冲突时内嵌侧优先（见 §4.3）。**不是**「有内嵌则完全忽略会话资料库」。 |
| 3 | **尽量对齐 V2 spec** | `position`、`selective`、`case_sensitive`、`insertion_order`、`priority` 等按 spec 映射；缺省 **`position = after_char`**。 |
| 4 | **触发模式** | 内嵌书**仅**支持 **恒定注入**（`constant: true`）与 **关键词匹配**（`keys[]`）。**不支持 vector**；条目若标为 vector 扩展则跳过或在 audit 标 `unsupported_vector`。 |
| 5 | **UI** | **后期**在角色库增加内嵌世界书 **查看 / 编辑**（与独立「世界书」模态能力对齐的子集）；**不**纳入本项 MVP 实现范围。 |

**优先级**：**P2**（服务端组装与适配优先；UI 可列为 P2 后期或 P2 子阶段）。

---

## 3. 与会话资料库的关系

### 3.1 叠加顺序（XML）

组装输出的 lore XML 建议顺序：

1. **内嵌**：按 `characterIds` 顺序，每卡一个 `<lorebook name="角色名">`（该卡 `after_char` 条目 + 命中 keyword 条目）。
2. **会话**：按 `lorebookIds` 顺序，现有 `formatLoresXmlGroupedBlock` 行为不变。

同一 `<lores>` 根下可包含多个 `<lorebook>`  sibling；内嵌节在前，会话节在后。

### 3.2 扫描语料

与 §13.5 一致：`scanCorpus = buildScanText(userText, memoryText, historyText)`（`chat-assemble` 在 memory / history 就绪后调用）。内嵌与会话 lore **共用**同一语料与递归深度上限（默认最多 2 轮）。

### 3.3 内嵌优先（冲突与裁切）

| 场景 | 规则 |
|------|------|
| **正文 dedupe** | 相同 `content` 或同 keys 命中时，**保留内嵌侧**，会话侧重複条目不重复注入。 |
| **Token 裁切** | `prompt-budget-trim` 裁 matched lore 时，**先裁会话侧**，后裁内嵌侧；同 `priority` 时会话条目优先被丢弃。 |
| **constant** | 内嵌 constant 与会话 constant **均注入**（除非 dedupe）；裁切策略上内嵌 constant 保护级别 ≥ 会话 constant（实现时可与现有「constant 组」逻辑合并）。 |

### 3.4 无内嵌时的回退

绑定卡均无 `character_book` 或 entries 全空 / 全 disabled → 行为与**当前仓库一致**（仅 `lorebookIds`；未绑则回退全部资料库）。

---

## 4. ST `character_book` → 内部模型

### 4.1 虚拟资料库（每卡一本）

```ts
// 概念类型（实现时放 server/src/character-book-adapt.ts 或同类模块）
interface EmbeddedLorebook {
  source: 'embedded'
  characterId: string
  lorebookName: string   // card.name
  entries: AdaptedEmbeddedEntry[]
  bookSettings?: {
    scan_depth?: number
    token_budget?: number
    recursive_scanning?: boolean
  }
}
```

- **范围**：仅 **`characterIds` 中的 AI 绑定卡**；不含 `userCharacterId`（persona 用户卡），除非后续产品另行定案。
- **条目 ID**：`embedded:{characterId}:{index}`（或稳定 hash），避免与会话 `entry-*` 在 audit / `seenEntryIds` 冲突。

### 4.2 条目字段映射

| ST 字段 | 内部行为 |
|---------|----------|
| `enabled` | `false` → 跳过 |
| `content` | 空 → 跳过 |
| `constant: true` | 恒定注入 |
| `keys[]` | 关键词；**非 constant 且 keys 为空 → 不注入**（与会话 lore 一致） |
| `insertion_order` | 排序主键（升序） |
| `priority` | 裁切分数；**数值越低越先被裁**（与 spec「低 priority 先丢」一致） |
| `case_sensitive` | `true` → 区分大小写匹配；`false` → 现有 `scanLower` 逻辑 |
| `selective` + `secondary_keys` | `selective: true` 时 **`keys` 与 `secondary_keys` 均须命中** |
| `position` | `before_char` \| `after_char`；**缺省 `after_char`** |
| `name` / `comment` | → `<lore name="…">` 标题（优先 `name`，fallback `comment`） |
| `extensions` | 只读透传，不参与 resolve |

**不支持**：vector、`triggerMode=vector`、内嵌条目的 Lance 索引。若条目仅能通过 vector 触发，**不注入**并在 debug audit 记录原因。

### 4.3 `position` 与组装槽位

默认预设分组顺序：**Character → World → History**（`prompts-default-seed`）。

| `position` | 注入落点 |
|------------|----------|
| **`after_char`**（缺省） | 现有 **`ctx.world` / `boundWorld`**（World 组在 Character 之后，语义与 ST 一致） |
| **`before_char`** | **Character 组内、角色 XML 之前**（**新能力**） |

实现要点：

- `assemblePrompts` 增加例如 **`ctx.embeddedLoreBeforeChar?: string`**（已格式化的 `<lores>…</lores>` 块）。
- `character` 组在 `mergedCharacterCardBody` **之前** push 一条 system message。
- `after_char` 内嵌条目与会话 lore 合并进 `ctx.world`；组内顺序：内嵌 constant → 内嵌 matched → 会话 constant → 会话 matched（或按现有 trim 分组约定）。

---

## 5. 实现管线（规划）

```text
buildConversationOutboundMessages
  ├─ loadBoundCharacterSlices(characterIds)     // 保留 character_book
  ├─ adaptEmbeddedLorebooks(characters)         // ST entries → EmbeddedLorebook[]
  ├─ resolveEmbeddedLoreParts(books, scanCorpus) // 仅 constant + keyword
  ├─ resolveSessionLoreParts(lorebookIds, …)    // 现有 lorebook-resolve
  ├─ mergeWithEmbeddedPrecedence(embedded, session)
  ├─ splitByPosition(before_char | after_char)
  └─ assemblePrompts({
        embeddedLoreBeforeChar?,
        world: after_char_embedded + session,
        …
     })
```

### 5.1 复用模块

| 模块 | 改动 |
|------|------|
| `lorebook-resolve.ts` | 抽公共 resolve 或并行 `resolveEmbeddedLoreParts` |
| `prompt-xml.ts` | 继续 `formatLoresXmlGroupedBlock` / `formatLoresInjectionXml` |
| `chat-assemble.ts` | 内嵌 resolve + merge + 传入 assemble ctx |
| `assemble-prompts.ts` | `embeddedLoreBeforeChar` 注入点 |
| `prompt-budget-trim.ts` | embedded / session 来源标记 + 裁切顺序 |
| `buildAssemblyAudit` | `lore.matched[]` 增加 `source: 'embedded' \| 'session'`、`characterId?`、`position?` |

### 5.2 宏与 regex outgoing

- Lore 正文进入 messages 后仍走 **`applyPromptMacroPipeline`**（与会话 world 一致）。
- **`regex-outgoing`**：纯 `<lores>` 块不走 memory XML 重建路径；与现 world 行为一致。

---

## 6. 分期

### Phase 1（P2 · 服务端 MVP）

- [ ] `character-book-adapt.ts`：ST JSON → `EmbeddedLorebook`
- [ ] `resolveEmbeddedLoreParts`：constant + keyword（含 selective / case_sensitive）
- [ ] `after_char` → `ctx.world`；`before_char` → `embeddedLoreBeforeChar`
- [ ] 与会话 lore 叠加 + 内嵌优先 dedupe / trim
- [ ] 审计字段 `source: embedded`
- [ ] 单元测试：适配、position 拆分、merge 优先级

### Phase 2（P2 · UI，后期）

- [ ] 角色详情 / 编辑：内嵌世界书 **只读预览**（条目列表、constant / keys / position）
- [ ] **编辑**：增删改条目、保存回 `card.character_book`（`PATCH /api/characters/:id`）
- [ ] 可选：「拆分为独立资料库」工具（导入迁移辅助）
- [ ] 会话设置说明文案：内嵌书与会话资料库叠加、内嵌优先

---

## 7. 边界与易错点

| 场景 | 处理 |
|------|------|
| 多卡均有内嵌书 | 各一节 `<lorebook>`，**不**跨卡合并 |
| 某卡内嵌书本轮零命中 |  omit 该 `<lorebook>`（与会话多本行为一致） |
| 书级 `recursive_scanning` | Phase 1 可继承全局 `maxRecursionDepth`；书级 `scan_depth` / `token_budget` 可 Phase 2 |
| persona 用户卡 | 默认不参与内嵌 resolve |
| 导入 PNG 含 character_book | 存储已有；Phase 1 组装即可生效，无需用户再绑资料库 |

---

## 8. 与 ST spec 的差异（ intentional ）

| 项目 | 本仓库定案 | 备注 |
|------|------------|------|
| 触发 | 仅 constant + keyword | ST 生态可有 vector 等扩展 |
| 内嵌编辑 | Phase 2 UI | spec 要求可编辑；当前只透传 JSON |
| 叠加 | 内嵌 + 会话均注入 | 与 spec「角色书优先于 world book」一致；非「内嵌独占」 |

---

## 9. 验收要点（实现后）

1. 导入含 `character_book` 的 ST v2 卡，绑定对话，keyword 命中后 outbound 含 `<lorebook name="角色名">`。
2. 多绑卡时 `<lorebook>` 顺序与 `characterIds` 一致。
3. 同时勾选会话资料库：XML 中内嵌节在前；重复 content 不双份。
4. `before_char` 条目出现在 Character 组、卡 XML 之前；`after_char` 在 World 槽。
5. Token 紧张时会话 matched 先于内嵌 matched 被裁。
6. Debug 审计可区分 `embedded` / `session`。
