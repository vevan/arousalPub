import {
  ApiCredentialError,
  credentialInputFromBody,
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
  type ConversationChatBinding,
  type ResolvedConversationChatParams,
} from './conversation-api-settings.js'

type ChatBodyFallback = ResolveChatCredentialsInput & {
  alias?: string
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
  customParams?: Record<string, unknown>
}

export interface ResolvedConversationChatCall {
  baseUrl: string
  apiKey: string
  preset: ApiPreset
  presetId: string
  params: ResolvedConversationChatParams
  /** 会话磁盘绑定仅用于进房灌面板；发请求不再用磁盘采样覆盖 */
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
 * 会话对话凭证与采样：以请求体面板快照为准（同源）。
 * 不读会话磁盘上的采样覆盖；缺省 apiPresetId 时才回退全局 activePresetId。
 * 未落盘新预设：允许仅凭 body 草稿 Key + baseUrl + 采样发聊天。
 */
export async function resolveConversationChatCall(
  _conversationId: string,
  bodyFallback?: ChatBodyFallback,
): Promise<ResolvedConversationChatCall> {
  const creds = await resolveChatCredentials(
    bodyFallback ? credentialInputFromBody(bodyFallback) : {},
  )

  const preset =
    creds.preset ??
    panelSnapshotPresetFromBody(bodyFallback, creds.baseUrl, creds.presetId)
  if (!preset) {
    throw new ApiCredentialError('api_preset_not_found')
  }

  const params = mergePresetWithChatBinding(
    preset,
    bodyBindingFromFallback(bodyFallback),
  )
  if (bodyFallback?.model?.trim()) {
    params.model = bodyFallback.model.trim()
  }
  if (typeof bodyFallback?.requestReasoning === 'boolean') {
    params.requestReasoningChain = bodyFallback.requestReasoning
  }
  if (
    bodyFallback?.customParams &&
    typeof bodyFallback.customParams === 'object' &&
    !Array.isArray(bodyFallback.customParams)
  ) {
    params.customParamsJson = JSON.stringify(bodyFallback.customParams)
  }
  if (typeof bodyFallback?.alias === 'string' && bodyFallback.alias.trim()) {
    params.alias = bodyFallback.alias.trim()
  }

  return {
    baseUrl: creds.baseUrl,
    apiKey: creds.apiKey,
    preset,
    presetId: preset.id,
    params,
    usedConversationOverride: false,
  }
}

/** 连接面板未保存新预设：用请求体拼合成形 ApiPreset */
function panelSnapshotPresetFromBody(
  body: ChatBodyFallback | undefined,
  baseUrl: string,
  resolvedPresetId: string | null,
): ApiPreset | null {
  if (!body) return null
  const hasDraftCreds = Boolean(
    body.apiKey?.trim() || body.apiKeyId?.trim(),
  )
  if (!hasDraftCreds) return null
  if (!baseUrl.trim()) return null
  const id = (
    body.apiPresetId?.trim() ||
    resolvedPresetId?.trim() ||
    ''
  ).trim()
  if (!id) return null
  const breakers = Array.isArray(body.drySequenceBreakers)
    ? body.drySequenceBreakers.filter((x): x is string => typeof x === 'string')
    : []
  return {
    id,
    alias: typeof body.alias === 'string' ? body.alias : '',
    baseUrl,
    apiKey: '',
    model: typeof body.model === 'string' ? body.model : '',
    contextLength:
      body.contextLength === undefined ? null : body.contextLength,
    maxTokens: body.maxTokens === undefined ? null : body.maxTokens,
    stream: typeof body.stream === 'boolean' ? body.stream : false,
    temperature: body.temperature === undefined ? null : body.temperature,
    topP: body.topP === undefined ? null : body.topP,
    topK: body.topK === undefined ? null : body.topK,
    dryMultiplier:
      body.dryMultiplier === undefined ? null : body.dryMultiplier,
    dryBase: body.dryBase === undefined ? null : body.dryBase,
    dryAllowedLength:
      body.dryAllowedLength === undefined ? null : body.dryAllowedLength,
    dryPenaltyLastN:
      body.dryPenaltyLastN === undefined ? null : body.dryPenaltyLastN,
    drySequenceBreakers: breakers,
    frequencyPenalty:
      body.frequencyPenalty === undefined ? null : body.frequencyPenalty,
    presencePenalty:
      body.presencePenalty === undefined ? null : body.presencePenalty,
    customParamsJson:
      body.customParams && typeof body.customParams === 'object'
        ? JSON.stringify(body.customParams)
        : '',
    showReasoningChain: true,
    requestReasoningChain:
      typeof body.requestReasoning === 'boolean'
        ? body.requestReasoning
        : false,
    linkedPromptPresetId: null,
    apiKeyId: body.apiKeyId?.trim() || null,
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
