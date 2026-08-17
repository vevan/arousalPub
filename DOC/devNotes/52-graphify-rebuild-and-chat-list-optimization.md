# Graphify 图谱重建与 upsertChatListEntry 热点分析

> **状态**：✅ **已落地**（2026-08-17）——图谱重建 · **M0–M4（CL1–CL9）** · plugins 三环打断 · 旧图清理；见 [`04-TODO.md`](04-TODO.md) §已归档  
> **来源**：`/graphify` 全量重建三份图谱 + 图谱 BFS 追查 `upsertChatListEntry()` 数据流（对照代码验证）  
> **前置**：[`47-graphify-optimization-backlog.md`](47-graphify-optimization-backlog.md)（2026-08-05 首轮审计 · 已落地）  
> **索引**：`DOC/devNotes/README.md` 专题表 · [`04-TODO.md`](04-TODO.md) §已归档  

> **修订**：2026-08-17 依审计修正调用点计数 / Import Cycles / 社区标签 / 行号等；同日写入 §5 改进计划并登记 P2；§6 计划评估（事实核对 + 决策 D1–D3）；终审后修正 D2 / D1 取值口径并回写 §3/§5 · CL3 reconcile 对齐 §5 · CL2 对齐 skip-write 先例 · 统一 CL4 dirty 优先与「非本主线」/D 表措辞 · CL3 验收去掉「锁内合并」歧义 · 实施后复审计修复（P0：`chat-storage` 值/类型导出分离 `export type`；P2：`turnStats` / `refreshConversationStats` 于 enrich 前写入 + 阶段 3 以新鲜 prev 重算；P3：`conversation-branches` 未用 import 清理）· **同日误截断后按对话定案全文重建**

---

## 1. 图谱重建报告（2026-08-17）

旧图谱已过时（server 08-05 / web、plugins 07-29，代码活动至 08-14）。已对三份语料库全量重建：AST 提取（`parallel=False` 规避沙箱 multiprocessing 管道限制）为主，少量文档/图片（admin 台 HTML、README、头像 logo）经子代理语义抽取；旧社区标签按节点重叠度映射复用。

| 图谱 | 路径 | 节点 / 边 | 社区 | 对比旧图 |
|------|------|-----------|------|---------|
| server | 仓库根 `graphify-out/` | **3043 / 10847** | 116 | 2888 / 10253 ↗；**2026-08-17 晚再抽**（commit `34d5edc`） |
| web | `web/graphify-out/` | **3491 / 4238** | 277 | 3554 / 4547 ↘*；同日再抽 |
| plugins | `plugins/graphify-out/` | **817 / 2002** | 33 | 722 / 1811 ↗；Import Cycles **None** |

*web 节点减少 63 属**合法收缩**（重构后符号减少），被 shrink-guard 拦截后按 skill 指引 `--force` 确认写入。

**God Nodes**（新）：server `registerChatRoutes()`(120) / `getCurrentUserId()`(96) / `readConversationIndex()`(91) / `buildConversationOutboundMessages()`(78)；web `useChatSession()`(27)；plugins `tKey()`(47)。

**新出现 Surprising Connections**：`resolveActiveEvent()` --calls--> `beginDungeonCombat()`（dungeon-maze 战斗已上图）；`vectorEntriesOf()` --indirect_call--> `isLorebookEntryVectorIndexable()`。

**Import Cycles**（依 2026-08-17 报告 / 同日再抽）：server / web 均为 **None**。plugins 初建时曾有 **3 组 2-file cycle**（47 解的仅是 server 环，**不能外推**）；打断后于同日 `graphify update plugins --force` 验收为 **None detected**：

- ~~`trace-keeper/src/trace-state-resolve.ts` ↔ `turn-view-segment.ts`~~ → 共享类型下沉 `types.ts`
- ~~`plot-summary/src/dialogs.ts` ↔ `pipeline.ts`~~ → 公共流程下沉 `lorebook-flow.ts`
- ~~`dungeon-maze/src/battle.ts` ↔ `maze.ts`~~ → `DungeonCombatState` 下沉 `types.ts`

**健康检查**：重建时控制台输出有 dangling-endpoint edges 警告（server 433 / web 1099 / plugins 124，语义节点 ID 未对齐所致）；该数字**仅来自重建控制台口述，未落进 GRAPH_REPORT**（报告只有 isolated nodes 等段落），本地无法复核，只作参考，不作为硬证据。

---

## 2. `upsertChatListEntry()` 数据流（图谱 + 代码验证）

社区位置：server 图谱 community `conversations (1)`；betweenness 0.022，为跨 4 社区桥节点（`conversations (1)` ↔ `lorebooks (4)` / `regex pipeline` / `characters`）。

```
共 18 处 await 调用（chat-storage.ts ×8、chat-group-turn-ops.ts ×6、
              conversation-branches.ts ×3、integration ×1）；图谱入边约 20 个调用方
   ▼
upsertChatListEntry(entry, idx, {refreshConversationStats?})   [src/chat-storage.ts L1293]
   ├─ withChatListFileLock()      ← 全局单条 promise 链互斥锁，所有会话共用 [L1129]
   │   ├─ reconcileChatListWithDiskUnsafe()  ← 每次全量 readdir(chats/) + 读每个未知会话 index.json + enrich [L1302]
   │   ├─ readChatListRaw()                  ← 读+解析整个 chat.index.json（catch 一切 → 空列表）[L1138]
   │   ├─ resolveActivePathConversationStats() ← 读 chunk 链统计轮数/最后时刻（refresh 时）[L1314]
   │   ├─ enrichChatListEntry()              ← 动态 import character-storage，锁内读角色卡元数据
   │   ├─ findIndex ×2 + 全列表 sort(updatedAt) [≈L1334]
   │   └─ writeChatListUnsafe()              ← JSON.stringify(data, null, 2) 整文件重写 [L1153]
```

对照线：`mutateConversationIndex`（`chat-storage-io.ts` L179）对 index.json 已是 **per-conversation keyed 队列 + tmp/rename 原子写**（设计良好）；但 **chat.index.json（全局列表）没有对应队列，只有一把全局锁**。

> **注**：§2 描述的是**改造前**热路径。落地后实现见 `server/src/chat-list-store.ts`（CL7 抽取；CL4 热路径不再每次 reconcile；CL6 enrich 出锁；CL5 `turnStats` 等）。

---

## 3. 可优化点（按收益/风险排序，待实施 → 已落地）

### P0 — 正确性风险

| ID | 问题 | 证据 | 建议 |
|----|------|------|------|
| CL1 | `readChatListRaw()` catch 吞掉一切错误 → 空列表 | `chat-storage.ts` L1138–1150；瞬时 IO 错误（EACCES / Syncthing 半写）被当作空列表，upsert 随后把空列表写回（reconcile 可自愈，但存在竞态窗口） | `ENOENT` → 空；其他错误短重试后 **upsert 路径 degrade** / **read 路径 throw**（以 §6 D1 为准） |

### P0 — 写放大（收益最大）

| ID | 问题 | 证据 | 建议 |
|----|------|------|------|
| CL2 | 每次 upsert = 全列表重写 + pretty-print，**无变更也照写** | `writeChatListUnsafe` L1153；`JSON.stringify(data, null, 2)` 膨胀 2–3×；Syncthing 下每条消息整文件同步 | merge 后与现有条目相等则跳过写；或改紧凑 JSON |
| CL3 | 单请求内多次 upsert 可能叠加整写 | 各写盘函数（`appendSegmentToTurn` / `updateTurnContentInTailChunk` / `mergeTurnPluginEntriesAtOrdinal` …）各自独立整次 upsert，管线内**可叠加**；但常见路径（`persistTurnAfterModelReply`）通常只走其中一条（约 1 次），「一轮必 2–7 次」证据不足 | **新增批量变体 `upsertChatListEntries(entries[])`**：锁内 read 一次 / merge 全部 / sort 一次 / write 一次；**不默认全盘 reconcile**（与 §5 一致）；写放大按叠加次数线性下降 |

### P1 — 热路径瘦身

| ID | 问题 | 证据 | 建议 |
|----|------|------|------|
| CL4 | `reconcileChatListWithDiskUnsafe()` 每个 upsert 都全盘扫描 | L1302；自愈逻辑（Syncthing 冲突/历史 bug）放错了热路径 | 移出热路径：仅 `readChatList()` / 启动 / **dirty 标记触发**（优先于 ≥30s 定时器，见 §6）；upsert 只做已知 id merge+write |
| CL5 | `resolveActivePathConversationStats()` 每条消息读整个 chunk 链 | L1314 + `refreshConversationStats: true` 调用点；写 1 轮却全链数轮数 + 取最后时刻 | 热路径**写事件增量**（本次落盘 delta：append +1 / 截断后重算一次）或传入已知 `turnCount`/`lastChatAt`；**禁止**用单文件 tail 冒充 active path；全量/修复路径保留 `resolveActivePath*` / `syncChatListConversationStats`（口径以 §6 D2 为准） |

### P1 — 锁粒度

| ID | 问题 | 证据 | 建议 |
|----|------|------|------|
| CL6 | 全局单锁 + 锁内做 IO（enrich 读角色卡也持锁） | `chatListFileLock` L1129；跨会话互相阻塞 | enrich 移出锁（先 enrich 再进锁）；或复用 `createKeyedSerialQueue` 按 conversationId 分桶（index.json 已有先例） |

### P2 — 可拆分性（对应图谱社区 89 聚类提示）

| ID | 问题 | 证据 | 建议 |
|----|------|------|------|
| CL7 | `chat-storage.ts` 职责过载 | chunk 写入入口 + 10+ 列表维护函数 + 共 18 处 `upsertChatListEntry` 调用（跨 4 文件，其中本文件 8 处）；图谱社区 89 的成员正是 `ChatListFile` / `readChatListRaw` / `withChatListFileLock` / `reconcileChatListWithDisk*` 等列表函数（报告自动命名 `lorebooks (4)`，**自动命名不准**，勿按标签理解） | 拆独立 `chat-list-store.ts`（锁/读/写/reconcile/批量 upsert）；`enrichChatListEntry` 纯函数化，去掉动态 import 绕环的间接层 |
| CL8 | 双写模式覆盖不全 | **组合 API 已存在**：`updateConversationIndexAndList()`（原 `chat-storage.ts` L1341，现 `chat-list-store.ts`）即「mutate index + upsert list」；问题不是「没有组合 API」，而是**大量路径仍直接 `mutateConversationIndex` 后跟 `upsertChatListEntry`**，未走该组合入口 | 扩展既有 `updateConversationIndexAndList` 的覆盖（让各写盘路径统一走它），或在其上加批量变体，而非新建 `touchConversationAndList` |
| CL9 | 每次全列表 sort O(n log n) | ≈L1334 `localeCompare` 排序 | 有序插入（二分定位）；列表页加进程内缓存 + 写时 invalidate |

**原建议顺序**（§3 初稿）：CL1 → CL3 → CL2 → CL4/CL5 → CL6 → CL7–CL9。  
**定案顺序**见 §5（因常见路径约 1 次 upsert，先做每次 upsert 都受益的 CL2+CL4）。

---

## 4. 关联与后续

- 新图产物（本地）：仓库根 `graphify-out/graph.html` · `web/graphify-out/graph.html` · `plugins/graphify-out/graph.html`
- **旧图已清理**（2026-08-17）：`server/graphify-out/`（08-05 旧图 · 2888 节点 / 10253 边 · `built_at_commit ddb795b`）已删除；新 server 图在仓库根 `graphify-out/`
- 首轮审计与已落地拆分见 [`47`](47-graphify-optimization-backlog.md)
- 改进计划已登记 [`04-TODO.md`](04-TODO.md) §P2（chat.index 项已勾选）；实施时同步 `DOC/devNotes/03` 相关段落（`chat.index` 写锁 / 列表统计）

---

## 5. 改进计划（定案 · P2 · 已实现）

> **目标**：降低 `chat.index.json` 热路径的错误写空风险与写放大，不改变对外 API 语义；可维护性拆分靠后。  
> **非本主线（CL1–CL9）**：plugins 三组 import cycle、图谱 dangling、清理 `server/graphify-out/`——已分项登记 [`04-TODO.md`](04-TODO.md) §P2，与本主线并行、互不阻塞。  
> **约束**：不做兼容双路径；坏 JSON/IO 从「静默变空」改为失败/重试属有意收紧。宿主通用性：改动限于 `server/src` 存储层。

**实施状态（2026-08-17）**：**M0–M4 全部完成（CL1–CL9）** ✅ —— 单测 7/7（`server/test/chat-list-file-lock.test.ts`）；CL7 抽出 `chat-list-store.ts`（无静态环）；CL6 两段锁（enrich 出锁，delta 基数取阶段 3 新鲜 prev）；CL8 迁 7 处直接 mutate+upsert。

**定案落地顺序**：

```
CL1 → CL2+CL4 → CL5 → CL3+CL8 → CL6 → CL7+CL9
      ↑ 每次 upsert 都赚        ↑ 叠加/双写        ↑ 结构债
```

### M0 — 正确性（CL1）· 约 0.5d ✅ 已实现

| 项 | 做法 | 验收 |
|----|------|------|
| CL1 | `readChatListRaw`：`ENOENT` → 空列表；其他错误短重试后 **upsert 路径 degrade**（不写列表、记 warn）/ **read 路径 throw**；**禁止**当空列表写回（口径以 §6 D1 为准） | 单测：缺文件仍空；故意坏 JSON / 非 ENOENT 时 upsert 不写空列表且不连累消息落盘、read 路径可观测失败（扩 `server/test/chat-list-file-lock.test.ts`） |

### M1 — 每次 upsert 都受益（CL2 + CL4）· 约 1–2d ✅ 已实现

常见路径每轮约 1 次 upsert，但每一次仍 reconcile + 整文件 pretty 写。

| 项 | 做法 | 验收 |
|----|------|------|
| CL4 | upsert / sync 热路径**默认不** `reconcile`；reconcile 仅：`readChatList`、启动、显式 API、**dirty 标记触发**（优先；≥30s 定时器仅作兜底可选） | 连续 N 次 upsert 无多余 `readdir(chats/)`；列表页/启动仍能自愈缺条目 |
| CL2 | merge+enrich 后与原条目相等（或稳定字段子集）则 **skip write**（**对齐 `syncChatListConversationStats` 已有先例**：L1280–1281 `activeTurnCount`/`lastChatAt` 未变即 `return`，避免重复设计）；可选改紧凑 JSON（与 Syncthing 权衡，可二选一或先 skip） | 无字段变化时文件内容不变；有变化仍整写 |

**建议合 PR**：CL1+CL2+CL4 打一包。Syncthing 下少写、少 reconcile 均降同步噪音；reconcile 节流后偶发缺条目依赖读列表/启动自愈，实施时在 `03` 补一句。

### M2 — 统计刷新成本（CL5）· 约 1d ✅ 已实现

| 项 | 做法 | 验收 |
|----|------|------|
| CL5 | `refreshConversationStats: true` 改为**写事件增量**（本次落盘 delta：append +1 / 截断后重算一次）或传入已知 `turnCount`/`lastChatAt`；**禁止**用单文件 tail 冒充 active path（`activeTurnCount` 含 fork 前缀轮数）；全链 `resolveActivePathConversationStats` 留给 sync/修复 | 带 refresh 的落盘路径不再全链扫；与 `syncChatListConversationStats` 行为可文档说明差异（口径以 §6 D2 为准） |

优先改现有 `refreshConversationStats: true` 调用点（约 6 处）。

### M3 — 多写合并 + 入口统一（CL3 + CL8）· 约 1–2d ✅ 已实现

在 M1 之后做：单次 upsert 已变轻，再收叠加与双写。

| 项 | 做法 | 验收 |
|----|------|------|
| CL3 | 新增 `upsertChatListEntries(entries[])`（锁内一次 read/merge/sort/write；**不**默认全盘 reconcile）；单条改走批量 | 人为连续两次本会各写一次的更新 → 经**批量 API**或调用方显式 batch 后一次写盘 |
| CL8 | `chat-group-turn-ops` / `conversation-branches` 等「mutate + upsert」改为走 `updateConversationIndexAndList`（或扩展其批量版） | 直接 `mutate`+`upsert` 调用显著减少；无丢字段竞态回归 |

### M4 — 锁与结构（CL6 → CL7 → CL9）· 约 2–3d，可拆 PR ✅ 已实现

| 项 | 做法 | 备注 |
|----|------|------|
| CL6 | enrich **出锁**：锁外 enrich → 锁内 merge 已 enrich 条目；全局锁可先保留 | 比按 id 分桶改动小；分桶须处理「整文件唯一写者」 |
| CL7 | 抽出 `chat-list-store.ts`（锁/读/写/reconcile/upsert*）；`enrichChatListEntry` 去动态 import 绕环 | 对齐社区 89 聚类；保持导出稳定 |
| CL9 | 有序插入替代全量 sort（`chatListSortedInsertIndex` 二分插入；batch/reconcile 仍整写排序） | 已实现：upsert 移除全量 sort（更新时间变化才重排）；列表很大时才更明显；CL7 拆文件后保留 |

**落地包**：

- **包 1**（2026-08-17）：CL1+CL2+CL4+CL5+CL3+CL8+CL9 —— `chat-storage.ts` / `chat-group-turn-ops.ts` / `conversation-branches.ts` 改造。
- **包 2**（2026-08-17）：CL6+CL7 —— `chat-list-store.ts` 抽取 + enrich 两段锁。
- 两包均已实现，单测 7/7；未提交（用户未要求 push）。实施后复审计见 §6.5。

---

## 6. 计划评估（2026-08-17 · 审计后复核）

> **结论**：计划事实断言全部经代码核实成立；里程碑划分清晰、依赖顺序正确、估计合理（合计约 5.5–8.5 人日）。D1–D3 **推荐已明确，开写可直接按推荐执行**（无需再开一轮讨论）。

### 6.1 事实核对

| 计划断言 | 核实结果 |
|---------|---------|
| `refreshConversationStats: true` 调用点约 6 处 | ✅ 精确 6（`chat-group-turn-ops` 2 + `chat-storage` 4） |
| `chat-list-file-lock.test.ts` 存在 | ✅ `server/test/chat-list-file-lock.test.ts`（另有 `chat-list-enrich.test.ts`） |
| `chat-group-turn-ops` 存在「直接 mutate+upsert」模式 | ✅ **6 组 mutate→upsert**（7 次 mutate、6 次 upsert；L423/428 双 mutate 共用一次 upsert L440） |
| `updateConversationIndexAndList` 为现成组合 API | ✅ 原 `chat-storage.ts` L1341（私有 async，需导出/加批量版；现已迁 `chat-list-store.ts` 并导出） |
| sort 行号 ≈L1334 | ✅（改造前） |

### 6.2 逐里程碑结论

- **M0（CL1）**：「抛出」会连累消息落盘，「degrade」则列表短暂陈旧——已由 **D1** 分路径定案（upsert degrade / read throw）；§3/§5 CL1 行已回写该口径。
- **M1（CL2+CL4）**：收益最大。CL4 节流建议用 **dirty 标记**而非 ≥30s 定时器（与 CL1 写失败置 dirty 天然配合）；CL2 建议**保持 pretty JSON、只做 skip**（紧凑 JSON 与 Syncthing 可读性权衡，收益低于 skip，可砍）；需兜住「enrich 结果含易变字段导致比较恒不等」的假阳性。
- **M2（CL5）**：方向对，但**禁止用单文件 tail chunk 冒充 active path**——`activeTurnCount` 现义是 **active 路径轮数**（`resolveActivePathTurns`，含 fork 前缀），不是 tail chunk 内条数，分支/回滚/regen 下会算错。热路径应**由本次写盘事件算 delta**（append +1 / 截断后重算一次）或传入已知 `turnCount`/`lastChatAt`；全量/修复路径保留 `resolveActivePath*` / `syncChatListConversationStats`。→ **D2（见下）**。
- **M3（CL3+CL8）**：依赖 M1，顺序正确。CL8 扩展覆盖时注意**锁序一致**（现为「先 per-conversation index 队列，后全局 chat list 锁」），勿引入反向锁序死锁。
- **M4（CL6→CL7→CL9）**：纯结构债，排序合理。CL7 按社区 89 **成员**（readChatListRaw / withChatListFileLock 等）定位，勿被自动标签 `lorebooks (4)` 误导。→ **D3（见下）**。

### 6.3 实施决策（推荐即定案）

| ID | 决策 | 定案 |
|----|------|------|
| **D1** | CL1 失败策略 | upsert 路径 **degrade**（不写列表、记 warn）；read 路径 **throw**（短重试后） |
| **D2** | CL5 取值口径 | **写事件增量优先**（本次落盘 delta：append +1 / 截断后重算一次），或调用方传入已知 `turnCount`/`lastChatAt`；**禁止**用单文件 tail chunk 冒充 active path（`activeTurnCount` 含 fork 前缀轮数）；全量/修复路径保留 `resolveActivePath*` / `syncChatListConversationStats` |
| **D3** | M4 范围 | 显式纳入 `readChatList` / `refreshChatListEntriesForCharacter` 的整写（拆 `chat-list-store` 时一并处理），避免漏 |

### 6.4 可选补充

- **写放大基准**：`writeChatListUnsafe` 加计数日志，改造前后对比验证 CL2/CL3 收益（非必须）。
- 遗漏项（plugins 3 组 cycle、`server/graphify-out/` 旧图）已补登记 **TODO P2**（见 [`04-TODO.md`](04-TODO.md)）。

### 6.5 实施后复审计（2026-08-17）

| 优先级 | 问题 | 处理 |
|--------|------|------|
| P0 | `chat-storage.ts` 把 interface 当值 `export { ChatListEntry, … }`，tsx 无法 import | 改为 `export type { … }` + 值导出分离；`chat-list-file-lock` 7/7 通过 |
| P2 | `turnStats` 在 enrich 之后才应用，仍可能触发全链扫描 | enrich 前写入；阶段 3 用新鲜 prev 重算 `turnStats` |
| P3 | `conversation-branches.ts` 未用 import | 已清理 |
| 备注 | CL8 收尾（2026-08-17）：`batchUpdateConversationTurnsUnsafe` / `updateConversationAuditDebug` / `saveOpeningTurn` / `saveFirstTurn` 已统一走 `updateConversationIndexAndList`（含 turnStats）；同日补齐 **`appendConversationTurn` / `removeTurnAtOrdinalInTailChunk` / 导入 finalize**。**保留原结构**：分支路径仍先 `mutateBranch` 再组合 API（组合 API 只写根 index）；截断双 mutate（branch+root）已收束为 branch mutate + 组合 API。**plugins 三环已断**：dungeon-maze `types.ts`、trace-keeper `types.ts`（TraceTurnRef 显式化）、plot-summary `lorebook-flow.ts` 下沉 | 收尾完成 |
