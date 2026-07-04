# SillyTavern 宏移植可行性（备忘）

> **状态**：规划备忘；**已实现清单**见 **`DOC/26-st-macros-compatibility.md`**（Phase A ✅）。  
> **目的**：对照 [SillyTavern Macros](https://docs.sillytavern.app/usage/core-concepts/macros/) 评估「把 ST 宏能力迁到本项目」的可行范围与难度，供后续选型。  
> **非目标**：本文不是「为兼容 ST 而做」的决策记录；ST 宏在预设/角色卡/世界书里确实好用，值得单独评估。  
> **本项目现状**：运行时宏见 `DOC/03-实现细节.md` §15；实现目录 `server/src/prompt-macros/`（Handlebars）。

---

## 1. 架构差异（决定上限）

| 维度 | SillyTavern | arousalPub（当前） |
|------|-------------|-------------------|
| 引擎 | 实验性宏引擎：嵌套、作用域块、稳定求值顺序 | **Handlebars** helper + 预处理（`::` / legacy）；无嵌套/变量 |
| 语法 | `{{if}}` / `{{else}}` / `{{/macro}}`、`::` 多参、变量简写 `.` `$` | 仅 `{{name}}` / `{{name N}}` 形态 |
| 嵌套 | 内层先展开，如 `{{getvar::{{char}}_mood}}` | **不支持**；未知 → `[name UNSUPPORTED]` |
| 变量 | local/global + 运算符全家桶 | **无** 变量存储 |
| 角色字段 | 大量 `{{description}}` 等宏 | 角色字段经 **`prompt-xml`** 注入 `<char>`，与宏并行 |
| 群聊 | `{{group}}` 等 | 已实现，定案 [`DOC/35`](35-group-chat.md) §5（G0–G5） |
| Instruct | 整套 `{{instruct*}}` | **无** instruct 模板层（XML slot + 预设条目） |

**结论**：要接近 ST「好用」的 **条件分支 + 变量 + 嵌套**，不能只加 handler，需要 **第二套模板引擎**（或引入现成 parser）；在现有管线上「堆正则」会在 `{{if}}` / 变量处很快撞墙。

---

## 2. 本项目已支持（与 ST 同名或近似）

| ST 宏 | 本项目 | 备注 |
|-------|--------|------|
| `{{user}}` | ✅ | `userName` 快照 |
| `{{char}}` / `{{charN}}` | ✅ | `characterNames[]` 顺序 |
| `{{date}}` `{{time}}` | ✅ | `Intl`，locale 默认 `en` |
| `{{datetime}}` | ✅ | 日期+时间拼接 |
| `{{model}}` | ✅ | 组装时 `tokenModel` |
| `{{maxPrompt}}` / `{{maxContextTokens}}` | 近似 | 本项目为 `{{maxprompt}}` `{{context}}`（连接 `contextLength`） |
| `{{newline}}` | ✅ | |
| 未知 `{{…}}` | `[name UNSUPPORTED]` | ST 通常保留或按引擎处理 |

**调用点**：`assemble-prompts.ts` 在 token 裁切前展宏；`opening` 落盘前展宏；插件 host 暴露 `applyPromptMacroPipeline`。

---

## 3. 移植分级

难度：**低** ≈ 扩 `PromptMacroContext` + 新 handler（1～3 天量级）  
**中** ≈ 组装链路要带历史/时间戳/多 receive 状态（约 1～2 周）  
**高** ≈ 新引擎或持久化子系统（数周+）

### 3.1 低难度 — 可行，数据大多已有

| ST 宏 / 能力 | 可行性 | 说明 |
|--------------|--------|------|
| `{{description}}` `{{personality}}` `{{scenario}}` | ✅ | 角色卡字段已有；需在 `buildPromptMacroContext` 传入首绑卡或 `BoundCharacterSlice` 原文 |
| `{{persona}}` | ✅ | `userCharacter` / persona 卡 `description` 等 |
| `{{mesExamples}}` / `{{mesExamplesRaw}}` | ✅ | `mes_example`；Raw 即不套 instruct 格式 |
| `{{charPrompt}}` / `{{charInstruction}}` | ✅ | 对应 `system_prompt` / `post_history_instructions` |
| `{{charCreatorNotes}}` | ✅ | `creator_notes` |
| `{{charVersion}}` | ✅ | `character_version` |
| `{{charFirstMessage}}` / `::index` | ✅ | `first_mes` / `alternate_greetings`；opening 流程已有 |
| `{{weekday}}` `{{isodate}}` `{{isotime}}` | ✅ | 扩展 `datetime` handler |
| `{{datetimeformat::…}}` | ✅ | `Intl` 或轻量 format 库 |
| `{{time::UTC±offset}}` | ✅ | `Intl` timeZone |
| `{{newline::n}}` `{{space}}` `{{space::n}}` | ✅ | 纯文本工具 |
| `{{noop}}` `{{trim}}` `{{reverse::…}}` | ✅ | |
| `{{random::a::b::c}}` `{{roll::1d20}}` | ✅ | 无状态随机；`roll` 需 droll 语法子集 |
| `{{input}}` | ✅ | 组装上下文已有 `userInput` |
| `{{lastGenerationType}}` | ✅ | 已有 `promptTrigger`：`normal` / `continue` / `swipe` / `regenerate` |
| `{{maxResponseTokens}}` | ✅ | 连接面板有 `maxTokens`；需传入 macro ctx（当前未传） |
| Legacy `<USER>` `<BOT>` `<CHAR>` | ✅ | 预处理替换为 `{{user}}` 等 |
| `{{charDepthPrompt}}` | 视数据 | 若卡 `extensions` 含 depth 字段则可读；否则空 |

### 3.2 中难度 — 可行，需扩组装上下文或存储

| ST 宏 / 能力 | 可行性 | 说明 |
|--------------|--------|------|
| `{{lastMessage}}` `{{lastUserMessage}}` `{{lastCharMessage}}` | ✅ | `memoryPipeline` / chunk 尾块可读；需在 assemble 前注入 ctx |
| `{{lastMessageId}}` 等索引宏 | 部分 | 本项目为 **turnOrdinal + receive**，需定义与 ST messageId 的映射文档 |
| `{{firstIncludedMessageId}}` | ✅ | token 裁切后记录「保留的第一条 history」 |
| `{{allChatRange}}` | ✅ | 用 `0-(lastOrdinal)` 等约定生成 |
| `{{lastSwipeId}}` `{{currentSwipeId}}` | ✅ | `TurnRecord.receives` + `activeReceiveIndex` 已有 |
| `{{idleDuration}}` | ✅ | 需 turn 时间戳（若无则落盘时写入） |
| `{{timeDiff::left::right}}` | ✅ | 依赖时间戳 |
| `{{pick::…}}` 稳定随机 | ✅ | 需 per-conversation 种子 + 位置哈希；可选 `/reroll-pick` API |
| `{{hasExtension::name}}` | ✅ | 对照 `plugin-system/registry` |
| `{{original}}` | 待产品 | ST 用于角色覆盖替换；需明确在本项目预设/绑定槽中的语义 |
| `{{notChar}}` | 部分 | 多卡绑定时可列「除主卡外」；无「当前发言者」则无 ST 群聊语义 |
| `{{isMobile}}` | 可选 | 请求头或前端预览参数传入 |

### 3.3 高难度 — 可行但建议单独立项（引擎级）

| ST 能力 | 可行性 | 说明 |
|---------|--------|------|
| `{{if}}` / `{{else}}` / scoped `{{/macro}}` | 需新引擎 | 条件、trim、dedent 与现有单遍正则不兼容 |
| 嵌套宏 | 需新引擎 | 多轮展开直到不动 |
| `{{//}}` 注释、`\{\{` 转义 | 需新引擎 | |
| 宏标志 `#` `!` `?`（含 ST planned） | 需新引擎 | |
| 变量全套 `getvar` / `setvar` / global + 简写运算符 | 需新引擎 + **持久化** | 按会话/角色/全局 scope 设计存储（JSON 或 sqlite） |
| `{{setvar}}` 在组装过程中副作用 | 需谨慎 | 影响同条预设多次组装、预览 vs 发送一致性 |
| 前端宏自动补全、`/? macros` | 独立 UI | 与运行时引擎解耦 |

### 3.4 不可行或产品不对齐（短期不建议硬迁）

| ST 宏 / 能力 | 结论 | 原因 |
|--------------|------|------|
| `{{group}}` `{{groupNotMuted}}` `{{charIfNotGroup}}` | ✅ | 群聊 enabled 时生效；见 [`DOC/35`](35-group-chat.md) §5 |
| 全套 `{{instruct*}}` `{{chatSeparator}}` `{{chatStart}}` 等 | ❌ | 无 instruct 模式字符串层 |
| `{{authorsNote}}` | ✅ | 会话 `index.json` `authorsNote`（已启用时正文） |
| `{{defaultAuthorsNote}}` | ✅ | **`DOC/28`**：`user-preferences.defaultAuthorsNote`；新会话 seed |
| `{{charAuthorsNote}}` | ⏳ | **`DOC/28` Phase 2**：`card.extensions.authors_note` |
| `{{systemPrompt}}` `{{defaultSystemPrompt}}` | 不对齐 | 预设条目 + 绑定槽，非 ST 单一 system 字段 |
| `{{outlet::key}}` | ❌ | 世界书无 ST **outlet** 概念 |
| `{{summary}}` | ❌ | 无 ST Summarize 扩展对接 |
| `{{banned::word}}` | ❌ | Text Completion 后端专用 |
| `{{charPrefix}}` `{{charNegativePrefix}}` | ❌ | 无 SD 生图前缀链路 |
| `{{reasoningPrefix}}` 等 | 视后端 | 仅有 receive `reasoning` 字段，无统一 reasoning 模板宏 |
| ST 实验宏引擎 **整包 parity** | 不划算 | 应选型嵌入模板库，而非复刻 ST JS |

---

## 4. 推荐实施顺序（若将来做）

1. **Phase A（低）**：角色卡字段宏 + 日期扩展 + `{{maxResponseTokens}}` + 工具宏（`space` / `roll` / `random`）— 仍用 handler 表。  
2. **Phase B（中）**：历史/ swipe / `{{input}}` / `{{pick}}` — 扩展 `buildPromptMacroContext` 入参，assemble 前读尾 chunk。  
3. **Phase C（高）【已完成 · 2026-06】**：Handlebars + 预处理链（`if`/scoped/嵌套/注释/转义）；变量持久化：`ConversationIndex.macroLocalVars` + `user-preferences.macroGlobalVars`。  
4. **文档与兼容**：ST 宏名别名表（如 `maxPrompt` → `maxprompt`）；`[name UNSUPPORTED]` vs ST 空串行为要在发行说明写清。

---

## 5. 与现有设计的边界

- **角色 XML 注入**（`cardRecordToCharXmlBlock`）与 **宏** 并存：预设里写 `{{description}}` 会得到纯文本字段；写 `<inject slot="character_card" />` 仍得整卡 XML。产品需约定推荐写法，避免同一信息重复注入。  
- **仅服务端展宏**（§15 原则）不变；任何 Phase 的前端补全都是编辑器体验，不是第二套替换逻辑。  
- **插件**：`host-api` 已暴露 `applyPromptMacroPipeline`；新宏若带副作用（变量），需定义插件调用是否共享同一 ctx。

---

## 6. 参考

- ST 官方：[Macros](https://docs.sillytavern.app/usage/core-concepts/macros/)  
- 本项目：`server/src/prompt-macros/`、`DOC/03-实现细节.md` §15  
- 组装：`server/src/assemble-prompts.ts`、`server/src/chat-assemble.ts`  
- 角色 XML：`server/src/prompt-xml.ts`

---

*文档版本：2026-06-02 · 与代码快照对应 `prompt-macros` handler 表（user-char / datetime / connection / newline / unset）*
