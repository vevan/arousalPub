import {
  readConversationIndex,
  readTailChunk,
  type ChunkFile,
  type TurnRecord,
} from './chat-storage.js'
import { readAllTurns, readChunkFile } from './chunk-chain.js'

/** 沿 chunk 链按 turnId 查找完整 turn */
export async function resolveTurnById(
  conversationId: string,
  turnId: string,
): Promise<TurnRecord | null> {
  const id = turnId.trim()
  if (!id) return null
  const idx = await readConversationIndex(conversationId)
  if (!idx?.tailChunkFile) return null
  let fileName: string | null = idx.tailChunkFile
  const guard = new Set<string>()
  while (fileName) {
    if (guard.has(fileName)) break
    guard.add(fileName)
    const chunk = await readChunkFile(conversationId, fileName)
    const hit = findTurnInChunk(chunk, id)
    if (hit) return hit
    fileName = chunk?.meta.links.previous ?? null
  }
  return null
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
