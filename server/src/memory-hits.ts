import { readChunkFileAt } from './chunk-chain.js'
import { chunkLocationKey } from './chunk-path.js'
import type { TurnRecord } from './chat-storage.js'
import type { MemorySearchHit } from './memory-store.js'

export interface MemoryHitTurnItem {
  turn: TurnRecord
  score: number
}

/**
 * 按 branchPath + chunkFileName 批量读 chunk，解析向量命中对应的 TurnRecord。
 * 保持 hits 原有 score 排序。
 */
export async function loadTurnsForMemoryHits(
  conversationId: string,
  hits: MemorySearchHit[],
  excludeTurnIds: Set<string> = new Set(),
): Promise<MemoryHitTurnItem[]> {
  if (!hits.length) return []

  const groups = new Map<
    string,
    { branchPath: string; chunkFileName: string; hits: MemorySearchHit[] }
  >()
  for (const hit of hits) {
    const key = chunkLocationKey(hit.branchPath, hit.chunkFileName)
    let group = groups.get(key)
    if (!group) {
      group = {
        branchPath: hit.branchPath,
        chunkFileName: hit.chunkFileName,
        hits: [],
      }
      groups.set(key, group)
    }
    group.hits.push(hit)
  }

  const turnById = new Map<string, TurnRecord>()
  const scoreByTurnId = new Map<string, number>()

  for (const group of groups.values()) {
    const chunk = await readChunkFileAt(
      conversationId,
      group.branchPath,
      group.chunkFileName,
    )
    if (!chunk) continue
    const idToTurn = new Map(chunk.turns.map((t) => [t.turnId, t]))
    for (const hit of group.hits) {
      if (excludeTurnIds.has(hit.turnId)) continue
      const turn = idToTurn.get(hit.turnId)
      if (!turn) continue
      turnById.set(hit.turnId, turn)
      scoreByTurnId.set(hit.turnId, hit.score)
    }
  }

  const items: MemoryHitTurnItem[] = []
  for (const hit of hits) {
    if (excludeTurnIds.has(hit.turnId)) continue
    const turn = turnById.get(hit.turnId)
    if (!turn) continue
    items.push({ turn, score: scoreByTurnId.get(hit.turnId) ?? hit.score })
  }
  return items
}
