import { createEmbedding, createEmbeddingWithCredentials } from './embedding-client.js'
import {
  readConversationIndex,
  readTailChunk,
  resolvedLorebookIds,
  updateConversationMemoryEmbeddingModel,
  type TurnRecord,
} from './chat-storage.js'
import { resolveEmbeddingApiCredentials } from './embedding-credential-resolve.js'
import {
  countLorebookVectorEntriesByIds,
  reindexLorebooksByIds,
} from './lorebook-vector-index.js'
import {
  deleteTurnMemoryVector,
  replaceConversationMemoryIndex,
  upsertTurnMemoryVector,
  type TurnMemoryRow,
} from './memory-store.js'
import {
  readGlobalEmbeddingApiSettings,
  readGlobalMemorySettings,
} from './user-preferences-file.js'
import { turnEmbeddingCorpus } from './turn-memory-xml.js'
import { sortedTurnsFromChunk } from './turn-resolve.js'

export interface MemoryReindexPlan {
  turns: number
  loreEntries: number
  total: number
}

export interface MemoryReindexResult {
  ok: true
  indexed: number
  embeddingModel: string
  lorebooksReindexed: number
  lorebookEntriesIndexed: number
}

export interface MemoryReindexError {
  ok: false
  error: string
  detail?: string
}

export interface MemoryReindexProgress {
  done: number
  total: number
}

function embeddableTurns(turns: TurnRecord[]): TurnRecord[] {
  return turns.filter((turn) => turnEmbeddingCorpus(turn).trim().length > 0)
}

function lorebookIdsFromIndex(
  idx: Awaited<ReturnType<typeof readConversationIndex>>,
): string[] {
  if (!idx) return []
  return resolvedLorebookIds(idx)
}

/** 统计本会话重建任务总量（可索引 turn + 向量资料条目） */
export async function planConversationMemoryReindex(
  conversationId: string,
): Promise<MemoryReindexPlan> {
  const idx = await readConversationIndex(conversationId)
  const lorebookIds = lorebookIdsFromIndex(idx)
  const chunk = await readTailChunk(conversationId)
  const turns = embeddableTurns(sortedTurnsFromChunk(chunk))
  const loreEntries = await countLorebookVectorEntriesByIds(lorebookIds)
  return {
    turns: turns.length,
    loreEntries,
    total: turns.length + loreEntries,
  }
}

/** 落盘后异步索引单轮（失败仅打日志） */
export function scheduleMemoryIndexUpsert(
  conversationId: string,
  turn: TurnRecord,
): void {
  void indexTurnMemory(conversationId, turn).catch((e) => {
    // eslint-disable-next-line no-console
    console.warn('[memory-index] upsert failed:', e)
  })
}

export function scheduleMemoryIndexDelete(
  conversationId: string,
  turnId: string,
): void {
  void deleteTurnMemoryVector(conversationId, turnId).catch((e) => {
    // eslint-disable-next-line no-console
    console.warn('[memory-index] delete failed:', e)
  })
}

async function markConversationMemoryEmbeddingModel(
  conversationId: string,
): Promise<string> {
  const { embeddingModel, embeddingDimensions } =
    await readGlobalEmbeddingApiSettings()
  await updateConversationMemoryEmbeddingModel(
    conversationId,
    embeddingModel,
    embeddingDimensions,
  )
  return embeddingModel
}

async function indexTurnMemory(
  conversationId: string,
  turn: TurnRecord,
): Promise<void> {
  const global = await readGlobalMemorySettings()
  if (!global.memoryEnabled) return
  const corpus = turnEmbeddingCorpus(turn)
  if (!corpus.trim()) return
  const emb = await createEmbedding(corpus)
  if (!emb) return
  await upsertTurnMemoryVector(conversationId, {
    turnId: turn.turnId,
    conversationId,
    turnOrdinal: turn.turnOrdinal,
    vector: emb.vector,
  })
  await markConversationMemoryEmbeddingModel(conversationId)
}

/** 重建当前会话全部 turn 的远期记忆向量索引，并同步绑定资料库 */
export async function reindexConversationMemory(
  conversationId: string,
  options?: { onProgress?: (progress: MemoryReindexProgress) => void },
): Promise<MemoryReindexResult | MemoryReindexError> {
  const creds = await resolveEmbeddingApiCredentials()
  if (!creds) {
    return { ok: false, error: 'Embeddings API 未配置' }
  }
  const plan = await planConversationMemoryReindex(conversationId)
  const total = plan.total
  let done = 0
  const tick = () => {
    options?.onProgress?.({ done, total })
  }

  const { embeddingModel, embeddingDimensions } =
    await readGlobalEmbeddingApiSettings()
  const idx = await readConversationIndex(conversationId)
  const lorebookIds = lorebookIdsFromIndex(idx)
  const chunk = await readTailChunk(conversationId)
  const turns = embeddableTurns(sortedTurnsFromChunk(chunk))
  const rows: TurnMemoryRow[] = []
  for (const turn of turns) {
    const corpus = turnEmbeddingCorpus(turn)
    const emb = await createEmbeddingWithCredentials(creds, corpus)
    if ('error' in emb) {
      return {
        ok: false,
        error: emb.error,
        detail: emb.detail,
      }
    }
    rows.push({
      turnId: turn.turnId,
      conversationId,
      turnOrdinal: turn.turnOrdinal,
      vector: emb.vector,
    })
    done += 1
    tick()
  }
  await replaceConversationMemoryIndex(conversationId, rows)
  let lorebooksReindexed = 0
  let lorebookEntriesIndexed = 0
  if (lorebookIds.length > 0) {
    const loreResult = await reindexLorebooksByIds(lorebookIds, creds, {
      onEntryDone: () => {
        done += 1
        tick()
      },
    })
    if ('error' in loreResult) {
      const detail = [
        loreResult.detail,
        loreResult.lorebookId ? `lorebookId=${loreResult.lorebookId}` : '',
      ]
        .filter((x) => x && x.length > 0)
        .join(' ')
      return {
        ok: false,
        error: loreResult.error,
        detail: detail || undefined,
      }
    }
    lorebooksReindexed = loreResult.lorebooksReindexed
    lorebookEntriesIndexed = loreResult.lorebookEntriesIndexed
  }
  await updateConversationMemoryEmbeddingModel(
    conversationId,
    embeddingModel,
    embeddingDimensions,
  )
  return {
    ok: true,
    indexed: rows.length,
    embeddingModel,
    lorebooksReindexed,
    lorebookEntriesIndexed,
  }
}
