import { ApiCredentialError, resolveChatCredentials } from './api-credential-resolve.js'
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
  isConversationChatBindingEmpty,
  mergePresetWithChatBinding,
  readConversationChatBinding,
  type ConversationChatBinding,
  type ResolvedConversationChatParams,
} from './conversation-api-settings.js'

export interface ResolvedConversationChatCall {
  baseUrl: string
  apiKey: string
  preset: ApiPreset
  presetId: string
  params: ResolvedConversationChatParams
  /** 会话磁盘存在非空 apiPreset.chat 覆盖 */
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
 * 会话对话凭证与采样只从持久化的全局预设与会话覆盖解析。
 */
export async function resolveConversationChatCall(
  conversationId: string,
): Promise<ResolvedConversationChatCall> {
  const cid = typeof conversationId === 'string' ? conversationId.trim() : ''
  let diskBinding: ConversationChatBinding | null = null
  if (cid) {
    const idx = await readConversationIndex(cid)
    diskBinding = readConversationChatBinding(idx?.apiPreset)
  }
  const usedConversationOverride =
    !diskBinding?.inheritGlobal && !isConversationChatBindingEmpty(diskBinding)

  const diskPresetId = usedConversationOverride
    ? diskBinding?.apiConfigId?.trim() || ''
    : ''
  const creds = await resolveChatCredentials(
    diskPresetId ? { apiPresetId: diskPresetId } : {},
  )
  const preset = creds.preset
  if (!preset) {
    throw new ApiCredentialError('api_preset_not_found')
  }
  const params = mergePresetWithChatBinding(
    preset,
    usedConversationOverride ? diskBinding : null,
  )

  return {
    baseUrl: creds.baseUrl,
    apiKey: creds.apiKey,
    preset,
    presetId: preset.id,
    params,
    usedConversationOverride,
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
