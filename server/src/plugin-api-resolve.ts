import { readApiSettingsFromFile } from './api-settings-file.js'
import { readConversationIndex } from './chat-storage.js'
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
}

export type ResolvePluginCompleteApiResult =
  | { ok: true; resolved: ResolvedFeatureApi }
  | { ok: false; code: 'api_config_not_found' }

function pluginSettingsApiConfigId(
  settings: Record<string, unknown>,
): string | null {
  const id = settings.apiConfigId
  return typeof id === 'string' && id.trim() ? id.trim() : null
}

export async function resolvePluginCompleteApi(
  input: ResolvePluginCompleteApiInput,
): Promise<ResolvePluginCompleteApiResult> {
  const pluginId = input.pluginId.trim()
  if (!pluginId) {
    return { ok: false, code: 'api_config_not_found' }
  }

  const explicit =
    typeof input.apiConfigId === 'string' ? input.apiConfigId.trim() : ''
  if (explicit) {
    const settings = await readApiSettingsFromFile()
    const preset = settings?.presets.find((p) => p.id === explicit) ?? null
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

  const settings = await readApiSettingsFromFile()
  if (!settings) {
    return { ok: false, code: 'api_config_not_found' }
  }

  let conversationApiPreset: unknown
  const convId =
    typeof input.conversationId === 'string' ? input.conversationId.trim() : ''
  if (convId) {
    const idx = await readConversationIndex(convId)
    conversationApiPreset = idx?.apiPreset
  }

  const uid = input.userId ?? getCurrentUserId()
  const pluginSettings = await readMergedPluginUserSettings(pluginId, uid)

  const resolved = resolvePluginFeatureApi(settings, pluginId, {
    conversationApiPreset,
    pluginSettingsApiConfigId: pluginSettingsApiConfigId(pluginSettings),
  })
  if (!resolved) {
    return { ok: false, code: 'api_config_not_found' }
  }
  return { ok: true, resolved }
}
