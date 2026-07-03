import { createHash } from 'node:crypto'
import type { TurnReceive, TurnRecord } from './chat-storage.js'

export interface AssistantSegmentRecord {
  id: string
  speakerCharacterId: string
  receives: TurnReceive[]
  activeReceiveIndex: number
  meta?: {
    nextSpeakerHint?: string
    /** 本段落盘时下一段选人 audit（供下一段 segmentPick 展示掷骰表） */
    resolvedNextSpeakerAudit?: GroupChatSpeakerAudit
    /** 本段 segmentPick audit（regen 时复用） */
    segmentPickAudit?: GroupChatSpeakerAudit
  }
}

export interface GroupChatDecaySettings {
  enabled?: boolean
  initialRate?: number
  step?: number
  floor?: number
}

export interface GroupChatMemberSettings {
  weight?: number
  muted?: boolean
  /** 本 user turn 内最多发言次数（G3） */
  speakQuota?: number
}

/** @deprecated G2 过渡字段；normalize 时 `weighted` → `speakerMode: dice` */
export type GroupChatMode = 'weighted' | 'sequential'

export type SpeakerMode = 'sequential' | 'dice' | 'next@'

export interface GroupChatTurnState {
  quotaRemaining: Record<string, number>
  speakCount: Record<string, number>
}

export interface GroupChatSettings {
  enabled?: boolean
  speakerMode?: SpeakerMode
  /** @deprecated 使用 speakerMode */
  mode?: GroupChatMode
  autoContinue?: boolean
  confirmContinue?: boolean
  maxSegmentsPerTurn?: number
  /** members 未设 speakQuota 时的默认额度 */
  defaultSpeakQuota?: number
  decay?: GroupChatDecaySettings
  members?: Record<string, GroupChatMemberSettings>
}

export const DEFAULT_SPEAK_QUOTA = 2
export const DEFAULT_MAX_SEGMENTS_PER_TURN = 8

export function defaultGroupChatDecaySettings(): GroupChatDecaySettings {
  return {
    enabled: true,
    initialRate: 1,
    step: 0.2,
    floor: 0,
  }
}

export function defaultGroupChatSettings(): GroupChatSettings {
  return {
    enabled: false,
    speakerMode: 'dice',
    mode: 'weighted',
    autoContinue: false,
    confirmContinue: true,
    maxSegmentsPerTurn: DEFAULT_MAX_SEGMENTS_PER_TURN,
    defaultSpeakQuota: DEFAULT_SPEAK_QUOTA,
    decay: defaultGroupChatDecaySettings(),
    members: {},
  }
}

function resolveSpeakerModeFromRaw(
  o: Record<string, unknown>,
  base: GroupChatSettings,
): SpeakerMode {
  if (typeof o.speakerMode === 'string') {
    const m = o.speakerMode.trim().toLowerCase()
    if (m === 'sequential' || m === 'dice' || m === 'next@') return m
  }
  const legacy = typeof o.mode === 'string' ? o.mode.trim().toLowerCase() : ''
  if (legacy === 'sequential') return 'sequential'
  return base.speakerMode ?? 'dice'
}

function normalizePositiveInt(n: unknown, fallback: number): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return fallback
  return Math.max(1, Math.round(n))
}

function clampUnitRate(n: unknown, fallback: number): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return fallback
  return Math.min(1, Math.max(0, n))
}

export function normalizeGroupChatDecaySettings(
  raw: unknown,
): GroupChatDecaySettings {
  const base = defaultGroupChatDecaySettings()
  if (!raw || typeof raw !== 'object') return base
  const o = raw as Record<string, unknown>
  return {
    enabled: typeof o.enabled === 'boolean' ? o.enabled : base.enabled,
    initialRate: clampUnitRate(o.initialRate, base.initialRate!),
    step: clampUnitRate(o.step, base.step!),
    floor: clampUnitRate(o.floor, base.floor!),
  }
}

export function normalizeGroupChatMembers(
  raw: unknown,
): Record<string, GroupChatMemberSettings> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<string, GroupChatMemberSettings> = {}
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    const id = key.trim()
    if (!id || !val || typeof val !== 'object' || Array.isArray(val)) continue
    const m = val as Record<string, unknown>
    const entry: GroupChatMemberSettings = {}
    if (typeof m.muted === 'boolean') entry.muted = m.muted
    if (typeof m.weight === 'number' && Number.isFinite(m.weight) && m.weight >= 0) {
      entry.weight = m.weight
    }
    if (typeof m.speakQuota === 'number' && Number.isFinite(m.speakQuota) && m.speakQuota >= 0) {
      entry.speakQuota = Math.round(m.speakQuota)
    }
    out[id] = entry
  }
  return out
}

export function normalizeGroupChatSettings(
  raw: unknown,
): GroupChatSettings {
  const base = defaultGroupChatSettings()
  if (!raw || typeof raw !== 'object') return base
  const o = raw as Record<string, unknown>
  const speakerMode = resolveSpeakerModeFromRaw(o, base)
  const modeRaw = typeof o.mode === 'string' ? o.mode.trim().toLowerCase() : ''
  const mode: GroupChatMode =
    modeRaw === 'sequential' ? 'sequential' : 'weighted'
  return {
    enabled: typeof o.enabled === 'boolean' ? o.enabled : base.enabled,
    speakerMode,
    mode,
    autoContinue:
      typeof o.autoContinue === 'boolean' ? o.autoContinue : base.autoContinue,
    confirmContinue:
      typeof o.confirmContinue === 'boolean'
        ? o.confirmContinue
        : base.confirmContinue,
    maxSegmentsPerTurn: normalizePositiveInt(
      o.maxSegmentsPerTurn,
      base.maxSegmentsPerTurn ?? DEFAULT_MAX_SEGMENTS_PER_TURN,
    ),
    defaultSpeakQuota: normalizePositiveInt(
      o.defaultSpeakQuota,
      base.defaultSpeakQuota ?? DEFAULT_SPEAK_QUOTA,
    ),
    decay: normalizeGroupChatDecaySettings(o.decay ?? base.decay),
    members: normalizeGroupChatMembers(o.members),
  }
}

export function mergeGroupChatSettings(
  prev: GroupChatSettings | undefined,
  patch: unknown,
): GroupChatSettings {
  const base = normalizeGroupChatSettings(prev)
  if (patch === null) return defaultGroupChatSettings()
  if (!patch || typeof patch !== 'object') return base
  const o = patch as Record<string, unknown>
  const next: GroupChatSettings = { ...base }
  if (typeof o.enabled === 'boolean') next.enabled = o.enabled
  if (typeof o.speakerMode === 'string') {
    const m = o.speakerMode.trim().toLowerCase()
    if (m === 'sequential' || m === 'dice' || m === 'next@') next.speakerMode = m
  }
  if (typeof o.mode === 'string') {
    const m = o.mode.trim().toLowerCase()
    if (m === 'weighted' || m === 'sequential') next.mode = m
  }
  if (Object.prototype.hasOwnProperty.call(o, 'maxSegmentsPerTurn')) {
    next.maxSegmentsPerTurn = normalizePositiveInt(
      o.maxSegmentsPerTurn,
      base.maxSegmentsPerTurn ?? DEFAULT_MAX_SEGMENTS_PER_TURN,
    )
  }
  if (Object.prototype.hasOwnProperty.call(o, 'defaultSpeakQuota')) {
    next.defaultSpeakQuota = normalizePositiveInt(
      o.defaultSpeakQuota,
      base.defaultSpeakQuota ?? DEFAULT_SPEAK_QUOTA,
    )
  }
  if (typeof o.autoContinue === 'boolean') next.autoContinue = o.autoContinue
  if (typeof o.confirmContinue === 'boolean') {
    next.confirmContinue = o.confirmContinue
  }
  if (Object.prototype.hasOwnProperty.call(o, 'decay')) {
    next.decay = normalizeGroupChatDecaySettings({
      ...base.decay,
      ...(o.decay && typeof o.decay === 'object' && !Array.isArray(o.decay)
        ? o.decay
        : {}),
    })
  }
  if (Object.prototype.hasOwnProperty.call(o, 'members')) {
    const patchMembers = normalizeGroupChatMembers(o.members)
    const mergedMembers: Record<string, GroupChatMemberSettings> = {
      ...(base.members ?? {}),
    }
    for (const [id, patchMember] of Object.entries(patchMembers)) {
      mergedMembers[id] = { ...mergedMembers[id], ...patchMember }
    }
    next.members = mergedMembers
  }
  return normalizeGroupChatSettings(next)
}

export function isGroupChatMemberMuted(
  characterId: string,
  settings: GroupChatSettings,
): boolean {
  return settings.members?.[characterId.trim()]?.muted === true
}

export function groupChatMemberWeight(
  characterId: string,
  settings: GroupChatSettings,
): number {
  const w = settings.members?.[characterId.trim()]?.weight
  if (typeof w === 'number' && Number.isFinite(w) && w >= 0) return w
  return 1
}

export function groupChatMemberSpeakQuota(
  characterId: string,
  settings: GroupChatSettings,
): number {
  const q = settings.members?.[characterId.trim()]?.speakQuota
  if (typeof q === 'number' && Number.isFinite(q) && q >= 0) return Math.round(q)
  return settings.defaultSpeakQuota ?? DEFAULT_SPEAK_QUOTA
}

export function initGroupChatTurnState(
  settings: GroupChatSettings,
  characterIds: string[],
): GroupChatTurnState {
  const groupChat = normalizeGroupChatSettings(settings)
  const quotaRemaining: Record<string, number> = {}
  const speakCount: Record<string, number> = {}
  for (const rawId of characterIds) {
    const id = rawId.trim()
    if (!id) continue
    quotaRemaining[id] = groupChatMemberSpeakQuota(id, groupChat)
    speakCount[id] = 0
  }
  return { quotaRemaining, speakCount }
}

export function cloneGroupChatTurnState(
  state: GroupChatTurnState,
): GroupChatTurnState {
  return {
    quotaRemaining: { ...state.quotaRemaining },
    speakCount: { ...state.speakCount },
  }
}

export function getTurnGroupChatState(
  turn: TurnRecord,
  settings: GroupChatSettings,
  characterIds: string[],
): GroupChatTurnState {
  if (turn.groupChatTurnState) {
    return cloneGroupChatTurnState(turn.groupChatTurnState)
  }
  return initGroupChatTurnState(settings, characterIds)
}

export function recordSegmentSpeaker(
  state: GroupChatTurnState,
  speakerId: string,
  opts?: { skipQuotaDeduction?: boolean },
): GroupChatTurnState {
  const id = speakerId.trim()
  const next = cloneGroupChatTurnState(state)
  next.speakCount[id] = (next.speakCount[id] ?? 0) + 1
  if (!opts?.skipQuotaDeduction) {
    const q = next.quotaRemaining[id] ?? 0
    next.quotaRemaining[id] = Math.max(0, q - 1)
  }
  return next
}

function deductSpeakQuota(
  state: GroupChatTurnState,
  characterId: string,
): GroupChatTurnState {
  const id = characterId.trim()
  const next = cloneGroupChatTurnState(state)
  const q = next.quotaRemaining[id] ?? 0
  next.quotaRemaining[id] = Math.max(0, q - 1)
  return next
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

function seededUnit(seed: string): number {
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

export function listEligibleCharacterIds(params: {
  characterIds: string[]
  settings: GroupChatSettings
  turnState: GroupChatTurnState
  lastSpeakerCharacterId?: string | null
  /** hint 可 override 不连说 */
  allowConsecutive?: boolean
}): string[] {
  const settings = normalizeGroupChatSettings(params.settings)
  const last = params.lastSpeakerCharacterId?.trim() || null
  return params.characterIds.filter((rawId) => {
    const id = rawId.trim()
    if (!id) return false
    return (
      resolveDiceSkipReason(id, {
        settings,
        turnState: params.turnState,
        lastSpeakerCharacterId: last,
        allowConsecutive: params.allowConsecutive,
      }) === null
    )
  })
}

export type GroupChatDiceSkipReason = 'consecutive' | 'quota' | 'muted'

export function resolveDiceSkipReason(
  characterId: string,
  params: {
    settings: GroupChatSettings
    turnState: GroupChatTurnState
    lastSpeakerCharacterId?: string | null
    allowConsecutive?: boolean
  },
): GroupChatDiceSkipReason | null {
  const id = characterId.trim()
  if (!id) return 'quota'
  const settings = normalizeGroupChatSettings(params.settings)
  if (isGroupChatMemberMuted(id, settings)) return 'muted'
  const quota = params.turnState.quotaRemaining[id]
  if (quota === undefined || quota <= 0) return 'quota'
  const last = params.lastSpeakerCharacterId?.trim() || null
  if (!params.allowConsecutive && last && id === last) return 'consecutive'
  return null
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

export interface DiceBiddingResult {
  speakerCharacterId: string | null
  decayStopped?: boolean
  turnState: GroupChatTurnState
  /** 首段全员失败兜底：speaker 额度已在掷骰失败中扣除 */
  firstSegmentAllFailFallback?: boolean
  diceAudit?: GroupChatDiceAudit
}

export type GroupChatSpeakerPickMethod =
  | 'queue'
  | 'sequential'
  | 'dice'
  | 'nextAtHint'
  | 'explicit'
  | 'manual'
  | 'maxSegments'
  | 'disabled'
  | 'none'

export interface GroupChatDiceBidAuditRow {
  characterId: string
  eligible: boolean
  skipReason?: GroupChatDiceSkipReason
  quotaRemaining: number
  speakCount: number
  /** per-bot 衰减概率 P；跳过者仍记录便于审计 */
  probability: number
  weight: number
  roll?: number
  passed?: boolean
  score?: number
}

export type GroupChatDiceAuditOutcome =
  | 'winner'
  | 'allFailedStop'
  | 'allFailedFirstSegmentFallback'
  | 'noEligible'

export interface GroupChatDiceAudit {
  segmentCount: number
  bids: GroupChatDiceBidAuditRow[]
  winnerCharacterId: string | null
  outcome: GroupChatDiceAuditOutcome
}

export interface GroupChatSpeakerAudit {
  speakerMode?: SpeakerMode
  phase: 'firstSegment' | 'nextAfterSegment'
  method: GroupChatSpeakerPickMethod
  segmentIndex: number
  maxSegmentsPerTurn?: number
  speakerCharacterId?: string | null
  nextSpeakerHint?: string
  decayStopped?: boolean
  needsManualContinue?: boolean
  firstSegmentAllFailFallback?: boolean
  dice?: GroupChatDiceAudit
}

export interface GroupChatAuditSnapshot {
  segmentSpeakerCharacterId?: string
  segmentPick?: GroupChatSpeakerAudit
  nextSpeaker?: GroupChatSpeakerAudit
}

export const GROUP_CHAT_NEXT_AT_INSTRUCTION =
  '若需其他角色接下一句，使用 [NEXT@角色名]，例如 [NEXT@Betty]。\n每个角色每轮发言次数有限；助手消息中的裸 @ 不会生效。'

/** 仅 speakerMode=next@ 且 enabled 时注入 assemble */
export function groupChatNextAtInstruction(
  settings: GroupChatSettings,
): string | null {
  const groupChat = normalizeGroupChatSettings(settings)
  if (!groupChat.enabled || groupChat.speakerMode !== 'next@') return null
  return GROUP_CHAT_NEXT_AT_INSTRUCTION
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
    // 首段中止结束
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

/** @deprecated G2；段序号全局衰减，G3 用 computeBotContinueProbability */
export function nextSegmentIndexForTurn(
  turn: TurnRecord,
  defaultSpeakerCharacterId: string,
): number {
  return getTurnSegments(turn, defaultSpeakerCharacterId).filter(
    (s) => (s.receives?.length ?? 0) > 0,
  ).length
}

/** 第二段起衰减概率；首段返回 null（不掷） */
export function computeGroupChatContinueProbability(
  nextSegmentIndex: number,
  decay: GroupChatDecaySettings,
): number | null {
  if (nextSegmentIndex < 1) return null
  const d = normalizeGroupChatDecaySettings(decay)
  if (!d.enabled) return 1
  const initial = d.initialRate ?? 1
  const step = d.step ?? 0.2
  const floor = d.floor ?? 0
  return Math.max(floor, initial - step * (nextSegmentIndex - 1))
}

export function rollGroupChatDecay(
  nextSegmentIndex: number,
  decay: GroupChatDecaySettings,
  random: () => number = Math.random,
): boolean {
  const prob = computeGroupChatContinueProbability(nextSegmentIndex, decay)
  if (prob === null) return true
  return random() < prob
}

export function buildGroupMacroStrings(
  characterIds: string[],
  characterNames: string[],
  settings: GroupChatSettings,
): { group: string; groupNotMuted: string } {
  const groupNames: string[] = []
  const notMutedNames: string[] = []
  for (let i = 0; i < characterIds.length; i++) {
    const id = characterIds[i]?.trim()
    if (!id) continue
    const name = characterNames[i]?.trim() || id
    groupNames.push(name)
    if (!isGroupChatMemberMuted(id, settings)) notMutedNames.push(name)
  }
  return {
    group: groupNames.join(', '),
    groupNotMuted: notMutedNames.join(', '),
  }
}

export function listGroupChatCandidateIds(
  characterIds: string[],
  spokenCharacterIds: string[],
  settings: GroupChatSettings,
): string[] {
  const spoken = new Set(spokenCharacterIds)
  return characterIds.filter(
    (id) => id.trim() && !spoken.has(id) && !isGroupChatMemberMuted(id, settings),
  )
}

/** 是否还有下一位可接续（掷衰减前检查，避免无候选人时误报 decayStopped） */
export function hasGroupChatContinuationCandidate(params: {
  groupChat: GroupChatSettings
  speakerQueue?: string[]
  lastHintCharacterId?: string
  spokenCharacterIds: string[]
  characterIds: string[]
}): boolean {
  const settings = normalizeGroupChatSettings(params.groupChat)
  const spoken = new Set(params.spokenCharacterIds)

  if (Array.isArray(params.speakerQueue)) {
    for (const rawId of params.speakerQueue) {
      const id = rawId.trim()
      if (!id || spoken.has(id) || !params.characterIds.includes(id)) continue
      if (isGroupChatMemberMuted(id, settings)) continue
      return true
    }
  }
  if (
    params.lastHintCharacterId &&
    params.characterIds.includes(params.lastHintCharacterId) &&
    !spoken.has(params.lastHintCharacterId) &&
    !isGroupChatMemberMuted(params.lastHintCharacterId, settings)
  ) {
    return true
  }
  return (
    listGroupChatCandidateIds(
      params.characterIds,
      params.spokenCharacterIds,
      settings,
    ).length > 0
  )
}

export function pickWeightedGroupChatSpeaker(params: {
  conversationId: string
  turnOrdinal: number
  nextSegmentIndex: number
  candidateIds: string[]
  settings: GroupChatSettings
}): string | null {
  const candidates = params.candidateIds.filter(Boolean)
  if (candidates.length === 0) return null
  if (candidates.length === 1) return candidates[0]!
  const weighted: { id: string; weight: number }[] = []
  let total = 0
  for (const id of candidates) {
    const weight = groupChatMemberWeight(id, params.settings)
    if (weight <= 0) continue
    weighted.push({ id, weight })
    total += weight
  }
  if (weighted.length === 0) return null
  if (weighted.length === 1) return weighted[0]!.id
  const seed = `${params.conversationId}\0${params.turnOrdinal}\0${params.nextSegmentIndex}`
  const hash = createHash('sha256').update(seed).digest()
  const r = (hash.readUInt32BE(0) / 0xffffffff) * total
  let acc = 0
  for (const item of weighted) {
    acc += item.weight
    if (r <= acc) return item.id
  }
  return weighted[weighted.length - 1]!.id
}

export interface ResolveNextSpeakerResult {
  speakerCharacterId: string | null
  decayStopped?: boolean
  needsManualContinue?: boolean
  turnState?: GroupChatTurnState
  firstSegmentAllFailFallback?: boolean
  groupChatAudit?: GroupChatSpeakerAudit
}

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

export interface GroupChatResolveParams {
  groupChat: GroupChatSettings
  characterIds: string[]
  characterNames: string[]
  defaultSpeakerCharacterId: string
  conversationId: string
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

/** @deprecated G2 过渡；请用 resolveNextSpeakerForTurn */
export function resolveNextSpeakerWithDecay(params: {
  turn: TurnRecord
  characterIds: string[]
  characterNames: string[]
  defaultSpeakerCharacterId: string
  groupChat: GroupChatSettings
  conversationId: string
  random?: () => number
}): ResolveNextSpeakerResult {
  void params.random
  return resolveNextSpeakerForTurn(params)
}

/** 读取 turn.segments（已物化落盘；缺省 speaker 为 characterIds[0]） */
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

export function resolveDisplayNameToCharacterId(
  name: string,
  characterIds: string[],
  characterNames: string[],
): string | null {
  const q = name.trim().toLowerCase()
  if (!q) return null
  for (let i = 0; i < characterNames.length; i++) {
    const n = characterNames[i]?.trim()
    const id = characterIds[i]?.trim()
    if (n && id && n.toLowerCase() === q) return id
  }
  return null
}

export function resolveSpeakerQueueIds(
  displayNames: string[],
  characterIds: string[],
  characterNames: string[],
): string[] {
  const out: string[] = []
  for (const name of displayNames) {
    const id = resolveDisplayNameToCharacterId(name, characterIds, characterNames)
    if (id && !out.includes(id)) out.push(id)
  }
  return out
}

export interface GroupContinueBody {
  turnOrdinal: number
  speakerCharacterId: string
  afterSegmentIndex: number
}

export type GroupContinueValidation =
  | 'ok'
  | 'invalid_body'
  | 'invalid_after_segment'
  | 'speaker_not_bound'
  | 'consecutive_speaker'
  | 'no_quota'
  | 'duplicate_speaker'

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
    const state = getTurnGroupChatState(turn, settings, characterIds)
    const quota = state.quotaRemaining[speaker]
    if (quota === undefined || quota <= 0) return 'no_quota'
    if (isGroupChatMemberMuted(speaker, settings)) return 'speaker_not_bound'
  }
  return 'ok'
}

export function pickFirstSpeakerForSend(params: {
  groupChatEnabled: boolean
  speakerQueueIds: string[]
  defaultCharacterId: string
}): string {
  const { speakerQueueIds, defaultCharacterId } = params
  if (speakerQueueIds.length > 0) return speakerQueueIds[0]!
  return defaultCharacterId
}

/** 组装/落盘：从 `/@` 队列解析本轮 outbound speaker（{{char}}） */
export function resolveOutboundSpeakerCharacterId(params: {
  groupChatEnabled: boolean
  groupChat?: GroupChatSettings
  characterIds: string[]
  characterNames: string[]
  defaultCharacterId: string
  conversationId?: string
  turnOrdinal?: number
  explicitSpeakerCharacterId?: string
  speakerQueueIds?: string[]
  speakerQueueDisplayNames?: string[]
}): string {
  const explicit = params.explicitSpeakerCharacterId?.trim()
  if (explicit) return explicit

  let speakerQueueIds =
    params.speakerQueueIds?.filter((id) => id.trim().length > 0) ?? []
  if (
    speakerQueueIds.length === 0 &&
    params.speakerQueueDisplayNames?.length
  ) {
    speakerQueueIds = resolveSpeakerQueueIds(
      params.speakerQueueDisplayNames,
      params.characterIds,
      params.characterNames,
    )
  }
  if (!params.groupChatEnabled && speakerQueueIds.length > 1) {
    speakerQueueIds = [speakerQueueIds[0]!]
  }
  if (
    params.groupChatEnabled &&
    params.groupChat &&
    params.conversationId &&
    typeof params.turnOrdinal === 'number'
  ) {
    const resolved = resolveFirstSegmentSpeaker({
      groupChat: params.groupChat,
      characterIds: params.characterIds,
      characterNames: params.characterNames,
      conversationId: params.conversationId,
      turnOrdinal: params.turnOrdinal,
      speakerQueueIds,
      defaultCharacterId: params.defaultCharacterId,
    })
    return resolved.speakerCharacterId ?? params.defaultCharacterId
  }
  return pickFirstSpeakerForSend({
    groupChatEnabled: params.groupChatEnabled,
    speakerQueueIds,
    defaultCharacterId: params.defaultCharacterId,
  })
}

export function spokenCharacterIdsFromTurn(
  turn: TurnRecord,
  defaultSpeakerCharacterId: string,
): string[] {
  return getTurnSegments(turn, defaultSpeakerCharacterId)
    .filter((s) => (s.receives?.length ?? 0) > 0)
    .map((s) => s.speakerCharacterId)
    .filter(Boolean)
}

const NEXT_AT_MARKER = /\[NEXT@([^\]]+)\]/g

/** 提取最后一个 [NEXT@Name] 并从正文 strip（宏/插件前） */
export function extractNextSpeakerHint(
  rawAssistant: string,
  characterIds: string[],
  characterNames: string[],
): { content: string; hintCharacterId?: string } {
  let lastName: string | null = null
  let m: RegExpExecArray | null
  const re = new RegExp(NEXT_AT_MARKER.source, 'g')
  while ((m = re.exec(rawAssistant)) !== null) {
    lastName = m[1]?.trim() ?? null
  }
  const content = rawAssistant.replace(NEXT_AT_MARKER, '').trim()
  let hintCharacterId: string | undefined
  if (lastName) {
    const id = resolveDisplayNameToCharacterId(
      lastName,
      characterIds,
      characterNames,
    )
    if (id) hintCharacterId = id
  }
  return { content, hintCharacterId }
}

export function resolveNextSpeaker(params: {
  groupChatEnabled: boolean
  groupChatSettings?: GroupChatSettings
  speakerQueue?: string[]
  lastHintCharacterId?: string
  spokenCharacterIds: string[]
  characterIds: string[]
  conversationId?: string
  turnOrdinal?: number
  nextSegmentIndex?: number
  turnState?: GroupChatTurnState
  lastSpeakerCharacterId?: string | null
}): string | null {
  const {
    groupChatEnabled,
    groupChatSettings,
    speakerQueue,
    lastHintCharacterId,
    characterIds,
  } = params
  const settings = normalizeGroupChatSettings(groupChatSettings)
  const turnState =
    params.turnState ?? initGroupChatTurnState(settings, characterIds)
  const lastSpeaker = params.lastSpeakerCharacterId ?? null

  const fromQueue = pickFromSpeakerQueue({
    speakerQueue,
    characterIds,
    settings,
    turnState,
    lastSpeakerCharacterId: lastSpeaker,
  })
  if (fromQueue) return fromQueue

  const speakerMode = settings.speakerMode ?? 'dice'
  if (
    speakerMode === 'next@' &&
    lastHintCharacterId &&
    groupChatEnabled
  ) {
    return validateNextAtHint({
      hintCharacterId: lastHintCharacterId,
      characterIds,
      settings,
      turnState,
      lastSpeakerCharacterId: lastSpeaker,
    })
  }
  if (!groupChatEnabled) return null

  if (speakerMode === 'sequential') {
    return pickSequentialSpeaker({
      characterIds,
      settings,
      turnState,
      lastSpeakerCharacterId: lastSpeaker,
    })
  }

  if (
    speakerMode === 'dice' &&
    params.conversationId &&
    typeof params.turnOrdinal === 'number' &&
    typeof params.nextSegmentIndex === 'number'
  ) {
    const eligible = listEligibleCharacterIds({
      characterIds,
      settings,
      turnState,
      lastSpeakerCharacterId: lastSpeaker,
    })
    const dice = diceBiddingPick({
      groupChat: settings,
      characterIds,
      turnState,
      eligibleIds: eligible,
      segmentCount: params.nextSegmentIndex,
      conversationId: params.conversationId,
      turnOrdinal: params.turnOrdinal,
      lastSpeakerCharacterId: lastSpeaker,
    })
    return dice.speakerCharacterId
  }
  return pickSequentialSpeaker({
    characterIds,
    settings,
    turnState,
    lastSpeakerCharacterId: lastSpeaker,
  })
}
