import { apiFetch } from '@/utils/api-fetch'
import type { PluginWebModule } from '@/plugins/types'

/** 经 apiFetch 拉取插件 web 入口并以 blob URL 动态加载（原生 import URL 不会带 Bearer） */
export async function loadPluginWebModule(
  webEntry: string,
): Promise<PluginWebModule> {
  const res = await apiFetch(webEntry)
  if (!res.ok) {
    throw new Error(`plugin_web_${res.status}`)
  }
  const code = await res.text()
  const blob = new Blob([code], { type: 'text/javascript' })
  const url = URL.createObjectURL(blob)
  try {
    return (await import(/* @vite-ignore */ url)) as PluginWebModule
  } finally {
    URL.revokeObjectURL(url)
  }
}
