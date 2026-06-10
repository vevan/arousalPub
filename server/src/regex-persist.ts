import { readTailChunk } from './chat-storage.js'
import { applyRegexPersistToTurnFields, filterRegexRules } from './regex-apply.js'
import { resolveConversationTailOrdinal } from './regex-persist-patch.js'
import { readRegexRulesDocument } from './regex-rules-file.js'
import type { RegexRule } from './regex-rules-types.js'

export interface PersistRegexFields {
  userText: string
  assistantContent: string
  assistantReasoning?: string
}

export function hasEnabledPersistRules(rules: RegexRule[]): boolean {
  return rules.some((r) => r.enabled && r.phases.includes('persist'))
}

/** 落盘轮 ordinal（新轮 = 尾轮 + 1；再生 = 指定轮） */
export async function resolvePersistTurnOrdinal(params: {
  conversationId: string
  hasHeadChunk: boolean
  regenerateTurnOrdinal?: number | null
}): Promise<number> {
  if (
    typeof params.regenerateTurnOrdinal === 'number' &&
    Number.isInteger(params.regenerateTurnOrdinal) &&
    params.regenerateTurnOrdinal >= 0
  ) {
    return params.regenerateTurnOrdinal
  }
  if (!params.hasHeadChunk) return 0
  const tailChunk = await readTailChunk(params.conversationId)
  const last = tailChunk?.turns[tailChunk.turns.length - 1]
  if (!last || typeof last.turnOrdinal !== 'number') return 0
  return last.turnOrdinal + 1
}

/** 落盘轮 ordinal；tailOrdinal 为会话当前尾轮（再生时与 turnOrdinal 不同） */
export function applyRegexPersistForTurn(
  rules: RegexRule[],
  fields: PersistRegexFields,
  turnOrdinal: number,
  tailOrdinal?: number,
): PersistRegexFields {
  const persistRules = filterRegexRules(rules, { phases: ['persist'] })
  if (!hasEnabledPersistRules(persistRules)) return fields
  return applyRegexPersistToTurnFields({
    userText: fields.userText,
    assistantContent: fields.assistantContent,
    assistantReasoning: fields.assistantReasoning,
    turnOrdinal,
    tailOrdinal: tailOrdinal ?? turnOrdinal,
    rules: persistRules,
  })
}

export async function loadAndApplyRegexPersistForTurn(
  fields: PersistRegexFields,
  turnOrdinal: number,
  conversationId?: string,
): Promise<PersistRegexFields> {
  const doc = await readRegexRulesDocument()
  if (!hasEnabledPersistRules(doc.rules)) return fields
  let tailOrdinal = turnOrdinal
  if (conversationId?.trim()) {
    tailOrdinal = await resolveConversationTailOrdinal(conversationId.trim())
  }
  return applyRegexPersistForTurn(doc.rules, fields, turnOrdinal, tailOrdinal)
}
