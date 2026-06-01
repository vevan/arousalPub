import path from 'node:path'
import type { Table } from '@lancedb/lancedb'
import { closeLanceDb, openLanceDb } from './lance-connection-pool.js'
import { getUserDataDir } from './config.js'
import { getCurrentUserId } from './user-context.js'

const TABLE_NAME = 'turn_memory'

export interface TurnMemoryRow {
  turnId: string
  conversationId: string
  turnOrdinal: number
  vector: number[]
}

function rowToRecord(row: TurnMemoryRow): Record<string, unknown> {
  return {
    turnId: row.turnId,
    conversationId: row.conversationId,
    turnOrdinal: row.turnOrdinal,
    vector: row.vector,
  }
}

function memoryDbUri(conversationId: string): string {
  return path.join(
    getUserDataDir(getCurrentUserId()),
    'memory',
    'conversations',
    conversationId,
  )
}

async function connectDb(conversationId: string) {
  const uri = memoryDbUri(conversationId)
  return openLanceDb(uri)
}

async function openOrCreateTable(
  conversationId: string,
  sampleVector: number[],
): Promise<Table> {
  const db = await connectDb(conversationId)
  const names = await db.tableNames()
  if (names.includes(TABLE_NAME)) {
    return db.openTable(TABLE_NAME)
  }
  const seed: TurnMemoryRow = {
    turnId: '__seed__',
    conversationId,
    turnOrdinal: -1,
    vector: sampleVector,
  }
  const table = await db.createTable(TABLE_NAME, [rowToRecord(seed)])
  await table.delete('turnId = "__seed__"')
  return table
}

function toSqlString(s: string): string {
  return s.replace(/'/g, "''")
}

export async function upsertTurnMemoryVector(
  conversationId: string,
  row: TurnMemoryRow,
): Promise<void> {
  if (!row.vector.length) return
  const table = await openOrCreateTable(conversationId, row.vector)
  await table.delete(`turnId = '${toSqlString(row.turnId)}'`)
  await table.add([rowToRecord(row)])
}

export async function deleteTurnMemoryVector(
  conversationId: string,
  turnId: string,
): Promise<void> {
  const id = turnId.trim()
  if (!id) return
  const db = await connectDb(conversationId)
  const names = await db.tableNames()
  if (!names.includes(TABLE_NAME)) return
  const table = await db.openTable(TABLE_NAME)
  await table.delete(`turnId = '${toSqlString(id)}'`)
}

export async function deleteConversationMemoryIndex(
  conversationId: string,
): Promise<void> {
  const uri = memoryDbUri(conversationId)
  const db = await connectDb(conversationId)
  const names = await db.tableNames()
  if (!names.includes(TABLE_NAME)) return
  await db.dropTable(TABLE_NAME)
  closeLanceDb(uri)
}

export async function replaceConversationMemoryIndex(
  conversationId: string,
  rows: TurnMemoryRow[],
): Promise<void> {
  await deleteConversationMemoryIndex(conversationId)
  if (!rows.length) return
  const table = await openOrCreateTable(conversationId, rows[0]!.vector)
  await table.add(rows.map(rowToRecord))
}

export interface MemorySearchHit {
  turnId: string
  turnOrdinal: number
  score: number
}

/** 向量 TopK；score 为 Lance 返回的 _distance（越小越近，转为相似度展示） */
export async function searchTurnMemoryVectors(
  conversationId: string,
  queryVector: number[],
  topK: number,
  excludeTurnIds: Set<string> = new Set(),
  maxOrdinalExclusive?: number,
): Promise<MemorySearchHit[]> {
  if (!queryVector.length || topK < 1) return []
  const db = await connectDb(conversationId)
  const names = await db.tableNames()
  if (!names.includes(TABLE_NAME)) return []
  const table = await db.openTable(TABLE_NAME)
  const k = Math.min(64, Math.max(topK * 3, topK))
  const raw = await table
    .vectorSearch(queryVector)
    .limit(k)
    .toArray()
  const hits: MemorySearchHit[] = []
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
    hits.push({ turnId, turnOrdinal, score })
    if (hits.length >= topK) break
  }
  return hits
}
