import { stripTraceKeeperBlocks } from './parse-block.js'
import { SEPARATE_TURN_COUNT_MIN } from './separate-turn-settings.js'
import {
  activeReceiveFromSegment,
  type HostTurnWithSegments,
} from './host-segment-snapshot.js'

export type SeparateTurnRow = HostTurnWithSegments & {
  turnOrdinal: number
  userText?: string
}

export type SeparateChatMessage = {
  role: 'user' | 'assistant'
  content: string
}

function resolveTargetSegmentIndex(
  turn: SeparateTurnRow,
  targetOrdinal: number,
  targetSegmentIndex?: number,
): number | null {
  if (turn.turnOrdinal !== targetOrdinal) return null
  const segments = turn.segments ?? []
  if (segments.length === 0) return null
  const defaultIdx = Math.min(
    Math.max(0, Math.floor(turn.activeSegmentIndex)),
    segments.length - 1,
  )
  if (
    typeof targetSegmentIndex === 'number' &&
    Number.isFinite(targetSegmentIndex)
  ) {
    return Math.min(
      Math.max(0, Math.floor(targetSegmentIndex)),
      segments.length - 1,
    )
  }
  return defaultIdx
}

/** Separate 补生成：窗口内多轮 user/assistant，与对话对齐；历史 state 保留在 assistant 正文（若有）。 */
export function buildSeparateDialogueMessages(
  tail: SeparateTurnRow[],
  targetOrdinal: number,
  windowTurnCount: number,
  targetSegmentIndex?: number,
): SeparateChatMessage[] {
  const cap = Math.max(SEPARATE_TURN_COUNT_MIN, Math.floor(windowTurnCount))
  const fromOrdinal = targetOrdinal - cap + 1
  const windowTurns = tail
    .filter(
      (t) =>
        t.turnOrdinal >= fromOrdinal && t.turnOrdinal <= targetOrdinal,
    )
    .sort((a, b) => a.turnOrdinal - b.turnOrdinal)

  const messages: SeparateChatMessage[] = []
  for (const turn of windowTurns) {
    const userText = turn.userText?.trim()
    if (userText) {
      messages.push({ role: 'user', content: userText })
    }

    const targetSegIdx = resolveTargetSegmentIndex(
      turn,
      targetOrdinal,
      targetSegmentIndex,
    )
    const segments = turn.segments ?? []
    for (let si = 0; si < segments.length; si += 1) {
      const seg = segments[si]!
      const receive = activeReceiveFromSegment(seg)
      const rawAssistant = receive?.content?.trim()
      if (!rawAssistant) continue

      const isTargetSegment = targetSegIdx !== null && si === targetSegIdx
      const assistantContent = isTargetSegment
        ? stripTraceKeeperBlocks(rawAssistant).trim()
        : rawAssistant
      if (assistantContent) {
        messages.push({ role: 'assistant', content: assistantContent })
      }
    }
  }

  return messages
}
