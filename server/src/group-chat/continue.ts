import type { TurnRecord } from '../chat-storage.js'
import {
  isGroupChatMemberMuted,
  normalizeGroupChatSettings,
  type GroupChatSettings,
} from '../shared/group-chat-settings.js'
import { getTurnGroupChatState, getTurnSegments } from './segments.js'
import type { GroupContinueBody, GroupContinueValidation } from './types.js'

/** 解析 chat API groupContinue；字段不齐返回 null */
export function parseGroupContinueBody(raw: unknown): GroupContinueBody | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  const turnOrdinal = o.turnOrdinal
  const speakerCharacterId = o.speakerCharacterId
  const afterSegmentIndex = o.afterSegmentIndex
  if (
    typeof turnOrdinal !== 'number' ||
    !Number.isInteger(turnOrdinal) ||
    turnOrdinal < 0
  ) {
    return null
  }
  if (typeof speakerCharacterId !== 'string' || !speakerCharacterId.trim()) {
    return null
  }
  if (
    typeof afterSegmentIndex !== 'number' ||
    !Number.isInteger(afterSegmentIndex) ||
    afterSegmentIndex < 0
  ) {
    return null
  }
  return {
    turnOrdinal,
    speakerCharacterId: speakerCharacterId.trim(),
    afterSegmentIndex,
  }
}

export function validateGroupContinueRequest(
  turn: TurnRecord,
  body: GroupContinueBody,
  speakerCharacterId: string,
  characterIds: string[],
  defaultSpeakerCharacterId: string,
  groupChat?: GroupChatSettings,
): GroupContinueValidation {
  const segments = getTurnSegments(turn, defaultSpeakerCharacterId)
  const withContent = segments.filter((s) => (s.receives?.length ?? 0) > 0)
  const lastIndex = Math.max(0, withContent.length - 1)
  if (body.afterSegmentIndex !== lastIndex) {
    return 'invalid_after_segment'
  }
  const speaker = speakerCharacterId.trim()
  if (!speaker || !characterIds.includes(speaker)) {
    return 'speaker_not_bound'
  }
  const lastSpeaker = withContent[lastIndex]?.speakerCharacterId?.trim()
  const hintOverride =
    groupChat?.speakerMode === 'next@' &&
    withContent[lastIndex]?.meta?.nextSpeakerHint?.trim() === speaker
  if (lastSpeaker && lastSpeaker === speaker && !hintOverride) {
    return 'consecutive_speaker'
  }
  if (groupChat?.enabled) {
    const settings = normalizeGroupChatSettings(groupChat)
    const state = getTurnGroupChatState(
      turn,
      settings,
      characterIds,
      defaultSpeakerCharacterId,
    )
    const quota = state.quotaRemaining[speaker]
    if (quota === undefined || quota <= 0) return 'no_quota'
    if (isGroupChatMemberMuted(speaker, settings)) return 'speaker_not_bound'
  }
  return 'ok'
}
