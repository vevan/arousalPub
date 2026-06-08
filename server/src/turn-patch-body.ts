import type { TurnReceive } from './chat-storage.js'

export const CONVERSATION_BATCH_MAX_TURNS = 50

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
