# Codex 项目规则

本文件适用于整个仓库。带路径条件的章节仅在编辑对应文件时适用。用户在当前任务中的明确要求优先。

## Graphify

- 用户输入 `/graphify` 时，在做任何其他事情前先使用已安装的 Graphify skill 及其指令。
- 分析代码库结构、文件关系或项目内容时，优先使用现有 `graphify-out/` 图谱。

## 依赖安全与推送门禁

- 新增或升级任何依赖后，必须运行 `npm audit`，并解决全部已报告风险。
- 执行任何 `git push` 前，必须再次运行 `npm audit`；只有结果为 `0 vulnerabilities` 时才允许推送。
- 禁止使用 `npm audit fix --force`、忽略审计失败或其他绕过方式满足门禁。

## 禁止兼容性与过渡代码

除非用户在当前任务或 issue 中明示允许，不得编写、保留或使用兼容性/过渡代码。

禁止：

- 旧 API、旧字段、旧路由的读盘兜底、双写、别名导出、`@deprecated` 包装或旧名 re-export。
- 启动或请求时静默迁移，例如复制旧路径或把 legacy 键 normalize 成新键却不写回。
- 为“旧客户端可能传入”保留请求体兼容分支。
- 为旧数据格式保留 fallback 双路径（一般运行时容错除外）。

允许：

- 用户明示要求的短期兼容；必须在任务/PR 中写明删除条件和截止时间。
- 插件沙箱加载失败时回退到进程内加载（`plugin-system/loader.ts`）。
- 新建用户的一次性 seed，但必须遵守下文 seed 规则。
- 对外部标准协议的注释说明。

数据已迁移时：

1. 删除读旧键/旧路径分支，以新格式为唯一真相源。
2. Lance FTS、memory 索引等派生数据通过文档/UI 引导重建，不在运行时永久读旧布局。
3. 同步更新单测：删除 legacy 断言，改为新格式或“缺失即失败/空”。

新增能力时只实现定案后的 API/字段名，不做 `toast`/`notify` 式双 API。存储 schema 变更优先使用一次性迁移脚本或“缺文件即空”。

## 插件宿主通用性（强制）

适用路径：

- `server/src/**`
- `web/src/plugins/**`
- `web/src/components/settings/**`
- `web/src/utils/persist-display.ts`
- `web/src/utils/chat-api.ts`
- `web/src/utils/plugin-*.ts`
- `web/src/types/chat-turn.ts`
- `shared/**`

完整定案见 `DOC/devNotes/41-plugin-host-generic-principles.md`。宿主只提供 generic 能力，不得针对任何插件（包括 bundled 插件）特化。删除全部 bundled 插件后，宿主代码仍必须有意义。

不可妥协：

- 不接受“先写入宿主，再改名/抽象”的过渡态。
- 不接受用 opaque id 或通用文件名掩盖某个插件的领域逻辑。
- grep id 门禁不够；必须检查算法、契约形状、UI 状态机和产品字段等“能力”。
- 发现特化必须立即迁出到插件或改成纯 generic，不得保留临时特化。

宿主源码禁止：

- bundled 插件 id 字面量，如 `trace-keeper`、`plot-summary`、`guidance-generate`、`curated-memory`。
- `if (pluginId === '...')` / `switch (pluginId)` 等已知插件分支。
- `TraceKeeper*`、`PlotSummary*`、`Historian*`、`patchTraceKeeper*`、`*-trace-keeper-*` 等产品语义函数、类型和文件名。
- 任何插件业务逻辑、专用 UI、专用 TS 类型、专用 draft 形状（例如 `{ title, content, keywords }`）、自动摘要进度算法或 MEMO 标题格式。
- `loader.ts` 硬编码内置插件 id 数组。
- 宿主单测使用真实 bundled id；测试只使用 `fixture-plugin-*`。
- 宿主注释或示例绑定真实 bundled id 或产品话术。

允许：

- `pluginId: string` 作为路由参数、循环变量或 JSON 键，但不得存在语义分支。
- 由 manifest 字段、通用 hook、`runPluginAction`、lifecycle 或声明式 companion view 驱动行为。
- 插件 id 仅出现在 `plugins/*/manifest.json`、生成的 `plugins/bundled-registry.json` 和用户 data 中。

扩展插件行为时：

1. 先增加 manifest 声明、通用 hook 或通用壳，不在宿主增加 if/switch 或领域算法。
2. 块标签剔除等格式处理从 manifest 聚合的 `memory.stripBlockTags` 读取，不写死标签名。
3. 执行 `npm run check:host-no-plugin-ids`，并用 `DOC/devNotes/41-plugin-host-generic-principles.md` §7 的“三问 + 能力问”自检。

`DOC/devNotes/18` 可以用 bundled 插件作说明，但宿主实现不得引用其 id。

## 用户数据 seed

仅在编辑 `server/src/**/*-seed.ts` 或 `server/src/users-index.ts` 时适用。

除非新建用户，不得 seed 种子文件：

- 允许 `registerUser` 以及首次安装创建种子用户（`users.index.json` 尚不存在）时，经 `seedNewUserDefaultFiles` 一次性写入。
- 禁止服务每次启动，或 `ensureUsersRegistry` 已有用户索引时，因缺文件而补写 `prompts/`、`api-settings.json`、`lorebooks/`、`regex-rules.json`、`avatar.png` 等。
- 启动时仅可调用 `ensureDataSkeletonForUser` 创建空目录骨架，不得写默认内容文件。
- 新增 seed 类型必须挂到 `seedNewUserDefaultFiles`，不得挂到 `ensureUsersRegistry` 的常规分支。

## Vue i18n v11

仅在编辑 `web/src/locales/**`、`web/**/*.vue` 或 `web/src/utils/plugin-locale-text.ts` 时适用。

项目使用 Composition API（`legacy: false`）。宿主文案在 `web/src/locales/zh.json` 和 `en.json`；插件文案合并到 `plugins.{pluginId}`。

Message Format 中 `{` `}` `@` `$` `|` 有特殊含义：

| 用途 | 界面显示 | JSON 写法 |
|------|------|------|
| i18n 插值 | `共 {n} 条` | `"共 {n} 条"` 并调用 `$t('key', { n })` |
| 提示词宏 | `{{user}}` | `"\\{\\{user\\}\\}"` |
| `@` | `/@` | `/{'@'}` 或 `\\@` |
| XML 标签 | `<memory>` | `{'<'}memory{'>'}` |
| 字面量花括号 | `{` / `}` | `\\{` / `\\}` |

- 不得使用旧式 `'{'{'user{'}'}'` 拼接。
- 不得在 JSON 中写 `@:` 或 `@.` 开头的片段。
- 宿主 `zh` / `en` 键必须同步修改。
- 包含 `<history>`、`{` 等且无插值的插件文案，使用 `readPluginLocaleMessage` / `translatePluginI18nKey`，避免 `$t` 误解析。
- 服务端群聊说明、提示词预设、角色卡正文不经 i18n，保持真实 `{{user}}` / `[NEXT@]`，不做 locales 转义。

详细对照表见 `cursor.md` 的“易错”章节。修改 locales 后可执行：

```bash
node --input-type=module -e "import { createI18n } from 'vue-i18n'; import zh from './web/src/locales/zh.json' with { type: 'json' }; createI18n({ legacy: false, locale: 'zh', messages: { zh } }); console.log('zh ok');"
```
