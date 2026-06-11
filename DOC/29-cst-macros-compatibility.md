# CST 宏引擎现状 ↔ Legacy 对照

> **状态**：`CST-MACRO` 分支 · **D2 已完成**（2026-06-11）；D3 未开始。  
> **目的**：记录 **CST**（Lexer → Parser → Walker）相对 **legacy**（Handlebars + 预处理链）的能力边界，便于你在 `macroEngine: "cst"` 下判断「能不能跑」「差在哪」。  
> **ST 全量对照**：仍以 **`DOC/26-st-macros-compatibility.md`** 为准（描述 legacy 已实现的 ST 兼容面）；本文只回答 **CST 相对 legacy 差什么**。

---

## 1. 如何确认正在用 CST

| 方式 | 说明 |
|------|------|
| **`config.json`** | `"macroEngine": "cst"`（见 `config.example.json`） |
| **环境变量** | `MACRO_ENGINE=cst`（**优先于** config.json） |
| **默认** | 未配置 → **`legacy`** |

解析：`server/src/config.ts` → `resolveMacroEngine()`；路由：`server/src/prompt-macros/engine.ts` → `renderPromptMacros()`。

**改配置后须重启 server 进程。**

自检：在预设里临时写 `{{noop}}CST_PROBE{{user}}`，若 `noop` 与 `user` 均正常展开且 **无** `[if UNSUPPORTED]` 泄漏，说明宏注册在工作；若出现大量 `[… UNSUPPORTED]`，对照下文 §5。

---

## 2. 图例

| 标记 | 含义 |
|------|------|
| ✅ | CST 已与 legacy **同等**（同一套 `macro-values` / `macro-vars` 取值） |
| ⚠️ | CST 部分支持或语义与 legacy 不同 |
| ❌ | CST **未实现**（legacy 有）；启用 CST 时行为会坏或降级为 `[UNSUPPORTED]` |
| ⏳ | 已规划下一版 CST（D1/D2） |

**引擎差异（与 ST 无关）**

| 行为 | Legacy | CST |
|------|--------|-----|
| 未知 `{{…}}` | `[name UNSUPPORTED]` | 同左 |
| 未闭合 `{{` | `[UNSUPPORTED]` | 同左 |
| Handlebars 编译失败 | `[name RENDERFAIL]` | **无** RENDERFAIL 路径（不经过 Handlebars） |
| 嵌套 `{{…}}` | `nested-expand.ts` 多轮展开 | Lexer 平衡匹配 `}}` + 参数内递归 `walk` |
| 变量持久化 | 组装末 `persistMacroVarMutations` | **同左**（与引擎无关） |

---

## 3. 实施阶段（CST 路线图）

| 阶段 | 范围 | 状态 |
|------|------|------|
| **D0** | Lexer / Parser / Walker；**平铺宏**；注释、转义、参数内嵌套 | ✅ |
| **D1** | `{{if}}` / `{{else}}` / scoped 块；`{{.x}}` / `{{$x}}` 简写 | ✅ |
| **D2** | `addvar`；`==` / `!=` 条件；无参 `{{trim}}`；`#` 保留空白 | ✅ |
| **D3** | 默认切 CST、删除 legacy 预处理链 | ⏳ |
| **D4** | CST 文档缓存（静态 preset 条目） | ⏳ |

实现目录：

```text
server/src/prompt-macros/
  engine.ts                 # legacy | cst 路由
  cst/
    lexer.ts                # 含嵌套 {{ }} 平衡闭合
    parser.ts
    nodes.ts
    walker.ts
    macro-registry.ts       # 宏派发（复用 macro-values / macro-vars）
    render.ts
    cst.test.ts
  handlebars-engine.ts      # legacy（renderPromptMacrosLegacy）
  preprocess*.ts            # 仅 legacy 使用
```

---

## 4. 宏 vs 表达式 / 运算符

| 类别 | 示例 | 实现位置 | 说明 |
|------|------|----------|------|
| **取值宏** | `{{user}}` `{{getvar::k}}` `{{.k}}` | `macro-registry` / `macro-values` | 注册表派发，展开为字符串 |
| **副作用宏** | `{{setvar::k::v}}` `{{addvar::k::chunk}}` | `macro-vars` | 改变 `macroLocalVars` / `macroGlobalVars` |
| **块结构** | `{{if …}}` `{{setvar}}…{{/setvar}}` | CST Parser + Walker；legacy 预处理 | 控制流 / scoped body |
| **条件表达式** | `{{.x == y}}` `{{.a != b}}` | **`macro-expr.ts`** → `evaluateStCondition` | **不是**宏；`==` / `!=` 在 if 条件内求值 |
| **真值判断** | `{{if .flag}}` `{{if $g}}` | `macro-condition` + `macro-truthy` | 无比较运算符时按 ST 真值 |

要点：

- `{{lastGenerationType}}`、`{{addvar::…}}` 等是**宏**；`{{.reasoningeffort == High}}` 是 **if 条件里的比较表达式**，不应加入 `KNOWN_MACRO_HEADS`。
- 比较两侧：`.` / `$` 走变量；带引号字面量去引号；含 `{{` 时递归展开后再比。
- Legacy `{{#if {{.x == y}}}}` 依赖 `preprocess-st-if` **平衡**匹配嵌套 `}}`（与 CST Lexer 一致）。

---

## 5. 按能力：CST vs Legacy

### 5.1 引擎级语法

| 能力 | Legacy | CST | 备注 |
|------|--------|-----|------|
| `{{if}}` / `{{else}}` / `{{/if}}` | ✅ | ✅ | 条件求值复用 `evaluateStCondition` |
| `{{#if}}`（ST 实验） | ⚠️ 经预处理当 `if` | ✅ | Parser 剥 `#` 后与 `if` 同路径 |
| scoped `{{setvar}}`…`{{/setvar}}` | ✅ | ✅ | `setvar` / `setglobalvar` / `reverse` / `trim` |
| `{{.name}}` / `{{$name}}` 简写 | ✅ | ✅ | Parser 改写为 getvar / getglobalvar |
| `{{//}}` 注释 | ✅ | ✅ | |
| `\{\{` / `\}\}` 转义 | ✅ | ✅ | |
| 参数内嵌套 `{{setvar::k::{{char}}}}` | ✅ | ✅ | |
| 宏标志 `!` `?` | ❌ | ❌ | 双方均未做 |
| 宏标志 `#`（scoped / if 保留空白） | ⚠️ legacy 仅 scoped | ✅ | CST D2：`#setvar` 等保留 body 首尾空白 |
| `addvar` | ✅ | ✅ | 追加会话变量；`::` 值保留尾部换行 |
| 比较条件 `{{.x == y}}` / `!=` | ✅ | ✅ | `macro-expr` + `evaluateStCondition`；非宏注册表 |
| 无参 `{{trim}}` | ✅ | ✅ | 去**已输出**尾部空白（非 `trim("")`） |

### 5.2 取值宏（平铺 `{{name}}` / `{{name::…}}`）

以下在 **CST D0** 中经 `macro-registry.ts` 派发，与 legacy **共用** `macro-values.ts` / `macro-vars.ts`：

| 分类 | 宏（节选） | CST |
|------|-----------|-----|
| 用户/角色 | `user` `char` `charN` `char N` `persona` | ✅ |
| Legacy 角括号 | `<USER>` `<CHAR>` `<BOT>` | ✅（`render` 前预处理） |
| 角色卡字段 | `description` `personality` `scenario` `charPrompt` … `charDepthPrompt` | ✅ |
| 日期时间 | `date` `time` `datetime` `weekday` `isodate` `isotime` `datetimeformat` `idleDuration` `timeDiff` | ✅ |
| 组装上下文 | `model` `maxprompt` `context` `maxResponseTokens` **`input`** **`lastGenerationType`** | ✅ |
| 作者注 | `authorsNote` `defaultAuthorsNote` | ✅ |
| 历史 / swipe | `lastMessage` `lastUserMessage` `lastCharMessage` `lastMessageId` `firstIncludedMessageId` `allChatRange` `lastSwipeId` `currentSwipeId` | ✅ |
| 其它 | `pick` `hasExtension` `notChar` | ✅ |
| 文本工具 | `newline` `space` `noop` `trim` `reverse` `random` `roll` `addvar` | ⚠️ 见下 |
| 变量（**仅** `::` 形态） | `getvar` `setvar` `hasvar` `getglobalvar` `setglobalvar` `hasglobalvar` | ✅ |

**⚠️ CST 与 legacy 共有差异（非 CST 独有）**

| 宏 | 说明 |
|----|------|
| `{{trim}}` 无参 | **D2 起**：去已生成文本尾部空白；有参 `{{trim::…}}` / scoped `{{trim}}…{{/trim}}` 仍按字符串 trim |
| `{{roll::d6}}` | 需 `1d6` 形态（`rollDiceSpec` 子集） |
| `{{random::…}}` | 无状态随机，非 ST 种子 |
| 历史索引 | 超长对话 tail **512 轮** cap（`MACRO_INDEXING_TURN_CAP`） |

### 5.3 变量与持久化（引擎无关）

| 项 | 说明 |
|----|------|
| 会话 `macroLocalVars` | `ConversationIndex` / `index.json` |
| 全局 `macroGlobalVars` | `user-preferences.json` |
| 写入时机 | `buildConversationOutboundMessages`、插件 `macros.expand` 组装后 `persistMacroVarMutations` |

CST 下 **`{{setvar::k::v}}` / `{{addvar::k::chunk}}` + `{{getvar::k}}`** 可用；Stabs Tier 编译可试，但 preset 结构 / regex 仍另议。

---

## 6. 预设迁移速查

| 预设类型 | `macroEngine: "cst"` 现状 | 建议 |
|----------|---------------------------|------|
| 角色卡 / 世界书（`user` `char` 字段宏） | ✅ 一般可跑 | 可用 CST 试 |
| Frankenstein 类（浅宏 + 复杂 prompt 顺序） | ⚠️ 宏多半 OK；prompt 槽位另议 | CST 或 legacy |
| **Stabs / 变量编译预设** | ⚠️ D2 宏层接近；prompt 槽位 / regex 另议 | 可用 CST **试跑** |
| 含 `{{if}}` / `{{/if}}` 一般预设 | ✅ | CST 可用 |
| 含 `{{.x}}` / `{{$x}}` | ✅ | CST 可用 |

---

## 7. 测试

| 套件 | 路径 | 说明 |
|------|------|------|
| Legacy 全量 | `server/src/prompt-macros/prompt-macros.test.ts` | 默认 `MACRO_ENGINE` 未设 → legacy |
| CST | `server/src/prompt-macros/cst/cst.test.ts` | 直接调 `renderPromptMacrosCst`（含 D2） |
| 表达式 | `server/src/prompt-macros/macro-expr.test.ts` | `==` / `!=` 解析与求值 |
| 配置解析 | `server/src/config-macro-engine.test.ts` | `resolveMacroEngine()` |

改 CST 后应：**`cst.test.ts` 绿 + legacy 全量仍绿**（dual-run 完整对等待 D3 前逐步补）。

---

## 8. 与 DOC/26 的关系

```text
DOC/26  … ST 宏在本地「产品能力」总表（以 legacy 为完整实现基准）
DOC/29  … 选用 CST 时，在 26 基础上再砍掉/尚未迁移的一层
```

查阅顺序：

1. 该宏在 **DOC/26** 是否已实现？若否，CST 也不会 magically 有。  
2. 若 26 为 ✅，查 **本文 §5** 该宏在 CST 是 ✅ 还是 ❌。  
3. Stabs 类额外需要 §5.1 的 `addvar` / 比较 `if`（D2 起 legacy 与 CST 均已实现）。

---

## 9. 参考

| 资源 | 路径 |
|------|------|
| 路由入口 | `server/src/prompt-macros/engine.ts` |
| 配置 | `server/src/config.ts` → `resolveMacroEngine()`；`config.example.json` → `macroEngine` |
| CST 宏表（代码） | `server/src/prompt-macros/cst/macro-registry.ts` |
| Legacy 宏表 | `server/src/prompt-macros/macro-values.ts` → `KNOWN_MACRO_HEADS` |
| ST 全量对照 | `DOC/26-st-macros-compatibility.md` |
| 运行时原则 | `DOC/03-实现细节.md` §15 |

---

*文档版本：2026-06-11 · CST D2 · 分支 `CST-MACRO`*
