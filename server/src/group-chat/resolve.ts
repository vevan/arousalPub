import type { TurnRecord } from '../chat-storage.js'
import {
  DEFAULT_MAX_SEGMENTS_PER_TURN,
  initGroupChatTurnState,
  listEligibleCharacterIds,
  normalizeGroupChatSettings,
  type GroupChatSettings,
  type GroupChatTurnState,
} from '../shared/group-chat-settings.js'
import { buildGroupChatSpeakerAudit } from './audit.js'
import {
  diceBiddingPick,
  pickFirstSpeakerForSend,
  pickFromSpeakerQueue,
  pickSequentialSpeaker,
  validateNextAtHint,
} from './pick.js'
import {
  getTurnGroupChatState,
  getTurnSegments,
  lastSegmentSpeakerId,
  segmentCountForTurn,
} from './segments.js'
import {
  type GroupChatResolveParams,
  type ResolveNextSpeakerResult,
  GROUP_CHAT_NEXT_AT_INSTRUCTION,
} from './types.js'

/** 仅 speakerMode=next@ 且 enabled 时注入 assemble */
export function groupChatNextAtInstruction(
  settings: GroupChatSettings,
): string | null {
  const groupChat = normalizeGroupChatSettings(settings)
  if (!groupChat.enabled || groupChat.speakerMode !== 'next@') return null
  return GROUP_CHAT_NEXT_AT_INSTRUCTION
}

export function resolveNextSpeakerForTurn(params: {
  turn: TurnRecord
  characterIds: string[]
  characterNames: string[]
  defaultSpeakerCharacterId: string
  groupChat: GroupChatSettings
  conversationId: string
}): ResolveNextSpeakerResult {
  const groupChat = normalizeGroupChatSettings(params.groupChat)
  if (!groupChat.enabled) {
    return { speakerCharacterId: null }
  }

  const segmentCount = segmentCountForTurn(
    params.turn,
    params.defaultSpeakerCharacterId,
  )
  const maxSeg = groupChat.maxSegmentsPerTurn ?? DEFAULT_MAX_SEGMENTS_PER_TURN
  if (segmentCount >= maxSeg) {
    return {
      speakerCharacterId: null,
      groupChatAudit: buildGroupChatSpeakerAudit(
        groupChat,
        'nextAfterSegment',
        'maxSegments',
        segmentCount,
        { speakerCharacterId: null },
      ),
    }
  }

  let turnState = getTurnGroupChatState(
    params.turn,
    groupChat,
    params.characterIds,
    params.defaultSpeakerCharacterId,
  )
  const lastSpeaker = lastSegmentSpeakerId(
    params.turn,
    params.defaultSpeakerCharacterId,
  )
  const speakerMode = groupChat.speakerMode ?? 'dice'

  const fromQueue = pickFromSpeakerQueue({
    speakerQueue: params.turn.speakerQueue,
    characterIds: params.characterIds,
    settings: groupChat,
    turnState,
    lastSpeakerCharacterId: lastSpeaker,
  })
  if (fromQueue) {
    return {
      speakerCharacterId: fromQueue,
      turnState,
      groupChatAudit: buildGroupChatSpeakerAudit(
        groupChat,
        'nextAfterSegment',
        'queue',
        segmentCount,
        { speakerCharacterId: fromQueue },
      ),
    }
  }

  const segments = getTurnSegments(params.turn, params.defaultSpeakerCharacterId)
  const withContent = segments.filter((s) => (s.receives?.length ?? 0) > 0)
  const lastSeg = withContent[withContent.length - 1]
  const hintId = lastSeg?.meta?.nextSpeakerHint?.trim()

  if (speakerMode === 'next@') {
    const hintSpeaker = validateNextAtHint({
      hintCharacterId: hintId,
      characterIds: params.characterIds,
      settings: groupChat,
      turnState,
      lastSpeakerCharacterId: lastSpeaker,
    })
    if (hintSpeaker) {
      return {
        speakerCharacterId: hintSpeaker,
        turnState,
        groupChatAudit: buildGroupChatSpeakerAudit(
          groupChat,
          'nextAfterSegment',
          'nextAtHint',
          segmentCount,
          {
            speakerCharacterId: hintSpeaker,
            nextSpeakerHint: hintId,
          },
        ),
      }
    }
    return {
      speakerCharacterId: null,
      needsManualContinue: true,
      turnState,
      groupChatAudit: buildGroupChatSpeakerAudit(
        groupChat,
        'nextAfterSegment',
        'none',
        segmentCount,
        {
          speakerCharacterId: null,
          needsManualContinue: true,
          nextSpeakerHint: hintId,
        },
      ),
    }
  }

  if (speakerMode === 'sequential') {
    const speaker = pickSequentialSpeaker({
      characterIds: params.characterIds,
      settings: groupChat,
      turnState,
      lastSpeakerCharacterId: lastSpeaker,
    })
    return {
      speakerCharacterId: speaker,
      turnState,
      groupChatAudit: buildGroupChatSpeakerAudit(
        groupChat,
        'nextAfterSegment',
        'sequential',
        segmentCount,
        { speakerCharacterId: speaker },
      ),
    }
  }

  // dice
  const eligible = listEligibleCharacterIds({
    characterIds: params.characterIds,
    settings: groupChat,
    turnState,
    lastSpeakerCharacterId: lastSpeaker,
  })
  const dice = diceBiddingPick({
    groupChat,
    characterIds: params.characterIds,
    turnState,
    eligibleIds: eligible,
    segmentCount,
    conversationId: params.conversationId,
    turnOrdinal: params.turn.turnOrdinal,
    lastSpeakerCharacterId: lastSpeaker,
  })
  return {
    speakerCharacterId: dice.speakerCharacterId,
    turnState: dice.turnState,
    decayStopped: dice.decayStopped,
    firstSegmentAllFailFallback: dice.firstSegmentAllFailFallback,
    groupChatAudit: buildGroupChatSpeakerAudit(
      groupChat,
      'nextAfterSegment',
      'dice',
      segmentCount,
      {
        speakerCharacterId: dice.speakerCharacterId,
        decayStopped: dice.decayStopped,
        firstSegmentAllFailFallback: dice.firstSegmentAllFailFallback,
        dice: dice.diceAudit,
      },
    ),
  }
}

export function resolveFirstSegmentSpeaker(params: {
  groupChat: GroupChatSettings
  characterIds: string[]
  characterNames: string[]
  conversationId: string
  turnOrdinal: number
  speakerQueueIds: string[]
  defaultCharacterId: string
}): ResolveNextSpeakerResult {
  const groupChat = normalizeGroupChatSettings(params.groupChat)
  if (!groupChat.enabled) {
    return {
      speakerCharacterId: pickFirstSpeakerForSend({
        groupChatEnabled: false,
        speakerQueueIds: params.speakerQueueIds,
        defaultCharacterId: params.defaultCharacterId,
      }),
    }
  }

  let turnState = initGroupChatTurnState(groupChat, params.characterIds)
  const fromQueue = pickFromSpeakerQueue({
    speakerQueue: params.speakerQueueIds,
    characterIds: params.characterIds,
    settings: groupChat,
    turnState,
    lastSpeakerCharacterId: null,
  })
  if (fromQueue) {
    return {
      speakerCharacterId: fromQueue,
      turnState,
      groupChatAudit: buildGroupChatSpeakerAudit(
        groupChat,
        'firstSegment',
        'queue',
        0,
        { speakerCharacterId: fromQueue },
      ),
    }
  }

  const speakerMode = groupChat.speakerMode ?? 'dice'
  if (speakerMode === 'sequential') {
    const speaker = pickSequentialSpeaker({
      characterIds: params.characterIds,
      settings: groupChat,
      turnState,
      lastSpeakerCharacterId: null,
    })
    return {
      speakerCharacterId: speaker,
      turnState,
      groupChatAudit: buildGroupChatSpeakerAudit(
        groupChat,
        'firstSegment',
        'sequential',
        0,
        { speakerCharacterId: speaker },
      ),
    }
  }

  // dice 或 next@ 首段
  const eligible = listEligibleCharacterIds({
    characterIds: params.characterIds,
    settings: groupChat,
    turnState,
    lastSpeakerCharacterId: null,
  })
  const dice = diceBiddingPick({
    groupChat,
    characterIds: params.characterIds,
    turnState,
    eligibleIds: eligible,
    segmentCount: 0,
    conversationId: params.conversationId,
    turnOrdinal: params.turnOrdinal,
    lastSpeakerCharacterId: null,
  })
  return {
    speakerCharacterId: dice.speakerCharacterId,
    turnState: dice.turnState,
    firstSegmentAllFailFallback: dice.firstSegmentAllFailFallback,
    groupChatAudit: buildGroupChatSpeakerAudit(
      groupChat,
      'firstSegment',
      'dice',
      0,
      {
        speakerCharacterId: dice.speakerCharacterId,
        firstSegmentAllFailFallback: dice.firstSegmentAllFailFallback,
        dice: dice.diceAudit,
      },
    ),
  }
}

/** 首段后解析下一位并写回 turn.groupChatTurnState（落盘前单次写入） */
export function applyNextSpeakerStateToTurn(
  turn: TurnRecord,
  params: GroupChatResolveParams,
): ResolveNextSpeakerResult {
  const groupChat = normalizeGroupChatSettings(params.groupChat)
  if (!groupChat.enabled) {
    return { speakerCharacterId: null }
  }
  const resolved = resolveNextSpeakerForTurn({
    turn,
    characterIds: params.characterIds,
    characterNames: params.characterNames,
    defaultSpeakerCharacterId: params.defaultSpeakerCharacterId,
    groupChat,
    conversationId: params.conversationId,
  })
  if (resolved.turnState) {
    turn.groupChatTurnState = resolved.turnState
  }
  return resolved
}

export function validateExplicitFirstSegmentSpeaker(params: {
  explicitSpeakerId: string
  groupChat: GroupChatSettings
  characterIds: string[]
}):
  | { ok: true; turnState: GroupChatTurnState }
  | { ok: false; reason: 'not_bound' | 'not_eligible' } {
  const id = params.explicitSpeakerId.trim()
  if (!id || !params.characterIds.includes(id)) {
    return { ok: false, reason: 'not_bound' }
  }
  const settings = normalizeGroupChatSettings(params.groupChat)
  const turnState = initGroupChatTurnState(settings, params.characterIds)
  const eligible = listEligibleCharacterIds({
    characterIds: params.characterIds,
    settings,
    turnState,
    lastSpeakerCharacterId: null,
  })
  if (!eligible.includes(id)) {
    return { ok: false, reason: 'not_eligible' }
  }
  return { ok: true, turnState }
}
