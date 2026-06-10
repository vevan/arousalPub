import { readTailChunk } from './chat-storage.js'
import { applyRegexPersistToTurnFields, filterRegexRules } from './regex-apply.js'
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

/** 落盘轮 ordinal；persist 阶段 turnOrdinal 与 tailOrdinal 同为该值 */
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

export function applyRegexPersistForTurn(
  rules: RegexRule[],
  fields: PersistRegexFields,
  turnOrdinal: number,
): PersistRegexFields {
  const persistRules = filterRegexRules(rules, { phases: ['persist'] })
  if (!hasEnabledPersistRules(persistRules)) return fields
  return applyRegexPersistToTurnFields({
    userText: fields.userText,
    assistantContent: fields.assistantContent,
    assistantReasoning: fields.assistantReasoning,
    turnOrdinal,
    tailOrdinal: turnOrdinal,
    rules: persistRules,
  })
}

export async function loadAndApplyRegexPersistForTurn(
  fields: PersistRegexFields,
  turnOrdinal: number,
): Promise<PersistRegexFields> {
  const doc = await readRegexRulesDocument()
  if (!hasEnabledPersistRules(doc.rules)) return fields
  return applyRegexPersistForTurn(doc.rules, fields, turnOrdinal)
}
