import path from 'node:path'
import type { OptimizeStats, Table } from '@lancedb/lancedb'
import { closeLanceDb, openLanceDb } from './lance-connection-pool.js'
import { getUserDataDir } from './config.js'
import { getCurrentUserId } from './user-context.js'
import {
  chunkIdFromFileName,
  listChunkFileNames,
  readChunkContainingTurnId,
} from './chunk-chain.js'
import {
  isTurnIdNullable,
  readTurnMemoryRowsFromTable,
  rowsToTurnMemoryArrowTable,
  type TurnMemoryRow,
} from './turn-memory-arrow.js'

export type { TurnMemoryRow } from './turn-memory-arrow.js'

const LEGACY_TABLE_NAME = 'turn_memory'
const CHUNK_TABLE_PREFIX = 'mem_'

const primaryKeyReady = new Set<string>()

function memoryDbUri(conversationId: string): string {
  return path.join(
    getUserDataDir(getCurrentUserId()),
    'memory',
    'conversations',
    conversationId,
  )
}

function primaryKeyCacheKey(conversationId: string, tableName: string): string {
  return `${conversationId}\0${tableName}`
}

/** JSON chunk 文件名 → Lance 表名（1 chunk ↔ 1 表） */
export function memoryTableNameForChunkFile(chunkFileName: string): string {
  return `${CHUNK_TABLE_PREFIX}${chunkIdFromFileName(chunkFileName)}`
}

function isChunkMemoryTableName(name: string): boolean {
  return name.startsWith(CHUNK_TABLE_PREFIX)
}

async function connectDb(conversationId: string) {
  return openLanceDb(memoryDbUri(conversationId))
}

async function openTableByName(
  conversationId: string,
  tableName: string,
): Promise<Table | null> {
  const db = await connectDb(conversationId)
  const names = await db.tableNames()
  if (!names.includes(tableName)) return null
  return db.openTable(tableName)
}

async function openChunkTable(
  conversationId: string,
  chunkFileName: string,
): Promise<Table | null> {
  return openTableByName(
    conversationId,
    memoryTableNameForChunkFile(chunkFileName),
  )
}

async function openLegacyTable(conversationId: string): Promise<Table | null> {
  return openTableByName(conversationId, LEGACY_TABLE_NAME)
}

async function ensureTurnIdPrimaryKey(
  table: Table,
  conversationId: string,
  tableName: string,
): Promise<void> {
  const key = primaryKeyCacheKey(conversationId, tableName)
  if (primaryKeyReady.has(key)) return
  await table.setUnenforcedPrimaryKey('turnId')
  primaryKeyReady.add(key)
}

async function dropTableByName(
  conversationId: string,
  tableName: string,
): Promise<void> {
  const db = await connectDb(conversationId)
  const names = await db.tableNames()
  if (!names.includes(tableName)) return
  await db.dropTable(tableName)
  primaryKeyReady.delete(primaryKeyCacheKey(conversationId, tableName))
}

async function migrateNullableTable(
  conversationId: string,
  tableName: string,
  table: Table,
): Promise<Table | null> {
  const rows = await readTurnMemoryRowsFromTable(table, conversationId)
  await dropTableByName(conversationId, tableName)
  if (rows.length === 0) return null
  return createChunkMemoryTable(conversationId, tableName, rows)
}

async function ensureMergeReadyTable(
  conversationId: string,
  tableName: string,
  table: Table,
): Promise<Table | null> {
  if (await isTurnIdNullable(table)) {
    return migrateNullableTable(conversationId, tableName, table)
  }
  await ensureTurnIdPrimaryKey(table, conversationId, tableName)
  return table
}

async function createChunkMemoryTable(
  conversationId: string,
  tableName: string,
  rows: TurnMemoryRow[],
): Promise<Table> {
  if (rows.length === 0) {
    throw new Error('createChunkMemoryTable requires at least one row')
  }
  const db = await connectDb(conversationId)
  const arrowTable = rowsToTurnMemoryArrowTable(rows)
  const table = await db.createTable(tableName, arrowTable)
  await ensureTurnIdPrimaryKey(table, conversationId, tableName)
  return table
}

function toSqlString(s: string): string {
  return s.replace(/'/g, "''")
}

export interface OptimizeTurnMemoryOptions {
  immediate?: boolean
  aggressiveCleanup?: boolean
}

export async function optimizeChunkMemoryTable(
  conversationId: string,
  chunkFileName: string,
  options?: OptimizeTurnMemoryOptions,
): Promise<OptimizeStats | null> {
  const uri = memoryDbUri(conversationId)
  const tableName = memoryTableNameForChunkFile(chunkFileName)
  const table = await openTableByName(conversationId, tableName)
  if (!table) return null

  const optimizeOptions =
    options?.aggressiveCleanup === true
      ? { cleanupOlderThan: new Date() }
      : undefined

  const stats = await table.optimize(optimizeOptions)
  closeLanceDb(uri)
  return stats
}

/** 批量 mergeInsert 到指定 chunk 表 */
export async function upsertTurnMemoryRowsBatch(
  conversationId: string,
  chunkFileName: string,
  rows: TurnMemoryRow[],
): Promise<void> {
  if (!rows.length) return
  const valid = rows.filter((r) => r.vector.length > 0)
  if (!valid.length) return

  const tableName = memoryTableNameForChunkFile(chunkFileName)
  let existing = await openTableByName(conversationId, tableName)
  if (existing) {
    existing = await ensureMergeReadyTable(conversationId, tableName, existing)
  }
  if (!existing) {
    await createChunkMemoryTable(conversationId, tableName, valid)
    return
  }
  await existing
    .mergeInsert('turnId')
    .whenMatchedUpdateAll()
    .whenNotMatchedInsertAll()
    .execute(rowsToTurnMemoryArrowTable(valid))
}

/** 替换单个 chunk 的 memory 表（全量重建该块） */
export async function replaceChunkMemoryIndex(
  conversationId: string,
  chunkFileName: string,
  rows: TurnMemoryRow[],
): Promise<void> {
  const tableName = memoryTableNameForChunkFile(chunkFileName)
  await dropTableByName(conversationId, tableName)
  if (!rows.length) return
  await createChunkMemoryTable(conversationId, tableName, rows)
  await optimizeChunkMemoryTable(conversationId, chunkFileName, {
    aggressiveCleanup: true,
  })
}

export async function deleteTurnMemoryVector(
  conversationId: string,
  turnId: string,
): Promise<void> {
  const id = turnId.trim()
  if (!id) return

  const located = await readChunkContainingTurnId(conversationId, id)
  if (located) {
    const table = await openChunkTable(conversationId, located.fileName)
    if (table) {
      await table.delete(`turnId = '${toSqlString(id)}'`)
    }
    return
  }

  const legacy = await openLegacyTable(conversationId)
  if (legacy) {
    await legacy.delete(`turnId = '${toSqlString(id)}'`)
  }
}

export async function deleteConversationMemoryIndex(
  conversationId: string,
): Promise<void> {
  const uri = memoryDbUri(conversationId)
  const db = await connectDb(conversationId)
  const names = await db.tableNames()
  for (const name of names) {
    if (name === LEGACY_TABLE_NAME || isChunkMemoryTableName(name)) {
      await db.dropTable(name)
      primaryKeyReady.delete(primaryKeyCacheKey(conversationId, name))
    }
  }
  closeLanceDb(uri)
}

export interface MemorySearchHit {
  turnId: string
  turnOrdinal: number
  score: number
}

function collectSearchHits(
  raw: Record<string, unknown>[],
  excludeTurnIds: Set<string>,
  maxOrdinalExclusive: number | undefined,
  out: MemorySearchHit[],
  topK: number,
): void {
  for (const row of raw) {
    const turnId = String(row.turnId ?? '')
    if (!turnId || turnId === '__seed__' || excludeTurnIds.has(turnId)) {
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
    const dist = Number(row._distance ?? 0)
    const score = 1 / (1 + dist)
    out.push({ turnId, turnOrdinal, score })
    if (out.length >= topK * 8) break
  }
}

async function searchOneTable(
  table: Table,
  queryVector: number[],
  k: number,
  excludeTurnIds: Set<string>,
  maxOrdinalExclusive: number | undefined,
  out: MemorySearchHit[],
  topK: number,
): Promise<void> {
  const raw = await table.vectorSearch(queryVector).limit(k).toArray()
  collectSearchHits(raw, excludeTurnIds, maxOrdinalExclusive, out, topK)
}

/** 跨 chunk 表向量 TopK；兼容旧版单表 turn_memory */
export async function searchTurnMemoryVectors(
  conversationId: string,
  queryVector: number[],
  topK: number,
  excludeTurnIds: Set<string> = new Set(),
  maxOrdinalExclusive?: number,
): Promise<MemorySearchHit[]> {
  if (!queryVector.length || topK < 1) return []
  const k = Math.min(64, Math.max(topK * 3, topK))
  const hits: MemorySearchHit[] = []

  const chunkFiles = await listChunkFileNames(conversationId)
  for (const chunkFile of chunkFiles) {
    const table = await openChunkTable(conversationId, chunkFile)
    if (!table) continue
    await searchOneTable(
      table,
      queryVector,
      k,
      excludeTurnIds,
      maxOrdinalExclusive,
      hits,
      topK,
    )
  }

  const legacy = await openLegacyTable(conversationId)
  if (legacy) {
    await searchOneTable(
      legacy,
      queryVector,
      k,
      excludeTurnIds,
      maxOrdinalExclusive,
      hits,
      topK,
    )
  }

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
