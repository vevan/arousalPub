import { readApiSettingsFromFile } from './api-settings-file.js'
import {
  readConversationIndex,
  readConversationPluginSettings,
} from './chat-storage.js'
import {
  resolvePluginFeatureApi,
  type ResolvedFeatureApi,
} from './feature-binding-resolve.js'
import { readMergedPluginUserSettings } from './plugin-system/settings.js'
import { getCurrentUserId } from './user-context.js'

export interface ResolvePluginCompleteApiInput {
  pluginId: string
  conversationId?: string
  /** 请求体显式传入时优先使用，不走解析链 */
  apiConfigId?: string
  userId?: string
  /**
   * 未绑定时回退全局 **activePresetId**（连接设置「全局默认预设」）。
   * 默认 **true**；显式 `false` 关闭。
   */
  fallbackToGlobalDefault?: boolean
}

/** 未传或 `true` 时回退全局默认 preset；仅显式 `false` 关闭 */
export function shouldPluginFallbackToGlobalDefault(
  input: Pick<ResolvePluginCompleteApiInput, 'fallbackToGlobalDefault'>,
): boolean {
  return input.fallbackToGlobalDefault !== false
}

export type ResolvePluginCompleteApiResult =
  | { ok: true; resolved: ResolvedFeatureApi }
  | { ok: false; code: 'api_config_not_found' }

export interface ResolvePluginCompleteApiSources {
  settings: Awaited<ReturnType<typeof readApiSettingsFromFile>>
  conversationPluginApiConfigId?: string | null
  globalPluginApiConfigId?: string | null
}

function pluginSettingsApiConfigId(
  settings: Record<string, unknown>,
): string | null {
  const id = settings.apiConfigId
  return typeof id === 'string' && id.trim() ? id.trim() : null
}

/** 纯解析（单测 / 预加载数据）；`resolvePluginCompleteApi` 读盘后调用 */
export function resolvePluginCompleteApiFromSources(
  input: ResolvePluginCompleteApiInput,
  sources: ResolvePluginCompleteApiSources,
): ResolvePluginCompleteApiResult {
  const pluginId = input.pluginId.trim()
  if (!pluginId) {
    return { ok: false, code: 'api_config_not_found' }
  }

  const explicit =
    typeof input.apiConfigId === 'string' ? input.apiConfigId.trim() : ''
  if (explicit) {
    const preset = sources.settings?.presets.find((p) => p.id === explicit) ?? null
    if (!preset) {
      return { ok: false, code: 'api_config_not_found' }
    }
    return {
      ok: true,
      resolved: {
        featureType: 'plugin',
        featureRefId: pluginId,
        pluginId,
        apiConfigId: explicit,
        source: 'plugin_settings',
        preset,
        model: preset.model,
      },
    }
  }

  const settings = sources.settings
  if (!settings) {
    return { ok: false, code: 'api_config_not_found' }
  }

  const resolved = resolvePluginFeatureApi(settings, pluginId, {
    conversationPluginApiConfigId: sources.conversationPluginApiConfigId,
    globalPluginApiConfigId: sources.globalPluginApiConfigId,
    fallbackToGlobalDefault: shouldPluginFallbackToGlobalDefault(input),
  })
  if (resolved) {
    return { ok: true, resolved }
  }

  return { ok: false, code: 'api_config_not_found' }
}

export async function resolvePluginCompleteApi(
  input: ResolvePluginCompleteApiInput,
): Promise<ResolvePluginCompleteApiResult> {
  const pluginId = input.pluginId.trim()
  if (!pluginId) {
    return { ok: false, code: 'api_config_not_found' }
  }

  const settings = await readApiSettingsFromFile()

  let conversationPluginApiConfigId: string | null = null
  const convId =
    typeof input.conversationId === 'string' ? input.conversationId.trim() : ''
  if (convId) {
    const idx = await readConversationIndex(convId)
    if (idx) {
      const convPluginSettings = readConversationPluginSettings(idx, pluginId)
      conversationPluginApiConfigId = pluginSettingsApiConfigId(convPluginSettings)
    }
  }

  const uid = input.userId ?? getCurrentUserId()
  const globalPluginSettings = await readMergedPluginUserSettings(pluginId, uid)

  return resolvePluginCompleteApiFromSources(input, {
    settings,
    conversationPluginApiConfigId,
    globalPluginApiConfigId: pluginSettingsApiConfigId(globalPluginSettings),
  })
}
