import { createEmbedding } from './embedding-client.js'
import {
  readConversationIndex,
  resolvedLorebookIds,
  updateConversationMemoryEmbeddingModel,
  type TurnRecord,
} from './chat-storage.js'
import { resolveEmbeddingApiCredentials } from './embedding-credential-resolve.js'
import { createKeyedCoalesceScheduler } from './keyed-serial-queue.js'
import {
  countLorebookVectorEntriesByIds,
  reindexLorebooksByIds,
} from './lorebook-vector-index.js'
import {
  deleteConversationMemoryIndex,
  deleteTurnMemoryVector,
  optimizeTurnMemoryTable,
  replaceTurnMemoryIndex,
  upsertTurnMemoryRowsBatch,
  type TurnMemoryRow,
} from './memory-store.js'
import {
  readGlobalEmbeddingApiSettings,
  readGlobalHybridFtsSettings,
  readGlobalMemorySettings,
} from './user-preferences-file.js'
import {
  buildMemoryEmbeddingCorpus,
  type MemoryCorpusOptions,
  RAW_MEMORY_CORPUS_OPTIONS,
  resolveMemoryCorpusOptions,
} from './memory-corpus.js'
import { resolveMemorySettings } from './memory-settings.js'
import { formatHybridFtsSpec } from './hybrid-fts-settings.js'
import {
  enumerateAllChunkChains,
  readChunkFileAt,
} from './chunk-chain.js'
import { mainPathChunkLocation, normalizeBranchPath } from './chunk-path.js'
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
  stage:
    | 'planning'
    | 'collecting_turns'
    | 'embedding_turns'
    | 'writing_turns'
    | 'embedding_lorebooks'
    | 'finalizing'
  stageDone?: number
  stageTotal?: number
}

/** 可生成 embedding 语料的 turn（重建计划 / 执行共用） */
export function filterEmbeddableTurns(
  turns: TurnRecord[],
  corpusOptions: MemoryCorpusOptions = RAW_MEMORY_CORPUS_OPTIONS,
): TurnRecord[] {
  return turns.filter((t) => isTurnEligibleForMemoryEmbed(t, corpusOptions))
}

/** 单轮是否有非空 memory 语料 */
export function isTurnEligibleForMemoryEmbed(
  turn: TurnRecord,
  corpusOptions: MemoryCorpusOptions = RAW_MEMORY_CORPUS_OPTIONS,
): boolean {
  return buildMemoryEmbeddingCorpus(turn, corpusOptions).trim().length > 0
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

async function optimizeConversationMemoryTable(
  conversationId: string,
): Promise<void> {
  await optimizeTurnMemoryTable(conversationId, {
    aggressiveCleanup: true,
  }).then(() => undefined)
}

/** chunk 封存（滚动/拆分）：best-effort 合并 Lance 碎片 */
export async function sealChunkMemorySegment(
  conversationId: string,
  _chunkFileName: string,
  _branchPath = '',
): Promise<void> {
  await optimizeConversationMemoryTable(conversationId).catch((e) => {
    // eslint-disable-next-line no-console
    console.warn('[memory-index] seal optimize failed:', e)
  })
}

/** 清除 Lance 表（删会话等；全量重建改用 embed 成功后的 replaceTurnMemoryIndex） */
export async function wipeConversationMemoryIndex(
  conversationId: string,
): Promise<void> {
  bumpMemoryReindexEpoch(conversationId)
  await deleteConversationMemoryIndex(conversationId)
}

type TurnMemoryScheduleOp =
  | {
      kind: 'upsert'
      conversationId: string
      turn: TurnRecord
      chunkFileName: string
      branchPath: string
    }
  | { kind: 'delete'; conversationId: string; turnId: string }

function turnMemoryOpKey(op: TurnMemoryScheduleOp): string {
  const turnId = op.kind === 'upsert' ? op.turn.turnId : op.turnId
  return `${op.conversationId}:${turnId}`
}

/**
 * Same turnId: coalesce fire-and-forget upserts to latest; delete overrides
 * pending upsert so embed order cannot resurrect a deleted row.
 */
const turnMemoryScheduler = createKeyedCoalesceScheduler<TurnMemoryScheduleOp>({
  keyOf: turnMemoryOpKey,
  process: async (op) => {
    if (op.kind === 'delete') {
      await deleteTurnMemoryVector(op.conversationId, op.turnId)
      return
    }
    await indexTurnMemory(
      op.conversationId,
      op.turn,
      op.chunkFileName,
      op.branchPath,
    )
  },
  onError: (e) => {
    // eslint-disable-next-line no-console
    console.warn('[memory-index] schedule failed:', e)
  },
})

/** Bumped on full reindex so in-flight per-turn embeds skip stale upserts. */
const memoryReindexEpoch = new Map<string, number>()

function bumpMemoryReindexEpoch(conversationId: string): number {
  const next = (memoryReindexEpoch.get(conversationId) ?? 0) + 1
  memoryReindexEpoch.set(conversationId, next)
  turnMemoryScheduler.clearPendingWhere((key) =>
    key.startsWith(`${conversationId}:`),
  )
  return next
}

/** 落盘后异步索引单轮（失败仅打日志） */
export function scheduleMemoryIndexUpsert(
  conversationId: string,
  turn: TurnRecord,
  chunkFileName: string,
  branchPath = '',
): void {
  turnMemoryScheduler.schedule({
    kind: 'upsert',
    conversationId,
    turn,
    chunkFileName,
    branchPath,
  })
}

export function scheduleMemoryIndexDelete(
  conversationId: string,
  turnId: string,
): void {
  turnMemoryScheduler.schedule({
    kind: 'delete',
    conversationId,
    turnId,
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
  const epochAtStart = memoryReindexEpoch.get(conversationId) ?? 0
  const idx = await readConversationIndex(conversationId)
  const global = await readGlobalMemorySettings()
  const effective = resolveMemorySettings(global, idx?.memorySettings)
  if (!effective.memoryEnabled) return
  const corpusOptions = await resolveMemoryCorpusOptions(effective)
  const corpus = buildMemoryEmbeddingCorpus(turn, corpusOptions)
  if (!corpus.trim()) return
  const emb = await createEmbedding(corpus)
  if (!emb) return
  if ((memoryReindexEpoch.get(conversationId) ?? 0) !== epochAtStart) return

  const loc = mainPathChunkLocation(chunkFileName)
  const resolvedBranch = branchPath.trim()
    ? normalizeBranchPath(branchPath)
    : loc.branchPath
  const resolvedChunk = loc.chunkFileName

  await upsertTurnMemoryRowsBatch(conversationId, [
    {
      turnId: turn.turnId,
      turnOrdinal: turn.turnOrdinal,
      branchPath: resolvedBranch,
      chunkFileName: resolvedChunk,
      corpus,
      vector: emb.vector,
    },
  ])
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
  bumpMemoryReindexEpoch(conversationId)
  const plan = await planConversationMemoryReindex(conversationId)
  const total = plan.total
  let done = 0
  const tick = (
    stage: MemoryReindexProgress['stage'],
    stageDone?: number,
    stageTotal?: number,
  ) => {
    options?.onProgress?.({ done, total, stage, stageDone, stageTotal })
  }
  tick('planning', 0, total)

  const { embeddingModel, embeddingDimensions } =
    await readGlobalEmbeddingApiSettings()
  const idx = await readConversationIndex(conversationId)
  const lorebookIds = lorebookIdsFromIndex(idx)
  const globalMemory = await readGlobalMemorySettings()
  const effectiveMemory = resolveMemorySettings(globalMemory, idx?.memorySettings)
  const corpusOptions = await resolveMemoryCorpusOptions(effectiveMemory)

  type PendingTurn = {
    key: string
    corpus: string
    row: Omit<TurnMemoryRow, 'vector' | 'corpus'>
  }
  const pending: PendingTurn[] = []

  const locations = await enumerateAllChunkChains(conversationId)
  let scannedLocations = 0
  for (const loc of locations) {
    const chunk = await readChunkFileAt(
      conversationId,
      loc.branchPath,
      loc.chunkFileName,
    )
    const turns = filterEmbeddableTurns(chunk?.turns ?? [], corpusOptions)
    for (const turn of turns) {
      const corpus = buildMemoryEmbeddingCorpus(turn, corpusOptions)
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
    scannedLocations += 1
    tick('collecting_turns', scannedLocations, locations.length)
  }

  let indexed = 0

  let reportedTurnEmbeddings = 0
  const embedBatch = await embedTextsInBatches(
    creds,
    pending.map((p) => ({ key: p.key, text: p.corpus })),
    {
      onProgress: (progress) => {
        const delta = progress.completedItems - reportedTurnEmbeddings
        reportedTurnEmbeddings = progress.completedItems
        done += delta
        tick(
          'embedding_turns',
          progress.completedItems,
          progress.totalItems,
        )
      },
    },
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
    builtRows.push({ ...item.row, corpus: item.corpus, vector })
    indexed += 1
  }

  tick('writing_turns', 0, builtRows.length)
  await replaceTurnMemoryIndex(conversationId, builtRows)
  tick('writing_turns', builtRows.length, builtRows.length)
  await optimizeConversationMemoryTable(conversationId).catch((e) => {
    // Optimize is a compaction hint after full replacement; do not fail rebuild
    // if Lance cannot optimize a specific table on this platform/data shape.
    // eslint-disable-next-line no-console
    console.warn('[memory-index] optimize after rebuild failed:', e)
  })

  let lorebooksReindexed = 0
  let lorebookEntriesIndexed = 0
  if (lorebookIds.length > 0) {
    let reportedLoreEntries = 0
    const loreResult = await reindexLorebooksByIds(lorebookIds, creds, {
      onEntryDone: () => {
        done += 1
        reportedLoreEntries += 1
        tick('embedding_lorebooks', reportedLoreEntries, plan.loreEntries)
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

  tick('finalizing', total, total)
  const hybridFtsSpec = formatHybridFtsSpec(await readGlobalHybridFtsSettings())
  await updateConversationMemoryEmbeddingModel(
    conversationId,
    embeddingModel,
    embeddingDimensions,
    hybridFtsSpec,
  )
  return {
    ok: true,
    indexed,
    embeddingModel,
    lorebooksReindexed,
    lorebookEntriesIndexed,
  }
}
