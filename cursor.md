# arousalPub 概况与索引

## ⚠️ 易错：`locales/*.json` 与 Message Format 特殊字符

**vue-i18n v11** 编译 `web/src/locales/zh.json`、`en.json` 时，下列字符有特殊含义：`{` `}` `@` `$` `|`。  
若要在界面**原样显示**（提示词宏、群聊 `[NEXT@]`、`/@`、XML 标签名等），**禁止直接写入**，否则几乎必炸：

- 运行时：`Message compilation error`（常见 `Not allowed nest placeholder`、`Unterminated closing brace`）
- 连带：弹窗 / `$t()` 组件渲染失败（如 `VOverlay` 读 `classList` 报错）

### 先分清两类花括号

| 用途 | 界面显示 | JSON 写法 | 说明 |
|------|----------|-----------|------|
| **i18n 插值**（要传参） | `共 {n} 条` | `"共 {n} 条"` | 调用 `$t('key', { n: 5 })`；**不要**转义 |
| **提示词宏**（字面量） | `{{user}}` | `"\\{\\{user\\}\\}"` | 每个 `{` `}` 各加 `\\` |

### 字面量对照表（本仓库已用写法）

| 界面要显示 | 推荐 JSON 写法 | 备注 |
|------------|----------------|------|
| `{{user}}` `{{char}}` `{{groupNotMuted}}` `{{defaultAuthorsNote}}` 等宏 | `\\{\\{user\\}\\}` | 双花括号宏一律如此 |
| `@` | `{'@'}` 或 `\\@` | 群聊 `/{'@'}`、`[NEXT{'@'}]` 已采用前者 |
| `/ @` 提及语法 | `/{'@'}` | 见 `chat.groupChat.atNameUnmatched` |
| `[NEXT@]` | `[NEXT{'@'}]` | 见 `modeNextAt`、`needsManualContinue` |
| `<memory>` 等 XML 标签 | `{'<'}memory{'>'}` | 见 `memorySectionHint` |
| 反斜杠 + 字母 ` \n `（说明「换行符」） | `\\n` | JSON 内一个 `\`；见 `drySequenceBreakersHint` |
| 字面量 `{` `}`（单花括号，非插值） | `\\{` `\\}` | v11.3+ 转义序列 |
| 字面量 `\|` | `\\|` | 管道符 |
| 字面量 `$`（如 `$1`、`$&`） | `{'$'}1` 或实测可用的 `\\$` | `$` 为 MF 特殊字符，新增文案需验证 |

**两种等价手段**（可混用，本仓库以 **转义序列** 写宏、以 **`{'…'}` 字面量** 写 `@` / `<` / `>` 为主）：

1. **转义序列**（JSON 里对每个 `\` 再写一层）：`\\{` `\\}` `\\@` `\\|` `\\\\`
2. **字面量插值**：`{'@'}`、`{'<'}memory{'>'}`（[Literal interpolation](https://vue-i18n.intlify.dev/guide/essentials/syntax.html#literal-interpolation)）

```json
"continueAssembleInstructionHint": "支持 \\{\\{user\\}\\} 等宏。",
"modeNextAt": "LLM [NEXT{'@'}]",
"atNameUnmatched": "请检查 /{'@'} 后的名字…",
"memorySectionHint": "…以 {'<'}memory{'>'} 注入。"
```

**不要**用旧式 `'{'{'user{'}'}'` 拼接，易多写 `}` 触发 `Unterminated closing brace`。  
**勿**在 JSON 里写 `@:`、`@.` 开头片段，那是链接/修饰语法。

### 哪里要转义、哪里不要

| 位置 | 是否转义 |
|------|----------|
| `web/src/locales/*.json`（`$t('…')`） | **必须**按上表 |
| 服务端 / 群聊 `groupAssembleInstruction` / `continueAssembleInstruction` / 提示词预设 / 角色卡正文 | 保持真实 `{{user}}`、`[NEXT@Betty]`，**不要**转义 |
| Vue 模板里直接写的中文 | 不经过 i18n 编译，无此问题 |

**维护**：`zh` / `en` **同步**修改；改完后在仓库根执行（可选）：

```bash
node --input-type=module -e "import { createI18n } from 'vue-i18n'; import zh from './web/src/locales/zh.json' with { type: 'json' }; createI18n({ legacy: false, locale: 'zh', messages: { zh } }); console.log('zh ok');"
```

完整说明：`DOC/03-实现细节.md` §9.5。

## 项目概况

- 类 SillyTavern 现代化产品；**已脱离 MVP**（2026-05+）
- 栈：Vue3 + Pinia + Vuetify；Fastify；**宏/组装仅服务端**；`data/{userId}/` JSON + chunk
- 能力：对话、角色、Prompt、资料库、**Lance turn memory**、SSE、插件（Historian 等）

## 文档

**主索引**：[`DOC/README.md`](DOC/README.md)

| 常用 | 路径 |
|------|------|
| 实现细节 | `DOC/03-实现细节.md` |
| 工作交接 | `DOC/06-工作交接.md` |
| 待办 | `DOC/04-TODO.md` |
| 安全 / API Key | `DOC/25-security-deployment.md` |
| Historian | `DOC/12-plugin-plot-summary.md` |
| 数据目录 | `data/README.md` |
| 启动 | 根目录 `README.md` |

`cursor.md` 仅保留概况与索引；详细设计在 `DOC/`。
