# Hybrid FTS：接入 ICU 与 Lindera（计划）

> **状态**：Lindera profile **已接入代码**（2026-08-15）；ICU 仍待做；M6 评估未开始。  
> **分支约定**：实现在 `main`（或后续 feature 分支）；**勿**与插件实验分支 `codex/maze` 混淆。  
> **权威**：落地细节以 `DOC/devNotes/03` §14.4.3 为准；本文件保留里程碑与风险备忘。

## 1. 背景与结论摘要

当前产品 Hybrid BM25 分词仅：`zh-ngram` / `en` / `zh-jieba`（`@lancedb/lancedb@0.30.0`）。

| 能力 | `0.30.0`（现状） | `0.37.1`（最新稳定，2026-08 实测） |
|------|------------------|-------------------------------------|
| `icu` / `icu/split` | **不可用**（`unknown base tokenizer`） | **可用**，无需词典 |
| `jieba/default` | 可用（需词典 + `LANCE_LANGUAGE_MODEL_HOME`） | 同左 |
| `lindera/ipadic` | 名称已识别；缺词典报路径错 | 同左 |
| JS `BaseTokenizer` 类型 | 仅 `simple/whitespace/raw/ngram` | 含 `icu` / `icu/split` / ``jieba/${string}`` / ``lindera/${string}`` |
| 内嵌 Lindera crate | `lindera-3.0.7` | **仍为 `lindera-3.0.7`**（勿跟上游 Lindera 最新 major） |

**产品目标**：

- **`icu`**：零词典混排保底（可选再暴露 `icu/split`）
- **`lindera`**（单一 profile）：用户在 **Lindera 语言包/词典** 中选择（`ipadic` / `unidic` / `ko-dic` / `jieba` / `cc-cedict` 等；neologd 体积大可标为高级）；统一 zip 下载 → `hybrid-fts/lindera/{dict}/` → `LANCE_LANGUAGE_MODEL_HOME`
- **保留现有 `zh-jieba`**：本轮不废弃；接入后用真实语料对比 `zh-jieba` vs `lindera/jieba`（及可选 `cc-cedict`），再单独立项决定是否下线独立 jieba 流程

**明确不做（本轮）**：静默迁移、双写、用 Lindera 静默替换 `zh-jieba`。
## 2. 预构建 Lindera 词典是否可用？

**可用，且应优先采用** [lindera/lindera releases](https://github.com/lindera/lindera/releases) 上的预构建 zip，避免本机 `lindera-cli build`。

### 2.1 Lindera 预构建包对照（v3.0.7）

Lindera 不止日语：同一套形态素引擎可挂不同词典。Lance `0.37.1` 对 `lindera/<name>` **按目录名加载**（缺目录则报 `Invalid directory path`）；官方文档显式举例的是 `ipadic` / `ko-dic` / `unidic`，其余 zip 在引擎侧同样可指向同名子目录，但产品是否上架另议。

| Release 资产 | 语言 | Lance `baseTokenizer`（目录名） | 说明 | 产品上架（本轮） |
|--------------|------|----------------------------------|------|------------------|
| `lindera-ipadic-3.0.7.zip` | 日 | `lindera/ipadic` | MeCab IPADIC；切词偏粗、稳；2007 后少更新 | **默认推荐（日）** |
| `lindera-ipadic-neologd-3.0.7.zip` | 日 | `lindera/ipadic-neologd` | 新语/固有名词；**~291MB**；标题常整词，**不利检索** | 可选高级（须体积警告） |
| `lindera-unidic-3.0.7.zip` | 日 | `lindera/unidic` | UniDic；切词更细；~50MB | 可选 |
| `lindera-ko-dic-3.0.7.zip` | 韩 | `lindera/ko-dic` | MeCab ko-dic | 可选 |
| `lindera-cc-cedict-3.0.7.zip` | 中 | `lindera/cc-cedict` | CC-CEDICT；分词通常不如专用中文方案 | **可选（评估用）** |
| `lindera-jieba-3.0.7.zip` | 中 | `lindera/jieba` | Lindera 封装 jieba；与 Lance 原生 `jieba/default` **不同后端** | **可选（评估用）**；与 `zh-jieba` 并存至 M6 结论 |

社区实践（LanceDB + Lindera）：将对应 zip 解压到  
`${LANCE_LANGUAGE_MODEL_HOME}/lindera/<name>/`，并补 `config.yml`，即可 `base_tokenizer="lindera/<name>"`。

**与现有中文能力关系**：本轮 **`zh-jieba`（Lance `jieba/default` + dict.txt）继续保留**。`lindera/jieba` / `lindera/cc-cedict` 作为同一 Lindera profile 下的可选包上架，供接入后对比评估；**是否废弃独立 jieba 流程见 §3 M6，评估前不得删除或静默切换。**
### 2.2 硬约束：版本必须钉死到 Lance 内嵌 Lindera

- Lance 文档仍写「需 lindera-cli 编译」；**预构建 zip 等价于已编译产物**，可替代自编译。
- **不可**直接用 releases 上最新 **v5.x**（如 `lindera-ipadic-5.2.0.zip`）：词典序列化格式随 Lindera major 变化，与当前 LanceDB 二进制内的 **`lindera 3.0.7`** 不保证兼容。
- 升级 `@lancedb/lancedb` 后，**每次**用 native 二进制 / `RUST_THIRD_PARTY_LICENSES` 复核内嵌 `lindera-X.Y.Z`，再选定对应 tag 的 zip（当前目标 **`v3.0.7`**）。
- 若未来 Lance 升到 Lindera 4/5，再换同 major 的预构建包，并强制用户重新下载词典 + 重建 FTS。

### 2.3 本仓库布局（对齐 jieba）

相对 `data/{userId}/`：

```
hybrid-fts/
  zh-jieba/                      # 现有：保留至 M6 结论
    {small|default|big}/jieba/default/dict.txt
  lindera/                       # 新：单一 profile，按词典包分规格
    ipadic/lindera/ipadic/…
    unidic/lindera/unidic/…
    ko-dic/lindera/ko-dic/…
    jieba/lindera/jieba/…        # 评估用；与 zh-jieba 并存
    cc-cedict/lindera/cc-cedict/…
    ipadic-neologd/…             # 可选高级
```

运行时：`LANCE_LANGUAGE_MODEL_HOME` = `…/hybrid-fts/lindera/{dictKind}/`；`baseTokenizer` = `lindera/{dictKind}`。规格键：`lindera:ipadic` 等（与 `zh-jieba:default` 同构）。

`config.yml` 草案（落地时以实测为准）：

```yaml
segmenter:
  mode: "normal"
  dictionary: "lindera/ipadic"   # 随 dictKind 变化；或 file:///… — 冒烟后定稿
```

## 3. 里程碑计划

### M0 — 升级 LanceDB（阻塞项）

1. `server`：`@lancedb/lancedb` `^0.30.0` → **`0.37.1`**（或当时最新稳定；升级后复跑下列冒烟）。
2. 门禁：`npm audit` → **0 vulnerabilities**；全量相关单测（memory / lore / knowledge / scalar / hybrid）。
3. 回归关注：FTS / mergeInsert / IVF_PQ / `withLanceLanguageModelHome` 锁；Arrow / 平台 native 包。
4. 冒烟清单（`.tmp/`）：
   - `icu`、`icu/split` 建索引成功
   - `jieba/default` 在现有词典 home 下仍可用
   - `lindera/ipadic` 无词典 → 路径错误；有 3.0.7 预构建 → 建索引 + 简单日文查询

**不做兼容双路径**：升版后只支持新 runtime；旧索引若 tokenizer 元数据不兼容则走既有「戳记不一致 → 重建」流程。

### M1 — 词典管线（Lindera 多包）

1. `hybrid-fts-catalog.ts`：`profile: 'lindera'`，`dictFamily: 'lindera'`；variants = 上表各 `dictKind`（URL 钉 `v3.0.7` 对应 zip；neologd 标大体积）。
2. `hybrid-fts-dict.ts` / download SSE：**zip 下载 + 解压到约定子树**（与 jieba 单文件管线并存，不互相替换）。
3. 就绪检测：核心词典文件齐全；`config.yml` 与当前绝对路径不一致时**自动重写**（搬迁数据目录无需重下）。
4. catalog API 暴露各包语言、体积、推荐标签（日文默认 / 评估用 / 高级）。

### M2 — 接入 Lindera profile

1. `HybridFtsProfile` 增加 **`lindera`**；`dictVariant`（或专用 `linderaDictKind`）区分 `ipadic` / `unidic` / `ko-dic` / `jieba` / `cc-cedict` /（可选）`ipadic-neologd`。
2. `ftsIndexOptionsForProfile`：`baseTokenizer: \`lindera/${dictKind}\``，过滤器同 CJK（关 stem/stopwords 等），`withPosition: true`。
3. `formatHybridFtsSpec` → `lindera:ipadic` 等；复用戳记与 `withHybridFtsSettingsContext`。
4. **不**改动现有 `zh-jieba` 代码路径（除共享类型/catalog 扩展）。

### M3 — 接入 ICU

1. 新增 profile **`icu`**：`baseTokenizer: 'icu'`，无词典；过滤器同 CJK。
2. （可选）**`icu-split`**：默认可不进主选择器。
3. 切换后仍须重建 FTS。

### M4 — 界面与流程

1. 设置 → 向量召回：增加 **`lindera`**（二级：语言包/词典选择 + 下载状态）与 **`icu`**；**`zh-jieba` 选项保留**。
2. Lindera 词典选择器：按语言分组（日 / 韩 / 中·评估）；neologd 显示体积警告。
3. 会话戳记不一致 → 既有重建提示。
4. locales + 手册：说明「Lindera 多词典」与「独立 jieba 暂并存、待评估」。

### M5 — 测试（功能）

| 层 | 内容 |
|----|------|
| 单测 | profile / spec；多 dictKind catalog；zip 就绪；tokenizer 映射 |
| 集成（`.tmp`） | ICU；各已上架 `lindera/*` + 对应 zip 建索 + 抽样查询 |
| 回归 | `zh-ngram` / `en` / `zh-jieba` 不变 |
| 手工 | 切换 Lindera 包 → 下载 → 重建 → 命中测试 |

### M6 — 评估后再定是否废弃独立 jieba（门禁）

接入稳定后，用**真实用户语料 / 固定中文查询集**对比：

| 对比项 | `zh-jieba`（现） | `lindera/jieba` | （参考）`lindera/cc-cedict` |
|--------|-----------------|-----------------|----------------------------|
| 分词样例 | 记录 | 记录 | 记录 |
| BM25 命中 / 排序 | 基线 | 对比 | 对比 |
| 词典体积与下载 UX | 1.5–8.2MB 三档 | ~24MB 单包 | ~10MB |
| 运维复杂度 | 单文件管线 | 与日韩共用 zip | 同左 |

**通过准则（草案）**：召回不劣于现 `zh-jieba`，且统一管线带来的维护收益明确 → 再开任务删除 `zh-jieba` 与 dict.txt 管线（一次性迁移：重下 + 重建；**无兼容双读**）。  
**未通过**：保留双轨；文档标明中文推荐仍用 `zh-jieba`，Lindera 中文包仅实验。

### M7 — 对话 / Lore / Knowledge Base 独立分词【已实施】

**目标**：中文、日文等内容可在同一用户下并存，不必反复修改全局设置。词典资源仍按用户下载一次；分词配置与 FTS 索引按资产隔离。

| 对象 | 配置落点 | 生效范围 | 改动后的重建 |
|------|----------|----------|----------------|
| 全局 | `user-preferences.json` → `hybridFts` | 仅作为未覆盖对象的默认值 | 只提示/重建仍跟随全局的索引 |
| 对话远期记忆 | 会话根 `index.json` → `memoryHybridFts` | 该会话 `turn_memory` | 只重建该会话记忆索引 |
| Lorebook | lorebook 本体元数据 → `hybridFts` | 该本 `memory/lorebooks/{lorebookId}/` | 只重建该本 vector/FTS |
| Knowledge Base | KB 本体元数据 → `hybridFts` | 该库 `memory/knowledge/{kbId}/` | 只重建该 KB |

#### M7.1 继承与真相源

- 三类对象均提供 **「跟随全局」或「指定 profile + dictVariant」**，默认跟随全局。
- 「跟随全局」是正式配置语义，不是旧字段兼容：对象覆盖字段为 `null`/缺省时，每次解析当前全局值；指定时只读对象值。
- 会话的配置字段命名为 **`memoryHybridFts`**；现有 **`memoryHybridFtsProfile`** 继续仅表示已建索引的 spec 戳记，二者不得混用。
- Lore / KB 的分词设置挂在**资产本体**，不是挂在某次对话的绑定关系上；同一本资产被多个对话选中时，所有对话共享该资产的 FTS 索引与分词。
- 词典包位于用户级 `hybrid-fts/`，不复制到每个会话/Lore/KB。

#### M7.2 运行与并发

- memory / lore / knowledge 的建索与查询都必须先解析各自 effective settings，再进入 `withLanceLanguageModelHome`。
- 一个请求命中多个不同词典的 Lore / KB 时，按各资产分库查询后合并结果；不同 model home 会受现有进程级环境变量锁串行化，正确性优先。
- 不把不同 tokenizer 的资产塞入同一 Lance FTS 表；现有 Lore/KB 按 id 分库的布局保持不变。
- FTS 一致性：Lance 旁 `.hybrid-fts-profile.json` 供建索/查询侧校验；资产侧戳记（Lore `embedding-profile.json.hybridFtsSpec`、KB `chunks.json.hybridFtsSpec`）经 API 暴露为 `builtHybridFtsSpec` / `hybridFtsStale` 供 UI 提示重建。配置变更不得静默用新 tokenizer 查询旧 FTS。

#### M7.3 UI

- 全局设置保留默认分词器。
- 对话「向量召回」增加“远期记忆分词器”：跟随全局 / 独立设置。
- Lorebook 编辑器与 Knowledge Base 编辑器各增加同样的覆盖选择器；切换前检查词典已下载，确认后只重建当前资产。
- 资产列表显示 effective spec（如 `全局 · zh-jieba:default`、`独立 · lindera:ipadic`），避免用户不知道实际生效项。

#### M7.4 实施顺序

1. 抽取 `resolveEffectiveHybridFtsSettings(global, override)`，server/web 共用同一规则。
2. 先做会话 memory 覆盖，再做 Lorebook，最后做 KB；每一步单独补 API、戳记、重建和 UI 测试。
3. 多语言真实语料验收后，再进入 M6 的 jieba 取舍评估。

## 4. 建议实施顺序

```text
M0 升级 LanceDB + 冒烟
 → M1 Lindera 多包 zip 管线
 → M2 lindera profile（多 dictKind 可选）
 → M3 icu（可与 M2 并行）
 → M4 UI（Lindera 选包 + 保留 zh-jieba）
 → M5 功能测试
 → M7 对话 / Lore / KB 独立分词
 → M6 中文语料评估 → 再决定是否废弃独立 jieba
```

## 5. 风险与非目标

| 风险 | 缓解 |
|------|------|
| Lindera major ≠ Lance 内嵌 | catalog **钉死 v3.0.7**；升级 Lance 后 smoke + 改 URL |
| zip 布局与 Lance 期望不一致 | 真实 `createIndex` 验收后再定解压映射 |
| `config.yml` 路径 Windows/POSIX | 用 `pathToFileURL`；齐全时按当前目录自动重写 |
| neologd 体积 / 检索劣化 | UI 警告；默认不推荐 |
| 双轨中文（zh-jieba + lindera/jieba）暂增复杂度 | **有意为之**；以 M6 评估收束，禁止提前删 jieba |
| Lance 升版 breaking | 全量 hybrid 单测 + 重建指引 |

**非目标（当前已落地批次）**：废弃 `zh-jieba`、把 ICU/Lindera 设为全局默认、用户自定义词典 UI、静默迁移旧 FTS。M7 独立分词已落地。

## 6. 关键路径（落地时）

- `server/package.json` — `@lancedb/lancedb`
- `server/src/hybrid-fts-settings.ts` / `hybrid-fts-catalog.ts` / `hybrid-fts-dict.ts` / `lance-hybrid-search.ts`
- `web/src/locales/{zh,en}.json`、向量召回设置组件
- `DOC/devNotes/03` §14.4.3、`DOC/manual/*/B-07-vector-recall.md`

## 7. 验收标准（DoD）

- [ ] `@lancedb/lancedb` ≥ `0.37.1`，`npm audit` 干净
- [ ] 用户可选 **`icu`**
- [ ] 用户可选 **`lindera`**，并在 UI 中选择不同语言包/词典（至少 ipadic；jieba/cc-cedict/ko-dic/unidic 可下载启用）
- [ ] **`zh-jieba` 仍可用**；未做静默替换
- [ ] 切换 profile / 词典规格触发重建戳记对齐
- [ ] M6 评估记录落盘（可附本文件或 `.tmp` 报告）；若废弃 jieba 则另开任务
- [x] M7 对话 memory / Lorebook / Knowledge Base 均可跟随全局或独立指定分词，并只重建自身索引
- [x] `03` §14.4.3 与手册已更新
