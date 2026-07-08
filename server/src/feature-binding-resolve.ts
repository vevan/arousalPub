import { extractApiConfigIdFromBinding } from './api-config-references.js'
import type { ApiPreset, ApiSettingsDocument } from './api-settings-file.js'
import { readConversationChatBinding } from './conversation-api-settings.js'

export const FEATURE_TYPES = ['chat', 'rag_generate', 'rerank'] as const
export type FeatureType = (typeof FEATURE_TYPES)[number]

export type ResolvedFeatureSource =
  | 'conversation'
  | 'global'
  | 'plugin_settings'

export type ResolvedFeatureType = FeatureType | 'plugin'

export interface ResolvedFeatureBinding {
  featureType: ResolvedFeatureType
  featureRefId: string
  pluginId?: string
  apiConfigId: string
  modelOverride?: string
  source: ResolvedFeatureSource
}

export interface ResolvedFeatureApi extends ResolvedFeatureBinding {
  preset: ApiPreset
  model: string
}

/** 落盘 / 组装预览审计字段（不含 preset 与密钥） */
export interface ResolvedFeatureAudit {
  featureType: ResolvedFeatureType
  apiConfigId: string
  source: ResolvedFeatureSource
  pluginId?: string
  model?: string
}

export function toResolvedFeatureAudit(
  meta: ResolvedFeatureBinding | ResolvedFeatureApi,
): ResolvedFeatureAudit {
  const audit: ResolvedFeatureAudit = {
    featureType: meta.featureType,
    apiConfigId: meta.apiConfigId,
    source: meta.source,
  }
  if (meta.pluginId?.trim()) {
    audit.pluginId = meta.pluginId.trim()
  }
  if ('model' in meta && typeof meta.model === 'string' && meta.model.trim()) {
    audit.model = meta.model.trim()
  } else if (meta.modelOverride?.trim()) {
    audit.model = meta.modelOverride.trim()
  }
  return audit
}

const NON_PLUGIN_GLOBAL_REF = 'global'

function conversationFeatureKey(featureType: FeatureType): string {
  if (featureType === 'rag_generate') return 'rag'
  return featureType
}

function readConversationFeatureBinding(
  apiPreset: unknown,
  featureType: FeatureType,
): { apiConfigId: string; modelOverride?: string } | null {
  if (!apiPreset || typeof apiPreset !== 'object' || Array.isArray(apiPreset)) {
    return null
  }
  const o = apiPreset as Record<string, unknown>

  if (featureType === 'chat') {
    const binding = readConversationChatBinding(apiPreset)
    if (!binding?.apiConfigId?.trim()) return null
    return { apiConfigId: binding.apiConfigId.trim() }
  }

  const key = conversationFeatureKey(featureType)
  const id = extractApiConfigIdFromBinding(o[key])
  if (!id) return null
  const raw = o[key]
  const modelOverride =
    raw &&
    typeof raw === 'object' &&
    !Array.isArray(raw) &&
    typeof (raw as { modelOverride?: unknown }).modelOverride === 'string'
      ? (raw as { modelOverride: string }).modelOverride.trim() || undefined
      : undefined
  return { apiConfigId: id, modelOverride }
}

export type ResolvePluginFeatureBindingOptions = {
  /** 对话 pluginSettings.apiConfigId（插件 Tab） */
  conversationPluginApiConfigId?: string | null
  /** 全局 plugins/{id}/settings.json apiConfigId */
  globalPluginApiConfigId?: string | null
  /** 未绑定时回退全局 activePresetId；默认 true */
  fallbackToGlobalDefault?: boolean
}

export function resolveFeatureBindingMeta(
  settings: Pick<ApiSettingsDocument, 'activePresetId'>,
  featureType: FeatureType,
  options?: {
    conversationApiPreset?: unknown
  },
): ResolvedFeatureBinding | null {
  const fromConversation = readConversationFeatureBinding(
    options?.conversationApiPreset,
    featureType,
  )

  if (fromConversation) {
    return {
      featureType,
      featureRefId: NON_PLUGIN_GLOBAL_REF,
      apiConfigId: fromConversation.apiConfigId,
      modelOverride: fromConversation.modelOverride,
      source: 'conversation',
    }
  }

  if (featureType === 'chat') {
    const active = settings.activePresetId?.trim()
    if (active) {
      return {
        featureType: 'chat',
        featureRefId: NON_PLUGIN_GLOBAL_REF,
        apiConfigId: active,
        source: 'global',
      }
    }
  }

  return null
}

export function resolveChatApiConfigId(
  settings: Pick<ApiSettingsDocument, 'activePresetId'>,
  conversationApiPreset?: unknown,
): ResolvedFeatureBinding | null {
  return resolveFeatureBindingMeta(settings, 'chat', { conversationApiPreset })
}

export function resolvePluginFeatureBindingMeta(
  settings: Pick<ApiSettingsDocument, 'activePresetId'>,
  pluginId: string,
  options?: ResolvePluginFeatureBindingOptions,
): ResolvedFeatureBinding | null {
  const pid = pluginId.trim()
  if (!pid) return null

  const convId = options?.conversationPluginApiConfigId?.trim()
  if (convId) {
    return {
      featureType: 'plugin',
      featureRefId: pid,
      pluginId: pid,
      apiConfigId: convId,
      source: 'conversation',
    }
  }

  const globalId = options?.globalPluginApiConfigId?.trim()
  if (globalId) {
    return {
      featureType: 'plugin',
      featureRefId: pid,
      pluginId: pid,
      apiConfigId: globalId,
      source: 'plugin_settings',
    }
  }

  if (options?.fallbackToGlobalDefault === false) {
    return null
  }

  const active = settings.activePresetId?.trim()
  if (active) {
    return {
      featureType: 'plugin',
      featureRefId: pid,
      pluginId: pid,
      apiConfigId: active,
      source: 'global',
    }
  }

  return null
}

export function resolveFeatureApi(
  settings: ApiSettingsDocument,
  featureType: FeatureType,
  options?: {
    conversationApiPreset?: unknown
  },
): ResolvedFeatureApi | null {
  const meta = resolveFeatureBindingMeta(settings, featureType, options)
  if (!meta) return null
  const preset = settings.presets.find((p) => p.id === meta.apiConfigId) ?? null
  if (!preset) return null
  const model = meta.modelOverride?.trim() || preset.model
  return { ...meta, preset, model }
}

export function resolvePluginFeatureApi(
  settings: ApiSettingsDocument,
  pluginId: string,
  options?: ResolvePluginFeatureBindingOptions,
): ResolvedFeatureApi | null {
  const meta = resolvePluginFeatureBindingMeta(settings, pluginId, options)
  if (!meta) return null
  const preset = settings.presets.find((p) => p.id === meta.apiConfigId) ?? null
  if (!preset) return null
  const model = meta.modelOverride?.trim() || preset.model
  return { ...meta, preset, model }
}
