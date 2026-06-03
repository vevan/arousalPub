import { useApiKeysStore } from '@/stores/apiKeys'
import { useConnectionStore } from '@/stores/connection'
import { usePreferencesStore } from '@/stores/preferences'
import { usePromptsStore } from '@/stores/prompts'

let bootstrapPromise: Promise<void> | null = null

export function resetBootstrapAppData(): void {
  bootstrapPromise = null
}

/**
 * 应用级数据一次性初始化（偏好、API Key、提示词预设、连接预设）。
 * 多次调用共享同一 Promise，避免首屏重复请求与连接面板连环重渲染。
 */
export function bootstrapAppData(): Promise<void> {
  if (bootstrapPromise) return bootstrapPromise
  bootstrapPromise = (async () => {
    const pref = usePreferencesStore()
    const apiKeys = useApiKeysStore()
    const prompts = usePromptsStore()
    const conn = useConnectionStore()

    await Promise.all([
      pref.loadUserPreferencesFromServer(),
      apiKeys.loadFromServer(),
      prompts.loadIndexFromServer(),
    ])

    conn.ensureDefaultPresets()
    const ok = await conn.loadFromServer()
    if (!ok) conn.ensureDefaultPresets()
  })()
  return bootstrapPromise
}
