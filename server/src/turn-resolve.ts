import {
  readTailChunk,
  type ChunkFile,
  type TurnRecord,
} from './chat-storage.js'

/** 在尾块中按 turnId 查找完整 turn（MVP：仅尾块） */
export async function resolveTurnById(
  conversationId: string,
  turnId: string,
): Promise<TurnRecord | null> {
  const id = turnId.trim()
  if (!id) return null
  const chunk = await readTailChunk(conversationId)
  return findTurnInChunk(chunk, id)
}

export function findTurnInChunk(
  chunk: ChunkFile | null,
  turnId: string,
): TurnRecord | null {
  if (!chunk?.turns?.length) return null
  return chunk.turns.find((t) => t.turnId === turnId) ?? null
}

export function sortedTurnsFromChunk(chunk: ChunkFile | null): TurnRecord[] {
  if (!chunk?.turns?.length) return []
  return chunk.turns.slice().sort((a, b) => a.turnOrdinal - b.turnOrdinal)
}
