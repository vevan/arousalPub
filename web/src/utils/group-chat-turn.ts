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

/** PATCH /turns/:ord — 多 segment 时带 segmentIndex */
export function buildTurnPatchRequestBody(
  turn: ChatTurnItem,
  segmentIndex?: number,
): Record<string, unknown> {
  const segIdx = segmentIndex ?? getActiveSegmentIndex(turn)
  const segments = getTurnSegmentsForUi(turn)
  const seg = segments[segIdx] ?? segments[0]
  if (!seg) {
    return {
      userText: turn.user,
      receives: turn.receives.map(mapReceiveForPatch),
      activeReceiveIndex: turn.activeReceiveIndex,
    }
  }
  const body: Record<string, unknown> = {
    userText: turn.user,
    receives: seg.receives.map(mapReceiveForPatch),
    activeReceiveIndex: seg.activeReceiveIndex,
  }
  if (turn.segments?.length) {
    body.segmentIndex = segIdx
    body.activeSegmentIndex = segIdx
  }
  return body
}

export function getTurnSegmentsForUi(turn: ChatTurnItem): AssistantSegmentItem[] {
  return Array.isArray(turn.segments) && turn.segments.length > 0
    ? turn.segments
    : []
}

export function getActiveSegmentIndex(turn: ChatTurnItem): number {
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
