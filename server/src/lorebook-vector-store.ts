import path from 'node:path'
import { rm } from 'node:fs/promises'
import {
  Field,
  FixedSizeList,
  Float32,
  Schema,
  Utf8,
  type Table as ArrowTable,
} from 'apache-arrow'
import { makeArrowTable } from '@lancedb/lancedb'
import type { Table } from '@lancedb/lancedb'
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
  LORE_FTS_COLUMN,
  runLanceHybridSearch,
} from './lance-hybrid-search.js'
import {
  ensureScalarIndexes,
  LORE_SCALAR_INDEX_SPECS,
} from './lance-scalar-index.js'
import { readGlobalHybridFtsSettings } from './user-preferences-file.js'
import { languageModelHomeForSettings } from './hybrid-fts-dict.js'
import { getUserDataDir } from './config.js'
import { getCurrentUserId } from './user-context.js'

const TABLE_NAME = 'lore_entries'

/** Serialize Lance replace/rm/search for the same lorebook URI. */
const lorebookLanceQueue = createKeyedSerialQueue()

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

function loreEntryVectorSchema(vectorDimensions: number): Schema {
  return new Schema([
    new Field('entryId', new Utf8(), false),
    new Field('lorebookId', new Utf8(), false),
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

function rowsToLoreEntryVectorArrowTable(
  rows: LoreEntryVectorRow[],
): ArrowTable {
  if (rows.length === 0) {
    throw new Error('rowsToLoreEntryVectorArrowTable requires at least one row')
  }
  const dim = rows[0]!.vector.length
  if (dim <= 0) {
    throw new Error('lorebook vector dimension must be positive')
  }
  for (const r of rows) {
    if (r.vector.length !== dim) {
      throw new Error('lorebook vector dimension mismatch within batch')
    }
    if (r.vector.some((x) => !Number.isFinite(x))) {
      throw new Error('lorebook vector contains non-finite number')
    }
  }
  return makeArrowTable(rows.map(rowToRecord), {
    schema: loreEntryVectorSchema(dim),
  })
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

export async function replaceLorebookVectorIndex(
  lorebookId: string,
  rows: LoreEntryVectorRow[],
): Promise<void> {
  await lorebookLanceQueue.run(lorebookId, () =>
    replaceLorebookVectorIndexUnsafe(lorebookId, rows),
  )
}

async function replaceLorebookVectorIndexUnsafe(
  lorebookId: string,
  rows: LoreEntryVectorRow[],
): Promise<void> {
  const uri = lorebookDbUri(lorebookId)
  closeLanceDb(uri)
  await rm(uri, { recursive: true, force: true })
  if (!rows.length) {
    return
  }
  const db = await connectDb(lorebookId)
  const table = await db.createTable(
    TABLE_NAME,
    rowsToLoreEntryVectorArrowTable(rows),
  )
  const settings = await readGlobalHybridFtsSettings()
  await ensureHybridFtsIndex(
    table,
    LORE_FTS_COLUMN,
    settings,
    uri,
    getCurrentUserId(),
  )
  await ensureScalarIndexes(table, LORE_SCALAR_INDEX_SPECS)
}

export async function deleteLorebookVectorIndex(
  lorebookId: string,
): Promise<void> {
  await lorebookLanceQueue.run(lorebookId, () =>
    deleteLorebookVectorIndexUnsafe(lorebookId),
  )
}

async function deleteLorebookVectorIndexUnsafe(
  lorebookId: string,
): Promise<void> {
  const uri = lorebookDbUri(lorebookId)
  closeLanceDb(uri)
  await rm(uri, { recursive: true, force: true })
}

export interface LoreEntryVectorHit {
  entryId: string
  score: number
  scoreKind: 'rrf' | 'vector_fallback'
}

export async function searchLorebookEntryVectors(
  lorebookId: string,
  queryVector: number[],
  queryText: string,
  topK: number,
  excludeEntryIds: Set<string> = new Set(),
): Promise<LoreEntryVectorHit[]> {
  if (!queryVector.length || topK < 1) return []
  return lorebookLanceQueue.run(lorebookId, () =>
    searchLorebookEntryVectorsUnsafe(
      lorebookId,
      queryVector,
      queryText,
      topK,
      excludeEntryIds,
    ),
  )
}

async function searchLorebookEntryVectorsUnsafe(
  lorebookId: string,
  queryVector: number[],
  queryText: string,
  topK: number,
  excludeEntryIds: Set<string>,
): Promise<LoreEntryVectorHit[]> {
  const uri = lorebookDbUri(lorebookId)
  const db = await connectDb(lorebookId)
  const names = await listLanceTableNames(db, uri)
  if (!names.includes(TABLE_NAME)) return []
  const table = await openLanceTableWithManifestMigration(db, TABLE_NAME, uri)
  await ensureScalarIndexes(table, LORE_SCALAR_INDEX_SPECS, { soft: true })
  const k = Math.min(64, Math.max(topK * 3, topK))
  const settings = await readGlobalHybridFtsSettings()
  const userId = getCurrentUserId()
  const raw = await runLanceHybridSearch({
    table,
    queryVector,
    queryText,
    textColumn: LORE_FTS_COLUMN,
    limit: k,
    languageModelHome: languageModelHomeForSettings(userId, settings),
  })
  const hits: LoreEntryVectorHit[] = []
  for (const row of raw) {
    const entryId = String(row.entryId ?? '')
    if (!entryId || entryId === '__seed__' || excludeEntryIds.has(entryId)) {
      continue
    }
    hits.push({
      entryId,
      score: hybridRelevanceScore(row),
      scoreKind: hybridScoreKind(row),
    })
    if (hits.length >= topK) break
  }
  return hits
}
