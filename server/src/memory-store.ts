import path from 'node:path'
import type { OptimizeStats, Table } from '@lancedb/lancedb'
import { closeLanceDb, openLanceDb } from './lance-connection-pool.js'
import {
  listLanceTableNames,
  openLanceTableWithManifestMigration,
} from './lance-manifest-migrate.js'
import {
  buildAllowedBranchPathsWhereSql,
  normalizeBranchPath,
} from './chunk-path.js'
import { getUserDataDir } from './config.js'
import { readGlobalHybridFtsSettings } from './user-preferences-file.js'
import { languageModelHomeForSettings } from './hybrid-fts-dict.js'
import {
  ensureHybridFtsIndex,
  hybridRelevanceScore,
  MEMORY_FTS_COLUMN,
  runLanceHybridSearch,
  withHybridFtsSettingsContext,
} from './lance-hybrid-search.js'
import { getCurrentUserId } from './user-context.js'
import {
  isTurnIdNullable,
  readTurnMemoryRowsFromTable,
  rowsToTurnMemoryArrowTable,
  tableHasCorpusColumn,
  type TurnMemoryRow,
} from './turn-memory-arrow.js'

export type { TurnMemoryRow } from './turn-memory-arrow.js'

const TABLE_NAME = 'turn_memory'
/** 旧版每 chunk 一表；wipe 时一并删除 */
const LEGACY_CHUNK_TABLE_PREFIX = 'mem_'

const primaryKeyReady = new Set<string>()
const legacyMemoryWarned = new Set<string>()

function memoryDbUri(conversationId: string): string {
  return path.join(
    getUserDataDir(getCurrentUserId()),
    'memory',
    'conversations',
    conversationId,
  )
}

async function ensureMemoryHybridFtsIndex(
  conversationId: string,
  table: Table,
): Promise<void> {
  const userId = getCurrentUserId()
  const settings = await readGlobalHybridFtsSettings()
  await ensureHybridFtsIndex(
    table,
    MEMORY_FTS_COLUMN,
    settings,
    memoryDbUri(conversationId),
    userId,
  )
}

async function withMemoryHybridFtsContext<T>(fn: () => Promise<T>): Promise<T> {
  const userId = getCurrentUserId()
  const settings = await readGlobalHybridFtsSettings()
  return withHybridFtsSettingsContext(userId, settings, fn)
}

function primaryKeyCacheKey(conversationId: string): string {
  return `${conversationId}\0${TABLE_NAME}`
}

async function connectDb(conversationId: string) {
  return openLanceDb(memoryDbUri(conversationId))
}

function warnLegacyMemoryTablesOnce(
  conversationId: string,
  tableNames: string[],
): void {
  const key = conversationId
  if (legacyMemoryWarned.has(key)) return
  const hasLegacy = tableNames.some((n) => n.startsWith(LEGACY_CHUNK_TABLE_PREFIX))
  const hasV2 = tableNames.includes(TABLE_NAME)
  if (!hasLegacy || hasV2) return
  legacyMemoryWarned.add(key)
  // eslint-disable-next-line no-console
  console.warn(
    `[memory] conversation ${conversationId} has legacy mem_* tables without v2 turn_memory; rebuild recommended`,
  )
}

async function openMemoryTable(
  conversationId: string,
): Promise<Table | null> {
  const uri = memoryDbUri(conversationId)
  const db = await connectDb(conversationId)
  const names = await listLanceTableNames(db, uri)
  warnLegacyMemoryTablesOnce(conversationId, names)
  if (!names.includes(TABLE_NAME)) return null
  return openLanceTableWithManifestMigration(db, TABLE_NAME, uri)
}

async function ensureTurnIdPrimaryKey(
  table: Table,
  conversationId: string,
): Promise<void> {
  const key = primaryKeyCacheKey(conversationId)
  if (primaryKeyReady.has(key)) return
  try {
    await table.setUnenforcedPrimaryKey('turnId')
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (!msg.includes('already set')) throw e
  }
  primaryKeyReady.add(key)
}

async function dropTableByName(
  conversationId: string,
  tableName: string,
): Promise<void> {
  const uri = memoryDbUri(conversationId)
  const db = await connectDb(conversationId)
  const names = await listLanceTableNames(db, uri)
  if (!names.includes(tableName)) return
  await db.dropTable(tableName)
  if (tableName === TABLE_NAME) {
    primaryKeyReady.delete(primaryKeyCacheKey(conversationId))
  }
}

async function migrateNullableTable(
  conversationId: string,
  table: Table,
): Promise<Table | null> {
  const rows = await readTurnMemoryRowsFromTable(table)
  await dropTableByName(conversationId, TABLE_NAME)
  if (rows.length === 0) return null
  return createTurnMemoryTable(conversationId, rows)
}

async function migrateMissingCorpusColumn(
  conversationId: string,
  table: Table,
): Promise<Table | null> {
  if (await tableHasCorpusColumn(table)) return table
  const rows = await readTurnMemoryRowsFromTable(table)
  await dropTableByName(conversationId, TABLE_NAME)
  if (rows.length === 0) return null
  const withCorpus = rows.map((r) => ({ ...r, corpus: r.corpus || '' }))
  const recreated = await createTurnMemoryTable(conversationId, withCorpus)
  await ensureMemoryHybridFtsIndex(conversationId, recreated)
  return recreated
}

async function ensureMergeReadyTable(
  conversationId: string,
  table: Table,
): Promise<Table | null> {
  if (await isTurnIdNullable(table)) {
    return migrateNullableTable(conversationId, table)
  }
  const withCorpus = await migrateMissingCorpusColumn(conversationId, table)
  if (!withCorpus) return null
  await ensureTurnIdPrimaryKey(withCorpus, conversationId)
  return withCorpus
}

async function createTurnMemoryTable(
  conversationId: string,
  rows: TurnMemoryRow[],
): Promise<Table> {
  if (rows.length === 0) {
    throw new Error('createTurnMemoryTable requires at least one row')
  }
  const db = await connectDb(conversationId)
  const arrowTable = rowsToTurnMemoryArrowTable(rows)
  const table = await db.createTable(TABLE_NAME, arrowTable)
  await ensureTurnIdPrimaryKey(table, conversationId)
  return table
}

function toSqlString(s: string): string {
  return s.replace(/'/g, "''")
}

export interface OptimizeTurnMemoryOptions {
  aggressiveCleanup?: boolean
}

export async function optimizeTurnMemoryTable(
  conversationId: string,
  options?: OptimizeTurnMemoryOptions,
): Promise<OptimizeStats | null> {
  const uri = memoryDbUri(conversationId)
  const optimizeOptions =
    options?.aggressiveCleanup === true
      ? { cleanupOlderThan: new Date() }
      : undefined

  const stats = await withMemoryHybridFtsContext(async () => {
    const table = await openMemoryTable(conversationId)
    if (!table) return null
    return table.optimize(optimizeOptions)
  })
  closeLanceDb(uri)
  return stats
}

export interface UpsertTurnMemoryRowsBatchOptions {
  /** 全量重建时延后建 FTS，避免批间 mergeInsert 触碰 jieba 索引 */
  deferFts?: boolean
}

/** 批量 mergeInsert 到会话单表 turn_memory */
export async function upsertTurnMemoryRowsBatch(
  conversationId: string,
  rows: TurnMemoryRow[],
  options?: UpsertTurnMemoryRowsBatchOptions,
): Promise<void> {
  if (!rows.length) return
  const valid = rows.filter((r) => r.vector.length > 0)
  if (!valid.length) return

  let existing = await openMemoryTable(conversationId)
  if (existing) {
    existing = await ensureMergeReadyTable(conversationId, existing)
  }
  if (!existing) {
    const table = await createTurnMemoryTable(conversationId, valid)
    if (!options?.deferFts) {
      await ensureMemoryHybridFtsIndex(conversationId, table)
    }
    return
  }
  await withMemoryHybridFtsContext(async () => {
    await existing!
      .mergeInsert('turnId')
      .whenMatchedUpdateAll()
      .whenNotMatchedInsertAll()
      .execute(rowsToTurnMemoryArrowTable(valid))
  })
}

/** 弃用分支子树时删除对应 Lance 行（含嵌套 branchPath） */
export async function deleteTurnMemoryByBranchSubtree(
  conversationId: string,
  branchPath: string,
): Promise<void> {
  const bp = normalizeBranchPath(branchPath)
  if (!bp) return

  const table = await openMemoryTable(conversationId)
  if (!table) return
  const esc = toSqlString(bp)
  await table.delete(`branchPath = '${esc}' OR branchPath LIKE '${esc}/%'`)
}

export async function deleteTurnMemoryVector(
  conversationId: string,
  turnId: string,
): Promise<void> {
  const id = turnId.trim()
  if (!id) return

  const table = await openMemoryTable(conversationId)
  if (!table) return
  await table.delete(`turnId = '${toSqlString(id)}'`)
}

const REPLACE_TURN_MEMORY_BATCH = 50

/**
 * 全量替换 turn_memory（重建成功路径；调用方须已完成 embed）。
 * embed / API 失败时不应调用，以免清空旧索引。
 */
export async function replaceTurnMemoryIndex(
  conversationId: string,
  rows: TurnMemoryRow[],
  batchSize = REPLACE_TURN_MEMORY_BATCH,
): Promise<void> {
  await deleteConversationMemoryIndex(conversationId)
  const valid = rows.filter((r) => r.vector.length > 0)
  for (let i = 0; i < valid.length; i += batchSize) {
    await upsertTurnMemoryRowsBatch(
      conversationId,
      valid.slice(i, i + batchSize),
      { deferFts: true },
    )
  }
  const table = await openMemoryTable(conversationId)
  if (table) {
    await ensureMemoryHybridFtsIndex(conversationId, table)
  }
}

export async function deleteConversationMemoryIndex(
  conversationId: string,
): Promise<void> {
  const uri = memoryDbUri(conversationId)
  const db = await connectDb(conversationId)
  const names = await listLanceTableNames(db, uri)
  for (const name of names) {
    if (name === TABLE_NAME || name.startsWith(LEGACY_CHUNK_TABLE_PREFIX)) {
      await db.dropTable(name)
      if (name === TABLE_NAME) {
        primaryKeyReady.delete(primaryKeyCacheKey(conversationId))
      }
    }
  }
  closeLanceDb(uri)
}

export interface MemorySearchHit {
  turnId: string
  turnOrdinal: number
  branchPath: string
  chunkFileName: string
  score: number
}

/** Lance vectorSearch 预过滤 SQL（分支链 + 排除近期 history ordinal） */
export function buildMemoryVectorSearchWhereClause(
  allowedBranchPaths: Set<string> | undefined,
  maxOrdinalExclusive: number | undefined,
): string | undefined {
  const parts: string[] = []
  const branchWhere = buildAllowedBranchPathsWhereSql(allowedBranchPaths)
  if (branchWhere) parts.push(branchWhere)
  if (
    typeof maxOrdinalExclusive === 'number' &&
    !Number.isNaN(maxOrdinalExclusive)
  ) {
    parts.push(`turnOrdinal < ${maxOrdinalExclusive}`)
  }
  if (parts.length === 0) return undefined
  return parts.join(' AND ')
}

function collectSearchHits(
  raw: Record<string, unknown>[],
  excludeTurnIds: Set<string>,
  maxOrdinalExclusive: number | undefined,
  allowedBranchPaths: Set<string> | undefined,
  out: MemorySearchHit[],
  topK: number,
): void {
  for (const row of raw) {
    const turnId = String(row.turnId ?? '')
    if (!turnId || turnId === '__seed__' || excludeTurnIds.has(turnId)) {
      continue
    }
    const branchPath = String(row.branchPath ?? '')
    if (
      allowedBranchPaths &&
      allowedBranchPaths.size > 0 &&
      !allowedBranchPaths.has(branchPath)
    ) {
      continue
    }
    const turnOrdinal = Number(row.turnOrdinal ?? 0)
    if (
      typeof maxOrdinalExclusive === 'number' &&
      !Number.isNaN(maxOrdinalExclusive) &&
      turnOrdinal >= maxOrdinalExclusive
    ) {
      continue
    }
    const chunkFileName = String(row.chunkFileName ?? '')
    if (!chunkFileName) continue
    out.push({
      turnId,
      turnOrdinal,
      branchPath,
      chunkFileName,
      score: hybridRelevanceScore(row),
    })
    if (out.length >= topK * 8) break
  }
}

/** 单测 / 集成辅助：内存侧 branchPath 兜底过滤（与 Lance `.where` 语义一致） */
export function filterMemorySearchRawRows(
  raw: Record<string, unknown>[],
  params: {
    excludeTurnIds?: Set<string>
    maxOrdinalExclusive?: number
    allowedBranchPaths?: Set<string>
    topK?: number
  } = {},
): MemorySearchHit[] {
  const out: MemorySearchHit[] = []
  collectSearchHits(
    raw,
    params.excludeTurnIds ?? new Set(),
    params.maxOrdinalExclusive,
    params.allowedBranchPaths,
    out,
    params.topK ?? 20,
  )
  return out
}

/** 单表 hybrid TopK（Memory v2） */
export async function searchTurnMemoryVectors(
  conversationId: string,
  queryVector: number[],
  queryText: string,
  topK: number,
  excludeTurnIds: Set<string> = new Set(),
  maxOrdinalExclusive?: number,
  allowedBranchPaths?: Set<string>,
): Promise<MemorySearchHit[]> {
  if (!queryVector.length || topK < 1) return []
  const k = Math.min(64, Math.max(topK * 3, topK))

  const table = await openMemoryTable(conversationId)
  if (!table) return []

  const whereClause = buildMemoryVectorSearchWhereClause(
    allowedBranchPaths,
    maxOrdinalExclusive,
  )
  const settings = await readGlobalHybridFtsSettings()
  const userId = getCurrentUserId()
  const raw = await runLanceHybridSearch({
    table,
    queryVector,
    queryText,
    textColumn: MEMORY_FTS_COLUMN,
    limit: k,
    whereClause,
    languageModelHome: languageModelHomeForSettings(userId, settings),
  })
  const hits: MemorySearchHit[] = []
  collectSearchHits(
    raw as Record<string, unknown>[],
    excludeTurnIds,
    maxOrdinalExclusive,
    allowedBranchPaths,
    hits,
    topK,
  )

  hits.sort((a, b) => b.score - a.score)
  const seen = new Set<string>()
  const merged: MemorySearchHit[] = []
  for (const h of hits) {
    if (seen.has(h.turnId)) continue
    seen.add(h.turnId)
    merged.push(h)
    if (merged.length >= topK) break
  }
  return merged
}
