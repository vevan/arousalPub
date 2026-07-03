import type { TurnRecord } from '../chat-storage.js'
import {
  cloneGroupChatTurnState,
  initGroupChatTurnState,
  recordSegmentSpeaker,
  segmentSkipQuotaDeduction,
  type GroupChatSettings,
  type GroupChatTurnState,
} from '../shared/group-chat-settings.js'
import type { AssistantSegmentRecord } from './types.js'

export function getTurnSegments(
  turn: TurnRecord,
  defaultSpeakerCharacterId: string,
): AssistantSegmentRecord[] {
  if (!Array.isArray(turn.segments) || turn.segments.length === 0) {
    return []
  }
  return turn.segments.map((s) => ({
    id: s.id?.trim() || '',
    speakerCharacterId:
      s.speakerCharacterId?.trim() || defaultSpeakerCharacterId,
    receives: Array.isArray(s.receives) ? s.receives : [],
    activeReceiveIndex:
      typeof s.activeReceiveIndex === 'number' ? s.activeReceiveIndex : 0,
    ...(s.meta ? { meta: s.meta } : {}),
  }))
}

export function getActiveSegmentIndex(turn: TurnRecord): number {
  if (turn.segments.length === 0) return 0
  return Math.min(
    Math.max(0, turn.activeSegmentIndex),
    turn.segments.length - 1,
  )
}

export function getActiveSegment(
  turn: TurnRecord,
  defaultSpeakerCharacterId: string,
): AssistantSegmentRecord | null {
  const segments = getTurnSegments(turn, defaultSpeakerCharacterId)
  if (segments.length === 0) return null
  const idx = getActiveSegmentIndex(turn)
  return segments[idx] ?? segments[0]!
}

/** 将 active segment 同步到 turn.receives / activeReceiveIndex（API 与 swipe 宏） */
export function syncTurnReceivesFromActiveSegment(turn: TurnRecord): void {
  const defaultSpeaker =
    turn.segments[0]?.speakerCharacterId?.trim() ??
    turn.speakerCharacterId?.trim() ??
    ''
  const seg = getActiveSegment(turn, defaultSpeaker)
  if (!seg) return
  turn.receives = seg.receives
  turn.activeReceiveIndex = Math.min(
    Math.max(0, seg.activeReceiveIndex),
    Math.max(0, seg.receives.length - 1),
  )
  turn.speakerCharacterId = seg.speakerCharacterId
}

export function segmentSkipQuotaDeductionOnRecord(
  seg: AssistantSegmentRecord,
): boolean {
  return segmentSkipQuotaDeduction(seg.meta)
}

export function getTurnGroupChatState(
  turn: TurnRecord,
  settings: GroupChatSettings,
  characterIds: string[],
  defaultSpeakerCharacterId?: string,
): GroupChatTurnState {
  if (turn.groupChatTurnState) {
    return cloneGroupChatTurnState(turn.groupChatTurnState)
  }
  const defaultSpeaker =
    defaultSpeakerCharacterId?.trim() || characterIds[0]?.trim() || ''
  const segments = getTurnSegments(turn, defaultSpeaker).filter(
    (s) => (s.receives?.length ?? 0) > 0,
  )
  if (segments.length > 0 && defaultSpeaker) {
    return rebuildGroupChatTurnStateFromTurn(
      turn,
      settings,
      characterIds,
      defaultSpeaker,
    )
  }
  return initGroupChatTurnState(settings, characterIds)
}

export function deductSpeakQuota(
  state: GroupChatTurnState,
  characterId: string,
): GroupChatTurnState {
  const id = characterId.trim()
  const next = cloneGroupChatTurnState(state)
  const q = next.quotaRemaining[id] ?? 0
  next.quotaRemaining[id] = Math.max(0, q - 1)
  return next
}

/** regen 截断后续 segment 后，按剩余已落盘 segment 重算额度（与可见气泡一致） */
export function rebuildGroupChatTurnStateFromTurn(
  turn: TurnRecord,
  settings: GroupChatSettings,
  characterIds: string[],
  defaultSpeakerCharacterId: string,
): GroupChatTurnState {
  let state = initGroupChatTurnState(settings, characterIds)
  const segments = getTurnSegments(turn, defaultSpeakerCharacterId).filter(
    (s) => (s.receives?.length ?? 0) > 0,
  )
  for (const seg of segments) {
    const speakerId =
      seg.speakerCharacterId?.trim() || defaultSpeakerCharacterId.trim()
    if (speakerId) {
      state = recordSegmentSpeaker(state, speakerId, {
        skipQuotaDeduction: segmentSkipQuotaDeductionOnRecord(seg),
      })
    }
  }
  return state
}

/** 已有内容的 segment 数 */
export function segmentCountForTurn(
  turn: TurnRecord,
  defaultSpeakerCharacterId: string,
): number {
  return getTurnSegments(turn, defaultSpeakerCharacterId).filter(
    (s) => (s.receives?.length ?? 0) > 0,
  ).length
}

export function lastSegmentSpeakerId(
  turn: TurnRecord,
  defaultSpeakerCharacterId: string,
): string | null {
  const segments = getTurnSegments(turn, defaultSpeakerCharacterId).filter(
    (s) => (s.receives?.length ?? 0) > 0,
  )
  const last = segments[segments.length - 1]
  return last?.speakerCharacterId?.trim() || null
}
