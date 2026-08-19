import {
  ApiCredentialError,
  resolveChatCredentials,
} from './api-credential-resolve.js'
import {
  readApiSettingsFromFile,
  type ApiPreset,
} from './api-settings-file.js'
import {
  resolveChatApiConfigId,
  toResolvedFeatureAudit,
  type ResolvedFeatureAudit,
} from './feature-binding-resolve.js'
import { readConversationIndex } from './chat-storage.js'
import {
  mergePresetWithChatBinding,
  readConversationChatBinding,
  type ResolvedConversationChatParams,
} from './conversation-api-settings.js'

export interface ResolvedConversationChatCall {
  baseUrl: string
  apiKey: string
  preset: ApiPreset
  presetId: string
  params: ResolvedConversationChatParams
  usedConversationOverride: boolean
}

export async function resolveChatFeatureAudit(
  conversationId?: string,
): Promise<ResolvedFeatureAudit | undefined> {
  const settings = await readApiSettingsFromFile()
  if (!settings) return undefined
  let conversationApiPreset: unknown
  const cid = typeof conversationId === 'string' ? conversationId.trim() : ''
  if (cid) {
    const idx = await readConversationIndex(cid)
    conversationApiPreset = idx?.apiPreset
  }
  const meta = resolveChatApiConfigId(settings, conversationApiPreset)
  return meta ? toResolvedFeatureAudit(meta) : undefined
}

/**
 * 会话对话凭证与采样参数：仅来自磁盘上的全局 activePresetId + 会话 apiPreset.chat 绑定。
 * 故意忽略请求体中的 baseUrl / apiKeyId / model / 采样字段，避免设置页「编辑中预设」与激活预设混搭。
 */
export async function resolveConversationChatCall(
  conversationId: string,
): Promise<ResolvedConversationChatCall> {
  const idx = await readConversationIndex(conversationId)
  const binding = idx ? readConversationChatBinding(idx.apiPreset) : null
  const settings = await readApiSettingsFromFile()
  if (!settings) {
    throw new ApiCredentialError('api_credential_not_configured')
  }

  const resolvedChat = resolveChatApiConfigId(settings, idx?.apiPreset)
  const presetId = (
    binding?.apiConfigId?.trim() ||
    resolvedChat?.apiConfigId ||
    settings.activePresetId ||
    ''
  ).trim()
  const preset = settings.presets.find((p) => p.id === presetId) ?? null
  if (!preset) {
    throw new ApiCredentialError('api_preset_not_found')
  }

  const creds = await resolveChatCredentials({
    apiPresetId: presetId,
  })

  return {
    baseUrl: creds.baseUrl,
    apiKey: creds.apiKey,
    preset,
    presetId: preset.id,
    params: mergePresetWithChatBinding(preset, binding),
    usedConversationOverride: Boolean(binding),
  }
}

export function resolvedParamsToChatBodyFields(
  params: ResolvedConversationChatParams,
): {
  model: string
  contextLength?: number | null
  maxTokens?: number | null
  stream?: boolean
  temperature?: number | null
  topP?: number | null
  topK?: number | null
  dryMultiplier?: number | null
  dryBase?: number | null
  dryAllowedLength?: number | null
  dryPenaltyLastN?: number | null
  drySequenceBreakers?: string[]
  frequencyPenalty?: number | null
  presencePenalty?: number | null
  requestReasoning?: boolean
  customParams?: Record<string, unknown>
} {
  let customParams: Record<string, unknown> | undefined
  if (params.customParamsJson.trim()) {
    try {
      const parsed = JSON.parse(params.customParamsJson) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        customParams = parsed as Record<string, unknown>
      }
    } catch {
      /* ignore invalid json */
    }
  }
  return {
    model: params.model,
    contextLength: params.contextLength,
    maxTokens: params.maxTokens,
    stream: params.stream,
    temperature: params.temperature,
    topP: params.topP,
    topK: params.topK,
    dryMultiplier: params.dryMultiplier,
    dryBase: params.dryBase,
    dryAllowedLength: params.dryAllowedLength,
    dryPenaltyLastN: params.dryPenaltyLastN,
    drySequenceBreakers: params.drySequenceBreakers,
    frequencyPenalty: params.frequencyPenalty,
    presencePenalty: params.presencePenalty,
    requestReasoning: params.requestReasoningChain,
    customParams,
  }
}
