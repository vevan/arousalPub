# vue-i18n v9 → v11 迁移计划

> 状态：**已完成**（2026-05-29）。安全告警见 `DOC/00-alert.md`。  
> 参考：[Maintenance](https://vue-i18n.intlify.dev/guide/maintenance.html)、[Breaking Changes in v11](https://vue-i18n.intlify.dev/guide/migration/breaking11.html)

## 背景

- 当前：`vue-i18n@^9.14.5`，`createI18n({ legacy: false, ... })`（`web/src/i18n/index.ts`）。
- v9/v10 自 2025-07 起进入维护模式；v11 为主流版本。
- 本仓库 **无 SSR**；文案为 `web/src/locales/{en,zh}.json`。

## 现状评估（有利于低风险升级）

| 检查项 | 本仓库 |
|--------|--------|
| Composition API 模式（`legacy: false`） | 已满足 |
| `v-t` 指令 | 未使用 |
| `$tc` / `tc`（复数 Legacy API） | 未使用 |
| 模板 `$t(...)` + `<script setup>` 中 `useI18n().t` | 混用，均为 v11 支持方式 |
| 语言切换 | `App.vue` + `useLocaleStore` 写 `locale.value` |

结论：主要工作是 **依赖升级 + 全站冒烟**，而非 API 模式重写。

## 目标

- `web/package.json`：`vue-i18n` → `^11.4.0`（或当时最新 11.x patch）。
- `npm audit` / install 无 v9 弃用警告。
- `npm run typecheck`、`npm run build -w web` 通过。
- 中英文切换与主要页面文案正常。

## 步骤

### 1. 升级依赖

```bash
cd web
npm install vue-i18n@^11.4.0
cd ..
npm install
```

在 monorepo 根目录确认 lockfile 仅保留 v11 的 `vue-i18n` 解析。

### 2. 静态检查（可选但推荐）

安装并在 `web/` 启用 [eslint-plugin-vue-i18n](https://eslint-plugin-vue-i18n.intlify.dev/)，规则至少包含：

- `@intlify/vue-i18n/no-deprecated-v-t`（本仓库应为 0 处）
- 缺失 key / 未使用 key（按团队接受度配置）

若暂不引入 ESLint，用 ripgrep 兜底：

```bash
rg "v-t=|v-t\s|\\.tc\\(|\\$tc\\(" web/src
```

### 3. 配置核对

`web/src/i18n/index.ts` 保持：

```ts
export const i18n = createI18n({
  legacy: false,
  locale: initialLocale,
  fallbackLocale: 'en',
  messages: { en, zh },
})
```

v11 下 `legacy: false` 仍为 Composition 模式入口；无需改回 Legacy API。

若升级后出现模板内 `$t` 未注入，可显式增加 `globalInjection: true`（v9.2+ 默认已为 true，一般不必改）。

### 4. 回归测试清单

> 自动化：`npm run typecheck`、`npm run build -w web` 已通过（2026-05-29）。下列为建议手测。

- [ ] 设置页：语言 `auto` / `en` / `zh` 切换，`document.documentElement.lang` 正确
- [ ] `App.vue` 主导航、设置抽屉、API 连接文案
- [ ] `/chat/*`：发送、流式、删除确认、组装预览对话框
- [ ] `/prompts`、`/characters`、`/lorebooks` 列表与表单校验提示
- [ ] `ConnectionSettingsCard`、`ConversationContextSettings`、记忆重建相关 `t()` 文案
- [ ] 浏览器 `languagechange`（`preference === 'auto'` 时）

### 5. 文档同步

- [ ] `DOC/05-技术栈.md` §2 国际化：注明 vue-i18n v11
- [ ] `DOC/00-alert.md`：移除 vue-i18n 待办
- [ ] `DOC/04-TODO.md`：勾选迁移项

## 备忘：locale 中的 `{{user}}` 等宏名字面量

v11 下须在 `web/src/locales/*.json` 用反斜杠转义（如 `\\{\\{user\\}\\}`），详见 **`DOC/03-实现细节.md` §9.5**。

## 不在此次范围（可后续迭代）

- **TypeScript 消息 schema**（`createI18n<{ message: MessageSchema }, ...>()`）：提升 key 补全，非 v11 必需。
- **v11.4+ isolated scope**（`useI18n({ useScope: 'isolated' })`）：仅当 composable 需要独立 messages 时再考虑。
- **按路由懒加载 locale JSON**：当前 en/zh 体量小，可维持静态 import。

## 风险与回滚

| 风险 | 缓解 |
|------|------|
| v11 对 `$tc` 的移除 | 本仓库未使用 |
| 依赖与 Vue 3.5 兼容性 | 升级后跑 build + 手测 |
| 个别运行时 deprecation 警告 | 按控制台逐项对照 breaking11 文档 |

回滚：将 `vue-i18n` 指回 `^9.14.5` 并恢复 lockfile 对应段落。

## 排期建议

- **工作量**：约 0.5～1 人日（含冒烟）。
- **依赖**：可与其它前端依赖升级合并为一个 PR；与安全修复（marked/fast-uri）已分离。
