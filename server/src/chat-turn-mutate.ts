/**
 * In-memory turn segment/receive mutation helpers.
 * May use group-chat/segments for active-index + speaker sync (no storage cycle).
 */
import { allocateShortId } from './short-id.js'
import {
  getActiveSegmentIndex,
  syncTurnSpeakerFromActiveSegment,
} from './group-chat/segments.js'
import type {
  ChatAuditSnapshotInput,
  PersistTimingMs,
} from './chat-audit-types.js'
import type {
  TurnReceive,
  TurnRecord,
} from './chat-turn-types.js'

export function nowIso(): string {
  return new Date().toISOString()
}

export function finalizeAuditPersistDiskMs(
  snapshot: ChatAuditSnapshotInput | undefined,
  storageStartedAt: number,
): void {
  const persistMs = snapshot?.performance?.persistMs as PersistTimingMs | undefined
  if (!persistMs || storageStartedAt <= 0) return
  const diskAndAudit = Math.round(performance.now() - storageStartedAt)
  persistMs.diskAndAudit = diskAndAudit
  const regex = persistMs.regex
  persistMs.total =
    typeof regex === 'number' ? regex + diskAndAudit : diskAndAudit
}

export function auditReceiveIdForSegment(
  turn: TurnRecord,
  segmentIndex: number,
): string | undefined {
  const seg = turn.segments[segmentIndex]
  if (!seg?.receives?.length) return undefined
  const idx = Math.min(
    Math.max(0, seg.activeReceiveIndex ?? 0),
    seg.receives.length - 1,
  )
  const id = seg.receives[idx]?.id?.trim()
  return id || undefined
}

export function mapReceivesWithShortIds(
  receives: TurnReceive[],
  used: Set<string>,
): TurnReceive[] {
  return receives.map((r) => {
    const rec: TurnReceive = {
      id: r.id?.trim() ? r.id.trim() : allocateShortId(used),
      content: r.content,
    }
    if (typeof r.reasoning === 'string' && r.reasoning.length > 0) {
      rec.reasoning = r.reasoning
    }
    if (r.runtime && typeof r.runtime === 'object') {
      rec.runtime = r.runtime
    }
    return rec
  })
}

export function releaseTurnEntityIds(turn: TurnRecord, used: Set<string>): void {
  for (const s of turn.segments ?? []) {
    const sid = typeof s.id === 'string' ? s.id.trim() : ''
    if (sid) used.delete(sid)
    for (const r of s.receives ?? []) {
      const rid = typeof r.id === 'string' ? r.id.trim() : ''
      if (rid) used.delete(rid)
    }
  }
  const tid = typeof turn.turnId === 'string' ? turn.turnId.trim() : ''
  if (tid) used.delete(tid)
}

export function buildFirstSegmentOnTurn(
  turn: TurnRecord,
  used: Set<string>,
  params: {
    speakerCharacterId: string
    receives: TurnReceive[]
    activeReceiveIndex: number
    nextSpeakerHint?: string
  },
): void {
  const mappedReceives = mapReceivesWithShortIds(params.receives, used)
  const activeIdx = Math.min(
    Math.max(0, params.activeReceiveIndex),
    Math.max(0, mappedReceives.length - 1),
  )
  const segmentId = allocateShortId(used)
  const speaker = params.speakerCharacterId.trim()
  turn.segments = [
    {
      id: segmentId,
      speakerCharacterId: speaker,
      receives: mappedReceives,
      activeReceiveIndex: activeIdx,
      ...(params.nextSpeakerHint
        ? { meta: { nextSpeakerHint: params.nextSpeakerHint } }
        : {}),
    },
  ]
  turn.activeSegmentIndex = 0
  turn.speakerCharacterId = speaker
  syncTurnSpeakerFromActiveSegment(turn)
}

/** 在内存中更新单轮正文与 receives（调用方维护 chunk 级 used 集合） */
export function applyTurnContentUpdate(
  turn: TurnRecord,
  used: Set<string>,
  userText: string,
  receives: TurnReceive[],
  activeReceiveIndex: number,
  segmentIndex?: number,
): void {
  if (!receives.length) return
  releaseTurnEntityIds(turn, used)
  const segIdx =
    typeof segmentIndex === 'number' && Number.isInteger(segmentIndex)
      ? segmentIndex
      : getActiveSegmentIndex(turn)
  const activeSeg = turn.segments[segIdx]
  if (!activeSeg) return
  const prevReceives = activeSeg.receives ?? []
  const mappedReceives = mapReceivesWithShortIds(receives, used).map((rec) => {
    const rid = typeof rec.id === 'string' ? rec.id.trim() : ''
    const prev = prevReceives.find(
      (p) => typeof p.id === 'string' && p.id.trim() === rid,
    )
    if (!prev?.runtime || typeof prev.runtime !== 'object') return rec
    return {
      ...rec,
      runtime: {
        ...(prev.runtime as Record<string, unknown>),
        ...(rec.runtime ?? {}),
      },
    }
  })
  const activeIdx = Math.min(
    Math.max(0, activeReceiveIndex),
    mappedReceives.length - 1,
  )
  const prevActiveSegIdx = getActiveSegmentIndex(turn)
  turn.send = { userText }
  activeSeg.receives = mappedReceives
  activeSeg.activeReceiveIndex = activeIdx
  if (segIdx === prevActiveSegIdx) {
    syncTurnSpeakerFromActiveSegment(turn)
  }
}

/** 更新指定 segment 的 receives（regenerate/swipe 仅当前 segment） */
export function applyTurnSegmentContentUpdate(
  turn: TurnRecord,
  used: Set<string>,
  segmentIndex: number,
  userText: string,
  receives: TurnReceive[],
  activeReceiveIndex: number,
  _defaultSpeakerCharacterId: string,
  nextSpeakerHint?: string,
): void {
  if (!receives.length) return
  const seg = turn.segments[segmentIndex]
  if (!seg) return
  for (const r of seg.receives ?? []) {
    const rid = typeof r.id === 'string' ? r.id.trim() : ''
    if (rid) used.delete(rid)
  }
  const prevReceives = seg.receives ?? []
  seg.receives = mapReceivesWithShortIds(receives, used).map((rec) => {
    const rid = typeof rec.id === 'string' ? rec.id.trim() : ''
    const prev = prevReceives.find(
      (p) => typeof p.id === 'string' && p.id.trim() === rid,
    )
    if (!prev?.runtime || typeof prev.runtime !== 'object') return rec
    return {
      ...rec,
      runtime: {
        ...(prev.runtime as Record<string, unknown>),
        ...(rec.runtime ?? {}),
      },
    }
  })
  seg.activeReceiveIndex = Math.min(
    Math.max(0, activeReceiveIndex),
    seg.receives.length - 1,
  )
  if (nextSpeakerHint) {
    seg.meta = { ...(seg.meta ?? {}), nextSpeakerHint }
  }
  turn.activeSegmentIndex = segmentIndex
  turn.send = { userText }
  syncTurnSpeakerFromActiveSegment(turn)
}
