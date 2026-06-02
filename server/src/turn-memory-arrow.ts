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

/** mergeInsert 要求 turnId 等非空；推断 schema 默认可空，须显式声明 */
export function turnMemorySchema(vectorDimensions: number): Schema {
  return new Schema([
    new Field('turnId', new Utf8(), false),
    new Field('conversationId', new Utf8(), false),
    new Field('turnOrdinal', new Int32(), false),
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
  conversationId: string,
): Promise<TurnMemoryRow[]> {
  const raw = await table.query().toArray()
  const rows: TurnMemoryRow[] = []
  for (const r of raw) {
    const turnId = String(r.turnId ?? '')
    if (!turnId || turnId === '__seed__') continue
    const vector = vectorToNumberArray(r.vector)
    if (!vector?.length) continue
    rows.push({
      turnId,
      conversationId: String(r.conversationId ?? conversationId),
      turnOrdinal: Number(r.turnOrdinal ?? 0),
      vector,
    })
  }
  return rows
}
