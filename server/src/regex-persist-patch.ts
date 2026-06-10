import type { TurnContentPatchInput } from './turn-patch-body.js'
import {
  applyRegexRulesToText,
  filterRegexRules,
} from './regex-apply.js'
import { readTailChunk } from './chat-storage.js'
import { readRegexRulesDocument } from './regex-rules-file.js'
import type { RegexRule } from './regex-rules-types.js'
import { hasEnabledPersistRules } from './regex-persist.js'

export async function resolveConversationTailOrdinal(
  conversationId: string,
): Promise<number> {
  const tailChunk = await readTailChunk(conversationId)
  if (!tailChunk?.turns.length) return 0
  const last = tailChunk.turns[tailChunk.turns.length - 1]
  return typeof last?.turnOrdinal === 'number' ? last.turnOrdinal : 0
}

/** 编辑 / 批量 PATCH 写盘前：对整轮 user + 全部 receives 应用 persist 规则 */
export function applyRegexPersistToTurnPatch(
  rules: RegexRule[],
  patch: TurnContentPatchInput,
  tailOrdinal: number,
  ruleIds?: string[] | 'all',
): TurnContentPatchInput {
  const persistRules = filterRegexRules(rules, {
    phases: ['persist'],
    ruleIds: ruleIds ?? 'all',
  })
  if (!hasEnabledPersistRules(persistRules)) return patch

  const turnOrdinal = patch.turnOrdinal
  const ctxBase = {
    phase: 'persist' as const,
    turnOrdinal,
    tailOrdinal,
  }

  const userText = applyRegexRulesToText(
    patch.userText,
    persistRules,
    { ...ctxBase, field: 'user' },
  )

  const receives = patch.receives.map((r) => {
    const content = applyRegexRulesToText(
      r.content,
      persistRules,
      { ...ctxBase, field: 'assistant' },
    )
    const next: (typeof patch.receives)[number] = { ...r, content }
    if (typeof r.reasoning === 'string' && r.reasoning.length > 0) {
      next.reasoning = applyRegexRulesToText(
        r.reasoning,
        persistRules,
        { ...ctxBase, field: 'reasoning' },
      )
    }
    return next
  })

  return {
    ...patch,
    userText,
    receives,
    activeReceiveIndex: patch.activeReceiveIndex,
  }
}

export async function loadAndApplyRegexPersistToTurnPatch(
  conversationId: string,
  patch: TurnContentPatchInput,
): Promise<TurnContentPatchInput> {
  const doc = await readRegexRulesDocument()
  if (!hasEnabledPersistRules(doc.rules)) return patch
  const tailOrdinal = await resolveConversationTailOrdinal(conversationId)
  return applyRegexPersistToTurnPatch(doc.rules, patch, tailOrdinal)
}

export interface TurnPatchPersistPayload {
  ok: true
  finalUserText: string
  receives: TurnContentPatchInput['receives']
  activeReceiveIndex: number
}

export function toTurnPatchPersistPayload(
  patch: TurnContentPatchInput,
): TurnPatchPersistPayload {
  return {
    ok: true,
    finalUserText: patch.userText,
    receives: patch.receives,
    activeReceiveIndex: patch.activeReceiveIndex,
  }
}
