# 主布局三列 Grid 与插件 Rail — 设计定案

> **状态**：**已实现**（2026-06-16 定案 · 2026-06 落地）。本文描述 `v-main` 三列布局、插件常驻侧栏、API 浮层保留，以及 `pinned` → `hidden` 的状态迁移。  
> **关联**：`DOC/03` §11.3、`DOC/18` §3.13.1、`DOC/30` 迹录侧栏。

---

## 1. 背景与目标

### 1.1 现状

- `App.vue`：`v-main.main-chat` 为纵向 flex，内仅 `<router-view />`。
- **左侧插件**：`v-navigation-drawer`（`temporary` · 280px）+ `PluginLeftDrawerHost`；`placement: 'leftDrawer'`。
- **右侧 API**：`v-navigation-drawer`（`temporary` · 440px）+ `ConnectionSettingsCard`。
- 插件面板状态：`pluginPanelOpen`、`pluginPanelPinned`（钉住浮层）；页脚按钮 `openPluginPanel('leftDrawer')`。

### 1.2 定案目标

| 项 | 定案 |
|----|------|
| 主内容区 | `main-chat` 改为 **CSS Grid 三列**：左 rail · 中主内容 · 右 rail |
| 中间列 | 现有路由视图（`/` 对话列表、`/chat/:id` 对话页等），宽度 `clamp(45rem, 60%, 80rem)` |
| 左右 rail | **常驻参与布局**（非 `temporary` 浮层），供插件 `host.ui.panel` 使用 |
| API 连接设置 | **保持**右侧 `v-navigation-drawer` **`temporary` 浮层**，不参与 grid 占位 |
| 显隐语义 | 废弃 `pluginPanelPinned`；改为按 placement 的 **`hidden` 开关** |
| 无插件时 | **rail 列仍占位**（grid 列宽不变）；仅 **宿主内容区** 可隐藏（`.hidden`） |

---

## 2. 布局结构

### 2.1 Grid 列定义

```css
.main-chat {
  display: grid;
  grid-template-columns: 1fr clamp(45rem, 60%, 80rem) 1fr;
  min-height: 0;
  /* 左右 1fr 平分视口剩余宽度；中间列随视口在 45rem–80rem 间伸缩 */
}
```

- **左列 `1fr`**：左插件 rail 容器（`#leftRail`）。
- **中列 `clamp(...)`**：`#centerRail`，包 `<router-view />`。
- **右列 `1fr`**：右插件 rail 容器（`#rightRail`）。

三列均需 `min-width: 0`、`min-height: 0`，避免 grid 子项撑破布局。

### 2.2 DOM 层级（定案）

```html
<v-main id="mainChat" class="main-chat">
  <aside id="leftRail" class="main-chat__rail main-chat__rail--left">
    <section
      id="leftHostPanel"
      class="plugin-rail-host"
      :class="{ hidden: isPluginPanelHidden('leftRail') }"
    >
      <PluginRailHost placement="leftRail" />
    </section>
  </aside>

  <section id="centerRail" class="main-chat__center">
    <router-view />
  </section>

  <aside id="rightRail" class="main-chat__rail main-chat__rail--right">
    <section
      id="rightHostPanel"
      class="plugin-rail-host"
      :class="{ hidden: isPluginPanelHidden('rightRail') }"
    >
      <PluginRailHost placement="rightRail" />
    </section>
  </aside>
</v-main>
```

**选择器约定**：`#leftRail > #leftHostPanel.hidden` — 隐藏的是 **宿主面板节点**，不是 rail 列本身。

```css
.plugin-rail-host.hidden {
  display: none;
}
```

### 2.3 无插件时的占位策略

| 层级 | 行为 |
|------|------|
| `#leftRail` / `#rightRail` | **始终存在**，参与 grid 列宽计算；**不因**「零注册插件」而 `display: none` |
| `#leftHostPanel` / `#rightHostPanel` | 用户或 API 设 `hidden=true` 时加 `.hidden`，**仅隐藏宿主 UI**（Tab 栏 + HTML 内容） |
| 零注册插件 / 当前路由无可用面板 / 无可展示 HTML | 宿主统一显示 **`app.pluginRailUnavailable`**（「当前无可用插件」）；**不**渲染陈旧 `setHtml` |

这样超宽屏下中间对话区始终居中，左右对称留白由 `1fr` 承担；将来插件挂上后同一列宽内展示面板，无需再改全局列公式。

### 2.4 API 浮层（不变）

```html
<v-navigation-drawer
  v-model="drawerRight"
  :width="440"
  temporary
  location="end"
>
  <ConnectionSettingsCard />
</v-navigation-drawer>
```

- 顶栏 / 页脚「API 连接」仍切换 `drawerRight`。
- 与 `#rightRail` **职责分离**：`rightRail` = 插件；`drawerRight` = 全局 API 预设。

---

## 3. 状态模型：`pinned` → `hidden`

### 3.1 语义对照

| 旧（drawer） | 新（grid rail） |
|--------------|-----------------|
| `pluginPanelPinned = true` | `hidden(leftRail) = false` |
| `pluginPanelPinned = false` 且 drawer 关闭 | `hidden(leftRail) = true` |
| `openPluginPanel(placement)` | `setHidden(placement, false)` + `focusPluginPanelTab` |
| Pin 按钮 | **显示/隐藏** 宿主面板（非钉住浮层） |

关系：**`pinned === !hidden`**（按 placement）。

### 3.2 Registry（`plugin-panel-registry.ts`）

**删除或废弃**：

- `pluginPanelOpen`
- `pluginPanelPinned`
- `setPluginPanelPinned`

**新增**：

```ts
export type PluginPanelPlacement = 'leftRail' | 'rightRail'

const panelHidden = ref<Record<PluginPanelPlacement, boolean>>({
  leftRail: false,
  rightRail: true, // 右侧默认隐藏，直至有插件或用户展开
})

export function isPluginPanelHidden(placement: PluginPanelPlacement): boolean
export function setPluginPanelHidden(placement: PluginPanelPlacement, hidden: boolean): void
```

`openPluginPanel(placement, pluginId?)` 保留名称，实现改为：

1. `setPluginPanelHidden(placement, false)`
2. `focusPluginPanelTab(placement, pluginId)`

**不**再操作 drawer `v-model`。

### 3.3 宿主 UI 按钮

原 `PluginLeftDrawerHost` 内 Pin 图标（`mdi-pin`）改为 **隐藏/显示**：

- 图标建议：`mdi-eye-off` / `mdi-eye-outline`，或 `mdi-chevron-left`（左 rail 收起方向）
- i18n：`app.pluginPanelPin` → `app.pluginPanelHide` / `app.pluginPanelShow`（或合并为 `app.pluginPanelToggle`）

### 3.4 页脚插件按钮

`App.vue` 页脚 `mdi-menu`：

```ts
openPluginPanel('leftRail') // 显示左 rail 宿主并聚焦默认 Tab
```

---

## 4. 插件宿主 API（`host.ui.panel`）

### 4.1 Placement 重命名

| 旧 | 新 |
|----|-----|
| `'leftDrawer'` | `'leftRail'` |
| （无） | `'rightRail'` |

### 4.2 方法变更（`web/src/plugins/types.ts`）

| 方法 | 变更 |
|------|------|
| `register({ placement, ... })` | `placement: 'leftRail' \| 'rightRail'` |
| `setHtml(placement, ...)` | 同上 |
| `open(placement, pluginId?)` | 取消 hidden + 聚焦 Tab |
| `setPinned(placement, boolean)` | **删除** → `setHidden(placement, boolean)` |
| `onEvent(placement, ...)` | placement 类型扩展 |

`create-plugin-web-host.ts` 透传 `setHidden`；若需短期兼容可保留 `setPinned(p, pinned)` 别名：`setHidden(p, !pinned)`（**不推荐长期保留**）。

### 4.3 组件重命名

| 旧 | 新 |
|----|-----|
| `PluginLeftDrawerHost.vue` | `PluginRailHost.vue`（`placement` prop） |

单组件服务 `leftRail` / `rightRail`，按 `getRegisteredPanels(placement)` 过滤 Tab 与 HTML。

### 4.4 路由可见性（`routes` · 已实现）

`host.ui.panel.register` 可选 **`routes`**：`('home' | 'chat')[]`，**省略时默认 `['chat']`**。

| 项 | 行为 |
|----|------|
| `PluginRailHost` | 顶栏 Tab **始终列出**已注册插件；**当前路由不匹配**的 Tab **`disabled`** |
| 主体区 | 仅当 active 插件在 `routes` 内且 `html` 非空时 `v-html`；否则 **`app.pluginRailUnavailable`** |
| 离开对话页 | `App.vue` 监听 `route.name`，对不可见面板 **`clearPanelHtmlForInactiveRoutes`**，避免列表页残留上一场 HTML |

迹录 `trace-keeper` 使用默认 `routes: ['chat']`（注册时可省略）。

---

## 5. 与对话页高度的关系

`ChatConversationView` 根 `.chat_pane` 当前：

```css
height: calc(100vh - var(--header-height) - var(--footer-height));
flex: 1 1 auto; /* 配合父级 flex */
```

改为 grid 后建议：

- `#centerRail`：`display: flex; flex-direction: column; overflow: hidden; min-height: 0`
- `.chat_pane`：`height: 100%`（或继续 `calc(100vh - …)`，二选一，以实现时实测为准）
- **勿在** `<router-view>` 或 `v-main` 上挂 `d-flex flex-column` 合并到子路由（见 `DOC/03` §11.2 注释）

---

## 6. 迁移清单（实现时）

### 6.1 删除

- `App.vue` 左侧 `v-navigation-drawer` + `drawerLeft` computed
- `plugin-panel-registry.ts` 中 `pluginPanelOpen`、`pluginPanelPinned`
- `plugin-left-drawer-overlay` 等相关 class（若有）

### 6.2 修改

| 文件 | 内容 |
|------|------|
| `web/src/App.vue` | `main-chat` grid 三列；挂载 `PluginRailHost`；API drawer 保留 |
| `web/src/components/PluginRailHost.vue` | 自 `PluginLeftDrawerHost` 演进 |
| `web/src/plugins/plugin-panel-registry.ts` | placement、`hidden` 状态 |
| `web/src/plugins/types.ts` | `host.ui.panel` 类型 |
| `web/src/plugins/create-plugin-web-host.ts` | API 透传 |
| `web/src/locales/zh.json` / `en.json` | Pin → Hide/Show 文案 |
| `plugins/trace-keeper/src/index.ts` | `PLACEMENT = 'leftRail'` |
| `DOC/03` §11.3 | 侧栏描述更新 |
| `DOC/18` §3.13.1 | panel API 表更新 |
| `DOC/30` | 侧栏占位从 drawer 改为 leftRail |

### 6.3 窄屏（**`DOC/33`** · Phase 1 已落地）

- **断点 `40rem`**：`grid-template-columns: 1fr`（侧栏 `absolute` 脱流）；`#centerRail` **文档流**；侧栏打开时 `fixed` + `::after` 遮罩；panel **`max-width: 25rem`**
- 页脚「插件」：**toggle** `leftRail` hidden；pin 同 registry
- 仍待做：composer 键盘、`safe-area`（见 `DOC/33`）
- `rightRail` 首个消费者插件（未变）

---

## 7. 行为验收

| # | 场景 | 期望 |
|---|------|------|
| 1 | 无插件注册 | 左/右 rail 列仍占位；宿主显示「当前无可用插件」；右宿主默认 hidden |
| 1b | 在 `/` 对话列表，迹录已注册 | 迹录 Tab 显示但 **disabled**；主体「当前无可用插件」，无陈旧 tracker HTML |
| 2 | 迹录注册并 `setHtml` | 左 rail 内显示 Tab + HTML；中间对话区宽度不变公式 |
| 3 | 点击宿主「隐藏」 | `#leftHostPanel` 加 `.hidden`；**左列 grid 宽度不变** |
| 4 | 页脚「插件」按钮 | `hidden=false`，聚焦迹录 Tab |
| 5 | `host.ui.panel.open('leftRail')` | 同 #4 |
| 6 | `host.ui.panel.setHidden('leftRail', true)` | 同 #3 |
| 7 | 顶栏 API 连接 | 右侧 **temporary** drawer 浮层打开；不挤占 grid |
| 8 | `/` 与 `/chat/:id` | 中间列布局正常，无 flex/grid 覆盖回归 |

---

## 8. 示意图

```text
┌─────────────────────────────────────────────────────────────┐
│ v-app-bar                                                    │
├──────────┬──────────────────────────────┬───────────────────┤
│ #leftRail│      #centerRail             │ #rightRail        │
│ 1fr      │ clamp(45rem, 60%, 80rem)     │ 1fr               │
│          │                              │                   │
│ ┌──────┐ │  router-view                 │ ┌──────┐          │
│ │Host  │ │  (列表 / 对话)               │ │Host  │          │
│ │Panel │ │                              │ │.hidden│         │
│ └──────┘ │                              │ └──────┘          │
├──────────┴──────────────────────────────┴───────────────────┤
│ v-footer                                                     │
└─────────────────────────────────────────────────────────────┘

                    ┌─────────────────┐
                    │ API drawer      │  ← temporary 浮层，不占 grid
                    │ (440px, end)    │
                    └─────────────────┘
```

---

## 9. 变更记录

| 日期 | 说明 |
|------|------|
| 2026-06-16 | 初稿：grid 三列、hidden 替代 pinned、无插件仍占位、API 浮层保留 |
| 2026-06-16 | 落地：`routes` 路由门控、`pluginRailUnavailable` 统一空态、离开 chat 清 HTML |
