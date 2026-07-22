import { createHash } from 'node:crypto'
import {
  cloneGroupChatTurnState,
  defaultGroupChatDecaySettings,
  groupChatMemberWeight,
  initGroupChatTurnState,
  listEligibleCharacterIds,
  normalizeGroupChatDecaySettings,
  normalizeGroupChatSettings,
  resolveDiceSkipReason,
  type GroupChatDecaySettings,
  type GroupChatSettings,
  type GroupChatTurnState,
} from '../shared/group-chat-settings.js'
import { deductSpeakQuota } from './segments.js'
import type {
  GroupChatDiceAudit,
  GroupChatDiceAuditOutcome,
  GroupChatDiceBidAuditRow,
} from './types.js'

export interface DiceBiddingResult {
  speakerCharacterId: string | null
  decayStopped?: boolean
  turnState: GroupChatTurnState
  /** 首段全员失败兜底：speaker 额度已在掷骰失败中扣除 */
  firstSegmentAllFailFallback?: boolean
  diceAudit?: GroupChatDiceAudit
}

/** SHA-256 前 4 字节 → [0,1) */
export function seededUnit(seed: string): number {
  const hash = createHash('sha256').update(seed).digest()
  return hash.readUInt32BE(0) / 0xffffffff
}

function pickHighestScoreBid(
  bids: { id: string; score: number }[],
  characterIds: string[],
): string | null {
  if (bids.length === 0) return null
  let best: { id: string; score: number } | null = null
  let bestOrder = Number.POSITIVE_INFINITY
  for (const bid of bids) {
    const order = characterIds.indexOf(bid.id)
    if (
      !best ||
      bid.score > best.score ||
      (bid.score === best.score && order >= 0 && order < bestOrder)
    ) {
      best = bid
      bestOrder = order >= 0 ? order : bestOrder
    }
  }
  return best?.id ?? null
}

/** per-bot 个人衰减；k = 已成功发言次数 */
export function computeBotContinueProbability(
  speakCount: number,
  decay: GroupChatDecaySettings,
): number {
  const d = normalizeGroupChatDecaySettings(decay)
  if (!d.enabled) return 1
  const initial = d.initialRate ?? 1
  const step = d.step ?? 0.2
  const floor = d.floor ?? 0
  const k = Math.max(0, Math.floor(speakCount))
  return Math.max(floor, initial - step * k)
}

export function pickFromSpeakerQueue(params: {
  speakerQueue?: string[]
  characterIds: string[]
  settings: GroupChatSettings
  turnState: GroupChatTurnState
  lastSpeakerCharacterId?: string | null
}): string | null {
  if (!Array.isArray(params.speakerQueue)) return null
  for (const rawId of params.speakerQueue) {
    const id = rawId.trim()
    if (!id || !params.characterIds.includes(id)) continue
    const eligible = listEligibleCharacterIds({
      characterIds: [id],
      settings: params.settings,
      turnState: params.turnState,
      lastSpeakerCharacterId: params.lastSpeakerCharacterId,
    })
    if (eligible.length > 0) return id
  }
  return null
}

export function pickSequentialSpeaker(params: {
  characterIds: string[]
  settings: GroupChatSettings
  turnState: GroupChatTurnState
  lastSpeakerCharacterId?: string | null
}): string | null {
  const eligible = listEligibleCharacterIds({
    characterIds: params.characterIds,
    settings: params.settings,
    turnState: params.turnState,
    lastSpeakerCharacterId: params.lastSpeakerCharacterId,
  })
  return eligible[0] ?? null
}

export function pickFirstSpeakerForSend(params: {
  groupChatEnabled: boolean
  speakerQueueIds: string[]
  defaultCharacterId: string
}): string {
  void params.groupChatEnabled
  const { speakerQueueIds, defaultCharacterId } = params
  if (speakerQueueIds.length > 0) return speakerQueueIds[0]!
  return defaultCharacterId
}

export function validateNextAtHint(params: {
  hintCharacterId?: string
  characterIds: string[]
  settings: GroupChatSettings
  turnState: GroupChatTurnState
  lastSpeakerCharacterId?: string | null
}): string | null {
  const id = params.hintCharacterId?.trim()
  if (!id || !params.characterIds.includes(id)) return null
  const eligible = listEligibleCharacterIds({
    characterIds: [id],
    settings: params.settings,
    turnState: params.turnState,
    lastSpeakerCharacterId: params.lastSpeakerCharacterId,
    allowConsecutive: true,
  })
  return eligible[0] ?? null
}

export function diceBiddingPick(params: {
  groupChat: GroupChatSettings
  characterIds: string[]
  turnState: GroupChatTurnState
  eligibleIds: string[]
  segmentCount: number
  conversationId: string
  turnOrdinal: number
  lastSpeakerCharacterId?: string | null
}): DiceBiddingResult {
  void params.eligibleIds
  const settings = normalizeGroupChatSettings(params.groupChat)
  const decay = settings.decay ?? defaultGroupChatDecaySettings()
  let turnState = cloneGroupChatTurnState(params.turnState)
  const orderedIds = params.characterIds.map((id) => id.trim()).filter(Boolean)
  const lastSpeaker = params.lastSpeakerCharacterId?.trim() || null

  const bidRows: GroupChatDiceBidAuditRow[] = []
  const bids: { id: string; passed: boolean; score: number }[] = []

  for (const id of orderedIds) {
    const skipReason = resolveDiceSkipReason(id, {
      settings,
      turnState,
      lastSpeakerCharacterId: lastSpeaker,
    })
    const k = turnState.speakCount[id] ?? 0
    const quotaRemaining = turnState.quotaRemaining[id] ?? 0
    const prob = computeBotContinueProbability(k, decay)
    const weight = groupChatMemberWeight(id, settings)
    if (skipReason) {
      bidRows.push({
        characterId: id,
        eligible: false,
        skipReason,
        quotaRemaining,
        speakCount: k,
        probability: prob,
        weight,
      })
      continue
    }
    const roll = seededUnit(
      `${params.conversationId}\0${params.turnOrdinal}\0${params.segmentCount}\0${id}\0roll`,
    )
    const passed = roll < prob
    const score =
      weight *
      seededUnit(
        `${params.conversationId}\0${params.turnOrdinal}\0${params.segmentCount}\0${id}\0score`,
      )
    bidRows.push({
      characterId: id,
      eligible: true,
      quotaRemaining,
      speakCount: k,
      probability: prob,
      roll,
      passed,
      score,
      weight,
    })
    bids.push({ id, passed, score })
  }

  if (bids.length === 0) {
    return {
      speakerCharacterId: null,
      turnState,
      diceAudit: {
        segmentCount: params.segmentCount,
        bids: bidRows,
        winnerCharacterId: null,
        outcome: 'noEligible',
      },
    }
  }

  const buildDiceAudit = (
    winnerCharacterId: string | null,
    outcome: GroupChatDiceAuditOutcome,
  ): GroupChatDiceAudit => ({
    segmentCount: params.segmentCount,
    bids: bidRows,
    winnerCharacterId,
    outcome,
  })

  const passedBids = bids.filter((b) => b.passed)
  if (passedBids.length > 0) {
    for (const b of bids) {
      if (!b.passed) turnState = deductSpeakQuota(turnState, b.id)
    }
    const winner = pickHighestScoreBid(passedBids, params.characterIds)
    return {
      speakerCharacterId: winner,
      turnState,
      diceAudit: buildDiceAudit(winner, 'winner'),
    }
  }

  // 全员掷骰失败 → 结束 turn 流程
  if (params.segmentCount === 0) {
    for (const b of bids) {
      turnState = deductSpeakQuota(turnState, b.id)
    }
    const winner = pickHighestScoreBid(bids, params.characterIds)
    return {
      speakerCharacterId: winner,
      turnState,
      firstSegmentAllFailFallback: true,
      diceAudit: buildDiceAudit(winner, 'allFailedFirstSegmentFallback'),
    }
  }

  for (const b of bids) {
    turnState = deductSpeakQuota(turnState, b.id)
  }
  return {
    speakerCharacterId: null,
    turnState,
    decayStopped: true,
    diceAudit: buildDiceAudit(null, 'allFailedStop'),
  }
}

/** 首段选人 id（无 audit）；与 resolveFirstSegmentSpeaker 的 speaker id 一致 */
export function resolveFirstSegmentSpeakerId(params: {
  groupChat: GroupChatSettings
  characterIds: string[]
  conversationId: string
  turnOrdinal: number
  speakerQueueIds: string[]
  defaultCharacterId: string
}): string {
  const groupChat = normalizeGroupChatSettings(params.groupChat)
  const defaultId = params.defaultCharacterId.trim()
  if (!groupChat.enabled) {
    return pickFirstSpeakerForSend({
      groupChatEnabled: false,
      speakerQueueIds: params.speakerQueueIds,
      defaultCharacterId: defaultId,
    })
  }

  const turnState = initGroupChatTurnState(groupChat, params.characterIds)
  const fromQueue = pickFromSpeakerQueue({
    speakerQueue: params.speakerQueueIds,
    characterIds: params.characterIds,
    settings: groupChat,
    turnState,
    lastSpeakerCharacterId: null,
  })
  if (fromQueue) return fromQueue

  const speakerMode = groupChat.speakerMode ?? 'dice'
  if (speakerMode === 'sequential') {
    return (
      pickSequentialSpeaker({
        characterIds: params.characterIds,
        settings: groupChat,
        turnState,
        lastSpeakerCharacterId: null,
      }) ?? defaultId
    )
  }

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
  return dice.speakerCharacterId?.trim() || defaultId
}
