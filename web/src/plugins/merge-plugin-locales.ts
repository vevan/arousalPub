import { SUPPORTED_LOCALES } from '@/i18n/locale'
import { i18n } from '@/i18n'
import { apiFetch } from '@/utils/api-fetch'

const mergedPluginIds = new Set<string>()

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
  mergedPluginIds.add(id)
}

/** 宿主 locale 消息重载后，恢复已加载插件的 merge（避免 setLocaleMessage 覆盖） */
export async function remergeAllPluginLocales(): Promise<void> {
  if (mergedPluginIds.size === 0) return
  await Promise.all([...mergedPluginIds].map((id) => mergePluginLocales(id)))
}
