import { readChunkContainingOrdinal } from './chunk-chain.js'
import {
  batchUpdateConversationTurns,
  readConversationIndex,
  writeConversationIndex,
  type ConversationIndex,
} from './chat-storage.js'
import { applyRegexPersistToTurnPatch } from './regex-persist-patch.js'
import { hasEnabledPersistRules } from './regex-persist.js'
import { readRegexRulesDocument } from './regex-rules-file.js'
import type { RegexRule } from './regex-rules-types.js'
import type { TurnContentPatchInput } from './turn-patch-body.js'
import {
  turnContentPatchChanged,
  turnRecordToContentPatch,
} from './turn-patch-body.js'

export interface RetroPersistTurnPayload {
  turnOrdinal: number
  finalUserText: string
  finalAssistantContent: string
  finalAssistantReasoning?: string
  receives: {
    id: string
    content: string
    reasoning?: string
  }[]
  activeReceiveIndex: number
}

export interface RetroPersistStatus {
  attempted: number[]
  changed: number[]
  failed?: number[]
}

export interface RetroPersistRunResult {
  retro: RetroPersistTurnPayload[]
  retroStatus: RetroPersistStatus
}

function normalizeOrdinalList(raw: unknown): number[] {
  if (!Array.isArray(raw)) return []
  const out: number[] = []
  for (const v of raw) {
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) continue
    if (!out.includes(v)) out.push(v)
  }
  return out.sort((a, b) => a - b)
}

export function readRetroPersistPending(idx: ConversationIndex | null): number[] {
  return normalizeOrdinalList(idx?.retroPersistPending)
}

/** 各 persist 规则 skipLastNTurns 在 tail 下刚出窗口的 retro 轮次（去重升序） */
export function resolveRetroOrdinalsFromRules(
  rules: RegexRule[],
  tailOrdinal: number,
): number[] {
  const set = new Set<number>()
  for (const rule of rules) {
    if (!rule.enabled || !rule.phases.includes('persist')) continue
    const skip = rule.skipLastNTurns
    if (skip <= 0) continue
    const retro = tailOrdinal - skip
    if (retro >= 0) set.add(retro)
  }
  return [...set].sort((a, b) => a - b)
}

export function mergeRetroAttemptOrdinals(
  pending: number[],
  fromRules: number[],
): number[] {
  return [...new Set([...pending, ...fromRules])].sort((a, b) => a - b)
}

export function isRetroOrdinalEligible(
  ordinal: number,
  tailOrdinal: number,
  rules: RegexRule[],
): boolean {
  return rules.some((rule) => {
    if (!rule.enabled || !rule.phases.includes('persist')) return false
    const skip = rule.skipLastNTurns
    if (skip <= 0) return false
    return ordinal <= tailOrdinal - skip
  })
}

function patchToRetroPayload(patch: TurnContentPatchInput): RetroPersistTurnPayload {
  const active = patch.receives[patch.activeReceiveIndex]
  return {
    turnOrdinal: patch.turnOrdinal,
    finalUserText: patch.userText,
    finalAssistantContent: active?.content ?? '',
    ...(typeof active?.reasoning === 'string' && active.reasoning.length > 0
      ? { finalAssistantReasoning: active.reasoning }
      : {}),
    receives: patch.receives.map((r) => ({
      id: r.id,
      content: r.content,
      ...(typeof r.reasoning === 'string' && r.reasoning.length > 0
        ? { reasoning: r.reasoning }
        : {}),
    })),
    activeReceiveIndex: patch.activeReceiveIndex,
  }
}

async function persistRetroPendingOrdinals(
  conversationId: string,
  pending: number[],
): Promise<void> {
  const idx = await readConversationIndex(conversationId)
  if (!idx) return
  const current = readRetroPersistPending(idx)
  if (
    current.length === pending.length &&
    current.every((v, i) => v === pending[i])
  ) {
    return
  }
  const next: ConversationIndex = { ...idx, updatedAt: new Date().toISOString() }
  if (pending.length > 0) {
    next.retroPersistPending = pending
  } else {
    delete next.retroPersistPending
  }
  await writeConversationIndex(conversationId, next)
}

export function attachRetroToPersistResult<T extends Record<string, unknown>>(
  result: T,
  retroRun: RetroPersistRunResult | null,
): T & Partial<RetroPersistRunResult> {
  if (!retroRun || retroRun.retro.length === 0) {
    if (
      retroRun?.retroStatus.attempted.length ||
      retroRun?.retroStatus.failed?.length
    ) {
      return { ...result, retroStatus: retroRun.retroStatus }
    }
    return result
  }
  return {
    ...result,
    retro: retroRun.retro,
    retroStatus: retroRun.retroStatus,
  }
}

/**
 * 主落盘成功后：回溯 skip 窗口刚滑出的轮次；失败不阻塞主落盘，失败 ordinal 写入 pending。
 */
export async function runRetroPersistAfterTurnPersist(
  conversationId: string,
  options: {
    newTailOrdinal: number
    includeNewRetro: boolean
  },
): Promise<RetroPersistRunResult | null> {
  const doc = await readRegexRulesDocument()
  if (!hasEnabledPersistRules(doc.rules)) return null

  const idx = await readConversationIndex(conversationId)
  if (!idx) return null

  const pending = readRetroPersistPending(idx)
  const fromRules = options.includeNewRetro
    ? resolveRetroOrdinalsFromRules(doc.rules, options.newTailOrdinal)
    : []
  const toAttempt = mergeRetroAttemptOrdinals(pending, fromRules).filter((o) =>
    isRetroOrdinalEligible(o, options.newTailOrdinal, doc.rules),
  )

  if (toAttempt.length === 0) {
    return null
  }

  const patches: TurnContentPatchInput[] = []
  const changedOrdinals: number[] = []
  const notFoundOrdinals: number[] = []

  for (const ordinal of toAttempt) {
    const located = await readChunkContainingOrdinal(conversationId, ordinal)
    if (!located) {
      notFoundOrdinals.push(ordinal)
      continue
    }
    const turn = located.chunk.turns.find((t) => t.turnOrdinal === ordinal)
    if (!turn) {
      notFoundOrdinals.push(ordinal)
      continue
    }
    const original = turnRecordToContentPatch(turn)
    const normalized = applyRegexPersistToTurnPatch(
      doc.rules,
      original,
      options.newTailOrdinal,
    )
    if (turnContentPatchChanged(original, normalized)) {
      patches.push(normalized)
      changedOrdinals.push(ordinal)
    }
  }

  const failedOrdinals: number[] = []
  if (patches.length > 0) {
    const batch = await batchUpdateConversationTurns(conversationId, patches)
    for (const f of batch.failed) {
      failedOrdinals.push(f.turnOrdinal)
    }
  }

  const pendingAfter = [...new Set(failedOrdinals)].sort((a, b) => a - b)
  await persistRetroPendingOrdinals(conversationId, pendingAfter)

  const retro = patches.map(patchToRetroPayload)
  const retroStatus: RetroPersistStatus = {
    attempted: toAttempt,
    changed: changedOrdinals.filter((o) => !failedOrdinals.includes(o)),
    ...(failedOrdinals.length > 0 ? { failed: failedOrdinals } : {}),
  }

  if (
    retro.length === 0 &&
    retroStatus.attempted.length === 0 &&
    !retroStatus.failed?.length
  ) {
    return null
  }

  return { retro, retroStatus }
}
