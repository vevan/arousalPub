# 99 · Android 单机 APK 设想（备忘 · 极低优先级）

> **状态**：**想法备忘**，无排期、无实现承诺  
> **优先级**：极低（远低于 `DOC/devNotes/04` 现有待办与 `33` 移动端 Web 验收）  
> **关联**：[`01-架构设计.md`](01-架构设计.md)、[`03-实现细节.md`](03-实现细节.md)、[`08-chunk-chain-implementation.md`](08-chunk-chain-implementation.md)、[`33-mobile-compatibility.md`](33-mobile-compatibility.md)、[`48-builtin-embedding-transformers.md`](48-builtin-embedding-transformers.md)、[`data/README.zh.md`](../../data/README.zh.md)

---

## 1. 背景与动机

当前 arousalPub 是 **Node 服务端 + 浏览器/Web** 架构：业务逻辑在 `server/`，对话以 **chunk JSON** 落盘，向量索引为 **Lance 派生数据**。手机可通过 LAN 浏览器访问（见 `33`），但**不是**安装包形态。

本备忘记录一种**远期可能**的产品方向：

- 将 **业务逻辑重构后迁入 Android APK**（非 WebView 连 PC、非 Termux 跑 Node）；
- **交互与桌面一致**（同一套产品行为与 UI 规范；UI 可复用 Vue 或原生重写）；
- 手机端用 **SQLite** 存对话与用户数据（替代 chunk 物理分片）；
- 与桌面 **数据互通**：经 **导入/导出**，而非 chunk 与 SQLite 文件级直连同步。

---

## 2. 非目标（本文档阶段）

| 排除项 | 说明 |
|--------|------|
| 近期排期 | 不进入 `04-TODO` P0/P1 |
| 实时双向同步 | 不同步 `data/{userId}/` ↔ APK 私有 SQLite；Syncthing 仍只服务桌面目录 |
| 离线内置 Embedding | 桌面 `builtin`（Transformers.js + ONNX）**不**假设可原样搬进 APK |
| 插件生态一次性对齐 | Worker 沙箱、manifest hooks 需单独定案（见 §6） |
| 替代现有部署路径 | `start.sh` / Docker / LAN Web 仍是主路径 |

---

## 3. 目标架构（设想）

```text
┌─────────────────────────────────────────────────────────┐
│  表现层：与桌面一致的交互（Vue 复用或 Compose/Flutter）   │
├─────────────────────────────────────────────────────────┤
│  应用层：发消息、分支、RAG、regex、插件编排…             │
│          （从 server/ 抽离为「领域内核」，非复制 Fastify）│
├─────────────────────────────────────────────────────────┤
│  领域层：Turn / Conversation / Branch / Profile 语义     │
│          （与存储形态无关；桌面与 APK 共享或对齐测试）      │
├──────────────────────┬──────────────────────────────────┤
│  桌面适配器           │  APK 适配器                       │
│  Chunk + JSON 文件    │  SQLite + 附件/BLOB 目录          │
│  Lance 向量（派生）   │  本地向量表（派生，实现待定）      │
└──────────────────────┴──────────────────────────────────┘
              ↑                    ↑
              └── Portable Bundle（导入/导出）──┘
```

### 3.1 推理与 Embedding（务实假设）

单机 APK **若不**移植 ONNX / Lance 原生栈，则：

| 能力 | 设想 |
|------|------|
| **LLM 对话** | 走 **OpenAI 兼容云端或远程自建** API（密钥存 Android Keystore / 加密存储） |
| **Embedding** | 同上；**不用**桌面 `builtin` 后路 |
| **向量召回逻辑** | 仍在 **本地领域层** 执行；仅「算向量」一步外包 HTTP |
| **向量索引** | 本地 **派生**，导入后按 **embedding profile** 决定是否重建 |

这与桌面「Lance 可重建、chunk 为权威」一致（`data/README.zh.md`、`03` §14.5）。

### 3.2 SQLite 与 chunk 的关系

- **chunk** 是桌面对 Turn 序列的 **物理分片**（每块 ≤100 轮、`meta.links` 链表）；**不是**业务语义本身。
- APK 用 **关系表 + ordinal 排序** 即可表达同一语义；**不必**在 SQLite 中复刻 `turn-000000-000099.json` 文件名或双向链表。
- 需覆盖的语义包括但不限于：`turnId` / `turnOrdinal`、群聊 **receives/segments**、**分支** `branchPath`、**`turn.plugins[]`**、会话级 settings 覆盖（见 `08`、`23`、`data/README.zh.md`）。

---

## 4. 数据互通：Portable Bundle（设想）

**原则**：交换 **逻辑数据**，不交换存储形态；不做 chunk ↔ SQLite 表的一一映射。

### 4.1 形态

- 建议：**ZIP + `manifest.json` + `schemaVersion`**（名称待定）。
- **导出**：从桌面 chunk 链 **或** APK SQLite 均生成 **同一份** bundle。
- **导入**：解析 bundle → 写入目标存储（chunk 链 **或** SQLite 行）。

### 4.2 Bundle 内容（草案）

| 类别 | 是否权威 | 备注 |
|------|----------|------|
| 会话元数据、turns 全量 | ✅ | 含分支树或 active 路径策略需定案 |
| 角色 / 世界书 / 提示词快照或引用 | 可选 | 全量包 vs 仅会话 |
| embedding **profile** 元数据 | ✅ | provider、model、dimensions、hybridFts 等 |
| Lance / 向量二进制 | ❌ | 目标端按 profile **重建** |
| API Key 明文 | ❌ 默认 | 或加密块 + 目标端密钥 |
| `chat-audit`、regex 规则 | 可选 | Phase 靠后 |

### 4.3 合并策略（待议）

- **Id 冲突**：`conversationId` / `turnId` — skip / rename / 用户选覆盖。
- **Profile 不一致**：导入后标记索引 stale，提示重建（对齐桌面换模型行为）。
- **第一版**：建议 **单会话或单用户 ZIP**，全量覆盖目标会话，不做 CRDT。

### 4.4 与 Syncthing 的关系

- 桌面仍 Syncthing 同步 **`data/{userId}/` JSON/chunk**。
- APK 数据在 **应用私有目录**；**不会**与 Syncthing 自动一致。
- 产品文案需说明：**手机上的改动需导出后才能在桌面 chunk 目录中出现**（除非未来另做同步服务）。

---

## 5. 领域内核：从 server/ 抽什么（方向性）

下列能力 today 在 `server/`，APK 若「全功能」需 **移植或共享**，而非仅「SQLite + 调云 API」：

| 模块方向 | 现有参考 |
|----------|----------|
| 提示词组装、宏展开 | `assemble-prompts.ts`、`prompt-macros/` |
| Regex 三阶段 | `regex-apply.ts`、`regex-outgoing.ts` |
| Memory / Lore / Knowledge 召回编排 | `memory-pipeline.ts`、`memory-index.ts`、lorebook vector |
| 落盘事务、分支 | `chat-storage.ts`、`chunk-chain.ts`、`conversation-branches.ts` |
| Embedding profile 门禁 | `embedding-*`、`DOC/devNotes/48` |
| 插件宿主（若要做） | `plugin-system/`、`09`、`18` |

**实现选项**（未定）：共享 TypeScript 领域包（KMP/JS 运行时）、Rust core + 双端 FFI、或 Kotlin 重写并对齐 golden tests。

---

## 6. 插件与 UI（未定）

| 项 | 说明 |
|----|------|
| **插件** | 桌面为 manifest + Worker + `data/plugins/`；APK 可能仅 **Phase 1 不支持**，或 **子集**（panel/slot），或长期对齐 `18` 契约 |
| **UI** | **A)** Capacitor + Vue + 原生 Bridge；**B)** Compose/Flutter + 设计规范对齐。 「交互相同」≠ 必须同一套 `.vue` 零修改 |

---

## 7. 与 `33-mobile-compatibility` 的边界

| | `33` 移动端 Web | 本文 APK 设想 |
|--|----------------|---------------|
| 形态 | 浏览器 / 可选 WebView 连 **现有 server** | 独立安装包 + **本地领域层** |
| 存储 | 无；数据仍在 PC `data/` | SQLite + 本地文件 |
| 优先级 | Phase 1 布局已落地，composer/安全区待验收 | **极低**，不抢 `33` 资源 |
| 关系 | 短期仍推荐 LAN Web | 长期可选原生单机 |

---

## 8. 若将来启动：建议阶段（仅备忘）

| 阶段 | 内容 |
|------|------|
| P0 | 定 `Portable Bundle` schema；桌面 chunk → bundle **只读**导出 |
| P1 | APK：SQLite + 聊天落盘 + 云端 LLM（无向量、无插件） |
| P2 | bundle ↔ SQLite 导入；云端 Embedding + 本地向量表 |
| P3 | 分支、群聊、regex、audit 进 bundle |
| P4 | 插件子集或完整宿主 |

---

## 9. 风险摘要

| 风险 | 说明 |
|------|------|
| 双份业务逻辑 | 抽离不彻底则桌面/APK 行为漂移 |
| 向量栈 | Lance 不可直接用于 Android；需替代或仅云端 embedding + 本地 flat/第三方向量库 |
| 内置 Embedding | APK 默认放弃 `builtin`，与桌面能力不对等 unless 另立项 |
| 密钥与合规 | API Key、用户数据备份/导出需单独安全评审 |
| 工作量 | 全功能 ≈ 新产品客户端，非「打包现有仓库」 |

---

## 10. 变更记录

| 日期 | 说明 |
|------|------|
| 2026-08-12 | 初稿：记录 Android 单机 APK + SQLite + Portable Bundle 互通设想；**极低优先级**，无排期 |
| 2026-08-12 | 文档序号 **50 → 99**（远期设想归入 90+ 段） |
