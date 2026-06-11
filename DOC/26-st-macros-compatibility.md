# SillyTavern 宏 ↔ 本地宏兼容对照

> **状态**：随 `macro-engine` 分支维护；**Phase A 已实现**（2026-06）。  
> **目的**：对照 [SillyTavern Macros](https://docs.sillytavern.app/usage/core-concepts/macros/) 列出「已兼容 / 部分兼容 / 未实现 / 不对齐」清单，便于迁移预设、角色卡与世界书。  
> **实现**：`server/src/prompt-macros/`（默认 **legacy** Handlebars 引擎；可选 **CST** 见 **`DOC/29-cst-macros-compatibility.md`**）；可行性分级见 **`DOC/14-st-macros-porting.md`**；运行时原则见 **`DOC/03-实现细节.md` §15**。

---

## 1. 图例

| 标记 | 含义 |
|------|------|
| ✅ | 已实现，ST 同名或文档列出的 `::` 形态可用 |
| ⚠️ | 部分兼容：语义/数据源/别名与 ST 有差异（见备注） |
| ⏳ | 规划内、尚未实现（Phase B/C） |
| ❌ | 短期不移植或产品不对齐 |

**本地独有行为**

- 未知 `{{…}}` → **`[name UNSUPPORTED]`**（ST 常保留原文或按引擎处理）；行尾未闭合的 `{{token` 亦标为 **`[UNSUPPORTED]`**。
- Handlebars **编译/执行失败** 时，剩余完整 `{{…}}` → **`[name RENDERFAIL]`**（与 UNSUPPORTED 区分，便于排查模板语法错误）。
- ST 块语法 `{{if}}` / `{{else}}` / `{{/if}}` 经预处理为 Handlebars `stIf` helper；原生 `{{#if}}` 仍按未知宏处理。
- 宏 **仅服务端** 展开；Web 预览/审计展示 API 返回的已展宏结果。
- 大小写 **不敏感**；camelCase ST 写法（如 `{{mesExamples}}`）经预处理后可用。
- ST **`::` 多参** 在预处理中转成 Handlebars helper 参数（如 `{{random::a::b}}` → `{{random "a" "b"}}`）。
- 日期/时长类宏默认 **`locale: en`**（未从请求传入时）；与 ST 按界面语言不同，属产品默认。
- 历史索引类宏（`lastMessageId`、`firstIncludedMessageId` 等）在超长对话中仅保证 **尾部 512 轮** 语义（`MACRO_INDEXING_TURN_CAP`）。

---

## 2. 实施阶段总览

| 阶段 | 范围 | 状态 |
|------|------|------|
| **基线** | `{{user}}` `{{char}}` 日期/连接/换行/`{{authorsNote}}` | ✅ |
| **引擎迁移** | handler 链 → **Handlebars**（`handlebars-engine.ts`） | ✅ |
| **Phase A** | 角色卡字段、日期扩展、工具宏、组装上下文、Legacy 角括号 | ✅ |
| **Phase B** | 历史尾块、swipe 索引、稳定 `pick`、`hasExtension`、`notChar` | ✅ |
| **Phase C** | `{{if}}`、嵌套、变量持久化、注释/转义 | ✅ |

---

## 3. 已兼容（Phase A + 基线）

### 3.1 用户 / 角色名

| ST 宏 | 本地 | 备注 |
|-------|------|------|
| `{{user}}` | ✅ | 会话 `userName` 快照，缺省「用户」 |
| `{{char}}` | ✅ | 首绑卡名，缺省「角色」 |
| `{{char1}}` … `{{charN}}` | ✅ | 多卡绑定顺序；支持 `{{char 2}}` 形态 |
| `{{persona}}` | ✅ | 用户 persona 卡 `description`（空则 `personality`） |
| `<USER>` `<BOT>` `<CHAR>` | ✅ | 预处理为 `{{user}}` / `{{char}}` |

### 3.2 角色卡字段（首绑卡 `primaryCharacter`）

| ST 宏 | 本地字段 | 备注 |
|-------|----------|------|
| `{{description}}` | `description` | |
| `{{personality}}` | `personality` | |
| `{{scenario}}` | `scenario` | |
| `{{charPrompt}}` | `system_prompt` | |
| `{{charInstruction}}` | `post_history_instructions` | |
| `{{mesExamples}}` | `mes_example` | |
| `{{mesExamplesRaw}}` | `mes_example` | ⚠️ 无 instruct 层，与 Raw 等价 |
| `{{charCreatorNotes}}` | `creator_notes` | |
| `{{charVersion}}` | `character_version` | 缺省 `2.0` |
| `{{charFirstMessage}}` | `first_mes` | |
| `{{charFirstMessage::index}}` | `first_mes` / `alternate_greetings` | ⚠️ `0`→首句；`n≥1`→备选 `n-1` |
| `{{charDepthPrompt}}` | `extensions.depth_prompt` | ⚠️ 卡无该扩展则为空 |

### 3.3 日期与时间

| ST 宏 | 本地 | 备注 |
|-------|------|------|
| `{{date}}` | ✅ | `Intl`，locale 默认 `en`（未传 `locale` 时；与 ST moment 缺省一致） |
| `{{time}}` | ✅ | |
| `{{datetime}}` | ✅ | 日期 + 空格 + 时间 |
| `{{weekday}}` | ✅ | 长星期名 |
| `{{isodate}}` | ✅ | `YYYY-MM-DD` |
| `{{isotime}}` | ✅ | `HH:mm:ss` |
| `{{datetimeformat::…}}` | ✅ | ⚠️ 子集：`YYYY` `YY` `MM` `DD` `HH` `mm` `ss` `dddd` `ddd` |
| `{{time::UTC±offset}}` | ✅ | ⚠️ 支持 `UTC+8` / `GMT-5` 等；非 IANA 时区名 |
| `{{idleDuration}}` | ✅ | `Intl` 人类可读时长；参照上一条用户 turn 的 `createdAt`；无时间戳 → `just now`（`locale=zh*` 时为「刚刚」） |
| `{{timeDiff::left::right}}` | ✅ | `Intl` 人类可读差值（带 ago/in/前/后）；参数为 ISO 或 `Date.parse` 可识别字符串 |

### 3.4 连接 / 组装上下文

| ST 宏 | 本地 | 数据源 | 备注 |
|-------|------|--------|------|
| `{{model}}` | ✅ | `tokenModel` | |
| `{{maxPrompt}}` | ✅ `{{maxprompt}}` | `contextLength` | 别名 |
| `{{maxContextTokens}}` | ✅ `{{context}}` | 同上 | 别名 |
| `{{maxResponseTokens}}` | ✅ | 会话 API `maxTokens` | 合并 preset + binding |
| `{{input}}` | ✅ | 本轮 `userText` | 仅完整组装路径 |
| `{{lastGenerationType}}` | ✅ | `promptTrigger` | `normal` / `continue` / `swipe` / `regenerate` |
| `{{authorsNote}}` | ✅ | 会话作者注正文 | 未启用则为空 |

### 3.5 文本工具

| ST 宏 | 本地 | 备注 |
|-------|------|------|
| `{{newline}}` | ✅ | 单换行 |
| `{{newline::n}}` | ✅ | `n` 上限 256 |
| `{{space}}` / `{{space::n}}` | ✅ | 空格重复 |
| `{{noop}}` | ✅ | 空串 |
| `{{trim}}` / `{{trim::text}}` | ✅ | |
| `{{reverse::text}}` | ✅ | |
| `{{random::a::b::…}}` | ✅ | ⚠️ 无状态均匀随机，非 ST 稳定种子 |
| `{{roll::1d20}}` | ✅ | ⚠️ 子集 `NdM` 可选 `+/-K` 修正 |

---

## 4. 部分兼容（非 Phase A，但已有近似能力）

| ST 宏 / 能力 | 标记 | 说明 |
|--------------|------|------|
| 角色信息重复注入 | ⚠️ | 宏得字段纯文本；`<inject slot="character_card" />` 仍注入整卡 XML，勿双份堆叠 |
| Memory / 摘要 XML 说话人属性 | ⚠️ | 统一为 `<user userName="{{user}}">` / `<assistant charName="{{char}}">`；**组装末段 / complete 前** 展宏为真实昵称 |
| 插件 `macros.expand` | ⚠️ | 摘要预览走 `/api/plugins/.../macros/expand`；需会话上下文才有完整角色字段 |
| 提示词库 assemble-preview | ⚠️ | 内置示例角色；无 memory 管线、无真实会话 API 绑定 |

---

## 5. Phase B（历史 / swipe / pick）— 已实现

| ST 宏 / 能力 | 标记 | 说明 |
|--------------|------|------|
| `{{lastMessage}}` `{{lastUserMessage}}` `{{lastCharMessage}}` | ✅ | 由 `memoryPipeline.recentTurns` 扁平化；不含本轮 `{{input}}` |
| `{{lastMessageId}}` | ✅ | 0-based 扁平消息索引（索引 turn 集最多 512 轮 tail） |
| `{{firstIncludedMessageId}}` | ✅ | token 裁切后首条 history 在索引集中的位置 |
| `{{allChatRange}}` | ✅ | `0-{{lastMessageId}}` |
| `{{lastSwipeId}}` `{{currentSwipeId}}` | ✅ | 1-based；再生/swipe 时读 `activeTurn` |
| `{{pick::…}}` | ✅ | 稳定 pick（`conversationId` + 参数 hash） |
| `{{hasExtension::name}}` | ✅ | 对照用户 `plugin-registry` enabled 插件 |
| `{{notChar}}` | ✅ | 除首绑卡外的角色名，逗号分隔 |
| `{{charAuthorsNote}}` | ⏳ | **`DOC/28` Phase 2** |

## 6. 未实现（Phase B 余项 / Phase C）

| ST 宏 / 能力 | 标记 | 说明 |
|--------------|------|------|
| `{{lastMessageId}}` 等 ST 全量 chat 索引 | ⚠️ | 与 ST 一致为全对话索引；本项目索引 turn 有 512 cap |
| `{{original}}` `{{notChar}}`（群聊语义） | ⏳ / ✅ | `notChar` 已按多卡名实现；`original` 待产品 |
| `{{isMobile}}` | ⏳ | 可选 |

---

## 7. Phase C（引擎级）— 已实现

| ST 能力 | 标记 | 说明 |
|---------|------|------|
| `{{if}}` / `{{else}}` / `{{/if}}` | ✅ | 条件支持宏名、`!` 取反、`.local` / `$global`；真值规则：空/`false`/`0`/`off`/`no` 为假 |
| scoped `{{setvar}}` … `{{/setvar}}` 等 | ✅ | `setvar` / `setglobalvar` / `reverse` / `trim` 块体合并为 helper 参数 |
| 嵌套宏 | ✅ | 自内向外展开（`nested-expand.ts`）；`::` 参数中含 `{{` 时延后至内层展开后再解析 |
| `{{//}}` 注释 | ✅ | 行内 `{{// …}}` 与块 `{{//}}` … `{{//}}` |
| `\{\{` / `\}\}` 转义 | ✅ | 渲染后还原字面花括号，不触发宏 |
| `getvar` / `setvar` / `hasvar` | ✅ | 会话 `index.json` → `macroLocalVars`；组装末持久化 |
| `getglobalvar` / `setglobalvar` / `hasglobalvar` | ✅ | 用户 `user-preferences.json` → `macroGlobalVars` |
| `{{.name}}` / `{{$name}}` | ✅ | 简写为 getvar / getglobalvar |
| 宏标志 `#` `!` `?`（ST 实验引擎） | ⏳ | 未移植 |
| 前端宏补全、`/? macros` | ⏳ | 未实现 |

---

## 8. 不对齐 / 不移植（短期）

| ST 宏 / 能力 | 标记 | 原因 |
|--------------|------|------|
| `{{group}}` `{{groupNotMuted}}` `{{charIfNotGroup}}` | ❌ | 无 ST 式群聊，仅多卡绑定 |
| 全套 `{{instruct*}}` `{{chatSeparator}}` 等 | ❌ | 无 instruct 字符串层 |
| `{{systemPrompt}}` `{{defaultSystemPrompt}}` | ❌ | 预设条目 + 绑定槽 |
| `{{outlet::key}}` | ❌ | 无 outlet |
| ST `{{summary}}` | ❌ | 非 ST Summarize 扩展 |
| `{{banned::word}}` | ❌ | TC 后端专用 |
| `{{charPrefix}}` / SD 前缀类 | ❌ | 无生图链路 |
| ST 实验宏引擎 **整包 parity** | ❌ | 维护成本过高 |

---

## 9. 调用点与展宏时机

| 场景 | 路径 | Phase A 上下文 |
|------|------|----------------|
| 发消息 / 组装预览 | `buildConversationOutboundMessages` | 全量：角色字段、input、trigger、maxResponseTokens |
| 提示词库预览 | `POST /api/prompts/assemble-preview` | 示例或传入 `characters[]` |
| 开场白落盘 | `POST .../opening` | 角色 + persona 字段 |
| 插件展宏 | `POST .../macros/expand` | 会话 + API preset |
| Historian 摘要 | `complete` / 预览 `macros.expand` | 同上；`<history>` 内属性宏一并展开 |
| Memory 注入 | `formatMemoryXml` → 组装 | outgoing 正则重建后会 **再次展宏** |

---

## 10. 迁移建议（ST → 本地）

1. **可直接粘贴**：§3 中 ✅ 宏；预设里 `{{maxPrompt}}` 等 camelCase 可保留。  
2. **需改写**：群聊、`instruct*` → 改用预设分组 / XML 注入；`{{if}}` / 变量宏已支持（§7）。  
3. **预期差异**：未知宏显示 `[foo UNSUPPORTED]`，导入后宜全文搜索 `UNSUPPORTED`。  
4. **角色字段**：优先在预设用宏 **或** XML 注入一种，避免 `{{description}}` 与 `<char>` 重复。  
5. **测试**：`server/src/prompt-macros/prompt-macros.test.ts`；改 helper 后补用例。

---

## 11. 参考

| 资源 | 路径 |
|------|------|
| 实现目录 | `server/src/prompt-macros/` |
| 已知宏表（代码） | `macro-values.ts` → `KNOWN_MACRO_HEADS` |
| 可行性备忘 | `DOC/14-st-macros-porting.md` |
| 运行时原则 | `DOC/03-实现细节.md` §15 |
| ST 官方 | [Macros](https://docs.sillytavern.app/usage/core-concepts/macros/) |

---

*文档版本：2026-06-11 · Phase A/B/C 完成 · 引擎 Handlebars · 分支 `macro-engine`*
