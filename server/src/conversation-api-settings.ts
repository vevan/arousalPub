import type { ApiPreset } from './api-settings-file.js'
import {
  normalizeEmbeddingDimensions,
  type EmbeddingApiSettings,
} from './embedding-api-settings.js'

/** 对话 apiPreset.chat：仅 preset id + 采样参数，禁止连接字段 */
export interface ConversationChatParamOverrides {
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
  drySequenceBreakers?: string[]
  frequencyPenalty?: number | null
  presencePenalty?: number | null
  showReasoningChain?: boolean
  requestReasoningChain?: boolean
  customParamsJson?: string
}

export interface ConversationChatBinding extends ConversationChatParamOverrides {
  /** 已有 api-settings preset id；省略则继承全局 activePresetId */
  apiConfigId?: string
}

export type ConversationEmbeddingApiSettingsOverride = {
  embeddingModel?: string
  embeddingDimensions?: number | null
}

const FORBIDDEN_CHAT_BINDING_KEYS = new Set([
  'baseUrl',
  'apiKey',
  'apiKeyId',
  'alias',
  'id',
  'linkedPromptPresetId',
])

const CHAT_PARAM_KEYS = new Set<string>([
  'model',
  'contextLength',
  'maxTokens',
  'stream',
  'temperature',
  'topP',
  'topK',
  'dryMultiplier',
  'dryBase',
  'dryAllowedLength',
  'dryPenaltyLastN',
  'drySequenceBreakers',
  'frequencyPenalty',
  'presencePenalty',
  'showReasoningChain',
  'requestReasoningChain',
  'customParamsJson',
])

export function isConversationChatBindingEmpty(
  binding: ConversationChatBinding | null | undefined,
): boolean {
  if (!binding || typeof binding !== 'object') return true
  return !binding.apiConfigId?.trim() && !hasConversationChatParamOverrides(binding)
}

export function hasConversationChatBinding(
  raw: unknown,
): raw is ConversationChatBinding {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false
  return !isConversationChatBindingEmpty(raw as ConversationChatBinding)
}

export function hasConversationChatParamOverrides(
  binding: ConversationChatParamOverrides,
): boolean {
  for (const key of CHAT_PARAM_KEYS) {
    if (Object.prototype.hasOwnProperty.call(binding, key)) return true
  }
  return false
}

export function hasConversationEmbeddingApiOverride(
  raw?: ConversationEmbeddingApiSettingsOverride | null,
): boolean {
  return raw != null && typeof raw === 'object' && !Array.isArray(raw)
}

export function parseConversationChatBinding(
  raw: unknown,
): { ok: true; binding: ConversationChatBinding | null } | { ok: false; error: string } {
  if (raw === null || raw === undefined) {
    return { ok: true, binding: null }
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'conversation_api_preset_chat_invalid' }
  }
  const o = raw as Record<string, unknown>
  for (const key of Object.keys(o)) {
    if (FORBIDDEN_CHAT_BINDING_KEYS.has(key)) {
      return { ok: false, error: 'conversation_api_preset_forbidden_field' }
    }
    if (key !== 'apiConfigId' && !CHAT_PARAM_KEYS.has(key)) {
      return { ok: false, error: 'conversation_api_preset_unknown_field' }
    }
  }
  const binding: ConversationChatBinding = {}
  if (Object.prototype.hasOwnProperty.call(o, 'apiConfigId')) {
    if (typeof o.apiConfigId !== 'string' || !o.apiConfigId.trim()) {
      return { ok: false, error: 'conversation_api_preset_id_invalid' }
    }
    binding.apiConfigId = o.apiConfigId.trim()
  }
  if (Object.prototype.hasOwnProperty.call(o, 'model')) {
    if (typeof o.model !== 'string' || !o.model.trim()) {
      return { ok: false, error: 'conversation_api_preset_model_invalid' }
    }
    binding.model = o.model.trim()
  }
  if (Object.prototype.hasOwnProperty.call(o, 'contextLength')) {
    binding.contextLength = parseNullableNumber(o.contextLength)
  }
  if (Object.prototype.hasOwnProperty.call(o, 'maxTokens')) {
    binding.maxTokens = parseNullableNumber(o.maxTokens)
  }
  if (Object.prototype.hasOwnProperty.call(o, 'stream')) {
    if (typeof o.stream !== 'boolean') {
      return { ok: false, error: 'conversation_api_preset_stream_boolean' }
    }
    binding.stream = o.stream
  }
  if (Object.prototype.hasOwnProperty.call(o, 'temperature')) {
    binding.temperature = parseNullableNumber(o.temperature)
  }
  if (Object.prototype.hasOwnProperty.call(o, 'topP')) {
    binding.topP = parseNullableNumber(o.topP)
  }
  if (Object.prototype.hasOwnProperty.call(o, 'topK')) {
    binding.topK = parseNullableNumber(o.topK)
  }
  if (Object.prototype.hasOwnProperty.call(o, 'dryMultiplier')) {
    binding.dryMultiplier = parseNullableNumber(o.dryMultiplier)
  }
  if (Object.prototype.hasOwnProperty.call(o, 'dryBase')) {
    binding.dryBase = parseNullableNumber(o.dryBase)
  }
  if (Object.prototype.hasOwnProperty.call(o, 'dryAllowedLength')) {
    binding.dryAllowedLength = parseNullableNumber(o.dryAllowedLength)
  }
  if (Object.prototype.hasOwnProperty.call(o, 'dryPenaltyLastN')) {
    binding.dryPenaltyLastN = parseNullableNumber(o.dryPenaltyLastN)
  }
  if (Object.prototype.hasOwnProperty.call(o, 'drySequenceBreakers')) {
    if (!Array.isArray(o.drySequenceBreakers)) {
      return { ok: false, error: 'conversation_api_preset_dry_breakers_array' }
    }
    binding.drySequenceBreakers = o.drySequenceBreakers.filter(
      (x): x is string => typeof x === 'string',
    )
  }
  if (Object.prototype.hasOwnProperty.call(o, 'frequencyPenalty')) {
    binding.frequencyPenalty = parseNullableNumber(o.frequencyPenalty)
  }
  if (Object.prototype.hasOwnProperty.call(o, 'presencePenalty')) {
    binding.presencePenalty = parseNullableNumber(o.presencePenalty)
  }
  if (Object.prototype.hasOwnProperty.call(o, 'showReasoningChain')) {
    if (typeof o.showReasoningChain !== 'boolean') {
      return { ok: false, error: 'conversation_api_preset_reasoning_boolean' }
    }
    binding.showReasoningChain = o.showReasoningChain
  }
  if (Object.prototype.hasOwnProperty.call(o, 'requestReasoningChain')) {
    if (typeof o.requestReasoningChain !== 'boolean') {
      return { ok: false, error: 'conversation_api_preset_reasoning_boolean' }
    }
    binding.requestReasoningChain = o.requestReasoningChain
  }
  if (Object.prototype.hasOwnProperty.call(o, 'customParamsJson')) {
    if (typeof o.customParamsJson !== 'string') {
      return { ok: false, error: 'conversation_api_preset_custom_params_string' }
    }
    binding.customParamsJson = o.customParamsJson
  }
  if (isConversationChatBindingEmpty(binding)) {
    return { ok: true, binding: null }
  }
  return { ok: true, binding }
}

function parseNullableNumber(v: unknown): number | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'number' && Number.isFinite(v)) return v
  return null
}

export function parseConversationEmbeddingApiOverride(
  raw: unknown,
): { ok: true; patch: ConversationEmbeddingApiSettingsOverride | null } | { ok: false; error: string } {
  if (raw === null || raw === undefined) {
    return { ok: true, patch: null }
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'conversation_embedding_api_invalid' }
  }
  const o = raw as Record<string, unknown>
  for (const key of Object.keys(o)) {
    if (key !== 'embeddingModel' && key !== 'embeddingDimensions') {
      return { ok: false, error: 'conversation_embedding_api_forbidden_field' }
    }
  }
  const patch: ConversationEmbeddingApiSettingsOverride = {}
  if (Object.prototype.hasOwnProperty.call(o, 'embeddingModel')) {
    if (typeof o.embeddingModel !== 'string' || !o.embeddingModel.trim()) {
      return { ok: false, error: 'embedding_api_embedding_model_string' }
    }
    patch.embeddingModel = o.embeddingModel.trim()
  }
  if (Object.prototype.hasOwnProperty.call(o, 'embeddingDimensions')) {
    patch.embeddingDimensions = normalizeEmbeddingDimensions(o.embeddingDimensions)
  }
  if (Object.keys(o).length === 0) {
    return { ok: true, patch: {} }
  }
  if (Object.keys(patch).length === 0) {
    return { ok: true, patch: null }
  }
  return { ok: true, patch }
}

export function resolveConversationEmbeddingModelSettings(
  global: EmbeddingApiSettings,
  override?: ConversationEmbeddingApiSettingsOverride | null,
): Pick<EmbeddingApiSettings, 'embeddingModel' | 'embeddingDimensions'> {
  const g = global
  if (!override || typeof override !== 'object') {
    return {
      embeddingModel: g.embeddingModel,
      embeddingDimensions: g.embeddingDimensions,
    }
  }
  return {
    embeddingModel:
      typeof override.embeddingModel === 'string' && override.embeddingModel.trim()
        ? override.embeddingModel.trim()
        : g.embeddingModel,
    embeddingDimensions: Object.prototype.hasOwnProperty.call(
      override,
      'embeddingDimensions',
    )
      ? normalizeEmbeddingDimensions(override.embeddingDimensions)
      : g.embeddingDimensions,
  }
}

export function conversationEmbeddingOverrideFromEffective(
  effective: Pick<EmbeddingApiSettings, 'embeddingModel' | 'embeddingDimensions'>,
  global: EmbeddingApiSettings,
): ConversationEmbeddingApiSettingsOverride | undefined {
  const o: ConversationEmbeddingApiSettingsOverride = {}
  if (effective.embeddingModel !== global.embeddingModel) {
    o.embeddingModel = effective.embeddingModel
  }
  if (effective.embeddingDimensions !== global.embeddingDimensions) {
    o.embeddingDimensions = effective.embeddingDimensions
  }
  return Object.keys(o).length > 0 ? o : undefined
}

export interface ResolvedConversationChatParams {
  apiPresetId: string
  alias: string
  model: string
  contextLength: number | null
  maxTokens: number | null
  stream: boolean
  temperature: number | null
  topP: number | null
  topK: number | null
  dryMultiplier: number | null
  dryBase: number | null
  dryAllowedLength: number | null
  dryPenaltyLastN: number | null
  drySequenceBreakers: string[]
  frequencyPenalty: number | null
  presencePenalty: number | null
  showReasoningChain: boolean
  requestReasoningChain: boolean
  customParamsJson: string
}

export function mergePresetWithChatBinding(
  preset: ApiPreset,
  binding?: ConversationChatBinding | null,
): ResolvedConversationChatParams {
  const b = binding ?? {}
  const breakers =
    b.drySequenceBreakers !== undefined
      ? b.drySequenceBreakers
      : preset.drySequenceBreakers
  return {
    apiPresetId: preset.id,
    alias: preset.alias,
    model: b.model?.trim() || preset.model,
    contextLength:
      b.contextLength !== undefined ? b.contextLength : preset.contextLength,
    maxTokens: b.maxTokens !== undefined ? b.maxTokens : preset.maxTokens,
    stream: b.stream !== undefined ? b.stream : preset.stream,
    temperature:
      b.temperature !== undefined ? b.temperature : preset.temperature,
    topP: b.topP !== undefined ? b.topP : preset.topP,
    topK: b.topK !== undefined ? b.topK : preset.topK,
    dryMultiplier:
      b.dryMultiplier !== undefined ? b.dryMultiplier : preset.dryMultiplier,
    dryBase: b.dryBase !== undefined ? b.dryBase : preset.dryBase,
    dryAllowedLength:
      b.dryAllowedLength !== undefined
        ? b.dryAllowedLength
        : preset.dryAllowedLength,
    dryPenaltyLastN:
      b.dryPenaltyLastN !== undefined
        ? b.dryPenaltyLastN
        : preset.dryPenaltyLastN,
    drySequenceBreakers: Array.isArray(breakers) ? breakers : [],
    frequencyPenalty:
      b.frequencyPenalty !== undefined
        ? b.frequencyPenalty
        : preset.frequencyPenalty,
    presencePenalty:
      b.presencePenalty !== undefined
        ? b.presencePenalty
        : preset.presencePenalty,
    showReasoningChain:
      b.showReasoningChain !== undefined
        ? b.showReasoningChain
        : preset.showReasoningChain,
    requestReasoningChain:
      b.requestReasoningChain !== undefined
        ? b.requestReasoningChain
        : preset.requestReasoningChain,
    customParamsJson:
      b.customParamsJson !== undefined
        ? b.customParamsJson
        : preset.customParamsJson,
  }
}

export function chatBindingOverrideFromEffective(
  preset: ApiPreset,
  effective: ResolvedConversationChatParams,
  apiConfigId?: string,
): ConversationChatBinding | undefined {
  const binding: ConversationChatBinding = {}
  if (apiConfigId?.trim()) {
    binding.apiConfigId = apiConfigId.trim()
  }
  if (effective.model !== preset.model) binding.model = effective.model
  if (effective.contextLength !== preset.contextLength) {
    binding.contextLength = effective.contextLength
  }
  if (effective.maxTokens !== preset.maxTokens) {
    binding.maxTokens = effective.maxTokens
  }
  if (effective.stream !== preset.stream) binding.stream = effective.stream
  if (effective.temperature !== preset.temperature) {
    binding.temperature = effective.temperature
  }
  if (effective.topP !== preset.topP) binding.topP = effective.topP
  if (effective.topK !== preset.topK) binding.topK = effective.topK
  if (effective.dryMultiplier !== preset.dryMultiplier) {
    binding.dryMultiplier = effective.dryMultiplier
  }
  if (effective.dryBase !== preset.dryBase) binding.dryBase = effective.dryBase
  if (effective.dryAllowedLength !== preset.dryAllowedLength) {
    binding.dryAllowedLength = effective.dryAllowedLength
  }
  if (effective.dryPenaltyLastN !== preset.dryPenaltyLastN) {
    binding.dryPenaltyLastN = effective.dryPenaltyLastN
  }
  if (
    JSON.stringify(effective.drySequenceBreakers) !==
    JSON.stringify(preset.drySequenceBreakers)
  ) {
    binding.drySequenceBreakers = [...effective.drySequenceBreakers]
  }
  if (effective.frequencyPenalty !== preset.frequencyPenalty) {
    binding.frequencyPenalty = effective.frequencyPenalty
  }
  if (effective.presencePenalty !== preset.presencePenalty) {
    binding.presencePenalty = effective.presencePenalty
  }
  if (effective.showReasoningChain !== preset.showReasoningChain) {
    binding.showReasoningChain = effective.showReasoningChain
  }
  if (effective.requestReasoningChain !== preset.requestReasoningChain) {
    binding.requestReasoningChain = effective.requestReasoningChain
  }
  if (effective.customParamsJson !== preset.customParamsJson) {
    binding.customParamsJson = effective.customParamsJson
  }
  if (isConversationChatBindingEmpty(binding)) return undefined
  return binding
}

/** 显式覆盖时保留快照（与 preset 相同也不删），避免被误判为继承全局 */
export function conversationChatBindingSnapshot(
  preset: ApiPreset,
  effective: ResolvedConversationChatParams,
  patch: ConversationChatBinding,
): ConversationChatBinding {
  const configId = patch.apiConfigId?.trim() || preset.id
  return {
    apiConfigId: configId,
    model: effective.model,
    contextLength: effective.contextLength,
    maxTokens: effective.maxTokens,
    stream: effective.stream,
    temperature: effective.temperature,
    topP: effective.topP,
    topK: effective.topK,
    dryMultiplier: effective.dryMultiplier,
    dryBase: effective.dryBase,
    dryAllowedLength: effective.dryAllowedLength,
    dryPenaltyLastN: effective.dryPenaltyLastN,
    drySequenceBreakers: [...effective.drySequenceBreakers],
    frequencyPenalty: effective.frequencyPenalty,
    presencePenalty: effective.presencePenalty,
    showReasoningChain: effective.showReasoningChain,
    requestReasoningChain: effective.requestReasoningChain,
    customParamsJson: effective.customParamsJson,
  }
}

export function readConversationChatBinding(
  apiPreset: unknown,
): ConversationChatBinding | null {
  if (!apiPreset || typeof apiPreset !== 'object' || Array.isArray(apiPreset)) {
    return null
  }
  const chat = (apiPreset as { chat?: unknown }).chat
  const parsed = parseConversationChatBinding(chat)
  if (!parsed.ok) return null
  return parsed.binding
}
