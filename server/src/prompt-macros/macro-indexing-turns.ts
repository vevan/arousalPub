import { readTurnsInOrdinalRange, readTurnsTail } from '../chunk-chain.js'
import type { TurnRecord } from '../chat-storage.js'

export const MACRO_INDEXING_TURN_CAP = 512

/** 宏 history 索引用 turn 集（与 chat-assemble / 插件扩宏一致） */
export async function loadTurnsForMacroIndexing(
  conversationId: string,
  beforeExclusive?: number | null,
): Promise<TurnRecord[]> {
  if (
    typeof beforeExclusive === 'number' &&
    !Number.isNaN(beforeExclusive)
  ) {
    if (beforeExclusive <= 0) return []
    return readTurnsInOrdinalRange(conversationId, 0, beforeExclusive - 1)
  }
  const { turns } = await readTurnsTail(conversationId, MACRO_INDEXING_TURN_CAP)
  return turns
}

/** 摘要 / 预览：锚定到 toTurn（含）时的 beforeExclusive */
export function macroBeforeExclusiveFromToTurn(
  toTurn: number | undefined | null,
): number | undefined {
  if (typeof toTurn !== 'number' || !Number.isFinite(toTurn)) return undefined
  return Math.floor(toTurn) + 1
}
