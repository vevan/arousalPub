import type { ChatTurnItem, ReceiveItem } from '../../types/chat-turn.js'
import type { GroupChatTurnState } from '../../utils/group-chat-settings.js'
import { allocateShortId } from '../../utils/short-id.js'

export function collectUsedIdsFromTurn(turn: ChatTurnItem): Set<string> {
  const used = new Set<string>()
  for (const r of turn.receives) used.add(r.id)
  for (const seg of turn.segments ?? []) {
    used.add(seg.id)
    for (const r of seg.receives) used.add(r.id)
  }
  return used
}

export function collectUsedIdsFromTurns(turns: ChatTurnItem[]): Set<string> {
  const used = new Set<string>()
  for (const t of turns) {
    for (const id of collectUsedIdsFromTurn(t)) used.add(id)
  }
  return used
}

export function buildPendingUserTurnItem(
  userText: string,
  ord: number,
  usedIds: Set<string>,
  meta?: { speakerCharacterId?: string; speakerQueue?: string[] },
): ChatTurnItem {
  const speakerId = meta?.speakerCharacterId?.trim() ?? ''
  const pendingSegment = {
    id: allocateShortId(usedIds),
    speakerCharacterId: speakerId,
    receives: [] as ReceiveItem[],
    activeReceiveIndex: 0,
  }
  return {
    user: userText,
    receives: [],
    activeReceiveIndex: 0,
    turnOrdinal: ord,
    segments: [pendingSegment],
    activeSegmentIndex: 0,
    ...(speakerId ? { speakerCharacterId: speakerId } : {}),
    ...(meta?.speakerQueue?.length ? { speakerQueue: meta.speakerQueue } : {}),
  }
}

export function mergeFinalizedPendingTurn(
  cur: ChatTurnItem,
  merged: ReceiveItem,
  meta?: {
    speakerCharacterId?: string
    speakerQueue?: string[]
    segmentIndex?: number
    activeSegmentIndex?: number
    groupChatTurnState?: GroupChatTurnState
  },
  finalUserText?: string,
): ChatTurnItem {
  const speakerId = meta?.speakerCharacterId?.trim() ?? cur.speakerCharacterId ?? ''
  const segIdx = meta?.activeSegmentIndex ?? meta?.segmentIndex ?? 0
  const segments = [...(cur.segments ?? [])]
  const existingSeg = segments[segIdx]
  const finalizedSeg = {
    id: existingSeg?.id ?? allocateShortId(collectUsedIdsFromTurn(cur)),
    speakerCharacterId: speakerId,
    receives: [merged],
    activeReceiveIndex: 0,
  }
  if (segIdx < segments.length) {
    segments[segIdx] = finalizedSeg
  } else if (segIdx === segments.length) {
    segments.push(finalizedSeg)
  } else {
    segments[0] = finalizedSeg
  }
  const activeSegIdx = meta?.activeSegmentIndex ?? segIdx
  const activeSeg = segments[activeSegIdx] ?? finalizedSeg
  return {
    ...cur,
    ...(finalUserText !== undefined ? { user: finalUserText } : {}),
    receives: activeSeg.receives,
    activeReceiveIndex: activeSeg.activeReceiveIndex,
    segments,
    activeSegmentIndex: activeSegIdx,
    ...(meta?.speakerQueue?.length ? { speakerQueue: meta.speakerQueue } : {}),
    ...(speakerId ? { speakerCharacterId: speakerId } : {}),
    ...(meta?.groupChatTurnState
      ? { groupChatTurnState: meta.groupChatTurnState }
      : {}),
  }
}
