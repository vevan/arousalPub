import {
  batchUpdateConversationTurns,
  readConversationIndex,
} from './chat-storage.js'
import { readTurnsInOrdinalRange } from './chunk-chain.js'
import { readRegexRulesDocument } from './regex-rules-file.js'
import { filterRegexRules } from './regex-apply.js'
import { hasEnabledPersistRules } from './regex-persist.js'
import {
  applyRegexPersistToTurnPatch,
  resolveConversationTailOrdinal,
} from './regex-persist-patch.js'
import type { TurnContentPatchInput } from './turn-patch-body.js'
import {
  CONVERSATION_BATCH_MAX_TURNS,
  turnContentPatchChanged,
  turnRecordToContentPatch,
} from './turn-patch-body.js'
import { ApiErrorCodes } from './api-error-codes.js'

export interface RegexBatchApplyRequest {
  dryRun: boolean
  fromOrdinal?: number
  toOrdinal?: number
  ruleIds?: string[] | 'all'
}

export interface RegexBatchApplyResult {
  dryRun: boolean
  fromOrdinal: number
  toOrdinal: number
  turnCount: number
  changedTurnCount: number
  ok?: number
  failed?: { turnOrdinal: number; error: string }[]
  /** 非 dry-run 且写盘成功时，已入队异步 re-embed 的轮次数 */
  memoryEmbedsQueued: number
}


export { turnContentPatchChanged, turnRecordToContentPatch } from './turn-patch-body.js'

export async function runConversationRegexBatchApply(
  conversationId: string,
  request: RegexBatchApplyRequest,
): Promise<
  | { ok: true; result: RegexBatchApplyResult }
  | { ok: false; error: string; status: number }
> {
  const idx = await readConversationIndex(conversationId)
  if (!idx) {
    return {
      ok: false,
      error: ApiErrorCodes.conversation_not_found,
      status: 404,
    }
  }

  const tailOrdinal = await resolveConversationTailOrdinal(conversationId)
  const fromOrdinal =
    typeof request.fromOrdinal === 'number'
      ? Math.trunc(request.fromOrdinal)
      : 0
  const toOrdinal =
    typeof request.toOrdinal === 'number'
      ? Math.trunc(request.toOrdinal)
      : tailOrdinal

  if (
    fromOrdinal < 0 ||
    toOrdinal < 0 ||
    !Number.isFinite(fromOrdinal) ||
    !Number.isFinite(toOrdinal) ||
    fromOrdinal > toOrdinal
  ) {
    return {
      ok: false,
      error: ApiErrorCodes.regex_batch_invalid_range,
      status: 400,
    }
  }

  const turns = await readTurnsInOrdinalRange(
    conversationId,
    fromOrdinal,
    toOrdinal,
  )
  const doc = await readRegexRulesDocument()
  const persistRules = filterRegexRules(doc.rules, {
    phases: ['persist'],
    ruleIds: request.ruleIds ?? 'all',
  })

  const patches: TurnContentPatchInput[] = []
  let changedTurnCount = 0

  if (hasEnabledPersistRules(persistRules)) {
    for (const turn of turns) {
      if (!turn.receives?.length) continue
      const original = turnRecordToContentPatch(turn)
      const normalized = applyRegexPersistToTurnPatch(
        doc.rules,
        original,
        tailOrdinal,
        request.ruleIds,
      )
      if (turnContentPatchChanged(original, normalized)) {
        changedTurnCount += 1
        patches.push(normalized)
      }
    }
  }

  const base: RegexBatchApplyResult = {
    dryRun: request.dryRun,
    fromOrdinal,
    toOrdinal,
    turnCount: turns.length,
    changedTurnCount,
    memoryEmbedsQueued: 0,
  }

  if (request.dryRun || patches.length === 0) {
    return { ok: true, result: base }
  }

  let totalOk = 0
  let memoryEmbedsQueued = 0
  const allFailed: { turnOrdinal: number; error: string }[] = []
  for (let i = 0; i < patches.length; i += CONVERSATION_BATCH_MAX_TURNS) {
    const slice = patches.slice(i, i + CONVERSATION_BATCH_MAX_TURNS)
    const batch = await batchUpdateConversationTurns(conversationId, slice)
    totalOk += batch.ok
    memoryEmbedsQueued += batch.memoryEmbedsQueued
    allFailed.push(...batch.failed)
  }
  return {
    ok: true,
    result: {
      ...base,
      ok: totalOk,
      failed: allFailed,
      memoryEmbedsQueued,
    },
  }
}

export function parseRegexBatchApplyBody(body: unknown):
  | { ok: true; request: RegexBatchApplyRequest }
  | { ok: false; error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: ApiErrorCodes.invalid_request_body }
  }
  const b = body as Record<string, unknown>
  const dryRun = b.dryRun === true

  let fromOrdinal: number | undefined
  if (b.fromOrdinal !== undefined) {
    if (
      typeof b.fromOrdinal !== 'number' ||
      !Number.isFinite(b.fromOrdinal) ||
      b.fromOrdinal < 0
    ) {
      return { ok: false, error: ApiErrorCodes.regex_batch_invalid_range }
    }
    fromOrdinal = Math.trunc(b.fromOrdinal)
  }

  let toOrdinal: number | undefined
  if (b.toOrdinal !== undefined) {
    if (
      typeof b.toOrdinal !== 'number' ||
      !Number.isFinite(b.toOrdinal) ||
      b.toOrdinal < 0
    ) {
      return { ok: false, error: ApiErrorCodes.regex_batch_invalid_range }
    }
    toOrdinal = Math.trunc(b.toOrdinal)
  }

  let ruleIds: string[] | 'all' | undefined
  if (b.ruleIds !== undefined) {
    if (b.ruleIds === 'all') {
      ruleIds = 'all'
    } else if (Array.isArray(b.ruleIds)) {
      ruleIds = b.ruleIds.filter((id): id is string => typeof id === 'string')
    } else {
      return { ok: false, error: ApiErrorCodes.validation_failed }
    }
  }

  return {
    ok: true,
    request: {
      dryRun,
      ...(fromOrdinal !== undefined ? { fromOrdinal } : {}),
      ...(toOrdinal !== undefined ? { toOrdinal } : {}),
      ...(ruleIds !== undefined ? { ruleIds } : {}),
    },
  }
}
