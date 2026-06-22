import type { TurnContentPatchInput } from './turn-patch-body.js'
import {
  shouldSkipPersistRegexForTurnPatch,
  turnRecordToContentPatch,
} from './turn-patch-body.js'
import {
  applyRegexRulesToText,
  filterRegexRules,
} from './regex-apply.js'
import { readChunkContainingOrdinal, resolveActivePathTurns, readConversationActiveBranchPath } from './chunk-chain.js'
import { readRegexRulesDocument } from './regex-rules-file.js'
import type { RegexRule } from './regex-rules-types.js'
import { hasEnabledPersistRules } from './regex-persist.js'

export async function resolveConversationTailOrdinal(
  conversationId: string,
): Promise<number> {
  const active = await readConversationActiveBranchPath(conversationId)
  const turns = await resolveActivePathTurns(conversationId, active)
  if (turns.length === 0) return 0
  return Math.max(...turns.map((t) => t.turnOrdinal))
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

async function readStoredTurnContentPatch(
  conversationId: string,
  turnOrdinal: number,
): Promise<TurnContentPatchInput | null> {
  const located = await readChunkContainingOrdinal(conversationId, turnOrdinal)
  if (!located) return null
  const turn = located.chunk.turns.find((t) => t.turnOrdinal === turnOrdinal)
  if (!turn) return null
  return turnRecordToContentPatch(turn)
}

/** PATCH 写盘前：正文与磁盘一致时跳过 persist 规则 */
export async function resolveTurnPatchPersistRegex(
  conversationId: string,
  patch: TurnContentPatchInput,
  rules?: RegexRule[],
  tailOrdinal?: number,
): Promise<TurnContentPatchInput> {
  let ruleList = rules
  if (!ruleList) {
    const doc = await readRegexRulesDocument()
    if (!hasEnabledPersistRules(doc.rules)) return patch
    ruleList = doc.rules
  } else if (!hasEnabledPersistRules(ruleList)) {
    return patch
  }

  const existing = await readStoredTurnContentPatch(conversationId, patch.turnOrdinal)
  if (existing && shouldSkipPersistRegexForTurnPatch(existing, patch)) {
    return patch
  }

  const tail =
    typeof tailOrdinal === 'number'
      ? tailOrdinal
      : await resolveConversationTailOrdinal(conversationId)
  return applyRegexPersistToTurnPatch(ruleList, patch, tail)
}

export async function loadAndApplyRegexPersistToTurnPatch(
  conversationId: string,
  patch: TurnContentPatchInput,
): Promise<TurnContentPatchInput> {
  return resolveTurnPatchPersistRegex(conversationId, patch)
}

export interface TurnPatchPersistPayload {
  ok: true
  finalUserText: string
  receives: TurnContentPatchInput['receives']
  activeReceiveIndex: number
  plugins?: unknown[]
}

export function toTurnPatchPersistPayload(
  patch: TurnContentPatchInput,
  plugins?: unknown[],
): TurnPatchPersistPayload {
  return {
    ok: true,
    finalUserText: patch.userText,
    receives: patch.receives,
    activeReceiveIndex: patch.activeReceiveIndex,
    ...(plugins !== undefined ? { plugins } : {}),
  }
}
