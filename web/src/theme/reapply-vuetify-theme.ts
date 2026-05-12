import { buildVuetifyThemes } from '@/theme/build-vuetify-themes'
import { readOklchOverrides } from '@/theme/overrides-storage'
import { nextTick } from 'vue'
import type { ThemeInstance } from 'vuetify'

/** 与 Vuetify 默认 theme.stylesheetId 一致 */
const VUETIFY_THEME_STYLE_ID = 'vuetify-theme-stylesheet'

/**
 * 从 localStorage 中的 OKLCH 覆盖重新生成并写入 Vuetify 主题（底层为 hex/RGB）。
 * 部分环境下仅改 themes ref 不会刷新已注入的 style 节点，因此在 nextTick 后强制写入样式文本。
 */
export async function reapplyVuetifyThemeFromStorage(
  theme: ThemeInstance,
): Promise<void> {
  const built = buildVuetifyThemes(readOklchOverrides())
  const th = theme.themes.value

  theme.themes.value = {
    ...th,
    dark: {
      ...th.dark,
      colors: { ...th.dark.colors, ...built.dark.colors },
      variables: {
        ...(th.dark.variables ?? {}),
        ...built.dark.variables,
      },
    },
    light: {
      ...th.light,
      colors: { ...th.light.colors, ...built.light.colors },
      variables: {
        ...(th.light.variables ?? {}),
        ...built.light.variables,
      },
    },
  } as typeof theme.themes.value

  await nextTick()
  const css = theme.styles.value
  const el = document.getElementById(VUETIFY_THEME_STYLE_ID)
  if (el && css) {
    el.textContent = css
  }
}
