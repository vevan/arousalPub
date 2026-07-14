import { Index, type Table } from '@lancedb/lancedb'

export type ScalarIndexKind = 'btree' | 'bitmap'

type LanceIndexInfo = Awaited<ReturnType<Table['listIndices']>>[number]

export interface ScalarIndexSpec {
  column: string
  kind: ScalarIndexKind
}

export interface EnsureScalarIndexesOptions {
  /**
   * 召回路径用：建索引失败只 warn，不阻断 hybrid/vector 检索。
   * 写入路径保持默认（抛错）。
   */
  soft?: boolean
}

/** Memory `turn_memory`：预过滤 + mergeInsert 键 */
export const MEMORY_SCALAR_INDEX_SPECS: readonly ScalarIndexSpec[] = [
  { column: 'turnId', kind: 'btree' },
  { column: 'turnOrdinal', kind: 'btree' },
  { column: 'branchPath', kind: 'bitmap' },
]

/** 资料库 `lore_entries` */
export const LORE_SCALAR_INDEX_SPECS: readonly ScalarIndexSpec[] = [
  { column: 'entryId', kind: 'btree' },
  { column: 'lorebookId', kind: 'bitmap' },
]

function lanceIndexTypeForKind(kind: ScalarIndexKind): string {
  return kind === 'btree' ? 'BTree' : 'Bitmap'
}

function indexTypeMatches(
  indexType: string,
  kind: ScalarIndexKind,
): boolean {
  return (
    String(indexType).toLowerCase() ===
    lanceIndexTypeForKind(kind).toLowerCase()
  )
}

export function listHasScalarIndex(
  indices: readonly LanceIndexInfo[],
  column: string,
  kind: ScalarIndexKind,
): boolean {
  return indices.some(
    (idx) =>
      indexTypeMatches(idx.indexType, kind) &&
      Array.isArray(idx.columns) &&
      idx.columns.includes(column),
  )
}

export async function tableHasScalarIndex(
  table: Table,
  column: string,
  kind: ScalarIndexKind,
): Promise<boolean> {
  return listHasScalarIndex(await table.listIndices(), column, kind)
}

/** 缺则建；已存在同类型则跳过（不 replace，避免无谓重建） */
export async function ensureScalarIndexes(
  table: Table,
  specs: readonly ScalarIndexSpec[],
  options?: EnsureScalarIndexesOptions,
): Promise<void> {
  try {
    await ensureScalarIndexesUnsafe(table, specs)
  } catch (e) {
    if (options?.soft) {
      // eslint-disable-next-line no-console
      console.warn('[lance-scalar-index] ensure failed (soft):', e)
      return
    }
    throw e
  }
}

async function ensureScalarIndexesUnsafe(
  table: Table,
  specs: readonly ScalarIndexSpec[],
): Promise<void> {
  if (specs.length === 0) return
  let indices = await table.listIndices()
  for (const spec of specs) {
    if (listHasScalarIndex(indices, spec.column, spec.kind)) continue
    const config = spec.kind === 'btree' ? Index.btree() : Index.bitmap()
    await table.createIndex(spec.column, {
      config,
      replace: true,
      waitTimeoutSeconds: 120,
    })
    indices = await table.listIndices()
  }
}
