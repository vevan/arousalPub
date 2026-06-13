import type { TurnReceive, TurnRecord } from './chat-storage.js'
import { getTurnUserText } from './chat-storage.js'

/** 单次 messages 区间读 / 批量 PATCH 上限 */
export const CONVERSATION_BATCH_MAX_TURNS = 50

/** UI 打开对话时默认尾部窗口（须 ≤ CONVERSATION_BATCH_MAX_TURNS） */
export const CONVERSATION_MESSAGES_DEFAULT_TAIL = 30

export interface TurnContentPatchInput {
  turnOrdinal: number
  userText: string
  receives: TurnReceive[]
  activeReceiveIndex: number
}

export type ParseTurnPatchResult =
  | { ok: true; patch: TurnContentPatchInput }
  | { ok: false; error: string }

export function parseTurnPatchBody(body: unknown): ParseTurnPatchResult {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'turn_patch_invalid' }
  }
  const b = body as Record<string, unknown>
  if (typeof b.userText !== 'string') {
    return { ok: false, error: 'user_text_must_be_string' }
  }
  if (!Array.isArray(b.receives) || b.receives.length === 0) {
    return { ok: false, error: 'receives_required_nonempty' }
  }
  const mapped: TurnReceive[] = []
  for (const r of b.receives) {
    if (!r || typeof r !== 'object') {
      return { ok: false, error: 'receives_item_invalid' }
    }
    const o = r as {
      id?: unknown
      content?: unknown
      reasoning?: unknown
      durationMs?: unknown
      estimatedTokens?: unknown
      completionTokens?: unknown
      model?: unknown
    }
    if (typeof o.id !== 'string' || typeof o.content !== 'string') {
      return { ok: false, error: 'receives_item_id_content_required' }
    }
    const rec: TurnReceive = { id: o.id, content: o.content }
    if (typeof o.reasoning === 'string' && o.reasoning.length > 0) {
      rec.reasoning = o.reasoning
    }
    if (typeof o.durationMs === 'number' && Number.isFinite(o.durationMs) && o.durationMs > 0) {
      rec.runtime = { ...(rec.runtime ?? {}), durationMs: Math.round(o.durationMs) }
    }
    if (
      typeof o.estimatedTokens === 'number' &&
      Number.isFinite(o.estimatedTokens) &&
      o.estimatedTokens > 0
    ) {
      rec.runtime = {
        ...(rec.runtime ?? {}),
        estimatedTokens: Math.round(o.estimatedTokens),
      }
    }
    if (
      typeof o.completionTokens === 'number' &&
      Number.isFinite(o.completionTokens) &&
      o.completionTokens > 0
    ) {
      rec.runtime = {
        ...(rec.runtime ?? {}),
        completionTokens: Math.round(o.completionTokens),
      }
    }
    if (typeof o.model === 'string' && o.model.trim()) {
      rec.runtime = { ...(rec.runtime ?? {}), model: o.model.trim() }
    }
    mapped.push(rec)
  }
  if (typeof b.turnOrdinal !== 'number' || !Number.isInteger(b.turnOrdinal) || b.turnOrdinal < 0) {
    return { ok: false, error: 'invalid_turn_ordinal' }
  }
  if (typeof b.activeReceiveIndex !== 'number' || !Number.isInteger(b.activeReceiveIndex)) {
    return { ok: false, error: 'active_receive_index_must_be_integer' }
  }
  return {
    ok: true,
    patch: {
      turnOrdinal: b.turnOrdinal,
      userText: b.userText,
      receives: mapped,
      activeReceiveIndex: b.activeReceiveIndex,
    },
  }
}

export function turnRecordToContentPatch(turn: TurnRecord): TurnContentPatchInput {
  const receives: TurnReceive[] = (turn.receives ?? []).map((r) => {
    const rec: TurnReceive = {
      id: r.id,
      content: typeof r.content === 'string' ? r.content : '',
    }
    if (typeof r.reasoning === 'string' && r.reasoning.length > 0) {
      rec.reasoning = r.reasoning
    }
    if (r.runtime && typeof r.runtime === 'object') {
      rec.runtime = r.runtime
    }
    return rec
  })
  let active = turn.activeReceiveIndex
  if (receives.length === 0) {
    return {
      turnOrdinal: turn.turnOrdinal,
      userText: getTurnUserText(turn),
      receives: [],
      activeReceiveIndex: 0,
    }
  }
  active = Math.min(Math.max(0, active), receives.length - 1)
  return {
    turnOrdinal: turn.turnOrdinal,
    userText: getTurnUserText(turn),
    receives,
    activeReceiveIndex: active,
  }
}

/** user + receives 正文是否与 patch 一致（不含 activeReceiveIndex） */
export function turnContentPatchFieldsEqual(
  before: TurnContentPatchInput,
  after: TurnContentPatchInput,
): boolean {
  if (before.userText !== after.userText) return false
  if (before.receives.length !== after.receives.length) return false
  for (let i = 0; i < before.receives.length; i++) {
    const a = before.receives[i]
    const b = after.receives[i]
    if (!a || !b) return false
    if (a.id !== b.id || a.content !== b.content) return false
    if ((a.reasoning ?? '') !== (b.reasoning ?? '')) return false
  }
  return true
}

export function turnContentPatchChanged(
  before: TurnContentPatchInput,
  after: TurnContentPatchInput,
): boolean {
  return !turnContentPatchFieldsEqual(before, after)
}

/** swipe 切换展示变体：仅 activeReceiveIndex 变化 */
export function isActiveReceiveIndexOnlyPatchChange(
  before: TurnContentPatchInput,
  after: TurnContentPatchInput,
): boolean {
  if (before.activeReceiveIndex === after.activeReceiveIndex) return false
  return turnContentPatchFieldsEqual(before, after)
}

/** PATCH 正文与磁盘一致时跳过 persist（含 swipe 与完全重复 PATCH） */
export function shouldSkipPersistRegexForTurnPatch(
  stored: TurnContentPatchInput,
  incoming: TurnContentPatchInput,
): boolean {
  return turnContentPatchFieldsEqual(stored, incoming)
}
