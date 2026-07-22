# 群聊（多角色发言轮次）— 设计定案

> **状态**：定案 · **G0–G5 已落地**（2026-07-03）  
> **关联**：`DOC/03` §6.8（turn/chunk · 群聊落盘）、`DOC/04` **已归档**（G0–G5 · Composer Slash S0–S4）、`DOC/14` / `DOC/26`（ST 群聊宏）、Composer Slash（[`DOC/36`](36-composer-slash.md) · **已归档**）

---

## 1. 背景

### 1.1 现状

| 能力 | 状态 |
|------|------|
| 会话 `characterIds[]` 多卡绑定与 XML 注入 | ✅ |
| 宏 `{{char}}` / `{{charN}}` / `{{notChar}}`（群聊除当前 speaker） | ✅ |
| 一轮 user 对应多个 **不同 speaker** 的 assistant | ✅ G0 |
| `speakerMode` 三选一 + 掷骰竞标 + `groupChatTurnState` | ✅ G3 |
| Continue 改选 / `[NEXT@]` / 群聊 audit Tab | ✅ G4 |
| ST 群聊宏 `{{group}}` 等 | ✅ G2（`{{group}}` / `{{groupNotMuted}}`） |
| Composer Slash / `/@` | ✅ S0–S4（插件命令路由 ✅）见 [`DOC/36`](36-composer-slash.md) |
| `speakerQueue` → turn / chat API | ✅ G1 |
| 手动 Continue（`groupContinue`） | ✅ G1 |

群聊开启时 assistant 按 **segment** 携带 `speakerCharacterId`；未开群聊时默认 **char1**（`characterIds[0]`）单段，见 §1.2。

### 1.2 与多卡绑定的关系

- **绑定多卡 ≠ 群聊**：仅 `groupChat.enabled === true` 时启用多 segment 接龙。
- **定案 · 新建多人对话**（≥2 bot）：创建时**默认开启群聊**并写入 `initialMultiBotGroupChatSettings`（掷骰竞标、`confirmContinue`、额度 2、衰减开、`maxSegmentsPerTurn = bot数+2`、成员色预分配）。单 bot / 旧会话不自动开启；用户仍可在群聊对话框关闭。
- **未开群聊**：默认 **char1**（`characterIds[0]`）生成 **1 段**；`/@` 仍可强制指定任意已绑定角色（1 段）。
- 角色卡 XML 组装逻辑不变；本文只定义 **发言轮次、选人、接续标记**。

---

## 2. 产品定案（2026-07-01）

### 2.1 轮次模型

一条 **user** 对应同 `turnOrdinal` 下多个 **assistant segment**：

```text
turn {
  user: string                    // LLM 可见正文（已 strip 元指令）
  speakerQueue?: string[]         // 来自 /@，characterId 列表；可选 meta
  segments: AssistantSegment[]
  activeSegmentIndex: number
}

AssistantSegment {
  id: string
  speakerCharacterId: string
  receives: ReceiveItem[]
  activeReceiveIndex: number
  meta?: {
    nextSpeakerHint?: string      // 解析自 [NEXT@Name]；characterId
  }
}
```

| 规则 | 说明 |
|------|------|
| **同一 bot 不得连说** | 仅 **上一 segment 的 speaker** 不参与下一段选人（冷却 1 段）；额度允许则同 bot 可在中间有人插话后再说 |
| **每 bot 发言额度** | `members[].speakQuota`（默认见 §2.7）；**实际发言**与 **掷骰失败**均消耗额度（见 §2.7）；**抢麦失败不扣额度** |
| **turn 段数上限** | `maxSegmentsPerTurn`（可选）；达上限结束本 user turn |
| **regenerate / swipe** | 仅作用于 **当前 segment** 的 receive |
| **落盘** | assistant 正文 **仅**在 `segments[i].receives[]`（无 turn 级镜像，见 [`DOC/44`](44-turn-segment-only-storage.md)） |
| **迁移** | 旧 turn 无 speaker → 包装为单 segment，`speakerCharacterId = characterIds[0]` |

组装 history：按 segment 顺序展开多条 assistant（带 speaker 标记）；生成时 `{{char}}` = **当前 segment 的 speaker**（非固定 char1）。

### 2.2 群聊开关与会话设置

`index.json`（或等价会话索引）：

```json
{
  "characterIds": ["alice-id", "betty-id"],
  "groupChat": {
    "enabled": false,
    "speakerMode": "dice",
    "autoContinue": false,
    "confirmContinue": true,
    "maxSegmentsPerTurn": 8,
    "decay": {
      "enabled": true,
      "initialRate": 1.0,
      "step": 0.2,
      "floor": 0
    },
    "members": {
      "<characterId>": {
        "weight": 1.0,
        "muted": false,
        "speakQuota": 2,
        "color": "#e11d48"
      }
    },
    "groupAssembleInstruction": "…群聊角色说明（{{char}}）…",
    "continueAssembleInstruction": "…[NEXT@] 接续说明…"
  }
}
```

| 字段 | 说明 |
|------|------|
| `speakerMode` | **`sequential` \| `dice` \| `next@`**，三选一（§3）；**无段间 fallback** |
| `maxSegmentsPerTurn` | 本 user turn 内 assistant segment 硬上限（可选） |
| `members[].speakQuota` | 该 bot 在本 user turn 内的发言预算（§2.7） |
| `members[].color` | 会话级 bot 区分色（`#rrggbb`）；开启群聊或成员变更时对缺色成员自动分配；UI 头像边框 / 助手气泡着色；**仅 bot**，user 不配色 |
| `decay` | **per-bot** 个人衰减曲线默认模板（§2.7）；G2 过渡代码仍用全局段序号衰减 |
| `groupAssembleInstruction` | 群聊角色说明；注入于 **user 消息之后**（`afterUserInput`）；空串用英文默认 |
| `continueAssembleInstruction` | `[NEXT@]` 接续说明；**仅 `speakerMode=next@`** 时与群聊说明 **拼接为一条 system** |
| `mode: weighted` | **已废弃**（G2 过渡字段）；G3 起由 `speakerMode: dice` 替代 |

| `enabled` | 首段 speaker（queue 空） | segment 数 |
|-----------|--------------------------|------------|
| `false` | char1 或 `/@` | 通常 1；`/@` 可指定他人 |
| `true` | 见 §3（**不再默认 char1**） | 多 segment + 额度 / confirm |

**UI**：对话顶栏 `chat-header` 群聊图标 → 开关、`speakerMode`、`autoContinue` / `confirmContinue`、`maxSegmentsPerTurn`、**群聊提示词**（全模式）、**接续提示词**（仅 `next@`）、衰减与额度、**成员列表**（角色立绘头像、`characterImageUrl` size `s`、displayName、**颜色 picker**〔`members[].color`〕、权重〔`dice`/`next@`〕、静音、上下排序〔`sequential`〕改 `characterIds`）。群聊开启时聊天区按 `speakerCharacterId` 给助手头像边框与气泡上色（见 `DOC/03` 群聊 UI）。

**流式首段 speaker**：组装（含掷骰）结束后服务端立刻开 SSE（HTTP **仍为 2xx**），经响应头 `X-Speaker-Character-Id` 与首包 `data: {"arousal":{"speakerCharacterId":"…"}}` 下发当选 bot；前端 `patchPendingSpeakerCharacterId` 更新 pending 气泡。**不以客户端复算掷骰**；无 `/@` 时 pending 初始可为空，群聊未知 speaker 不回退 `characterIds[0]`。

**流式错误契约（定案）**：因 speaker 早下发，上游 `fetch` 失败 / 非 2xx / 管道错误**不再**改写为 HTTP 502；改为同流内 `data: {"arousal":{"error":"<code>","detail?":"…"}}`（`formatArousalStreamErrorSseLine`）后结束。客户端须解析 SSE `arousal.error`（本仓 `readSseStream` 会 throw），**不能**只看 HTTP status。客户端中止生成时走既有 abort 绑定，避免旧流回写新会话。

### 2.3 用户指定发言者：`/@`（Slash 内置）

**定案：Composer Slash 落地后，仅认 `/@`；正文中裸 `@Bot` 不参与选人。**

| 来源 | 裸 `@Name` | `/@` | `[NEXT@Name]` |
|------|------------|------|----------------|
| **user** | ❌ **无效**（当普通文本） | ✅ 发言队列 | — |
| **assistant** | ❌ **无效** | — | ✅ 下一段 hint |

#### 语法

```text
/@ Alice
/@ Alice Betty
/@ Alice Betty 你们俩说说
```

- 名字为绑定卡的 **displayName**（空格分隔多个；顺序 = 发言顺序）。
- **不教 charN**：MVP 不要求模型输出 `[NEXT@char2]`，不注入 `char1=Alice` 对照表。
- 解析在 **`submitComposer`**（与 `/goto` 等内置命令同级）；`/@` 为宿主内置，非插件。

#### 落盘与 LLM 可见正文

```text
submitComposer(raw)
  → parseSlash：提取 speakerQueue（characterId[]）
  → userTextForModel = strip /@ 后的正文
  → persist：turn.user = userTextForModel；meta.speakerQueue 可选
  → 输入历史可存 raw（已有 composer-input-history）
```

**Slash / `/@`（已归档）**：S2 起由 Composer Slash 统一解析；`speakerQueue` 已接 G1 persist/API。详见 [`DOC/36`](36-composer-slash.md)。

### 2.4 助手接续：`[NEXT@DisplayName]`

- 模型若需指定下一位，使用 **`[NEXT@Betty]`**（displayName），**不用** `[NEXT@char2]`。
- **禁止**依赖 `[NEXT@{{char2}}]`（会进入宏管线，行为不可控）。
- **assistant 正文中的裸 `@`**：一律视为剧情文本，**不**参与 SpeakerResolver。

#### 提取时机（硬规则）

```text
LLM 原始 assistant 文本
  → ① extract [NEXT@…]（SpeakerRef by displayName）
  → ② strip 标记 → 可见正文
  → ③ outgoing regex / trace-keeper 等插件
  → ④ persist；hint 存 segment.meta（勿 persist 后再扫全文）
```

| 规则 | 说明 |
|------|------|
| 多个 `[NEXT@…]` | 取 **最后一个** |
| **仅 `speakerMode=next@` 时** | hint 参与下一段选人（§3） |
| **`speakerMode` 为 sequential / dice** | hint **仅 strip 存 meta**，**不参与** SpeakerResolver |
| hint 合法 | 目标已绑定、未 mute、额度 > 0；**可 override「不连说」**（模型显式指定连说） |
| hint 无效 / 缺失（`next@` 模式、第 2 段起） | **用户手动指定**；**不得** fallback 至 sequential 或 dice |
| 无标记（`next@` 模式、第 2 段起） | 同「hint 无效」 |

群聊 assemble 注入（**`enabled` 时**；见 `groupChatAssembleInstruction` → `assemble-prompts` **`afterUserInput`**，depth 0 = 紧接最后一条 user 消息之后，**非**作者注）：

| `speakerMode` | 注入内容 |
|---------------|----------|
| `sequential` / `dice` | 仅 `groupAssembleInstruction`（默认英文角色说明） |
| `next@` | `groupAssembleInstruction` + `\n` + `continueAssembleInstruction` **拼接为一条 system** |

默认正文见 `shared/group-chat-settings.ts`：`DEFAULT_GROUP_CHAT_ASSEMBLE_INSTRUCTION`、`DEFAULT_GROUP_CONTINUE_ASSEMBLE_INSTRUCTION`。会话内可覆盖；宏 `{{char}}` / `{{user}}` 等在 assemble 后展宏。

### 2.5 控制开关

| 开关 | 行为 |
|------|------|
| `autoContinue` | 下一位 **已确定**（queue / 模式 resolver / 合法 hint）时自动 `groupContinue` |
| `confirmContinue` | 暂停；UI 显示建议下一位，可 **改选** bot。**`next@` 模式 hint 失败时必须 pending 手动**，不得 auto |

组合：`confirmContinue=true` 时每段可确认；确认后可再链式 auto（下一位仍须已 resolve）。

### 2.6 掷骰竞标（`speakerMode=dice`；`next@` 首段无 `/@` 时共用）

**目标**：避免「每人必说一句」的机械接龙；用 **per-bot 掷骰失败耗额度** 自然收束段数。

#### 概念区分（硬规则）

| 概念 | 含义 | 额度 |
|------|------|------|
| **掷骰失败** | 该 bot **个人衰减骰**未通过（`random() >= P_k`） | **扣 1**（未发言）；首段全员失败兜底时 **全员**按此扣，speaker **不另扣**发言（§2.6） |
| **抢麦失败** | 掷骰通过但 **得分非最高** | **不扣** |
| **发言** | 成为本段 speaker 并生成 segment | **扣 1**；该 bot `k += 1`（下次 `P_k` 更低） |

**抢麦失败 ≠ 掷骰失败。**

#### eligible（参与本轮掷骰 / 抢麦）

- 在 `characterIds` 内、未 mute  
- `speakQuota > 0`  
- **不是上一 segment 的 speaker**（不连说；hint override 见 §2.4）

#### 个人衰减概率

```text
P_k = max(floor, initialRate - step × k)
k = 该 bot 在本 user turn 内已成功发言次数（默认 0 起）
decay.enabled=false → P_k = 1
```

#### 单轮竞标（每一段选 speaker 前，queue 空且模式为 dice 或 next@ 首段）

```text
对每个 eligible bot:
  roll = random()
  若 roll >= P_k → 掷骰失败（记录 failed）
  否则 → 掷骰通过（记录 passed）
  score = weight × random()（并列用 characterIds 顺序或 seed 打破）

若存在掷骰通过者:
  score 最高者为本段 speaker
  掷骰失败者 speakQuota -= 1；抢麦失败者额度不变；speaker 另扣发言额度 speakQuota -= 1
若无人掷骰通过:
  → 进入「全员掷骰失败 → 结束本 user turn」流程
  若 segmentCount == 0（首段）:
    → 终止上述结束流程，改走「首段全员失败兜底」（§2.6）
  否则:
    → 确认结束本 user turn
```

#### 首段全员失败兜底（罕见）

**触发**：经上表进入「全员失败 → 结束 turn」流程，且 **`segmentCount === 0`** 时 **中止结束**，改作本兜底（非与结束流程并列的另一分支）。

**条件**：本轮 eligible **全部**掷骰失败（**掷骰失败**，非抢麦失败）。

**行为**：仍按上表已算出的 `score` **取最高者**作为本段 speaker。

**额度（本兜底专用）**：

| 角色 | 额度 |
|------|------|
| **全部 eligible** | 各 **扣 1**（按 **掷骰失败** 计） |
| **胜出 speaker** | **不再另扣**发言额度（每人本轮合计 **只扣 1**） |
| **其余 eligible** | 已在上行随掷骰失败扣过，**不重复扣** |

> **第 2 段起**：全员掷骰失败 → 结束流程 **不中止**，直接结束本 user turn；各 bot 按常规定价（掷骰失败扣 1，抢麦失败不扣）。

#### 终止（dice 模式与共用）

- `segmentCount >= maxSegmentsPerTurn`  
- 所有 bot `speakQuota == 0`  
- eligible 为空  
- **全员掷骰失败** → 进入结束本 user turn 流程；**仅当 `segmentCount > 0` 时生效**（首段时中止结束，走 §2.6 兜底）

权重来自 `members[].weight`（默认 1）。

### 2.7 顺序模式（`speakerMode=sequential`）

- queue 空时：在 **eligible**（§2.6）内按 **`characterIds` 顺序**取第一个。  
- **不掷骰**、**不读 hint** 选人。  
- 首段同样走顺序（**不用 char1 硬编码**；eligible 第一个即列表序第一个未 mute、有额度的 bot）。

---

## 3. SpeakerResolver（2026-07-02 定案）

### 3.1 两层结构（非 fallback 链）

```text
┌─────────────────────────────────────────┐
│  L0 覆盖：`speakerQueue`（用户 `/@`）      │
│  非空 → shift 下一位，忽略 speakerMode     │
└─────────────────────────────────────────┘
                    ↓ queue 空
┌─────────────────────────────────────────┐
│  L1 配置：`speakerMode` 三选一             │
│  sequential | dice | next@               │
│  段间不得互相降级（见 §3.3「不 fallback」）  │
└─────────────────────────────────────────┘
```

**「不 fallback」** 指：`next@` 模式下 **第 2 段起** hint 缺失/无效时 **仅用户手动**，不得改用 sequential 或 dice。  
**例外（非 fallback）**：`next@` 模式 **首段** 且用户未 `/@` → **掷骰**选第一位（模式内开场规则，见 §3.2）。

### 3.2 各模式选人（queue 空）

| `speakerMode` | 首段 | 第 2 段起 |
|---------------|------|-----------|
| `sequential` | eligible 中 **characterIds 第一个** | 同上（每段 re-pick） |
| `dice` | **掷骰竞标**（§2.6） | **掷骰竞标** |
| `next@` | **掷骰竞标**（无 `/@` 时） | 上段 `[NEXT@]` hint 合法 → 用之；否则 **手动** |

| 模式 | 是否使用 `[NEXT@]` 选人 | 是否掷骰选人 |
|------|-------------------------|--------------|
| `sequential` | ❌（仅 strip） | ❌ |
| `dice` | ❌（仅 strip） | ✅ 每段 |
| `next@` | ✅ 第 2 段起 | ✅ 仅首段（无 `/@`） |

### 3.3 群聊主循环

```text
turnState = { perBot: { speakQuota, speakCount } }  // 本 user turn 内

loop:
  if !enabled && segmentCount >= 1: break
  if segmentCount >= maxSegmentsPerTurn: break

  pick speaker:
    if speakerQueue 非空 → shift（L0）
    else if speakerMode == sequential → sequentialPick(eligible)
    else if speakerMode == dice → diceBiddingPick(eligible)
    else if speakerMode == next@:
      if segmentCount == 0 → diceBiddingPick(eligible)   // 首段无 /@
      else if hint 合法 → hint
      else → pending 手动; break

  generate → persist → extract [NEXT@]（存 meta；仅 next@ 模式用于下段）

  if confirmContinue && 需确认: break
  if !autoContinue: break
  if 终止条件（§2.6）: break
```

**未开群聊：**

```text
speaker = speakerQueue[0] ?? characterIds[0]
生成 1 segment → 结束
（speakerQueue 长度 > 1 → toast：需开启群聊才能接龙）
```

**continue API：**

```json
{
  "conversationId": "...",
  "promptTrigger": "groupContinue",
  "groupContinue": {
    "turnOrdinal": 5,
    "speakerCharacterId": "...",
    "afterSegmentIndex": 2
  }
}
```

### 3.4 过渡实现（G2）与目标差异

| 项目 | G2 已落地（代码） | G3 目标（本文） |
|------|-------------------|-----------------|
| 模式 | `mode: weighted \| sequential` 混合 fallback | `speakerMode` 三选一 |
| 首段 | `characterIds[0]` 或 queue | dice/sequential/next@ 按 §3.2 |
| 衰减 | 全局段序号，一次失败整轮结束 | per-bot 掷骰 + 抢麦 |
| 每 bot 次数 | 每 turn 最多 1 segment | `speakQuota` + 不连说 |
| hint 无效 | fallback weighted/sequential | **仅手动**（`next@`） |

---

## 4. SpeakerRef 解析（服务端）

与宏 **独立**；`[NEXT@char2]` 无 `{{` **不触发**宏管线。MVP **主推 displayName**；服务端可 **可选** 支持 `charN → characterIds[N-1]`，不在提示词中教模型。

```text
displayName  → 绑定列表唯一匹配
characterId  → 可选短 id
charN        → 可选；characterIds[N-1]（Phase 2+）
```

---

## 5. ST 群聊宏（speaker 模型之后）

| 宏 | 群聊语义 |
|----|----------|
| `{{group}}` | 绑定卡名列表（`characterIds` 顺序） |
| `{{groupNotMuted}}` | 减去 `muted` |
| `{{charIfNotGroup}}` | 非群聊 = `{{char}}`；群聊 enabled 时为空 |
| `{{char}}` / `{{charN}}` | 生成时 **当前 speaker** / 绑定序 |
| `{{notChar}}` | 群聊：除 **当前 speaker** 外；非群聊：除首绑卡外 |

详见 `DOC/26`；实现排在 **G0 模型 + G1 `/@`** 之后。

---

## 6. 与 trace-keeper 的衔接

- `[NEXT@]` 提取在 **turn-plugin 链固定 phase**（模型原文阶段）。
- trace-keeper 在正文后 append 块 **不影响** 已提取的 `nextSpeakerHint`。
- trace 块内的 `[NEXT@…]` **不**当接续标记。
- **群聊多 segment（2026-07-08 · TK-O1）**：组装 history / Separate transcript 按 segment 逐条 assistant 输出；近 `skipLastNTurns` 轮各 segment 正文内保留 `<ex-trace-keeper>` 供下一段 bot 续写；Separate 仅剥 **目标 segment** 块。见 [`DOC/30`](30-plugin-trace-keeper.md) §10 · [`DOC/44`](44-turn-segment-only-storage.md)。

---

## 7. 实现分期

| 阶段 | 交付 |
|------|------|
| **G0** | segment + `speakerCharacterId` + 迁移；UI 多气泡；单 bot 行为兼容 |
| **G1** | `submitComposer` + 内置 `/@`；strip meta；未开群聊 `@` 强制 1 段；手动 Continue |
| **G2** | 权重、mute、**过渡**全局衰减 + `mode: weighted`；`autoContinue`；`{{groupNotMuted}}`；顶栏 bot 列表 |
| **G3** | **`speakerMode` 三选一**（§3）；per-bot 额度 + 掷骰竞标（§2.6）；`maxSegmentsPerTurn`；废弃混合 fallback |
| **G4** | **`speakerMode=next@` 全量**：hint 失败手动、首段掷骰；`confirmContinue` 改选；audit 掷骰表 + 群聊审计 Tab（本段/下段选人 · 2026-07-03） |
| **G5** | 群聊说明注入按模式分支、`{{notChar}}` 群聊语义、`{{charIfNotGroup}}`、**Group chat** 预设种子（新用户） |

**依赖：** G1 的 `/@` 依赖 Composer Slash（**S0–S4 已归档** · [`DOC/36`](36-composer-slash.md)）。

### 7.1 代码布局（2026-07-03）

| 层级 | 路径 | 说明 |
|------|------|------|
| **共享** | `shared/group-chat-settings.ts` | `normalizeGroupChatSettings`、`mergeGroupChatSettings`、`listEligibleCharacterIds`、`segmentSkipQuotaDeduction` 等；经 `scripts/sync-group-chat-settings-shared.mjs` 同步至 `server/src/shared/`、`web/src/shared/` |
| **构建** | `scripts/sync-all-shared.mjs` | dev / build / test / typecheck 前统一同步 plot-summary、prompt-preset、portrait-media、group-chat-settings |
| **服务端** | `server/src/group-chat/` | 选人/掷骰/落盘逻辑模块化：`types` · `segments` · `pick` · `audit` · `resolve` · `continue` · `outbound` · `instructions`；`server/src/group-chat-turn.ts` 为 barrel re-export |
| | `server/src/prompts-default-seed.ts` | 新用户种子：`preset-default` + **`preset-group-chat`**（条目默认 disabled，非 active） |
| **前端** | `web/src/utils/group-chat-turn.ts` | Continue 改选 fallback、`mergeTurnGroupChatStateFromPersist` |
| | `web/src/utils/regen-turn-segments.ts` | `patchRegenSegments`（非末段 regen 截断后续 segment，与服务端 `updateTurnSegmentInTailChunk` 对齐） |

**落盘要点**：`turn.groupChatTurnState`（`quotaRemaining` / `speakCount`）随 segment 写入；regen **非末段**截断后续 segment 后 **重算** state；persist 下发 `eligibleSpeakerCharacterIds` + `groupChatTurnState` 供 Continue UI 对齐。掷骰竞标失败扣额度**可无对应 segment**，persist 须优先 `resolved.turnState`（勿仅用磁盘快照）。详见 `DOC/03` §6.8、`DOC/24` §3。

---

## 8. 硬规则清单

1. 群聊须 **`groupChat.enabled`**；**新建 ≥2 bot 对话**会默认开启（见 §1.2），单 bot / 旧会话仍须手动开启。多卡绑定本身不自动接龙。
2. **同一 bot 不得连说**；**额度**控制每 bot 每 user turn 最多发言次数（§2.6–§2.7）。
3. **`speakerMode` 三选一**；段间 **无模式 fallback**（`next@` hint 失败 → **仅手动**，§3.1）。
4. **`/@`（L0）** 优先于一切 `speakerMode`。
5. **User 选人：仅 `/@`**；正文裸 `@` **关闭**。
6. **Assistant `[NEXT@]`** 仅 **`speakerMode=next@`** 时参与 resolver；其它模式仅 strip。
7. **不注入** `char1=Alice` 编号表；MVP 用 **displayName**。
8. **`[NEXT@]` 在宏 / 插件前提取**；hint 存 meta。
9. **regenerate / swipe** 仅当前 segment。
10. **`next@` 首段无 `/@`** → 掷骰选第一位（非 fallback）。
11. **confirmContinue** 可改选下一位；hint 失败时必须 pending。
12. **`maxSegmentsPerTurn`** 达上限强制结束本 user turn。
13. **首段全员掷骰失败**：先进入「结束 turn」流程；**首段中止结束** → 取得分最高者发言；**全部 eligible 各扣 1**（掷骰失败）；speaker **不另扣**发言额度（§2.6 兜底）。

---

## 9. 交叉引用

- 存储 / API：`DOC/03` §6.8
- 里程碑归档：`DOC/04` **§已归档**（群聊 G0–G5 · Composer Slash S0–S4）
- 宏对照：`DOC/26`
- Slash 宿主：[`DOC/36`](36-composer-slash.md)（**已归档**）
