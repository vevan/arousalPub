# 插件 — 策展式记忆（Curated Memory）设计指南



> **状态**：**v1.5 已落地**（§3.3 context 三块、条目自动排序、固定轮次后缀标题；v1.4 手动/自动摘要、Sidecar、auto ensure 等）。  

> **关联**：`DOC/11` 宿主 API、`DOC/09` 插件系统、`DOC/10` 对话 read、`DOC/03` §13 世界书。  

> **manual 默认**：无 `targetLorebookId` 时弹框选书；**auto** 见 §2.3。



---



## 1. 产品语义



将一段对话 **策展** 为资料库中的一条（或更新一条）**可检索记忆**：



| 概念 | 说明 |

|------|------|

| **摘要记忆** | 每 N 轮（或可配置）触发；模型返回 `{ title, content, keywords }` → **新增** lore 条目 |

| **Sidecar / Tracker** | 固定一条 lore 条目；每次触发 **覆盖** 同一 `entryId` 的 `content`（及可选 `keys`） |

| **摘要** | **插件能力**（prompt、解析、触发计数） |

| **Lorebook 读写** | **宿主能力**（`DOC/11`） |



与本体 **turn 向量记忆**（`memory-pipeline`）互补：向量记忆自动召回历史 turn；策展记忆由用户/插件决定「必须进资料库的事实」。



### 1.1 写入 vs 注入（定案）



| 阶段 | 负责方 | 说明 |

|------|--------|------|

| **写入** | 插件 | 仅向 `pluginSettings.targetLorebookId`（或自动 ensure 的书）`createEntry` / `patchEntry` |

| **注入** | **Prompt 管线** | 用户把资料库勾进对话 **`lorebookIds`** 后，由 `resolveLorebookInjectionText` → `ctx.world` 发给 LLM；插件**不**改 `lorebookIds`、不自行插 messages |



插件**不得**默认把摘要书绑进 `lorebookIds`；用户若要把摘要当设定用，须在对话设置里**显式**勾选该本（可与 `targetLorebookId` 为同一 id）。



### 1.2 Memorybook（自动块）与「自动」语义



| 概念 | 定案 |

|------|------|

| **自动** | 按 **块**（`blockTurns` + `bufferTurns`）在 `onAssistantReplyPersisted` 后**预约触发**，无需用户每次点「手动摘要」；**不等于后台静默** |

| **预览确认** | 每次生成摘要草稿后**必须**经用户确认（确认 / 跳过 / 中止）再写入 lore；**手动与自动共用** `promptReview`，为正常产品行为 |

| **目标书** | manual：无 `targetLorebookId` 时弹框选书；**auto**：`host.lorebook.ensure` 按模板建书并写回会话（见 §2.3） |

| **指针** | 成功写入摘要记忆后维护 `lastSummarizedEnd`、`nextBlockStart`（替代早期 `lastTriggeredTurnOrdinal` 语义） |



---



## 2. 配置分层



### 2.1 全局（`settings.json` + `settingsSchema`）



| 字段 | 说明 | 实现 |

|------|------|------|

| `apiConfigId` | 摘要 API 预设 id（可留空，走 `plugin-api-resolve`） | ✅ |

| `memorybookDefaultEnabled` | 新对话默认开启 Memorybook（首条落盘后预约自动块） | ✅ |

| `triggerEveryNTurns` | 设置页展示名；运行时合并为会话 **`blockTurns`**（每块 turn 数） | ✅ |

| `bufferTurns` | 块尾后保留最近 N 轮不纳入本块（仍留在对话历史） | ✅ |

| ~~`defaultTargetLorebookId`~~ | **已删除**；摘要目标仅会话 **`targetLorebookId`** | — |

| ~~`titleFormat`~~ | **v1.5 已删除**；剧情摘要标题恒为「模型标题 + 轮次后缀」（§4） | — |

| `previousSummariesLimit` | 摘要时向模型附带**最近 N 条**剧情摘要正文（§3.3）；默认 `8`，范围 `0–50` | v1.5 |

| `defaultEntryTriggerMode` | 新建摘要条目 `triggerMode`（当前默认 **`vector`**） | ✅ |

| `systemPromptTemplate` | 剧情摘要 system 模板 | ✅ |

| `sidecarEnabled` / `sidecars` | Tracker 列表（`objectList`：name、prompt、priority、triggerMode） | ✅ |

| `targetLorebookMode` | `manual` \| `auto`（见 §2.3） | ✅ |

| `autoLorebookNameTemplate` | auto 模式书名模板，默认 `{{conversationTitle}}-summary` | ✅ |



### 2.2 会话级（`index.json` → `pluginSettings[pluginId]`）



见 **`DOC/11` §4**。推荐字段：



| 字段 | 说明 | 实现 |

|------|------|------|

| `memorybookEnabled` | 本会话是否开启 Memorybook 自动块 | ✅ |

| `targetLorebookId` | **摘要资料库**（本对话写入目标；空则摘要时弹框） | ✅ |

| `blockTurns` / `bufferTurns` | 覆盖全局块长与 buffer | ✅ |

| `nextBlockStart` / `lastSummarizedEnd` | 下一块起始 turn、上次成功摘要块右端点 | ✅ |

| `sidecarEntryIds` | 各 Sidecar id → lore `entryId` 映射 | ✅ |

| `autoSidecarIds` | 自动块要更新的 Sidecar 子集 | ✅ |

| `sidecarEnabled` | `true` / `false` / 省略=继承全局 | ✅ |

| `entrySortMode` | `manual` \| `auto-turn-suffix`：摘要批次完成后是否自动整理目标书条目顺序（§4.2）；**默认 `auto-turn-suffix`** | v1.5 |

| `targetLorebookMode` | 可选覆盖全局 manual / auto | ✅ |

| `lastTriggeredTurnOrdinal` | 遗留字段；读取时兼容映射 `lastSummarizedEnd` | 兼容 |



### 2.3 目标资料库：手动 / 自动（auto ensure · v1.4）



**默认 `manual`**。会话可覆盖 `targetLorebookMode`（`pluginSettings`）。



| 模式 | 行为 | 状态 |

|------|------|------|

| **manual**（默认） | 预先在会话插件 Tab / composer 指定 `targetLorebookId`，或触发时弹框选已有书 | ✅ |

| **auto** | 无 `targetLorebookId` 时 `POST …/lorebooks/ensure` 按 `autoLorebookNameTemplate` 建空书 → `patchPluginSettings.targetLorebookId` → toast | ✅ |



自动建书**不**修改 `lorebookIds`。**重名**：模板解析名已存在 → 在名称后追加**当前对话 id**（8 位 hex）；仍冲突再随机短 id（`server/plugin-lorebook-ensure.ts`）。



---



## 3. 运行时流程



### 3.1 触发（插件自维护）



**手动**：composer 菜单「手动摘要」→ 用户选区间与任务 → §3.5（含预览）。



**Memorybook 自动块**（须 `memorybookEnabled === true`）：



1. 订阅 `host.lifecycle.onAssistantReplyPersisted`（已实现）。  

2. 块区间：`from = nextBlockStart`，`to = nextBlockStart + blockTurns - 1`；当 `turnOrdinal >= to + bufferTurns` 时触发本块。  

3. 会话 busy / `setPluginHold` / 已有摘要流水线 → **延后重试**（非静默丢弃）。  

4. 走与手动相同的 `runSummarizeTasks`（**含预览确认**）；仅当摘要记忆任务**确认写入**后推进 `lastSummarizedEnd` / `nextBlockStart`。用户跳过/中止 → **不**推进指针。  

5. 无 `targetLorebookId` → `ensureTargetLorebook`（manual 弹框 / auto ensure，§2.3）；失败则本次结束，指针不变。



### 3.2 读取历史



```text

host.conversation.runScope({ writeLock: false, requireIdle: true }, async (ctx) => {

  const turns = await ctx.read({ from, to })  // to - from + 1 ≤ 50

})

```



将 `from..to` 内 turn 格式化为 transcript，包裹于 `<history>…</history>`（见 §3.3）。



### 3.3 组装摘要提示词（v1.6 定案）



`host.plugin.prepareContext` 将参考与待摘要内容**拆分**；`completeDraft` 组装为两条消息：



- **system** = `systemReferenceContext` + `systemPromptTemplate`（中间空行分隔）

- **user** = `userContent`（仅 `<history>`）



**`systemReferenceContext`**（宿主拼接，顺序固定）：



```text

<previous-summaries readonly>

## 酒馆相遇-0-4

（正文）



## 下一段-5-9

（正文）

</previous-summaries>



<sidecars readonly>

## Tracker

（当前 Sidecar 正文）

</sidecars>



<context-history readonly>

<user name="{{user}}"><![CDATA[…]]></user>

<char name="{{char}}"><![CDATA[…]]></char>

</context-history>

```



**`userContent`**（turn 内按发言拆为 `<user>` / `<char>`，正文 CDATA；`name` 为宏 `{{user}}` / `{{char}}`，出站前由宿主展开）：



```text

<history>

<user name="{{user}}"><![CDATA[…]]></user>

<char name="{{char}}"><![CDATA[…]]></char>

</history>

```



| 块 | 消息 | 来源 | 规则 |

|----|------|------|------|

| `<previous-summaries>` | system | 目标书中 **剧情摘要类**条目 | 仅 **结束轮 &lt; fromTurn** 的条目；组内按 §4.2 排序后取最近 **N** 条（`previousSummariesLimit`）；`N=0` 省略 |

| `<sidecars>` | system | `sidecarEntryIds` 映射条目 | 按 Sidecar 配置列表顺序；当前 **content**（及标题作 `##` 行） |

| `<context-history>` | system | 对话 turn | 可选；`max(0, fromTurn−N+1) .. fromTurn−1` 的 transcript（`N=previousSummariesLimit`）；`fromTurn=0` 或 `N=0` 时省略 |

| `<history>` | user | 对话 turn | 本次待摘要闭区间 **`fromTurn..toTurn`** transcript |



**不包含**于摘要 context、但仍可通过 lore 注入进对话的条目：**无轮次后缀的 other 类**（§4.1）。



**System 指令模板**：



- 剧情摘要：`systemPromptTemplate`（拼在参考块之后）

- Sidecar：各 Sidecar 的 `systemPromptTemplate`（同样拼在参考块之后）

- 写入语义不变：Sidecar 仍 **patch** 固定条目，`title` 强制为 Sidecar 名称



**请求参数扩展**（`prepare-context`）：`previousSummariesLimit`（兼容旧名 `previousMemoriesLimit`）、`sidecarEntryIds`、`sidecarIds`（Sidecar 配置顺序）。



### 3.4 调用模型（经宿主）



经 `host.plugin.completeDraft` → 宿主 `POST …/complete-draft`（`DOC/11` §0.2）。**禁止** `host.chat.sendWithPlugins`。



### 3.5 解析、预览与写入 Lorebook



1. `completeDraft` 得草稿 → **`promptReview` 预览**（确认 / 跳过 / 中止 / 重新生成）。  

2. 用户确认后：`createEntry`（摘要）或 `patchEntry`（Sidecar）。  

3. 若 `entrySortMode === 'auto-turn-suffix'` 且本批次至少有一项（剧情摘要或 Sidecar）确认写入 lore → 对目标书执行 §4.2 自动排序（**整批任务结束后一次**，非仅剧情摘要后）。  

4. 成功写入摘要记忆后更新 `lastSummarizedEnd` / `nextBlockStart`；Sidecar 映射变更时更新 `sidecarEntryIds`。



---



## 4. 条目标题与排序



### 4.1 条目分类（目标摘要书）



| 类 | 识别 | 摘要 context | Lore 注入（勾选 `lorebookIds` 后） |

|----|------|--------------|-----------------------------------|

| **other** | 非 Sidecar 映射，且 title **无**尾部 `-{start}-{end}` | **不包含** | **包含**（按触发规则） |

| **sidecar** | `sidecarEntryIds` 值集合 | `<sidecars>` 块 | **包含** |

| **summary** | 非 Sidecar，且 title 匹配 `/-\d+-\d+$/` | `<previous-summaries>`（最近 N 条） | **包含** |



典型 **summary** 标题由插件写入，**恒为**「模型 `title` + 轮次后缀」（**不可配置为 plain**）：



- **`startTurnNum` / `endTurnNum`**：本次 `<history>` 的 **turnOrdinal** 闭区间（从 0 起）。  

- 若模型 `title` 已含尾部 `-数字-数字`，**覆盖**为本次区间后缀。  

- 示例：`酒馆相遇-8-11`  

- **Sidecar**：`title` 固定为配置 `name`，**无**轮次后缀。



### 4.2 资料库条目顺序（自动排序 · v1.5）



**语义**：排序反映**剧情时间线**——同组内靠前 = 更早剧情；「最近 N 条摘要」= summary 类条目排序后的**尾部 N 条**。



**组内顺序**（对每个 `group` 独立应用；自动 ensure 的书通常仅一个分组）：



```text

other（无后缀） → sidecar（按 sidecars 配置顺序） → summary（按 startTurn 升序，其次 endTurn）

```



**other 区内**多条：按 `createdAt` 升序（其次稳定 id）。



**触发方式（B + C）**：



| 机制 | 位置 | 行为 |

|------|------|------|

| **B · 开关** | 对话齿轮 → 插件 Tab；composer「本会话策展设置」 | `entrySortMode`：`auto-turn-suffix`（**默认**，摘要批次完成后自动重排）\| `manual` |

| **C · 立即排序** | composer 菜单「整理目标资料库顺序」 | 对当前 `targetLorebookId` 立即执行 §4.2 算法；无目标书时禁用 |



`manual` 模式下用户仍可拖拽排序；`auto-turn-suffix` 下每次摘要批次（剧情 + Sidecar）写完后再整理，会覆盖组内 order。

**实现**：`host.lorebook.reorderCurated(lorebookId, { sidecarEntryIds, sidecarIds })` → `POST …/lorebooks/:id/reorder-curated`；服务端 **单次** `readLorebookById` → 计算 order → **单次** `writeLorebook`（避免对数百条条目逐条 `patchEntry`）。



---



## 5. Sidecar（Tracker）与摘要记忆



| | 摘要记忆 | Sidecar |

|--|----------|---------|

| Lorebook 操作 | **insert** 新 entry | **patch** 固定 entry |

| 条目 id | 每次新建 | `sidecarEntryIds` 持久化 |

| 典型用途 | 场景快照、章节摘要 | 人物状态、好感、当前目标等 **随对话更新** |



---



## 6. manifest 与权限（v1.4+）



```json

{

  "id": "curated-memory",

  "hooks": ["completeDraft"],

  "permissions": [

    "plugin.complete",

    "lorebook.read",

    "lorebook.entry.write",

    "conversation.read",

    "lorebook.write"

  ]

}

```



---



## 7. UI（定案）



### 7.1 入口总览



| 入口 | 行为 |

|------|------|

| 设置页 schema | API 预设、Memorybook 默认、`previousSummariesLimit`、块长/buffer、Sidecar、prompt |

| 对话齿轮 → **插件** Tab | 摘要资料库、`memorybookEnabled`、`entrySortMode`、块长/buffer 覆盖 |

| composer 菜单 | Memorybook、手动摘要、**本会话策展设置**、**整理目标资料库顺序** |

| 手动「立即摘要」 | 用户自选区间与任务；仍经预览确认 |

| **`turn-block-head`** | ▷/◁ 区间选择 → 手动摘要预填 |



**上下文长度**：区间过长由宿主 **token preflight**（`context_exceeded`）拦截。



### 7.2 区间选择（`turn-block-head`）



见 v1.4 定案（▷/◁ 状态机、`cm-range-` 样式前缀）。



---



## 8. 与 STMB 的差异（概念借鉴）



| STMB | 本插件（arousalPub） |

|------|----------------------|

| ST `world-info.js` | `DOC/11` lorebook entry API |

| ST `chat[]` 消息下标 | **turnOrdinal** + `conversation.read` |

| 扩展内直连 OpenAI | `POST …/complete` 转发 |



---



## 9. 实现清单（插件包）



- [x] v1.4：手动/自动摘要、预览、Sidecar、auto ensure、turn-block-head  

- [x] **v1.5**：`prepareContext` 三块组装 + `previousSummariesLimit`  

- [x] **v1.5**：移除 `titleFormat`；固定轮次后缀标题  

- [x] **v1.5**：`entrySortMode` + 自动/手动整理条目顺序  

- [x] **v1.5**：Sidecar 有 `<history>` 时共用剧情 system  



---



## 10. 参考



- 宿主能力：`DOC/11-plugin-host-completion-and-lorebook.md`  

- 对话 read：`DOC/10-plugin-conversation-host.md`  

- 世界书条目结构：`server/src/lorebook-types.ts`


