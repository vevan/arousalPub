import type { TurnRecord } from '../chat-storage.js'
import {
  DEFAULT_MAX_SEGMENTS_PER_TURN,
  normalizeGroupChatSettings,
  type GroupChatSettings,
} from '../shared/group-chat-settings.js'
import {
  getActiveSegmentIndex,
  getTurnSegments,
} from './segments.js'
import type {
  GroupChatAuditSnapshot,
  GroupChatSpeakerAudit,
  GroupChatSpeakerPickMethod,
} from './types.js'

export function buildGroupChatSpeakerAudit(
  groupChat: GroupChatSettings,
  phase: 'firstSegment' | 'nextAfterSegment',
  method: GroupChatSpeakerPickMethod,
  segmentIndex: number,
  partial: Omit<
    GroupChatSpeakerAudit,
    'speakerMode' | 'phase' | 'method' | 'segmentIndex'
  > = {},
): GroupChatSpeakerAudit {
  const settings = normalizeGroupChatSettings(groupChat)
  return {
    speakerMode: settings.speakerMode ?? 'dice',
    phase,
    method,
    segmentIndex,
    maxSegmentsPerTurn: settings.maxSegmentsPerTurn ?? DEFAULT_MAX_SEGMENTS_PER_TURN,
    ...partial,
  }
}

/** 落盘前：将本段 segmentPick audit 挂到 segment meta（regen 复用） */
export function attachSegmentPickAuditToSegment(
  turn: TurnRecord,
  segmentIndex: number,
  audit: GroupChatSpeakerAudit | undefined,
): void {
  if (!audit) return
  const seg = turn.segments[segmentIndex]
  if (!seg) return
  seg.meta = {
    ...(seg.meta ?? {}),
    segmentPickAudit: audit,
  }
}

/** 落盘前：将下一段选人 audit 挂到当前 active segment（供后续 continue 本段选人展示） */
export function attachResolvedNextSpeakerAuditToActiveSegment(
  turn: TurnRecord,
  _defaultSpeakerCharacterId: string,
  audit: GroupChatSpeakerAudit | undefined,
): void {
  if (!audit) return
  const segments = getTurnSegments(turn, _defaultSpeakerCharacterId)
  if (segments.length === 0) return
  const idx = getActiveSegmentIndex(turn)
  const seg = turn.segments[idx]
  if (!seg) return
  seg.meta = {
    ...(seg.meta ?? {}),
    resolvedNextSpeakerAudit: audit,
  }
}

/** groupContinue 本段选人：若 speaker 来自上一段掷骰结果，复用其 dice audit */
export function segmentPickAuditFromCarriedNextSpeaker(params: {
  groupChat: GroupChatSettings
  turn: TurnRecord
  defaultSpeakerCharacterId: string
  speakerCharacterId: string
  segmentIndex: number
}): GroupChatSpeakerAudit | null {
  const groupChat = normalizeGroupChatSettings(params.groupChat)
  if (!groupChat.enabled) return null
  const prevIdx = params.segmentIndex - 1
  if (prevIdx < 0) return null
  const segments = getTurnSegments(params.turn, params.defaultSpeakerCharacterId).filter(
    (s) => (s.receives?.length ?? 0) > 0,
  )
  const prev = segments[prevIdx]
  const carried = prev?.meta?.resolvedNextSpeakerAudit
  if (!carried) return null
  const speaker = params.speakerCharacterId.trim()
  if (!speaker || carried.speakerCharacterId?.trim() !== speaker) return null
  if (carried.method === 'dice' && carried.dice) {
    return buildGroupChatSpeakerAudit(
      groupChat,
      'nextAfterSegment',
      'dice',
      params.segmentIndex,
      {
        speakerCharacterId: speaker,
        dice: carried.dice,
        ...(carried.decayStopped ? { decayStopped: carried.decayStopped } : {}),
        ...(carried.firstSegmentAllFailFallback
          ? { firstSegmentAllFailFallback: carried.firstSegmentAllFailFallback }
          : {}),
      },
    )
  }
  if (carried.method === 'queue' || carried.method === 'sequential') {
    return buildGroupChatSpeakerAudit(
      groupChat,
      'nextAfterSegment',
      carried.method,
      params.segmentIndex,
      { speakerCharacterId: speaker },
    )
  }
  return null
}

export function buildGroupChatAuditSnapshot(params: {
  segmentSpeakerCharacterId: string
  segmentPick?: GroupChatSpeakerAudit
  nextSpeaker?: GroupChatSpeakerAudit
}): GroupChatAuditSnapshot {
  return {
    segmentSpeakerCharacterId: params.segmentSpeakerCharacterId,
    ...(params.segmentPick ? { segmentPick: params.segmentPick } : {}),
    ...(params.nextSpeaker ? { nextSpeaker: params.nextSpeaker } : {}),
  }
}
