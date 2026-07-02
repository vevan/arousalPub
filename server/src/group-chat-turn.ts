import { createHash } from 'node:crypto'
import type { TurnReceive, TurnRecord } from './chat-storage.js'

export interface AssistantSegmentRecord {
  id: string
  speakerCharacterId: string
  receives: TurnReceive[]
  activeReceiveIndex: number
  meta?: {
    nextSpeakerHint?: string
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
}

export type GroupChatMode = 'weighted' | 'sequential'

export interface GroupChatSettings {
  enabled?: boolean
  mode?: GroupChatMode
  autoContinue?: boolean
  confirmContinue?: boolean
  decay?: GroupChatDecaySettings
  members?: Record<string, GroupChatMemberSettings>
}

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
    mode: 'weighted',
    autoContinue: false,
    confirmContinue: true,
    decay: defaultGroupChatDecaySettings(),
    members: {},
  }
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
  const modeRaw = typeof o.mode === 'string' ? o.mode.trim().toLowerCase() : ''
  const mode: GroupChatMode =
    modeRaw === 'sequential' ? 'sequential' : 'weighted'
  return {
    enabled: typeof o.enabled === 'boolean' ? o.enabled : base.enabled,
    mode,
    autoContinue:
      typeof o.autoContinue === 'boolean' ? o.autoContinue : base.autoContinue,
    confirmContinue:
      typeof o.confirmContinue === 'boolean'
        ? o.confirmContinue
        : base.confirmContinue,
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
  if (typeof o.mode === 'string') {
    const m = o.mode.trim().toLowerCase()
    if (m === 'weighted' || m === 'sequential') next.mode = m
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

/** 下一段 segment 索引（0-based） */
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
}

export function resolveNextSpeakerWithDecay(params: {
  turn: TurnRecord
  characterIds: string[]
  characterNames: string[]
  defaultSpeakerCharacterId: string
  groupChat: GroupChatSettings
  conversationId: string
  random?: () => number
}): ResolveNextSpeakerResult {
  const groupChat = normalizeGroupChatSettings(params.groupChat)
  if (!groupChat.enabled) {
    return { speakerCharacterId: null }
  }
  const nextSegmentIndex = nextSegmentIndexForTurn(
    params.turn,
    params.defaultSpeakerCharacterId,
  )
  const segments = getTurnSegments(params.turn, params.defaultSpeakerCharacterId)
  const lastSeg = segments[segments.length - 1]
  const spoken = spokenCharacterIdsFromTurn(
    params.turn,
    params.defaultSpeakerCharacterId,
  )
  if (
    !hasGroupChatContinuationCandidate({
      groupChat,
      speakerQueue: params.turn.speakerQueue,
      lastHintCharacterId: lastSeg?.meta?.nextSpeakerHint,
      spokenCharacterIds: spoken,
      characterIds: params.characterIds,
    })
  ) {
    return { speakerCharacterId: null }
  }
  if (
    !rollGroupChatDecay(
      nextSegmentIndex,
      groupChat.decay ?? defaultGroupChatDecaySettings(),
      params.random,
    )
  ) {
    return { speakerCharacterId: null, decayStopped: true }
  }
  const speaker = resolveNextSpeaker({
    groupChatEnabled: true,
    groupChatSettings: groupChat,
    speakerQueue: params.turn.speakerQueue,
    lastHintCharacterId: lastSeg?.meta?.nextSpeakerHint,
    spokenCharacterIds: spoken,
    characterIds: params.characterIds,
    conversationId: params.conversationId,
    turnOrdinal: params.turn.turnOrdinal,
    nextSegmentIndex,
  })
  return { speakerCharacterId: speaker }
}

/** 旧 turn → segments；缺省 speaker 为 characterIds[0] */
export function getTurnSegments(
  turn: TurnRecord,
  defaultSpeakerCharacterId: string,
): AssistantSegmentRecord[] {
  if (Array.isArray(turn.segments) && turn.segments.length > 0) {
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
  const speaker =
    defaultSpeakerCharacterId.trim() ||
    (typeof turn.speakerCharacterId === 'string'
      ? turn.speakerCharacterId.trim()
      : '')
  return [
    {
      id: `${turn.turnId}-seg0`,
      speakerCharacterId: speaker,
      receives: turn.receives ?? [],
      activeReceiveIndex: turn.activeReceiveIndex ?? 0,
    },
  ]
}

export function getActiveSegmentIndex(turn: TurnRecord): number {
  if (
    Array.isArray(turn.segments) &&
    turn.segments.length > 0 &&
    typeof turn.activeSegmentIndex === 'number'
  ) {
    return Math.min(
      Math.max(0, turn.activeSegmentIndex),
      turn.segments.length - 1,
    )
  }
  return 0
}

export function getActiveSegment(
  turn: TurnRecord,
  defaultSpeakerCharacterId: string,
): AssistantSegmentRecord {
  const segments = getTurnSegments(turn, defaultSpeakerCharacterId)
  const idx = getActiveSegmentIndex(turn)
  return segments[idx] ?? segments[0]!
}

/** 将 active segment 同步到 legacy receives / activeReceiveIndex */
export function syncLegacyFieldsFromSegments(turn: TurnRecord): void {
  const defaultSpeaker =
    turn.segments?.[0]?.speakerCharacterId?.trim() ??
    turn.speakerCharacterId?.trim() ??
    ''
  const seg = getActiveSegment(turn, defaultSpeaker)
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
): GroupContinueValidation {
  const segments = getTurnSegments(turn, defaultSpeakerCharacterId)
  const lastIndex = Math.max(0, segments.length - 1)
  if (body.afterSegmentIndex !== lastIndex) {
    return 'invalid_after_segment'
  }
  const speaker = speakerCharacterId.trim()
  if (!speaker || !characterIds.includes(speaker)) {
    return 'speaker_not_bound'
  }
  const spoken = new Set(
    segments
      .filter((s) => (s.receives?.length ?? 0) > 0)
      .map((s) => s.speakerCharacterId),
  )
  if (spoken.has(speaker)) return 'duplicate_speaker'
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
  characterIds: string[]
  characterNames: string[]
  defaultCharacterId: string
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

/** 写盘前将 legacy receives 物化为 segments[] */
export function materializeTurnSegments(
  turn: TurnRecord,
  defaultSpeakerCharacterId: string,
): AssistantSegmentRecord[] {
  if (Array.isArray(turn.segments) && turn.segments.length > 0) {
    return turn.segments
  }
  turn.segments = getTurnSegments(turn, defaultSpeakerCharacterId)
  if (typeof turn.activeSegmentIndex !== 'number') {
    turn.activeSegmentIndex = 0
  }
  syncLegacyFieldsFromSegments(turn)
  return turn.segments
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
}): string | null {
  const {
    groupChatEnabled,
    groupChatSettings,
    speakerQueue,
    lastHintCharacterId,
    spokenCharacterIds,
    characterIds,
  } = params
  const settings = normalizeGroupChatSettings(groupChatSettings)
  const spoken = new Set(spokenCharacterIds)

  if (Array.isArray(speakerQueue)) {
    for (const rawId of speakerQueue) {
      const id = rawId.trim()
      if (!id || spoken.has(id) || !characterIds.includes(id)) continue
      if (isGroupChatMemberMuted(id, settings)) continue
      return id
    }
  }
  if (
    lastHintCharacterId &&
    characterIds.includes(lastHintCharacterId) &&
    !spoken.has(lastHintCharacterId) &&
    !isGroupChatMemberMuted(lastHintCharacterId, settings)
  ) {
    return lastHintCharacterId
  }
  if (!groupChatEnabled) return null

  const candidates = listGroupChatCandidateIds(
    characterIds,
    spokenCharacterIds,
    settings,
  )
  if (candidates.length === 0) return null

  const mode = settings.mode ?? 'weighted'
  if (
    mode === 'weighted' &&
    params.conversationId &&
    typeof params.turnOrdinal === 'number' &&
    typeof params.nextSegmentIndex === 'number'
  ) {
    return pickWeightedGroupChatSpeaker({
      conversationId: params.conversationId,
      turnOrdinal: params.turnOrdinal,
      nextSegmentIndex: params.nextSegmentIndex,
      candidateIds: candidates,
      settings,
    })
  }
  return candidates[0] ?? null
}
