import path from 'node:path'
import type { Table } from '@lancedb/lancedb'
import { closeLanceDb, openLanceDb } from './lance-connection-pool.js'
import {
  ensureChineseFtsIndex,
  hybridRelevanceScore,
  LORE_FTS_COLUMN,
  runLanceHybridSearch,
} from './lance-hybrid-search.js'
import { getUserDataDir } from './config.js'
import { getCurrentUserId } from './user-context.js'

const TABLE_NAME = 'lore_entries'

export interface LoreEntryVectorRow {
  entryId: string
  lorebookId: string
  text: string
  vector: number[]
}

function rowToRecord(row: LoreEntryVectorRow): Record<string, unknown> {
  return {
    entryId: row.entryId,
    lorebookId: row.lorebookId,
    text: row.text,
    vector: row.vector,
  }
}

function lorebookDbUri(lorebookId: string): string {
  return path.join(
    getUserDataDir(getCurrentUserId()),
    'memory',
    'lorebooks',
    lorebookId,
  )
}

async function connectDb(lorebookId: string) {
  const uri = lorebookDbUri(lorebookId)
  return openLanceDb(uri)
}

function toSqlString(s: string): string {
  return s.replace(/'/g, "''")
}

async function openOrCreateTable(
  lorebookId: string,
  sampleVector: number[],
): Promise<Table> {
  const db = await connectDb(lorebookId)
  const names = await db.tableNames()
  if (names.includes(TABLE_NAME)) {
    return db.openTable(TABLE_NAME)
  }
  const seed: LoreEntryVectorRow = {
    entryId: '__seed__',
    lorebookId,
    text: '',
    vector: sampleVector,
  }
  const table = await db.createTable(TABLE_NAME, [rowToRecord(seed)])
  await table.delete(`entryId = '__seed__'`)
  return table
}

export async function replaceLorebookVectorIndex(
  lorebookId: string,
  rows: LoreEntryVectorRow[],
): Promise<void> {
  const uri = lorebookDbUri(lorebookId)
  const db = await connectDb(lorebookId)
  const names = await db.tableNames()
  if (names.includes(TABLE_NAME)) {
    await db.dropTable(TABLE_NAME)
  }
  if (!rows.length) {
    closeLanceDb(uri)
    return
  }
  const sample = rows[0]!.vector
  const table = await openOrCreateTable(lorebookId, sample)
  await table.add(rows.map(rowToRecord))
  await ensureChineseFtsIndex(table, LORE_FTS_COLUMN)
}

export async function deleteLorebookVectorIndex(
  lorebookId: string,
): Promise<void> {
  const uri = lorebookDbUri(lorebookId)
  const db = await connectDb(lorebookId)
  const names = await db.tableNames()
  if (!names.includes(TABLE_NAME)) return
  await db.dropTable(TABLE_NAME)
  closeLanceDb(uri)
}

export interface LoreEntryVectorHit {
  entryId: string
  score: number
}

export async function searchLorebookEntryVectors(
  lorebookId: string,
  queryVector: number[],
  queryText: string,
  topK: number,
  excludeEntryIds: Set<string> = new Set(),
): Promise<LoreEntryVectorHit[]> {
  if (!queryVector.length || topK < 1) return []
  const db = await connectDb(lorebookId)
  const names = await db.tableNames()
  if (!names.includes(TABLE_NAME)) return []
  const table = await db.openTable(TABLE_NAME)
  const k = Math.min(64, Math.max(topK * 3, topK))
  const raw = await runLanceHybridSearch({
    table,
    queryVector,
    queryText,
    textColumn: LORE_FTS_COLUMN,
    limit: k,
  })
  const hits: LoreEntryVectorHit[] = []
  for (const row of raw) {
    const entryId = String(row.entryId ?? '')
    if (!entryId || entryId === '__seed__' || excludeEntryIds.has(entryId)) {
      continue
    }
    hits.push({ entryId, score: hybridRelevanceScore(row) })
    if (hits.length >= topK) break
  }
  return hits
}
