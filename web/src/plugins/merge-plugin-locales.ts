import { SUPPORTED_LOCALES } from '@/i18n/locale'
import { i18n } from '@/i18n'
import { apiFetch } from '@/utils/api-fetch'

/** 拉取插件 `locales/{locale}.json` 并合并到 vue-i18n 的 `plugins.{pluginId}` 命名空间 */
export async function mergePluginLocales(pluginId: string): Promise<void> {
  const id = pluginId.trim()
  if (!id) return

  for (const locale of SUPPORTED_LOCALES) {
    const res = await apiFetch(
      `/api/plugins/${encodeURIComponent(id)}/locales/${locale}.json`,
    )
    if (!res.ok) continue
    let messages: unknown
    try {
      messages = await res.json()
    } catch {
      continue
    }
    if (!messages || typeof messages !== 'object' || Array.isArray(messages)) {
      continue
    }
    i18n.global.mergeLocaleMessage(locale, {
      plugins: {
        [id]: messages as Record<string, unknown>,
      },
    })
  }
}
