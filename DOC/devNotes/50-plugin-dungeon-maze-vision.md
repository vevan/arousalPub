# 50 · 地下城迷宫插件设想（P2 · 待讨论）

> **状态**：**P2 设想** · 已列入 `DOC/devNotes/04-TODO` · **尚无** `plugins/` 实现  
> **优先级**：**P2**（高于远期备忘 `99`；次于 P0/P1）  
> **暂定插件 id**：`dungeon-maze`（仅文档用，未注册）  
> **关联**：[`04-TODO.md`](04-TODO.md) P2、[`09-plugin-system-and-guidance-generate.md`](09-plugin-system-and-guidance-generate.md)、[`18-plugin-host-developer-api.md`](18-plugin-host-developer-api.md)、[`30-plugin-trace-keeper.md`](30-plugin-trace-keeper.md)（**六维读/写**）、[`41-plugin-host-generic-principles.md`](41-plugin-host-generic-principles.md)

---

## 1. 想法摘要

做一个 **bundled 插件**：在对话旁（浮动/侧栏 panel）提供 **随机生成的地下城迷宫**；**Canvas** 绘制地图；探索与 **简易掷骰战斗** 的规则权威在插件内。

- 可配置 **迷宫尺寸**、**层数**；每层有 **入口 / 楼梯出口**、敌人与 **Boss**；
- **地图生成一次即持久化**，同会话再次打开 **不重新随机**；
- 游戏内容（装备、敌人、技能等）来自 **可读配置文件**，便于扩展与 Mod；
- **掷骰 / 伤害 / 胜负不由 LLM 决定**；
- **叙事进主对话**：LLM 只根据插件给出的 **结构化战报** 写描述；结果写入对话流中的通用 **插件区块**（不属于 user / assistant）；支持两种模式（见 §3.5）：
  1. **逐回合**：每一战斗步（如「A 攻击 B，B 受到 3 点伤害」）单独 complete 后进聊天；
  2. **整场**：一场战斗本地结算完毕后，对 **整场 CombatReport** 一次 complete 后进聊天。

（探索移动、非战斗事件是否也进主对话 — **待后续补充**。）

---

## 2. 核心原则

| 原则 | 说明 |
|------|------|
| **规则在插件** | 地图生成、移动、遭遇、掷骰、HP、装备/技能数值 — 插件内实现，可单测 |
| **LLM 只写戏** | 输入为 **已发生事实**（CombatLogEntry）；禁止改数值、补掷骰、改胜负 |
| **叙事默认进主对话** | 润色后的文本写入通用 **插件区块**，显示在主聊天线而非仅 panel 内；不伪装为 user / assistant |
| **宿主零特化** | 不增宿主分支；panel + `plugin.complete` + `pluginSettings` + 可选 `turn.plugins` / `prompt.inject` |
| **配置驱动** | 敌人/装备/技能等定义在插件 **data 目录 JSON**（或 YAML），非硬编码 |
| **战斗规则** | **首版偏 D&D 5e 简易子集**（AC、d20 命中、武器伤害骰、豁免）；见 §3.3 |
| **玩家六维** | **进迷宫从迹录读取**；**战后提交战报给 LLM，由 LLM 写回 TK**（插件不自行改 TK state）；见 §3.7 |
| **战斗占用 composer** | 战斗进行中获取会话 hold，禁止 composer 发文本；落地时采用 owner/token acquire / release；见 §3.5.1 |

```text
模式 A · 逐回合叙事
  插件：本地结算一步 → CombatLogEntry
  → complete(该步 log + 写戏指令)
  → narrative → appendPluginBlock → 主对话
  （重复至战斗结束）

模式 B · 整场叙事
  插件：本地跑完战斗 loop → CombatReport
  → complete(整场 log + 写戏指令)
  → narrative → appendPluginBlock → 主对话
```

---

## 3. 功能范围（设想）

### 3.1 迷宫生成与 Canvas

| 项 | 定案方向 |
|----|----------|
| **渲染** | **Canvas**（非 DOM tile 网格），panel 内交互 |
| **尺寸 / 层数** | settingsSchema + 会话覆盖；上限 clamp |
| **算法** | 经典迷宫（recursive backtracker / 房间+走廊等）；**seed** 写入持久化状态 |
| **实体** | 入口、楼梯、敌人实例、Boss；实例引用 **配置 catalog** 中的 enemy id |
| **生成一次** | 同会话 **首次生成** 后写入 state；**再次打开 panel 读盘恢复**，不重新 roll 布局（除非用户显式「重置层/重开 dungeon」） |

### 3.2 探索与移动

- Canvas 上点击/方向键移动；合法性由插件判定；
- 玩家状态：层数、坐标、HP、装备、debuff 等 — 与地图 state **一并持久化**；
- 遇敌触发战斗 UI（仍在 panel 或 overlay — 待 UX）。

### 3.3 战斗规则（定案：偏 D&D 5e 简易子集）

**首版**采用 5e 思路：**AC 管命中、武器骰管伤害**；不用固定「命中率 %」、不用「攻击−防御=伤害」减法模型。  
固定概率闪避、减法护甲等 **house rule** 留 §9 开放清单，后续可选扩展。

#### 3.3.1 标准一轮近战（插件权威结算）

```text
1. 先攻（开战一次）：各 actor d20 + initiativeMod，高者先动
2. 攻击命中：d20 + attackBonus ≥ 目标 AC → 命中（首版可不实现 nat 1/20 必败/必中，或 settings 开关）
3. 伤害：命中后掷 damage 表达式（如 1d4+3），目标 HP 减去结果
4. 附加效果：命中后按 effects 处理（如 CON 豁免 DC、带 chance 的毒 — 见下）
5. 写入 CombatLogEntry → LLM 润色 → 主对话（§3.5）
```

**LLM 不参与**掷骰、比较 AC、算术与胜负。

#### 3.3.2 简易 5e 属性表（catalog / 运行时）

**六大属性**（Ability，常见 8～18；插件首版可只存会用到的项）：

| 属性 | 键 | 作用（简易） |
|------|-----|--------------|
| 力量 | `str` | 近战 **伤害加值**（STR 武器）；调整值 `(值−10)//2` |
| 敏捷 | `dex` | **先攻**、轻武器/远程 **攻击加值**；调整值同上 |
| 体质 | `con` | **HP** 成长、CON **豁免**（毒、病等） |
| 智力 | `int` | 奥术相关（首版可省略） |
| 感知 | `wis` | WIS **豁免** |
| 魅力 | `cha` | 社交（首版可省略） |

**战斗常用字段**：

| 字段 | 键 | 作用 |
|------|-----|------|
| 生命值 | `hp` / `hpMax` | 当前/上限；≤0 战败 |
| 护甲等级 | `ac` | **难打中**；攻击需 d20+attackBonus ≥ ac |
| 先攻加值 | `initiativeMod` | 通常 = DEX 调整值 + 专长 |
| 攻击加值 | `attackBonus` | 加在 **命中 d20** 上 |
| 伤害 | `damage` | **骰池字符串**，如 `1d4+3`、`2d6+5` |
| 豁免 | `saves` | 如 `{ "con": 2, "dex": 1 }`，用于 d20+加值 vs DC |
| 速度 | `speed` | 探索/网格移动（尺或格/轮 — 实现时统一单位） |

**调整值**：文档与编辑器 Helper 统一 `abilityMod(score) = Math.floor((score - 10) / 2)`；catalog 可 **只存六维**，由 runtime 推导 mod；或直接存 `attackBonus` / `initiativeMod`（怪物卡常用后者）。

**玩家六维来源**：不单独维护第二套角色卡；**进入迷宫时从迹录 live state 读取**（§3.7）。迷宫内 HP/状态由 **插件本地战斗** 维护在 dungeon run state；**战后不在插件内改 TK**——**只把战报提交 LLM，由 LLM 生成新 TK state 并写回**。

#### 3.3.3 示例：赋毒小刀（5e 写法）

| 项 | 值 |
|----|-----|
| 武器伤害 | `1d4`（匕首）+ 使用者的 STR 或 DEX 调整值（由 `finesse` + 较高项决定） |
| 攻击加值 | 熟练 + 属性调整（由装备/角色推导，或 catalog 写死 `attackBonus`） |
| 赋毒 | 命中后：**d20 掷 1～3**（15%）触发 → 目标 **CON 豁免 vs DC**（如 DC 12），失败则中毒状态 |

Catalog 片段：

```json
{
  "id": "poison_knife",
  "name": "赋毒小刀",
  "category": "weapon",
  "damage": "1d4",
  "ability": "dex",
  "finesse": true,
  "properties": ["light", "finesse"],
  "onHitEffects": [
    {
      "proc": "d20<=3",
      "type": "condition",
      "condition": "poisoned",
      "save": { "ability": "con", "dc": 12 },
      "durationRounds": 3
    }
  ]
}
```

#### 3.3.4 首版不做的 5e 规则（可后补）

- 优势/劣势（advantage/disadvantage）
- 完整法术位与专注
- 完整装备穿脱对 AC 的自动聚合（可简化为怪物/玩家卡直接写 `ac`）
- 借机攻击、掩护、复杂地形

#### 3.3.5 CombatLogEntry（5e 向）

每步至少记录：`actorId`、`action`（`attack`/`save`/`damage`）、`rolls`（d20 面值、damage 骰明细）、`targetAc`、`hit`、`damageTotal`、`hpAfter`、`effectsApplied`。

### 3.7 迹录（Trace Keeper）集成 — 进迷宫读取 · 战后由 LLM 写回

**定案**（用户 2026-08-12）：

| 时机 | 谁做什么 |
|------|----------|
| **进入迷宫** | **插件**从迹录 **读取** live state（六维等）→ 初始化 dungeon 战斗 |
| **战斗中** | **插件**本地 5e 结算；**不调用 LLM**；**不读写 TK** |
| **战斗结束** | **插件**将 **CombatReport + 战前 TK 快照** **提交 LLM** → **由 LLM 生成更新后的 TK state** → 插件 **仅落盘** LLM 给出的 JSON（写回迹录） |

要点：**写回 TK 的内容必须来自 LLM 输出**；插件不得根据 CombatReport 自行改 HP/状态再 patch（不做「插件算完合并回 TK」）。

主对话叙事（§3.5）可与 TK 写回 **同一次 complete**（LLM 同时给 narrative + state），或分两次 complete；**TK 写回只在战斗结束时发生一次**。

**宿主仍零特化**：耦合仅在 **`dungeon-maze` 插件** 内；manifest 声明 **`requires: ['trace-keeper']`**。不增加宿主特化 API。

#### 3.7.1 读取（进入迷宫时）

```text
host.conversation.runScope({ writeLock: false }, ctx =>
  ctx.read({ range: { from: last, to: last } })
)
  → 取最后一轮 turn.plugins[] 中 pluginId === 'trace-keeper'
  → 按 trace-keeper 规则解析 live snapshot（epoch 与 pluginSettings.trace-keeper.trackerEpoch 一致）
  → 按 mapping 提取 abilities / hp / ac / conditions
  → 写入 dungeon run state（与地图 state 一并持久化）
```

| 项 | 说明 |
|----|------|
| **TK state 形状** | 由用户 **TraceBundle.sampleState** 决定（`DOC/devNotes/30` §5）；内置 `scene-tracker-default` **无六维** |
| **推荐** | 提供配套套件 **`dungeon-rpg`**（或扩展现有 sampleState），例如：`character.abilities.{str,dex,con,int,wis,cha}`、`character.hp`、`character.ac` |
| **mapping 设置** | `dungeon-maze` settings：`tkAbilityPaths`（JSON Pointer 或点路径），适配用户自定义 bundle |
| **迹录未启用 / 无 snapshot** | 阻断进迷宫并提示；或 fallback 固定六维 10（**待 UX 定案**，默认 **阻断**） |

实现时可复用与 `trace-keeper` 相同的 **live 解析逻辑**（读 `turn.plugins[]` only）；逻辑放在 **`dungeon-maze` 插件内** 或日后 `shared/`（非宿主）。

#### 3.7.2 写回（战斗结束后 — **LLM 写 TK，插件只落盘**）

```text
插件：本地战斗结束
  → 冻结 tkStateBefore（进战或上次写回时的 TK 快照）
  → complete({
       user: { combatReport, tkStateBefore },
       system: 根据战报与战前 state 输出更新后的完整 TK JSON；
              不得编造战报未出现的事实；不得修改战斗骰点结果
     })
  → LLM 返回 tkStateAfter（+ 可选 narrative 供主对话）
  → 插件校验 JSON 形 → patch-state 写入迹录（最后一轮 active segment）
  → 可选：narrative → appendPluginBlock
```

| 原则 | 说明 |
|------|------|
| **LLM 是 TK 作者** | `tkStateAfter` **全文由 LLM 生成**；插件只做 parse / 弱校验 / 调用 patch |
| **插件不代写 state** | 禁止插件代码按 CombatReport 算术更新 `hp.current` 等再 patch |
| **patch 是传输** | `patch-state` / `<ex-trace-keeper>` 落盘等价于侧栏保存；**语义上仍是 LLM 写回** |
| **LLM 输出形** | 建议 `{ "state": { … } }` 或裸 TK object（与 TraceBundle sampleState 同形）；叙事字段可选 |

**与叙事模式（§3.5）**：

- **perStep**：战中每步 complete **仅** narrative → 主对话；**不写 TK**；
- **perBattle** 或 **战后**：**一次** complete 交战报 → **LLM 写 TK**（+ 可选整场 narrative）。

**跨插件落盘**（实现待议，宿主不特化）：`dungeon-maze` server action 将 **LLM 返回的 state** 转调 trace-keeper `patchTraceKeeperState`（见 `DOC/devNotes/30` §patch-state）；或待 `host.capabilities`（`09` §8.7）。

#### 3.7.3 示例：TK state 片段（配套 bundle）

```json
{
  "scene": { "location": "地下城一层", "time": "夜", "weather": "阴" },
  "character": {
    "name": "{{char}}",
    "abilities": { "str": 14, "dex": 16, "con": 12, "int": 10, "wis": 11, "cha": 8 },
    "hp": { "current": 22, "max": 24 },
    "ac": 14,
    "conditions": []
  }
}
```

战后 **由 LLM** 根据 CombatReport 更新 `hp.current`、`conditions`、`scene.location` 等；**abilities** 首版通常不变。**插件不替 LLM 做上述更新。**

#### 3.7.4 权限与依赖（草案）

```json
{
  "requires": ["trace-keeper"],
  "permissions": [
    "conversation.read",
    "conversation.write",
    "plugin.complete"
  ]
}
```

`dungeon-maze` server 若走路径 A，需能加载 trace-keeper server 模块（bundled 同仓库）；**不**在宿主 `loader.ts` 硬编码，由构建/打包约定即可。

### 3.4 可读内容配置（Catalog）

插件数据目录（示例路径，实现时可调整）：

```text
data/plugins/dungeon-maze/{userId}/
  settings.json
  catalog-manifest.json      # 插件维护：可用配置索引（见 §3.4.5）
  assets/
    {bundleId}/                # 宿主 importBundle 解压根（zip 文件名）
      {configId}/              # zip 内一个顶层文件夹 = 一份配置
        catalog/
          equipment.json
          enemies.json
          skills.json
        assets/                # 该配置专属贴图
          equipment/knife.png
          enemies/goblin.png
```

**内置默认 catalog**（可选）：仍可在 `plugins/dungeon-maze/` bundled 内 ship；用户 import 的 bundle **追加或覆盖** manifest 条目。

配置应 **人类可读、可版本管理**；导入走宿主 **`host.assets.importBundle`**（§3.4.5），手写 JSON 或 HTML 编辑器导出 zip 均可。

#### 3.4.1 武器 / 装备（5e 向示例字段）

| 字段 | 示例 | 说明 |
|------|------|------|
| `id` | `poison_knife` | |
| `name` | 赋毒小刀 | |
| `category` | `weapon` | weapon / armor / wondrous… |
| `damage` | `1d4` | **武器伤害骰**（不含属性加值时由 runtime 加 STR/DEX mod） |
| `ability` | `dex` | 攻击/伤害使用的属性（`finesse` 时取 STR/DEX 较高） |
| `attackBonus` | `+5` | 可选；缺省则由 **熟练+属性** 推导 |
| `properties` | `["light","finesse"]` | 5e 武器属性标签 |
| `acBonus` | `+2` | 防具时加在基础 AC 上 |
| `onHitEffects` | 见 §3.3.3 | `proc` 用骰表达式（如 `d20<=3`）+ 豁免 DC |
| `sprite` | `assets/equipment/knife.png` | 外观图（**相对该 config 根**，见 §3.4.5） |

#### 3.4.2 敌人（5e 向示例字段）

| 字段 | 示例 | 说明 |
|------|------|------|
| `id` | `goblin` | |
| `name` | 哥布林 | |
| `role` | `minion` | minion / elite / boss |
| `cr` / `baseLevel` | `1/4` / `1` | 挑战等级或插件等级（growth 用） |
| `hp` | `7` | 最大 HP |
| `ac` | `15` | **护甲等级** |
| `initiativeMod` | `2` | 先攻加值 |
| `speed` | `30` | 移动 |
| `abilities` | `{ "str":8, "dex":14, "con":10, … }` | 六维；可选 |
| `attacks` | `[{ "name":"短弓", "attackBonus":4, "damage":"1d6+2", "ability":"dex" }]` | 一条或多条 |
| `saves` | `{ "con": 1 }` | 豁免加值 |
| `resistances` | `[]` | 首版可空；后补火焰减半等 |
| `growth` | `{ "hp": 3, "attackBonus": 1 }` | 实例 level 缩放（公式待实现） |
| `portrait` | `assets/enemies/goblin.png` | 立绘 |
| `skills` | `["shortbow_shot"]` | 引用 skill id（可选） |

#### 3.4.3 技能（5e 向示例字段）

| 字段 | 示例 | 说明 |
|------|------|------|
| `id` | `fireball` | |
| `name` | 火球术 | |
| `level` | `3` | 法术环位或技能等级 |
| `range` | `single` / `20ft` | 目标范围 |
| `attackRoll` | false | true → d20+spellAttack vs AC；false → 目标豁免 |
| `save` | `{ "ability": "dex", "dc": 15 }` | 豁免类技能 |
| `damage` | `8d6` | 伤害骰；可与 `damageType: "fire"` 并用 |
| `effectSprite` | `assets/skills/fireball.png` | |
| `effects` | `[…]` | 附加状态 |

**schemaVersion** 字段必备；后续字段「想到再说」时只增 catalog 类型，不绑宿主。

#### 3.4.4 Catalog 编辑工具（HTML · 单文件 · 提议）

手写 JSON 易错；提议提供一个 **单文件 HTML** 配置编辑器，**可独立运行**（浏览器直接打开，不依赖 arousalPub 服务或构建链），用于编辑并 **约束 catalog 合法**。

| 项 | 方向 |
|----|------|
| **形态** | 一个 `.html`（CSS/JS 内联或同目录仅一份 schema）；`file://` 或任意静态服务器均可 |
| **职责** | 编辑 `equipment` / `enemies` / `skills`（及后续 catalog 类型）；实时校验；导出合法 JSON |
| **校验** | 内嵌 **JSON Schema**（与插件 runtime 共用同一份 schema 定案为佳）；非法字段/类型/缺必填 **阻断导出** 并提示 |
| **UX（待议）** | 表格式表单 vs 树形 JSON；id 唯一性；skill 引用检查；资源路径 `assets/…` 存在性（可选，仅 warn） |
| **与宿主** | **零耦合**：不进 Web 壳、不加宿主路由；内容作者 / Mod 作者工具 |
| **落盘位置（实现时）** | `plugins/dungeon-maze/tools/catalog-editor.html`（随插件分发）；spike 可暂放 `.tmp/` |

```text
作者打开 catalog-editor.html
  → 加载/粘贴 JSON 或新建模板
  → 表单编辑 + schema 校验
  → 导出 equipment.json / enemies.json / skills.json
  → 复制到 data/plugins/dungeon-maze/{userId}/catalog/
```

**非目标（该工具）**：不替代插件内「游戏时」读盘校验；不做地图 dungeon state 编辑（仅 **静态 catalog**）；首版不要求账号/协作。导出时可 **打 zip**（多配置 = 多顶层文件夹），供 **`importBundle`** 导入。

#### 3.4.5 资源包导入（宿主 `importBundle` + 插件 manifest）

**定案**（用户 2026-08-12）：

| 步 | 执行方 | 说明 |
|----|--------|------|
| 1 | 用户 | 选择 `.zip`（可含 **多份配置**，每份一个顶层文件夹） |
| 2 | **宿主** | `host.assets.importBundle` → 解压到 `assets/{zip文件名}/` |
| 3 | **宿主** | 解压成功后调用 **`dungeon-maze` server `onBundleImported`** |
| 4 | **插件** | 校验各 config 下 `catalog/*.json`（JSON Schema）→ 更新 **`catalog-manifest.json`** |

**`catalog-manifest.json`**（插件自有格式，宿主不写）示例：

```json
{
  "schemaVersion": 1,
  "activeConfig": "forest-pack/forest-campaign",
  "configs": [
    {
      "id": "forest-pack/forest-campaign",
      "bundleId": "forest-pack",
      "configDir": "forest-campaign",
      "label": "森林战役",
      "catalogRoot": "assets/forest-pack/forest-campaign/catalog",
      "assetsRoot": "assets/forest-pack/forest-campaign/assets",
      "importedAt": "2026-08-12T12:00:00.000Z"
    }
  ]
}
```

运行时读 catalog：**manifest 指向的 `catalogRoot`**；JSON 内图片路径相对 **`assetsRoot`**（或 config 根 — 实现时统一一种）。

**zip 打包约定**（Mod 作者）：

```text
forest-pack.zip                    → 落盘 assets/forest-pack/
  forest-campaign/                 # config A
    catalog/equipment.json
    catalog/enemies.json
    assets/enemies/goblin.png
  ice-campaign/                    # config B
    catalog/…
    assets/…
```

**与 HTML 编辑器**：§3.4.4 可增加「导出 zip」；与设置页「导入资源包」共用 **`importBundle`**。

**宿主文档**：[`09-plugin-system-and-guidance-generate.md`](09-plugin-system-and-guidance-generate.md) §8.8 · [`18-plugin-host-developer-api.md`](18-plugin-host-developer-api.md) §3.15。

### 3.5 LLM 叙事与主对话（两种模式）

| 模式 | 触发时机 | complete 次数 | 进主对话 |
|------|----------|---------------|----------|
| **逐回合** `perStep` | 每个 CombatLogEntry 产生后 | 多（每步一次） | 每步 narrative 一条消息（角色/格式待 UX） |
| **整场** `perBattle` | 战斗结束、胜负已定时 | 1 | 一条（或分段）战报叙事 |

共同点：

1. complete 的 user 内容 = **结构化 log（JSON 或固定模板文本）** + system：**不得改变结果，只润色描写**；
2. 返回 prose 后通过规划中的通用 `host.conversation.appendPluginBlock` 写入主对话流；该区块不属于 user / assistant，默认不作为聊天组装消息；
3. panel 内可同时展示 **原始 log + narrative**，但以 log 为权威。

#### 3.5.1 战斗中禁止 composer 发消息（定案）

**战斗进行中**（遭遇触发 → 本地结算结束 / 用户放弃战斗前），**禁止**用户在主聊天 **composer 发送文本**（含普通 send、指导发送、slash 等经 composer 的出站）。

| 项 | 定案 |
|----|------|
| **机制** | 现有 `setPluginHold`；落地时随宿主演进为带 owner/token 的 acquire / release，避免并发插件互相解除占用（见 `18` §3.5） |
| **时机** | 进入战斗 UI / 先攻开始时 acquire；战斗结束（或放弃、逃跑失败定案后）release |
| **范围** | 仅挡 **composer 发新消息**；panel 内战斗操作、逐回合 **complete 写叙事** 不受影响 |
| **perStep** | 每步 complete 等待 LLM 期间 **保持 hold**（避免叙事未落盘时用户插话打乱顺序） |
| **perBattle** | 整场本地结算 + 一次 complete 期间 **全程 hold** |
| **UX** | composer 禁用 + 可选 `host.ui.progress` 提示「战斗进行中」；与 `plot-summary` pipeline 同类模式（`18` §7 示例） |

**待议**：

- 是否允许设置 **第三种：仅 log 不进 LLM**（调试用）；
- 消息作者身份：系统旁白 vs 假 user vs assistant — 影响 assemble 与 regex。

### 3.6 地图与进度持久化

| 数据 | 存放 | 说明 |
|------|------|------|
| 已生成地图（格网、墙、门、楼梯、seed） | 会话 **`pluginSettings['dungeon-maze'].dungeonState`** 或专用 blob | **按 active branch 隔离**；重开 panel 不 regenerate |
| 敌人实例位置 / 已击败标记 | 同上 | |
| 玩家坐标、层、背包、装备 | 同上 | |
| Catalog 默认 | `catalog-manifest.json` + `assets/{bundleId}/…` | 用户 import / 切换 activeConfig |
| 战报历史 | state 内数组 + 已 send 进 turn 的 narrative | 可选 `turn.plugins[]` 快照 |

**分支**（`23`）：**定案按 `branchPath` 隔离**。创建分支时继承分叉点的 dungeon state；后续地图、敌人、背包与战报仅写当前 active branch，禁止跨分支共享可变进度。

---

## 4. UI 与宿主能力（设想）

| 能力 | 现有宿主 API / 模式 |
|------|---------------------|
| Canvas 地图 + 战斗 UI | **`registerPluginPanel`**（`interactive: true`）或 floating panel |
| 叙事模式切换 | **`settingsSchema`**：`narrationMode: 'perStep' \| 'perBattle'` |
| 出站写戏 | **`plugin.complete`** |
| **进主对话** | 规划中的通用 **插件区块**（§3.5） |
| **战斗禁 composer** | 会话 hold acquire / release（§3.5.1） |
| 进度 / 地图 | 会话 **`pluginSettings`**；体积大时是否 **server plugin action 写盘** 待议 |
| Catalog 编辑 / 导入 | 设置页 · HTML 编辑器 · **`host.assets.importBundle`**（§3.4.5） |

不采用：宿主 `Dungeon*` 类型、专用路由、战斗算法进宿主。

---

## 5. 非目标（当前阶段）

| 排除项 | 说明 |
|--------|------|
| LLM 掷骰 / 改伤害 | 不允许 |
| 3D / 多人联机 | 不做 |
| 宿主改 assemble 特化 | 叙事消息走通用 send；若需注入 worldbook 用 manifest 通用能力 |
| 首版完整 Mod 工具链 | catalog 先 hand-edit JSON；可视化编辑器可后做 |

---

## 6. 权限与 manifest 草案（备忘）

```json
{
  "id": "dungeon-maze",
  "permissions": [
    "conversation.read",
    "conversation.write",
    "plugin.complete"
  ],
  "ui": {
    "panel": {
      "placement": "rightRail",
      "routes": ["chat"]
    }
  }
}
```

`appendPluginBlock` 所需权限以宿主定案为准；可能还需 `turn.plugins.write`（战报快照）。

---

## 7. 建议阶段（备忘）

| 阶段 | 内容 |
|------|------|
| M0 | Catalog **JSON Schema 定案** + 迷宫生成；Canvas + state 持久化与 **branchPath 隔离**；可选 **catalog-editor.html** spike |
| M0b | **Catalog 编辑器**（单文件 HTML）：schema 校验 + 导出三类 JSON（可与 M1 并行） |
| M1 | 本地战斗 loop + CombatLogEntry；panel 内 log；**战斗 acquire / release 会话 hold** |
| M2 | **perBattle** 模式 + complete + **插件区块进主对话** + **TK 战后写回**（与 narrative 同次或紧随） |
| M3 | **perStep** 叙事；**TK 写回仍仅战斗结束一次** |
| M4 | 多层/Boss、装备/技能 growth、**dungeon-rpg TraceBundle**、i18n、单测 |
| M5 | **`importBundle`** + `catalog-manifest.json`、探索事件进对话（若需要） |

---

## 8. 风险与开放问题

| 项 | 说明 |
|----|------|
| **逐回合 complete 成本** | 一场 20 步 ≈ 20 次 LLM；需队列、取消；**战斗中 composer 已 hold**（§3.5.1） |
| **主对话刷屏** | perStep 模式下消息密度高；可考虑折叠块标签或插件专用 markdown 模板 |
| **state 体积** | 大地图 + 多层 JSON 可能撑大 `pluginSettings`；需上限或外置文件 API |
| **润色越狱** | 模型改写结果；UI 并列 log + 强约束 prompt |
| **Canvas + 移动端** | 与 `33` 窄屏、触摸操作需单独验收 |
| **TK 写回跨插件** | §3.7.2 路径 A/B/C 待实现前只能手改侧栏；优先 bundled server 互调 |
| **Bundle 不一致** | 用户 TK 套件无 `character.abilities` → mapping 失败；需配套 bundle 或设置页校验 |
| **Catalog 校验** | 错误 JSON / 循环引用 skill；加载时 schema 校验；**编辑器与 runtime 共用 schema** |

---

## 9. 开放清单（想到再说）

- 探索类事件（开箱、陷阱）是否进主对话、用哪种叙事模式
- 与角色卡 / {{char}} 名绑定（仅文案 vs **六维/熟练继承**）
- **House rule 扩展**：固定命中率 %、闪避率、攻击−防御减法（当前 **不做**，见 §3.3）
- 战斗中的物品掉落与 catalog 动态扩展
- 地图主题 tileset、音效（`reply-complete-sound` 式插件协作？）
- Catalog 编辑器：多语言 nameKey 并排编辑、图片拖放上传、从 xlsx 导入
- **迹录 `dungeon-rpg` 套件**：sampleState + 面板 template 是否与迷宫共用 HP 条 UI

---

## 10. 变更记录

| 日期 | 说明 |
|------|------|
| 2026-08-12 | 初稿：地下城迷宫 + 本地掷骰 + LLM 仅润色战报 |
| 2026-08-12 | 序号 **98 → 50**；优先级 **P2**，列入 `04-TODO` |
| 2026-08-12 | 补充：**Canvas**、地图 **持久化不 reroll**、**catalog 配置**（装备/敌人/技能）、叙事 **默认进主对话**、**perStep / perBattle** 双模式 |
| 2026-08-12 | 提议：**单文件 HTML catalog 编辑器**（独立运行、JSON Schema 约束）；见 §3.4.4 |
| 2026-08-12 | **战斗规则定案：偏 D&D 5e 简易子集**（AC、d20 命中、伤害骰、豁免）；catalog 字段与 §3.3 对齐 |
| 2026-08-12 | **Catalog 资源包**：宿主 **`importBundle`** → `assets/{zip名}/`；插件 **`onBundleImported`** 写 **`catalog-manifest.json`**（§3.4.5） |
| 2026-08-12 | **战斗占用 composer**：**`setPluginHold`** 禁止战斗中 composer 发文本（§3.5.1） |
| 2026-08-13 | 定案：叙事进入主对话时使用通用 **插件区块**，不伪装 user / assistant；dungeon state 按 active branch 隔离；hold 演进为 owner/token acquire / release。 |
