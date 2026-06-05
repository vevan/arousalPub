import type { ApiPreset } from '@/stores/connection'

import {

  normalizeEmbeddingDimensions,

  type EmbeddingApiSettings,

} from '@/utils/embedding-api-settings'



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

  apiConfigId?: string

}



export type ConversationEmbeddingApiSettingsOverride = {

  embeddingModel?: string

  embeddingDimensions?: number | null

}



export interface ResolvedConversationChatDisplay {

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



export function readConversationChatBinding(

  apiPreset: unknown,

): ConversationChatBinding | null {

  if (!apiPreset || typeof apiPreset !== 'object' || Array.isArray(apiPreset)) {

    return null

  }

  const chat = (apiPreset as { chat?: unknown }).chat

  if (!chat || typeof chat !== 'object' || Array.isArray(chat)) return null

  return chat as ConversationChatBinding

}



export function hasConversationChatOverride(apiPreset: unknown): boolean {

  const b = readConversationChatBinding(apiPreset)

  if (!b) return false

  return Boolean(b.apiConfigId?.trim()) || hasChatParamOverrides(b)

}



export function hasChatParamOverrides(b: ConversationChatParamOverrides): boolean {

  return (

    b.model !== undefined ||

    b.contextLength !== undefined ||

    b.maxTokens !== undefined ||

    b.stream !== undefined ||

    b.temperature !== undefined ||

    b.topP !== undefined ||

    b.topK !== undefined ||

    b.dryMultiplier !== undefined ||

    b.dryBase !== undefined ||

    b.dryAllowedLength !== undefined ||

    b.dryPenaltyLastN !== undefined ||

    b.drySequenceBreakers !== undefined ||

    b.frequencyPenalty !== undefined ||

    b.presencePenalty !== undefined ||

    b.showReasoningChain !== undefined ||

    b.requestReasoningChain !== undefined ||

    b.customParamsJson !== undefined

  )

}



export function hasConversationEmbeddingOverride(

  raw?: ConversationEmbeddingApiSettingsOverride | null,

): boolean {

  return raw != null && typeof raw === 'object' && !Array.isArray(raw)

}



export function readConversationEmbeddingOverride(

  idx: Record<string, unknown>,

): ConversationEmbeddingApiSettingsOverride | undefined {

  const raw = idx.embeddingApiSettings

  if (!hasConversationEmbeddingOverride(raw as ConversationEmbeddingApiSettingsOverride)) {

    return undefined

  }

  return raw as ConversationEmbeddingApiSettingsOverride

}



export function resolveConversationEmbeddingModelSettings(

  global: Pick<EmbeddingApiSettings, 'embeddingModel' | 'embeddingDimensions'>,

  override?: ConversationEmbeddingApiSettingsOverride | null,

): Pick<EmbeddingApiSettings, 'embeddingModel' | 'embeddingDimensions'> {

  if (!override) {

    return {

      embeddingModel: global.embeddingModel,

      embeddingDimensions: global.embeddingDimensions,

    }

  }

  return {

    embeddingModel:

      typeof override.embeddingModel === 'string' && override.embeddingModel.trim()

        ? override.embeddingModel.trim()

        : global.embeddingModel,

    embeddingDimensions: Object.prototype.hasOwnProperty.call(

      override,

      'embeddingDimensions',

    )

      ? normalizeEmbeddingDimensions(override.embeddingDimensions)

      : global.embeddingDimensions,

  }

}



export function mergePresetWithChatBinding(

  preset: ApiPreset,

  binding?: ConversationChatBinding | null,

): ResolvedConversationChatDisplay {

  const b = binding ?? {}

  const breakers =

    b.drySequenceBreakers !== undefined

      ? b.drySequenceBreakers

      : preset.drySequenceBreakers

  return {

    apiPresetId: b.apiConfigId?.trim() || preset.id,

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



export function resolveConversationChatDisplay(

  presets: ApiPreset[],

  activePresetId: string | null,

  apiPreset: unknown,

): ResolvedConversationChatDisplay | null {

  const binding = readConversationChatBinding(apiPreset)

  const baseId = activePresetId ?? presets[0]?.id ?? ''

  const presetId = binding?.apiConfigId?.trim() || baseId

  const preset = presets.find((p) => p.id === presetId) ?? presets[0]

  if (!preset) return null

  return mergePresetWithChatBinding(preset, binding)

}



function chatParamDiffFromPreset(

  preset: ApiPreset,

  effective: ResolvedConversationChatDisplay,

): ConversationChatBinding {

  const onlyParams: ConversationChatBinding = {}

  if (effective.model !== preset.model) onlyParams.model = effective.model

  if (effective.contextLength !== preset.contextLength) {

    onlyParams.contextLength = effective.contextLength

  }

  if (effective.maxTokens !== preset.maxTokens) {

    onlyParams.maxTokens = effective.maxTokens

  }

  if (effective.stream !== preset.stream) onlyParams.stream = effective.stream

  if (effective.temperature !== preset.temperature) {

    onlyParams.temperature = effective.temperature

  }

  if (effective.topP !== preset.topP) onlyParams.topP = effective.topP

  if (effective.topK !== preset.topK) onlyParams.topK = effective.topK

  if (effective.dryMultiplier !== preset.dryMultiplier) {

    onlyParams.dryMultiplier = effective.dryMultiplier

  }

  if (effective.dryBase !== preset.dryBase) onlyParams.dryBase = effective.dryBase

  if (effective.dryAllowedLength !== preset.dryAllowedLength) {

    onlyParams.dryAllowedLength = effective.dryAllowedLength

  }

  if (effective.dryPenaltyLastN !== preset.dryPenaltyLastN) {

    onlyParams.dryPenaltyLastN = effective.dryPenaltyLastN

  }

  if (

    JSON.stringify(effective.drySequenceBreakers) !==

    JSON.stringify(preset.drySequenceBreakers)

  ) {

    onlyParams.drySequenceBreakers = [...effective.drySequenceBreakers]

  }

  if (effective.frequencyPenalty !== preset.frequencyPenalty) {

    onlyParams.frequencyPenalty = effective.frequencyPenalty

  }

  if (effective.presencePenalty !== preset.presencePenalty) {

    onlyParams.presencePenalty = effective.presencePenalty

  }

  if (effective.showReasoningChain !== preset.showReasoningChain) {

    onlyParams.showReasoningChain = effective.showReasoningChain

  }

  if (effective.requestReasoningChain !== preset.requestReasoningChain) {

    onlyParams.requestReasoningChain = effective.requestReasoningChain

  }

  if (effective.customParamsJson !== preset.customParamsJson) {

    onlyParams.customParamsJson = effective.customParamsJson

  }

  return onlyParams

}



export function buildChatBindingPatch(

  preset: ApiPreset,

  effective: ResolvedConversationChatDisplay,

  useGlobalPreset: boolean,

): ConversationChatBinding | null {

  const paramDiff = chatParamDiffFromPreset(preset, effective)

  if (useGlobalPreset && effective.apiPresetId === preset.id) {

    return hasChatParamOverrides(paramDiff) ? paramDiff : null

  }

  const binding: ConversationChatBinding = {

    apiConfigId: effective.apiPresetId,

    ...paramDiff,

  }

  return binding

}



export function optionalNumToField(v: number | null | undefined): number | '' {

  return v === null || v === undefined ? '' : v

}


