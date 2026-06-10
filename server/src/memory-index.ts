import { createEmbedding } from './embedding-client.js'
import {
  readBranchConversationIndex,
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
  replaceTurnMemoryIndex,
  type TurnMemoryRow,
} from './memory-store.js'
import {
  clearConversationMemoryBuffers,
  optimizeConversationMemoryTable,
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
  enumerateAllChunkChains,
  isTailChunkFile,
  readChunkFileAt,
} from './chunk-chain.js'
import { mainPathChunkLocation } from './chunk-path.js'
import { embedTextsInBatches, isEmbeddingBatchOk } from './embedding-batch.js'

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

/** 可生成 embedding 语料的 turn（重建计划 / 执行共用） */
export function filterEmbeddableTurns(turns: TurnRecord[]): TurnRecord[] {
  return turns.filter(isTurnEligibleForMemoryEmbed)
}

/** 单轮是否有非空 memory 语料 */
export function isTurnEligibleForMemoryEmbed(turn: TurnRecord): boolean {
  return turnEmbeddingCorpus(turn).trim().length > 0
}

/** 本会话是否应执行 turn 向量 upsert（memory 开启 + Embeddings API 已配置） */
export async function isConversationMemoryEmbedActive(
  conversationId: string,
): Promise<boolean> {
  const idx = await readConversationIndex(conversationId)
  if (!idx) return false
  const global = await readGlobalMemorySettings()
  const effective = resolveMemorySettings(global, idx?.memorySettings)
  if (!effective.memoryEnabled) return false
  const creds = await resolveEmbeddingApiCredentials()
  return creds != null
}

function lorebookIdsFromIndex(
  idx: Awaited<ReturnType<typeof readConversationIndex>>,
): string[] {
  if (!idx) return []
  return resolvedLorebookIds(idx)
}

async function countEmbeddableTurnsAlongChunkChain(
  conversationId: string,
): Promise<number> {
  const locations = await enumerateAllChunkChains(conversationId)
  let total = 0
  for (const loc of locations) {
    const chunk = await readChunkFileAt(
      conversationId,
      loc.branchPath,
      loc.chunkFileName,
    )
    total += filterEmbeddableTurns(chunk?.turns ?? []).length
  }
  return total
}

/** 统计本会话重建任务总量（可索引 turn + 向量资料条目） */
export async function planConversationMemoryReindex(
  conversationId: string,
): Promise<MemoryReindexPlan> {
  const idx = await readConversationIndex(conversationId)
  const lorebookIds = lorebookIdsFromIndex(idx)
  const turnCount = await countEmbeddableTurnsAlongChunkChain(conversationId)
  const loreEntries = await countLorebookVectorEntriesByIds(lorebookIds)
  return {
    turns: turnCount,
    loreEntries,
    total: turnCount + loreEntries,
  }
}

export { sealChunkMemorySegment } from './memory-tail-buffer.js'

/** 清除缓冲 + Lance 表（删会话等；全量重建改用 embed 成功后的 replaceTurnMemoryIndex） */
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
  branchPath = '',
): void {
  void indexTurnMemory(conversationId, turn, chunkFileName, branchPath).catch(
    (e) => {
      // eslint-disable-next-line no-console
      console.warn('[memory-index] upsert failed:', e)
    },
  )
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

async function markConversationMemoryEmbeddingModelIfChanged(
  conversationId: string,
): Promise<string> {
  const { embeddingModel, embeddingDimensions } =
    await readGlobalEmbeddingApiSettings()
  const idx = await readConversationIndex(conversationId)
  if (
    idx?.memoryEmbeddingModel === embeddingModel &&
    idx?.memoryEmbeddingDimensions === embeddingDimensions
  ) {
    return embeddingModel
  }
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
  branchPath: string,
): Promise<void> {
  const idx = await readConversationIndex(conversationId)
  const global = await readGlobalMemorySettings()
  const effective = resolveMemorySettings(global, idx?.memorySettings)
  if (!effective.memoryEnabled) return
  const corpus = turnEmbeddingCorpus(turn)
  if (!corpus.trim()) return
  const emb = await createEmbedding(corpus)
  if (!emb) return

  const loc = mainPathChunkLocation(chunkFileName)
  const resolvedBranch = branchPath || loc.branchPath
  const resolvedChunk = loc.chunkFileName
  const branchIdx =
    resolvedBranch === ''
      ? idx
      : await readBranchConversationIndex(conversationId, resolvedBranch)
  const isTail =
    branchIdx != null && isTailChunkFile(branchIdx, resolvedChunk)

  await queueTurnMemoryUpsert(
    conversationId,
    resolvedBranch,
    resolvedChunk,
    {
      turnId: turn.turnId,
      turnOrdinal: turn.turnOrdinal,
      branchPath: resolvedBranch,
      chunkFileName: resolvedChunk,
      vector: emb.vector,
    },
    isTail,
  )
  await markConversationMemoryEmbeddingModelIfChanged(conversationId)
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

  clearConversationMemoryBuffers(conversationId)

  type PendingTurn = {
    key: string
    corpus: string
    row: Omit<TurnMemoryRow, 'vector'>
  }
  const pending: PendingTurn[] = []

  const locations = await enumerateAllChunkChains(conversationId)
  for (const loc of locations) {
    const chunk = await readChunkFileAt(
      conversationId,
      loc.branchPath,
      loc.chunkFileName,
    )
    const turns = filterEmbeddableTurns(chunk?.turns ?? [])
    for (const turn of turns) {
      const corpus = turnEmbeddingCorpus(turn)
      pending.push({
        key: turn.turnId,
        corpus,
        row: {
          turnId: turn.turnId,
          turnOrdinal: turn.turnOrdinal,
          branchPath: loc.branchPath,
          chunkFileName: loc.chunkFileName,
        },
      })
    }
  }

  let indexed = 0

  const embedBatch = await embedTextsInBatches(
    creds,
    pending.map((p) => ({ key: p.key, text: p.corpus })),
  )
  if (!isEmbeddingBatchOk(embedBatch)) {
    return {
      ok: false,
      error: embedBatch.error,
      detail: embedBatch.detail,
    }
  }

  const builtRows: TurnMemoryRow[] = []
  for (const item of pending) {
    const vector = embedBatch.vectors.get(item.key)
    if (!vector?.length) continue
    builtRows.push({ ...item.row, vector })
    done += 1
    indexed += 1
    tick()
  }

  await replaceTurnMemoryIndex(conversationId, builtRows)
  await optimizeConversationMemoryTable(conversationId)

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
