import type { AssistantSegmentItem, ChatTurnItem, ReceiveItem } from '@/types/chat-turn'

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

export function getTurnSegments(turn: ChatTurnItem): AssistantSegmentItem[] {
  return turn.segments ?? []
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

/** PATCH /turns/:ord — 有 segment 时按 segment 提交；无 segment 时仅 user 正文（待发轮次） */
export function buildTurnPatchRequestBody(
  turn: ChatTurnItem,
  segmentIndex?: number,
): Record<string, unknown> {
  const segments = getTurnSegments(turn)
  if (segments.length === 0) {
    return {
      userText: turn.user,
      receives: turn.receives.map(mapReceiveForPatch),
      activeReceiveIndex: turn.activeReceiveIndex,
    }
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
    activeSegmentIndex: segIdx,
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

export interface PendingGroupContinue {
  turnOrdinal: number
  listIndex: number
  afterSegmentIndex: number
  nextSpeakerCharacterId: string
}
