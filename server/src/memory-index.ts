import { createEmbedding, createEmbeddingWithCredentials } from './embedding-client.js'
import {
  readConversationIndex,
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
  deleteConversationMemoryIndex,
  deleteTurnMemoryVector,
  replaceChunkMemoryIndex,
  type TurnMemoryRow,
} from './memory-store.js'
import {
  clearConversationMemoryBuffers,
  queueTurnMemoryUpsert,
  removeBufferedTurnMemory,
} from './memory-tail-buffer.js'
import {
  readGlobalEmbeddingApiSettings,
  readGlobalMemorySettings,
} from './user-preferences-file.js'
import { resolveMemorySettings } from './memory-settings.js'
import { turnEmbeddingCorpus } from './turn-memory-xml.js'
import {
  isTailChunkFile,
  listChunkFileNames,
  readAllTurns,
  readChunkFile,
} from './chunk-chain.js'

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
  const turns = embeddableTurns(await readAllTurns(conversationId))
  const loreEntries = await countLorebookVectorEntriesByIds(lorebookIds)
  return {
    turns: turns.length,
    loreEntries,
    total: turns.length + loreEntries,
  }
}

export { sealChunkMemorySegment } from './memory-tail-buffer.js'

/** 清除缓冲 + Lance 表（删会话 / 全量重建前） */
export async function wipeConversationMemoryIndex(
  conversationId: string,
): Promise<void> {
  clearConversationMemoryBuffers(conversationId)
  await deleteConversationMemoryIndex(conversationId)
}

/** 落盘后异步索引单轮（失败仅打日志） */
export function scheduleMemoryIndexUpsert(
  conversationId: string,
  turn: TurnRecord,
  chunkFileName: string,
): void {
  void indexTurnMemory(conversationId, turn, chunkFileName).catch((e) => {
    // eslint-disable-next-line no-console
    console.warn('[memory-index] upsert failed:', e)
  })
}

export function scheduleMemoryIndexDelete(
  conversationId: string,
  turnId: string,
): void {
  removeBufferedTurnMemory(conversationId, turnId)
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
  chunkFileName: string,
): Promise<void> {
  const idx = await readConversationIndex(conversationId)
  const global = await readGlobalMemorySettings()
  const effective = resolveMemorySettings(global, idx?.memorySettings)
  if (!effective.memoryEnabled) return
  const corpus = turnEmbeddingCorpus(turn)
  if (!corpus.trim()) return
  const emb = await createEmbedding(corpus)
  if (!emb) return

  const isTail = idx != null && isTailChunkFile(idx, chunkFileName)

  await queueTurnMemoryUpsert(
    conversationId,
    chunkFileName,
    {
      turnId: turn.turnId,
      conversationId,
      turnOrdinal: turn.turnOrdinal,
      vector: emb.vector,
    },
    isTail,
  )
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

  await wipeConversationMemoryIndex(conversationId)

  const chunkFiles = await listChunkFileNames(conversationId)
  let indexed = 0
  for (const chunkFileName of chunkFiles) {
    const chunk = await readChunkFile(conversationId, chunkFileName)
    const turns = embeddableTurns(chunk?.turns ?? [])
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
      indexed += 1
      tick()
    }
    if (rows.length > 0) {
      await replaceChunkMemoryIndex(conversationId, chunkFileName, rows)
    }
  }

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
    indexed,
    embeddingModel,
    lorebooksReindexed,
    lorebookEntriesIndexed,
  }
}
