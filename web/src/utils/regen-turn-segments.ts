import type { AssistantSegmentItem, ReceiveItem } from '@/types/chat-turn'

/** regen 落盘：更新目标 segment 并在非末段时截断后续 segment（与服务端 updateTurnSegmentInTailChunk 一致） */
export function patchRegenSegments(
  segments: AssistantSegmentItem[],
  segIdx: number,
  receive: ReceiveItem,
): AssistantSegmentItem[] {
  const targetSeg = segments[segIdx]
  if (!targetSeg) return segments
  const next = [...segments]
  next[segIdx] = {
    ...targetSeg,
    receives: [...targetSeg.receives, receive],
    activeReceiveIndex: targetSeg.receives.length,
  }
  return next.length > segIdx + 1 ? next.slice(0, segIdx + 1) : next
}
