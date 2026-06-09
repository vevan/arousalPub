import { i18n } from '@/i18n'

/** 设置页 / 对话插件 Tab 展示名（各插件 `locales/*.json` 可选提供） */
export const PLUGIN_DISPLAY_NAME_KEY = 'pluginDisplayName'

/** manifest `name` 的本地化回退：无 `pluginDisplayName` 时用 fallback */
export function resolvePluginDisplayName(
  pluginId: string,
  fallbackName: string,
  locale?: string,
): string {
  const localized = readPluginLocaleMessage(
    pluginId,
    PLUGIN_DISPLAY_NAME_KEY,
    locale,
  )
  return localized?.trim() || fallbackName
}

/** 从已合并的 `plugins.{pluginId}` 命名空间读取字面量，不经 message compiler */
export function readPluginLocaleMessage(
  pluginId: string,
  key: string,
  locale?: string,
): string | undefined {
  const loc = (locale ?? i18n.global.locale.value) as string
  const root = i18n.global.getLocaleMessage(loc) as Record<string, unknown>
  const plugins = root?.plugins
  if (!plugins || typeof plugins !== 'object' || Array.isArray(plugins)) {
    return undefined
  }
  const bag = (plugins as Record<string, unknown>)[pluginId]
  if (!bag || typeof bag !== 'object' || Array.isArray(bag)) {
    return undefined
  }
  const v = (bag as Record<string, unknown>)[key]
  return typeof v === 'string' ? v : undefined
}

export function hasPluginLocaleMessage(
  pluginId: string,
  key: string,
  locale?: string,
): boolean {
  return readPluginLocaleMessage(pluginId, key, locale) !== undefined
}

export function parsePluginI18nKey(
  fullKey: string,
): { pluginId: string; key: string } | null {
  if (!fullKey.startsWith('plugins.')) return null
  const rest = fullKey.slice('plugins.'.length)
  const dot = rest.indexOf('.')
  if (dot <= 0) return null
  return { pluginId: rest.slice(0, dot), key: rest.slice(dot + 1) }
}

/**
 * 插件文案：无插值参数时按字面量返回（避免 `<history>`、`{` 触发 HTML/ICU 解析）；
 * 有 params 时走 vue-i18n 以支持 `{name}` 等占位。
 */
export function translatePluginI18nKey(
  fullKey: string,
  t: (key: string, params?: Record<string, unknown>) => string,
  te: (key: string) => boolean,
  params?: Record<string, unknown>,
): string {
  const hasParams = Boolean(params && Object.keys(params).length > 0)
  if (hasParams) {
    return te(fullKey) ? t(fullKey, params) : fullKey
  }
  const parsed = parsePluginI18nKey(fullKey)
  if (parsed) {
    const raw = readPluginLocaleMessage(parsed.pluginId, parsed.key)
    if (raw !== undefined) return raw
  }
  return te(fullKey) ? t(fullKey) : fullKey
}
