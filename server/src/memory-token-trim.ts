import type { TurnRecord } from './chat-storage.js'
import { estimateTokens } from './token-count.js'
import { formatMemoryXml } from './turn-memory-xml.js'

/** §14.4：memory 槽在 contextLength 预算中的占比上限 */
export function memoryTokenBudget(contextLength: number): number {
  const n = Math.floor(contextLength)
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.max(256, Math.min(4096, Math.floor(n * 0.18)))
}

export function trimMemoryItemsByTokenBudget(
  items: { turn: TurnRecord; score: number }[],
  maxMemoryTokens: number,
  tokenModel?: string,
): {
  items: { turn: TurnRecord; score: number }[]
  memoryText: string
  memoryTurnIds: string[]
  droppedMemoryCount: number
} {
  if (maxMemoryTokens <= 0 || items.length === 0) {
    const memoryText = formatMemoryXml(items)
    return {
      items,
      memoryText,
      memoryTurnIds: items.map((x) => x.turn.turnId),
      droppedMemoryCount: 0,
    }
  }

  let working = items.slice()
  let droppedMemoryCount = 0
  const countTokens = (list: typeof working) => {
    const xml = formatMemoryXml(list)
    if (!xml) return 0
    return estimateTokens(xml, { model: tokenModel })
  }

  while (working.length > 0 && countTokens(working) > maxMemoryTokens) {
    let dropIdx = 0
    let lowest = working[0]!.score
    for (let i = 1; i < working.length; i++) {
      const s = working[i]!.score
      if (s < lowest) {
        lowest = s
        dropIdx = i
      }
    }
    working = working.filter((_, i) => i !== dropIdx)
    droppedMemoryCount += 1
  }

  const memoryText = formatMemoryXml(working)
  return {
    items: working,
    memoryText,
    memoryTurnIds: working.map((x) => x.turn.turnId),
    droppedMemoryCount,
  }
}
