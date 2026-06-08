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
import type { Table as LanceTable } from '@lancedb/lancedb'
import { normalizeBranchPath, normalizeChunkBasename } from './chunk-path.js'

/** Memory v2 行；conversationId 由 Lance 库路径隐含 */
export interface TurnMemoryRow {
  turnId: string
  turnOrdinal: number
  branchPath: string
  chunkFileName: string
  vector: number[]
}

function rowToRecord(row: TurnMemoryRow): Record<string, unknown> {
  return {
    turnId: row.turnId,
    turnOrdinal: row.turnOrdinal,
    branchPath: normalizeBranchPath(row.branchPath),
    chunkFileName: normalizeChunkBasename(row.chunkFileName),
    vector: row.vector,
  }
}

/** mergeInsert 要求 turnId 等非空；推断 schema 默认可空，须显式声明 */
export function turnMemorySchema(vectorDimensions: number): Schema {
  return new Schema([
    new Field('turnId', new Utf8(), false),
    new Field('turnOrdinal', new Int32(), false),
    new Field('branchPath', new Utf8(), false),
    new Field('chunkFileName', new Utf8(), false),
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

export function rowsToTurnMemoryArrowTable(rows: TurnMemoryRow[]): ArrowTable {
  if (rows.length === 0) {
    throw new Error('rowsToTurnMemoryArrowTable requires at least one row')
  }
  const dim = rows[0]!.vector.length
  if (dim <= 0) {
    throw new Error('turn memory vector dimension must be positive')
  }
  for (const r of rows) {
    if (r.vector.length !== dim) {
      throw new Error('turn memory vector dimension mismatch within batch')
    }
  }
  return makeArrowTable(rows.map(rowToRecord), {
    schema: turnMemorySchema(dim),
  })
}

export async function isTurnIdNullable(table: LanceTable): Promise<boolean> {
  const schema = await table.schema()
  const turnIdField = schema.fields.find((f) => f.name === 'turnId')
  if (!turnIdField) return true
  return turnIdField.nullable !== false
}

function vectorToNumberArray(raw: unknown): number[] | null {
  if (raw instanceof Float32Array || raw instanceof Float64Array) {
    return Array.from(raw)
  }
  if (Array.isArray(raw)) {
    const out: number[] = []
    for (const x of raw) {
      const n = Number(x)
      if (!Number.isFinite(n)) return null
      out.push(n)
    }
    return out.length > 0 ? out : null
  }
  return null
}

/** 从 Lance 表读出全部 turn 行（跳过 seed） */
export async function readTurnMemoryRowsFromTable(
  table: LanceTable,
): Promise<TurnMemoryRow[]> {
  const raw = await table.query().toArray()
  const rows: TurnMemoryRow[] = []
  for (const r of raw) {
    const turnId = String(r.turnId ?? '')
    if (!turnId || turnId === '__seed__') continue
    const vector = vectorToNumberArray(r.vector)
    if (!vector?.length) continue
    let branchPath = ''
    let chunkFileName = ''
    try {
      branchPath = normalizeBranchPath(String(r.branchPath ?? ''))
      chunkFileName = normalizeChunkBasename(String(r.chunkFileName ?? ''))
    } catch {
      continue
    }
    rows.push({
      turnId,
      turnOrdinal: Number(r.turnOrdinal ?? 0),
      branchPath,
      chunkFileName,
      vector,
    })
  }
  return rows
}
