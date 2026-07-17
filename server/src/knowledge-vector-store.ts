import path from 'node:path'
import { rm } from 'node:fs/promises'
import {
  Field,
  FixedSizeList,
  Float32,
  Int32,
  Schema,
  Utf8,
  type Table as ArrowTable,
} from 'apache-arrow'
import { makeArrowTable } from '@lancedb/lancedb'
import { createKeyedSerialQueue } from './keyed-serial-queue.js'
import { closeLanceDb, openLanceDb } from './lance-connection-pool.js'
import {
  listLanceTableNames,
  openLanceTableWithManifestMigration,
} from './lance-manifest-migrate.js'
import {
  ensureHybridFtsIndex,
  hybridRelevanceScore,
  hybridScoreKind,
  runLanceHybridSearch,
  withHybridFtsSettingsContext,
} from './lance-hybrid-search.js'
import {
  ensureScalarIndexes,
  type ScalarIndexSpec,
} from './lance-scalar-index.js'
import {
  ensureIvfPqIndex,
  KNOWLEDGE_ANN_REFINE_FACTOR,
  KNOWLEDGE_ANN_VECTOR_COLUMN,
} from './lance-vector-ann-index.js'
import { readGlobalHybridFtsSettings } from './user-preferences-file.js'
import { languageModelHomeForSettings } from './hybrid-fts-dict.js'
import { getUserDataDir } from './config.js'
import { getCurrentUserId } from './user-context.js'

const TABLE_NAME = 'doc_chunks'
export const KNOWLEDGE_FTS_COLUMN = 'text'

export const KNOWLEDGE_SCALAR_INDEX_SPECS: readonly ScalarIndexSpec[] = [
  { column: 'chunkId', kind: 'btree' },
  { column: 'fileId', kind: 'bitmap' },
]

const knowledgeLanceQueue = createKeyedSerialQueue()

/** replace/delete 递增；队列外 ANN 训练前校验，避免对已作废代次写索引 */
const knowledgeIndexGenerations = new Map<string, number>()

/**
 * 在途 ANN 训练（队列外，可达数分钟）。replace/delete 在队内先 await 它，
 * 训练期间不得 rm/重建同一目录；promise 在队内注册，后续队任务必然可见。
 */
const knowledgeAnnBuilds = new Map<string, Promise<void>>()

function bumpKnowledgeIndexGeneration(queueKey: string): number {
  const next = (knowledgeIndexGenerations.get(queueKey) ?? 0) + 1
  knowledgeIndexGenerations.set(queueKey, next)
  return next
}

function knowledgeIndexGeneration(queueKey: string): number {
  return knowledgeIndexGenerations.get(queueKey) ?? 0
}

/** 队列 key 按用户隔离：不同用户即使 kbId 碰撞也不互相串行/串数据 */
function knowledgeQueueKey(kbId: string): string {
  return `${getCurrentUserId()}\0${kbId}`
}

export interface DocChunkVectorRow {
  chunkId: string
  kbId: string
  fileId: string
  ordinal: number
  text: string
  vector: number[]
}

export interface DocChunkVectorHit {
  chunkId: string
  fileId: string
  ordinal: number
  text: string
  score: number
  scoreKind: 'rrf' | 'vector_fallback'
}

function knowledgeDbUri(kbId: string): string {
  return path.join(
    getUserDataDir(getCurrentUserId()),
    'memory',
    'knowledge',
    kbId,
  )
}

function rowToRecord(row: DocChunkVectorRow): Record<string, unknown> {
  return {
    chunkId: row.chunkId,
    kbId: row.kbId,
    fileId: row.fileId,
    ordinal: row.ordinal,
    text: row.text,
    vector: row.vector,
  }
}

function docChunkSchema(vectorDimensions: number): Schema {
  return new Schema([
    new Field('chunkId', new Utf8(), false),
    new Field('kbId', new Utf8(), false),
    new Field('fileId', new Utf8(), false),
    new Field('ordinal', new Int32(), false),
    new Field('text', new Utf8(), false),
    new Field(
      'vector',
      new FixedSizeList(
        vectorDimensions,
        new Field('item', new Float32(), false),
      ),
      false,
    ),
  ])
}

function rowsToArrowTable(rows: DocChunkVectorRow[]): ArrowTable {
  if (rows.length === 0) {
    throw new Error('rowsToArrowTable requires at least one row')
  }
  const dim = rows[0]!.vector.length
  for (const r of rows) {
    if (r.vector.length !== dim) {
      throw new Error('knowledge vector dimension mismatch')
    }
  }
  return makeArrowTable(rows.map(rowToRecord), {
    schema: docChunkSchema(dim),
  })
}

async function connectDb(kbId: string) {
  return openLanceDb(knowledgeDbUri(kbId))
}

export async function replaceKnowledgeVectorIndex(
  kbId: string,
  rows: DocChunkVectorRow[],
): Promise<void> {
  const uri = knowledgeDbUri(kbId)
  const qkey = knowledgeQueueKey(kbId)
  let buildGen = 0
  let rowCount = 0
  let annPromise: Promise<void> | undefined
  let resolveAnn: (() => void) | undefined
  await knowledgeLanceQueue.run(qkey, async () => {
    const prevAnn = knowledgeAnnBuilds.get(qkey)
    if (prevAnn) await prevAnn
    buildGen = bumpKnowledgeIndexGeneration(qkey)
    closeLanceDb(uri)
    await rm(uri, { recursive: true, force: true })
    if (!rows.length) return
    const db = await connectDb(kbId)
    const table = await db.createTable(TABLE_NAME, rowsToArrowTable(rows))
    const settings = await readGlobalHybridFtsSettings()
    const userId = getCurrentUserId()
    // FTS 建完后 listIndices / scalar 仍可能读 jieba 统计，须保持 LANCE_LANGUAGE_MODEL_HOME
    await withHybridFtsSettingsContext(userId, settings, async () => {
      await ensureHybridFtsIndex(
        table,
        KNOWLEDGE_FTS_COLUMN,
        settings,
        uri,
        userId,
      )
      await ensureScalarIndexes(table, KNOWLEDGE_SCALAR_INDEX_SPECS)
    })
    rowCount = rows.length
    annPromise = new Promise<void>((r) => {
      resolveAnn = r
    })
    knowledgeAnnBuilds.set(qkey, annPromise)
  })
  if (!annPromise) return
  // ANN 不依赖 jieba 词典，且训练可达数分钟：移出 Lance 队列，避免阻塞同库召回。
  // 后续 replace/delete 进队后先 await 本 promise，训练期间目录不会被抹。
  // 全程 soft：ANN 失败只降级 flat 搜索，不影响本次重建结果。
  try {
    if (knowledgeIndexGeneration(qkey) === buildGen) {
      const db = await connectDb(kbId)
      const table = await openLanceTableWithManifestMigration(
        db,
        TABLE_NAME,
        uri,
      )
      await ensureIvfPqIndex(table, KNOWLEDGE_ANN_VECTOR_COLUMN, {
        rowCount,
        soft: true,
      })
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[knowledge-vector-store] ANN build skipped:', e)
  } finally {
    resolveAnn?.()
    if (knowledgeAnnBuilds.get(qkey) === annPromise) {
      knowledgeAnnBuilds.delete(qkey)
    }
  }
}

export async function deleteKnowledgeVectorIndex(kbId: string): Promise<void> {
  const qkey = knowledgeQueueKey(kbId)
  await knowledgeLanceQueue.run(qkey, async () => {
    const prevAnn = knowledgeAnnBuilds.get(qkey)
    if (prevAnn) await prevAnn
    bumpKnowledgeIndexGeneration(qkey)
    const uri = knowledgeDbUri(kbId)
    closeLanceDb(uri)
    await rm(uri, { recursive: true, force: true })
  })
}

export async function searchKnowledgeChunkVectors(
  kbId: string,
  queryVector: number[],
  queryText: string,
  topK: number,
): Promise<DocChunkVectorHit[]> {
  if (!queryVector.length || topK < 1) return []
  return knowledgeLanceQueue.run(knowledgeQueueKey(kbId), () =>
    searchKnowledgeChunkVectorsUnsafe(kbId, queryVector, queryText, topK),
  )
}

async function searchKnowledgeChunkVectorsUnsafe(
  kbId: string,
  queryVector: number[],
  queryText: string,
  topK: number,
): Promise<DocChunkVectorHit[]> {
  const uri = knowledgeDbUri(kbId)
  const db = await connectDb(kbId)
  const names = await listLanceTableNames(db, uri)
  if (!names.includes(TABLE_NAME)) return []
  const table = await openLanceTableWithManifestMigration(db, TABLE_NAME, uri)
  const settings = await readGlobalHybridFtsSettings()
  const userId = getCurrentUserId()
  await withHybridFtsSettingsContext(userId, settings, async () => {
    await ensureScalarIndexes(table, KNOWLEDGE_SCALAR_INDEX_SPECS, {
      soft: true,
    })
  })
  const k = Math.min(64, Math.max(topK * 3, topK))
  const raw = await runLanceHybridSearch({
    table,
    queryVector,
    queryText,
    textColumn: KNOWLEDGE_FTS_COLUMN,
    limit: k,
    languageModelHome: languageModelHomeForSettings(userId, settings),
    refineFactor: KNOWLEDGE_ANN_REFINE_FACTOR,
  })
  const hits: DocChunkVectorHit[] = []
  for (const row of raw) {
    const chunkId = String(row.chunkId ?? '')
    if (!chunkId) continue
    hits.push({
      chunkId,
      fileId: String(row.fileId ?? ''),
      ordinal: Number(row.ordinal ?? 0),
      text: String(row.text ?? ''),
      score: hybridRelevanceScore(row),
      scoreKind: hybridScoreKind(row),
    })
    if (hits.length >= topK) break
  }
  return hits
}
