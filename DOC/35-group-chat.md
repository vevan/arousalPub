# 群聊（多角色发言轮次）— 设计定案

> **状态**：定案 · **未实现**（2026-07-01）  
> **关联**：`DOC/03` §6（turn/chunk）、`DOC/04` **P0**、`DOC/14` / `DOC/26`（ST 群聊宏）、Composer Slash（`submitComposer`）

---

## 1. 背景

### 1.1 现状

| 能力 | 状态 |
|------|------|
| 会话 `characterIds[]` 多卡绑定与 XML 注入 | ✅ |
| 宏 `{{char}}` / `{{charN}}` / `{{notChar}}`（多卡名列表） | ✅ 部分 |
| 一轮 user 对应多个 **不同 speaker** 的 assistant | ❌ |
| ST 群聊宏 `{{group}}` 等 | ❌ |
| Composer Slash / `/@` | ❌（**P0**） |

当前为**多卡绑定**，非 ST 式群聊：assistant 无 `speakerCharacterId`，`{{char}}` 固定为 `characterIds[0]`。

### 1.2 与多卡绑定的关系

- **绑定多卡 ≠ 群聊**：仅 `groupChat.enabled === true` 时启用多 segment 接龙。
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
| **每 bot 每轮最多 1 segment** | 同一 user turn 内禁止同一 bot 连续说两次 |
| **regenerate / swipe** | 仅作用于 **当前 segment** 的 receive |
| **迁移** | 旧 turn 无 speaker → 包装为单 segment，`speakerCharacterId = characterIds[0]` |

组装 history：按 segment 顺序展开多条 assistant（带 speaker 标记）；生成时 `{{char}}` = **当前 segment 的 speaker**（非固定 char1）。

### 2.2 群聊开关与会话设置

`index.json`（或等价会话索引）：

```json
{
  "characterIds": ["alice-id", "betty-id"],
  "groupChat": {
    "enabled": false,
    "mode": "weighted",
    "autoContinue": false,
    "confirmContinue": true,
    "decay": {
      "enabled": true,
      "initialRate": 1.0,
      "step": 0.2,
      "floor": 0
    },
    "members": {
      "<characterId>": { "weight": 1.0, "muted": false }
    }
  }
}
```

| `enabled` | 默认 speaker | segment 数 |
|-----------|--------------|------------|
| `false` | char1 | 通常 1；`/@` 可指定他人 |
| `true` | 见 §4 | 多 segment + 衰减 / confirm |

**UI**：对话顶栏 `chat-header` 群聊图标 → 开关、`autoContinue` / `confirmContinue`、衰减参数、bot 列表（权重、静音、拖拽排序改 `characterIds`）。

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

**Slash 未实现前（群聊 G1 过渡期）**：可在 `send()` 做最小 `/@` 解析；**仍不**解析正文裸 `@`。

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
| 无效名 / mute / 本轮已发言 | 忽略，fallback §4 |
| 无标记 | 不走 LLM 接续，走随机+衰减或顺序 |

群聊 assemble 可注入简短说明（仅 `enabled` 或需 LLM 接续时）：

```text
若需其他角色接下一句，使用 [NEXT@角色名]，例如 [NEXT@Betty]。
助手消息中的裸 @ 不会生效。
```

### 2.5 控制开关

| 开关 | 行为 |
|------|------|
| `autoContinue` | 一段完成后自动 resolve 下一位并继续生成 |
| `confirmContinue` | 每段后暂停；UI 显示建议下一位，可 **改选** bot 后再继续 |

组合：`confirmContinue=true` 时以确认 UI 为准；确认后可再链式 auto。

### 2.6 衰减与权重

- **第一段**（user 发话后首个 bot）：**不掷**衰减。
- **之后每一段**（含 `/@` 队列下一位、`[NEXT@]`、随机选中）：生成前先掷 **continueProbability**（如 100% → 80% → 60%…），失败则 **结束本轮**（队列剩余 `@` 作废，可 toast）。
- 候选 bot：`characterIds` 减去已发言、mute；权重来自 `members[].weight` 或卡扩展字段；加权随机。

---

## 3. SpeakerResolver 优先级

实现顺序 **3 → 2 → 4**，sequential 作最终兜底：

```text
resolveNextSpeaker(ctx):
  1. 若 speakerQueue 非空 → shift()（/@ 强制顺序）
  2. else 若上段 meta.nextSpeakerHint 合法 → 用之（[NEXT@]）
  3. else 若 groupChat.enabled && mode=weighted → 衰减通过 + 加权随机
  4. else sequential（下一未发言 bot）
  5. 校验：已绑定、未 mute、不在 spokenInTurn
```

**未开群聊：**

```text
speaker = speakerQueue[0] ?? characterIds[0]
生成 1 segment → 结束
（speakerQueue 长度 > 1 → toast：需开启群聊才能接龙）
```

**群聊主循环：**

```text
spokenInTurn = Set<characterId>
loop:
  if !enabled && segmentCount >= 1: break
  if segmentCount > 0 && decay fail: break
  pick speaker（上表）
  generate → extract [NEXT@] → meta
  spokenInTurn.add(speaker)
  if confirmContinue: UI pending; break
  if !autoContinue: break
  if no candidates: break
```

**continue API（草案）：**

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
| `{{charIfNotGroup}}` | 非群聊 = `{{char}}`；群聊 ST 对齐规则待定 |
| `{{char}}` / `{{charN}}` | 生成时 **当前 speaker** / 绑定序 |
| `{{notChar}}` | 除 **当前 speaker** 外（优于现「除第一张卡」） |

详见 `DOC/26`；实现排在 **G0 模型 + G1 `/@`** 之后。

---

## 6. 与 trace-keeper 的衔接

- `[NEXT@]` 提取在 **turn-plugin 链固定 phase**（模型原文阶段）。
- trace-keeper 在正文后 append 块 **不影响** 已提取的 `nextSpeakerHint`。
- trace 块内的 `[NEXT@…]` **不**当接续标记。

---

## 7. 实现分期

| 阶段 | 交付 |
|------|------|
| **G0** | segment + `speakerCharacterId` + 迁移；UI 多气泡；单 bot 行为兼容 |
| **G1** | `submitComposer` + 内置 `/@`；strip meta；未开群聊 `@` 强制 1 段；手动 Continue |
| **G2** | 权重、mute、衰减、`autoContinue`；`{{groupNotMuted}}` |
| **G3** | `[NEXT@Name]` 解析；`confirmContinue` + 改选 |
| **G4** | sequential 兜底、audit、预设模板 |

**依赖：** G1 的 `/@` 与 **Composer Slash（P0）** 同批或略早（最小 `submitComposer` 路由即可）。

---

## 8. 硬规则清单

1. 群聊须 **`groupChat.enabled` 手动开启**；多卡绑定不自动接龙。
2. 一轮 user 内 **每 bot 最多 1 segment**。
3. **User 选人：仅 `/@`**；正文裸 `@` **关闭**。
4. **Assistant 选人：仅 `[NEXT@Name]`**；裸 `@` **无效**。
5. **不注入** `char1=Alice` 编号表；MVP 用 **displayName**。
6. **`[NEXT@]` 在宏 / 插件前提取**；hint 存 meta。
7. **regenerate / swipe** 仅当前 segment。
8. user 多 `/@` → **有序队列** + **第二段起同步衰减**。
9. **confirmContinue** 可改选下一位 bot。

---

## 9. 交叉引用

- 存储 / API：`DOC/03` §6（实现时 bump turn schema）
- 待办里程碑：`DOC/04` **P0**
- 宏对照：`DOC/26`
- Slash 宿主：`DOC/04` Composer Slash 条目
