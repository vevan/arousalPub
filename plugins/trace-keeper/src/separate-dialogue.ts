import { stripTraceKeeperBlocks } from './parse-block.js'
import { SEPARATE_TURN_COUNT_MIN } from './separate-turn-settings.js'

export type SeparateTurnRow = {
  turnOrdinal: number
  activeReceiveIndex: number
  userText?: string
  receives: { id: string; content: string }[]
}

export type SeparateChatMessage = {
  role: 'user' | 'assistant'
  content: string
}

function activeReceive(
  turn: Pick<SeparateTurnRow, 'activeReceiveIndex' | 'receives'>,
): { id: string; content: string } | null {
  const receives = turn.receives
  if (!receives.length) return null
  const idx = Math.min(
    Math.max(0, Math.floor(turn.activeReceiveIndex)),
    receives.length - 1,
  )
  return receives[idx] ?? null
}

/** Separate 补生成：窗口内多轮 user/assistant，与对话对齐；历史 state 保留在 assistant 正文（若有）。 */
export function buildSeparateDialogueMessages(
  tail: SeparateTurnRow[],
  targetOrdinal: number,
  windowTurnCount: number,
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

    const receive = activeReceive(turn)
    const rawAssistant = receive?.content?.trim()
    if (!rawAssistant) continue

    const assistantContent =
      turn.turnOrdinal === targetOrdinal
        ? stripTraceKeeperBlocks(rawAssistant).trim()
        : rawAssistant
    if (assistantContent) {
      messages.push({ role: 'assistant', content: assistantContent })
    }
  }

  return messages
}
