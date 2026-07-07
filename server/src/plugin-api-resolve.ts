import { readApiSettingsFromFile } from './api-settings-file.js'
import { readConversationIndex } from './chat-storage.js'
import {
  resolveChatApiConfigId,
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
  /** 插件未绑定时回退到会话/全局 chat API（`fallbackToChat`） */
  fallbackToChat?: boolean
}

export type ResolvePluginCompleteApiResult =
  | { ok: true; resolved: ResolvedFeatureApi }
  | { ok: false; code: 'api_config_not_found' }

export interface ResolvePluginCompleteApiSources {
  settings: Awaited<ReturnType<typeof readApiSettingsFromFile>>
  conversationApiPreset?: unknown
  pluginSettings: Record<string, unknown>
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
    conversationApiPreset: sources.conversationApiPreset,
    pluginSettingsApiConfigId: pluginSettingsApiConfigId(sources.pluginSettings),
  })
  if (resolved) {
    return { ok: true, resolved }
  }

  if (input.fallbackToChat) {
    const chatMeta = resolveChatApiConfigId(settings, sources.conversationApiPreset)
    if (chatMeta) {
      const preset =
        settings.presets.find((p) => p.id === chatMeta.apiConfigId) ?? null
      if (preset) {
        const model = chatMeta.modelOverride?.trim() || preset.model
        return {
          ok: true,
          resolved: {
            featureType: 'plugin',
            featureRefId: pluginId,
            pluginId,
            apiConfigId: chatMeta.apiConfigId,
            modelOverride: chatMeta.modelOverride,
            source: chatMeta.source,
            preset,
            model,
          },
        }
      }
    }
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

  let conversationApiPreset: unknown
  const convId =
    typeof input.conversationId === 'string' ? input.conversationId.trim() : ''
  if (convId) {
    const idx = await readConversationIndex(convId)
    conversationApiPreset = idx?.apiPreset
  }

  const uid = input.userId ?? getCurrentUserId()
  const pluginSettings = await readMergedPluginUserSettings(pluginId, uid)

  return resolvePluginCompleteApiFromSources(input, {
    settings,
    conversationApiPreset,
    pluginSettings,
  })
}
