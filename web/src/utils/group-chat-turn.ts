import type { AssistantSegmentItem, ChatTurnItem, ReceiveItem } from '@/types/chat-turn'
import {
  cloneGroupChatTurnState,
  initGroupChatTurnState,
  listEligibleCharacterIds,
  normalizeGroupChatSettings,
  recordSegmentSpeaker,
  segmentSkipQuotaDeduction,
  type GroupChatSettings,
  type GroupChatTurnState,
} from './group-chat-settings'

function mapReceiveForPatch(r: ReceiveItem): Record<string, unknown> {
  return {
    id: r.id,
    content: r.content,
    ...(r.reasoning ? { reasoning: r.reasoning } : {}),
    ...(r.durationMs ? { durationMs: r.durationMs } : {}),
    ...(r.estimatedTokens ? { estimatedTokens: r.estimatedTokens } : {}),
    ...(r.completionTokens ? { completionTokens: r.completionTokens } : {}),
    ...(r.model ? { model: r.model } : {}),
  }
}

function syntheticPendingSegment(turn: ChatTurnItem): AssistantSegmentItem {
  return {
    id: '',
    speakerCharacterId: turn.speakerCharacterId?.trim() ?? '',
    receives: [],
    activeReceiveIndex: 0,
  }
}

/** 无 segments 时返回单条合成 segment（待发 assistant） */
export function getTurnSegments(turn: ChatTurnItem): AssistantSegmentItem[] {
  const segments = turn.segments ?? []
  if (segments.length > 0) return segments
  return [syntheticPendingSegment(turn)]
}

function resolveSegmentIndex(turn: ChatTurnItem, segmentIndex?: number): number {
  const segments = getTurnSegments(turn)
  const raw =
    typeof segmentIndex === 'number' && Number.isFinite(segmentIndex)
      ? segmentIndex
      : getActiveSegmentIndex(turn)
  return Math.min(Math.max(0, Math.floor(raw)), segments.length - 1)
}

export function getSegmentReceives(
  turn: ChatTurnItem,
  segmentIndex?: number,
): ReceiveItem[] {
  return getTurnSegments(turn)[resolveSegmentIndex(turn, segmentIndex)]?.receives ?? []
}

export function getActiveReceiveIndex(
  turn: ChatTurnItem,
  segmentIndex?: number,
): number {
  const receives = getSegmentReceives(turn, segmentIndex)
  if (receives.length === 0) return 0
  const seg = getTurnSegments(turn)[resolveSegmentIndex(turn, segmentIndex)]
  const ai = seg?.activeReceiveIndex ?? 0
  return Math.min(Math.max(0, ai), receives.length - 1)
}

export function getActiveReceive(
  turn: ChatTurnItem,
  segmentIndex?: number,
): ReceiveItem | null {
  const receives = getSegmentReceives(turn, segmentIndex)
  if (receives.length === 0) return null
  return receives[getActiveReceiveIndex(turn, segmentIndex)] ?? null
}

export function fingerprintTurnReceives(turn: ChatTurnItem): string {
  const segments = turn.segments ?? []
  if (segments.length === 0) return '0:'
  return segments
    .map((seg) => `${seg.activeReceiveIndex}:${seg.receives.map((r) => r.id).join(',')}`)
    .join('|')
}

export function getActiveSegmentIndex(turn: ChatTurnItem): number {
  const segments = getTurnSegments(turn)
  if (segments.length === 0) return 0
  if (typeof turn.activeSegmentIndex !== 'number') return 0
  return Math.min(
    Math.max(0, turn.activeSegmentIndex),
    segments.length - 1,
  )
}

export function getActiveSegment(
  turn: ChatTurnItem,
): AssistantSegmentItem | null {
  const segments = getTurnSegments(turn)
  if (segments.length === 0) return null
  return segments[getActiveSegmentIndex(turn)] ?? segments[0]!
}

/** PATCH /turns/:ord — 按 segment 提交 receives */
export function buildTurnPatchRequestBody(
  turn: ChatTurnItem,
  segmentIndex?: number,
): Record<string, unknown> {
  const segments = turn.segments ?? []
  if (segments.length === 0) {
    throw new Error(`turn ${turn.turnOrdinal} has no segments`)
  }
  const segIdx = segmentIndex ?? getActiveSegmentIndex(turn)
  const seg = segments[segIdx]
  if (!seg) {
    throw new Error(`turn ${turn.turnOrdinal} segment ${segIdx} missing`)
  }
  return {
    userText: turn.user,
    receives: seg.receives.map(mapReceiveForPatch),
    activeReceiveIndex: seg.activeReceiveIndex,
    segmentIndex: segIdx,
  }
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

export function characterNameById(
  characterId: string,
  characterIds: string[],
  characterNames: string[],
): string {
  const idx = characterIds.indexOf(characterId)
  if (idx >= 0 && characterNames[idx]?.trim()) return characterNames[idx]!.trim()
  return characterId
}

/** 审计展示：COCO #358A7F69；无卡名时仅 #ID */
export function formatCharacterAuditLabel(
  characterId: string,
  characterIds: string[],
  characterNames: string[],
): string {
  const id = characterId.trim()
  if (!id) return '—'
  const idTag = `#${id.toUpperCase()}`
  const name = characterNameById(id, characterIds, characterNames)
  if (!name || name === id) return idTag
  return `${name} ${idTag}`
}

export interface PendingGroupContinue {
  turnOrdinal: number
  listIndex: number
  afterSegmentIndex: number
  nextSpeakerCharacterId: string
  /** next@ hint 失败，需用户确认/改选 */
  manualPick?: boolean
  /** confirmContinue 或 manualPick 时可改选 */
  allowSpeakerChange?: boolean
  /** 可改选时的绑定角色 id */
  eligibleSpeakerCharacterIds?: string[]
}

function getTurnGroupChatStateFromItem(
  turn: ChatTurnItem,
  settings: GroupChatSettings,
  characterIds: string[],
): GroupChatTurnState {
  if (turn.groupChatTurnState) {
    return cloneGroupChatTurnState(turn.groupChatTurnState)
  }
  let state = initGroupChatTurnState(settings, characterIds)
  const segments = getTurnSegments(turn).filter((s) => (s.receives?.length ?? 0) > 0)
  for (const seg of segments) {
    const id = seg.speakerCharacterId.trim()
    if (id) {
      state = recordSegmentSpeaker(state, id, {
        skipQuotaDeduction: segmentSkipQuotaDeduction(seg.meta),
      })
    }
  }
  return state
}

export function listEligibleSpeakersForContinue(
  turn: ChatTurnItem,
  characterIds: string[],
  settings: GroupChatSettings,
): string[] {
  const normalized = normalizeGroupChatSettings(settings)
  const segments = getTurnSegments(turn).filter((s) => (s.receives?.length ?? 0) > 0)
  const lastSpeaker = segments[segments.length - 1]?.speakerCharacterId?.trim() ?? null
  const turnState = getTurnGroupChatStateFromItem(turn, normalized, characterIds)
  return listEligibleCharacterIds({
    characterIds,
    settings: normalized,
    turnState,
    lastSpeakerCharacterId: lastSpeaker,
  })
}

/** persist / 本地 turn 合并群聊额度快照 */
export function mergeTurnGroupChatStateFromPersist(
  turn: ChatTurnItem,
  persist?: { groupChatTurnState?: GroupChatTurnState },
): ChatTurnItem {
  if (!persist?.groupChatTurnState) return turn
  return { ...turn, groupChatTurnState: persist.groupChatTurnState }
}
