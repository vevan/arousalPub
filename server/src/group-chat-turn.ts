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

export interface GroupChatSettings {
  enabled?: boolean
  autoContinue?: boolean
  confirmContinue?: boolean
}

export function defaultGroupChatSettings(): GroupChatSettings {
  return {
    enabled: false,
    autoContinue: false,
    confirmContinue: true,
  }
}

export function normalizeGroupChatSettings(
  raw: unknown,
): GroupChatSettings {
  const base = defaultGroupChatSettings()
  if (!raw || typeof raw !== 'object') return base
  const o = raw as Record<string, unknown>
  return {
    enabled: typeof o.enabled === 'boolean' ? o.enabled : base.enabled,
    autoContinue:
      typeof o.autoContinue === 'boolean' ? o.autoContinue : base.autoContinue,
    confirmContinue:
      typeof o.confirmContinue === 'boolean'
        ? o.confirmContinue
        : base.confirmContinue,
  }
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
  speakerQueue?: string[]
  lastHintCharacterId?: string
  spokenCharacterIds: string[]
  characterIds: string[]
}): string | null {
  const {
    groupChatEnabled,
    speakerQueue,
    lastHintCharacterId,
    spokenCharacterIds,
    characterIds,
  } = params
  if (Array.isArray(speakerQueue)) {
    const remaining = speakerQueue.filter(
      (id) => !spokenCharacterIds.includes(id),
    )
    if (remaining.length > 0) return remaining[0]!
  }
  if (
    lastHintCharacterId &&
    characterIds.includes(lastHintCharacterId) &&
    !spokenCharacterIds.includes(lastHintCharacterId)
  ) {
    return lastHintCharacterId
  }
  if (!groupChatEnabled) return null
  for (const id of characterIds) {
    if (!spokenCharacterIds.includes(id)) return id
  }
  return null
}
