import {
  ApiCredentialError,
  resolveChatCredentials,
  type ResolveChatCredentialsInput,
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
  type ConversationChatBinding,
  type ResolvedConversationChatParams,
} from './conversation-api-settings.js'

type ChatBodyFallback = ResolveChatCredentialsInput & {
  model?: string
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
  drySequenceBreakers?: string[] | null
  frequencyPenalty?: number | null
  presencePenalty?: number | null
  requestReasoning?: boolean
}

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

export async function resolveConversationChatCall(
  conversationId: string,
  bodyFallback?: ChatBodyFallback,
): Promise<ResolvedConversationChatCall> {
  const idx = await readConversationIndex(conversationId)
  const binding = idx ? readConversationChatBinding(idx.apiPreset) : null
  const settings = await readApiSettingsFromFile()
  if (!settings) {
    throw new ApiCredentialError('api_credential_not_configured')
  }

  if (!binding) {
    const creds = await resolveChatCredentials({
      apiPresetId: bodyFallback?.apiPresetId,
      apiKeyId: bodyFallback?.apiKeyId,
      baseUrl: bodyFallback?.baseUrl,
    })
    if (!creds.preset) {
      throw new ApiCredentialError('api_preset_not_found')
    }
    const params = mergePresetWithChatBinding(
      creds.preset,
      bodyBindingFromFallback(bodyFallback),
    )
    if (bodyFallback?.model?.trim()) {
      params.model = bodyFallback.model.trim()
    }
    return {
      baseUrl: creds.baseUrl,
      apiKey: creds.apiKey,
      preset: creds.preset,
      presetId: creds.presetId ?? creds.preset.id,
      params,
      usedConversationOverride: false,
    }
  }

  const resolvedChat = resolveChatApiConfigId(settings, idx?.apiPreset)
  const presetId = (
    binding.apiConfigId?.trim() ||
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
    baseUrl: preset.baseUrl,
  })

  return {
    baseUrl: creds.baseUrl,
    apiKey: creds.apiKey,
    preset,
    presetId: preset.id,
    params: mergePresetWithChatBinding(preset, binding),
    usedConversationOverride: true,
  }
}

function bodyBindingFromFallback(
  body?: ChatBodyFallback,
): ConversationChatBinding | null {
  if (!body) return null
  const b: ConversationChatBinding = {}
  let any = false
  if (typeof body.model === 'string' && body.model.trim()) {
    b.model = body.model.trim()
    any = true
  }
  const numericKeys = [
    'contextLength',
    'maxTokens',
    'temperature',
    'topP',
    'topK',
    'dryMultiplier',
    'dryBase',
    'dryAllowedLength',
    'dryPenaltyLastN',
    'frequencyPenalty',
    'presencePenalty',
  ] as const
  for (const key of numericKeys) {
    if (Object.prototype.hasOwnProperty.call(body, key)) {
      ;(b as Record<string, unknown>)[key] = body[key]
      any = true
    }
  }
  if (typeof body.stream === 'boolean') {
    b.stream = body.stream
    any = true
  }
  if (Array.isArray(body.drySequenceBreakers)) {
    b.drySequenceBreakers = body.drySequenceBreakers.filter(
      (x): x is string => typeof x === 'string',
    )
    any = true
  }
  return any ? b : null
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
