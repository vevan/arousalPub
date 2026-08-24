import type { ResolvedConversationChatDisplay } from '@/utils/conversation-api-settings'

export type ConnectionFormSnapshot = {
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
  customParamsJson: string
  showReasoningChain: boolean
  requestReasoningChain: boolean
}

export function resolveHydrationPresetId(
  presetIds: readonly string[],
  preferredId: string | null,
  fallbackPresetId: string | null,
): string | null {
  if (presetIds.length === 0) return null
  const has = (id: string | null | undefined): id is string =>
    Boolean(id && presetIds.includes(id))
  if (has(preferredId)) return preferredId
  if (has(fallbackPresetId)) return fallbackPresetId
  return presetIds[0] ?? null
}

export function chatDisplayToConnectionSnapshot(
  display: ResolvedConversationChatDisplay,
): ConnectionFormSnapshot {
  return {
    model: display.model,
    contextLength: display.contextLength,
    maxTokens: display.maxTokens,
    stream: display.stream,
    temperature: display.temperature,
    topP: display.topP,
    topK: display.topK,
    dryMultiplier: display.dryMultiplier,
    dryBase: display.dryBase,
    dryAllowedLength: display.dryAllowedLength,
    dryPenaltyLastN: display.dryPenaltyLastN,
    drySequenceBreakers: display.drySequenceBreakers,
    frequencyPenalty: display.frequencyPenalty,
    presencePenalty: display.presencePenalty,
    customParamsJson: display.customParamsJson,
    showReasoningChain: display.showReasoningChain,
    requestReasoningChain: display.requestReasoningChain,
  }
}

/** 会话灌入指纹匹配时视为干净；否则与全局 preset baseline 比较。 */
export function isConnectionFormDirty(args: {
  formFingerprint: string
  serverBaselineFingerprint: string | undefined
  conversationPanelFingerprint: string | null
}): boolean {
  if (args.serverBaselineFingerprint === undefined) return true
  if (
    args.conversationPanelFingerprint &&
    args.formFingerprint === args.conversationPanelFingerprint
  ) {
    return false
  }
  return args.formFingerprint !== args.serverBaselineFingerprint
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortJsonValue(value))
}

function sortJsonValue(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(sortJsonValue)
  const record = value as Record<string, unknown>
  const sorted: Record<string, unknown> = {}
  for (const key of Object.keys(record).sort()) {
    sorted[key] = sortJsonValue(record[key])
  }
  return sorted
}

export function buildConversationChatHydrationWatchKey(args: {
  conversationId: string
  loading: boolean
  presetsReady: boolean
  useGlobal: boolean
  apiPresetRaw: unknown
  effective: unknown
  activePresetId: string | null
}): string {
  return [
    args.conversationId,
    args.loading ? '1' : '0',
    args.presetsReady ? '1' : '0',
    args.useGlobal ? '1' : '0',
    stableJson(args.apiPresetRaw ?? null),
    stableJson(args.effective ?? null),
    args.activePresetId ?? '',
  ].join('\0')
}
