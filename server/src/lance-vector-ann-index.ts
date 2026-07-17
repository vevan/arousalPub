import { Index, type Table } from '@lancedb/lancedb'

type LanceIndexInfo = Awaited<ReturnType<Table['listIndices']>>[number]

/** 知识库 `doc_chunks`：行数达到此阈值才建 IVF_PQ（未满保持 flat） */
export const KNOWLEDGE_ANN_ROW_THRESHOLD = 10_000

export const KNOWLEDGE_ANN_VECTOR_COLUMN = 'vector'

/** IVF_PQ 召回补偿：取 refineFactor×limit 候选按真实距离重排（无 ANN 索引时 Lance 忽略） */
export const KNOWLEDGE_ANN_REFINE_FACTOR = 2

export interface EnsureIvfPqIndexOptions {
  /** 已知行数；省略则 `table.countRows()` */
  rowCount?: number
  /** 默认 {@link KNOWLEDGE_ANN_ROW_THRESHOLD}；单测可注入更小阈值 */
  threshold?: number
  /**
   * 失败只 warn、不抛错。ANN 仅是加速层：写入路径以 soft 调用，
   * 失败降级 flat 搜索（数据仍可召回）；召回路径**不应**懒建（训练重）。
   */
  soft?: boolean
  /** 建索等待上限（秒）；默认 600 */
  waitTimeoutSeconds?: number
}

function normalizeIvfPqType(indexType: string): string {
  return String(indexType).toLowerCase().replace(/[_-]/g, '')
}

/** `IvfPq` / `IVF_PQ` / `IVF-PQ` 等均视为 IVF_PQ */
export function isIvfPqIndexType(indexType: string): boolean {
  return normalizeIvfPqType(indexType) === 'ivfpq'
}

export function listHasIvfPqIndex(
  indices: readonly LanceIndexInfo[],
  column: string,
): boolean {
  return indices.some(
    (idx) =>
      isIvfPqIndexType(idx.indexType) &&
      Array.isArray(idx.columns) &&
      idx.columns.includes(column),
  )
}

export async function tableHasIvfPqIndex(
  table: Table,
  column: string,
): Promise<boolean> {
  return listHasIvfPqIndex(await table.listIndices(), column)
}

/**
 * 行数达到阈值且尚无 IVF_PQ 时建索；已存在则跳过（不 replace，避免无谓重训）。
 */
export async function ensureIvfPqIndex(
  table: Table,
  column: string,
  options?: EnsureIvfPqIndexOptions,
): Promise<boolean> {
  try {
    return await ensureIvfPqIndexUnsafe(table, column, options)
  } catch (e) {
    if (options?.soft) {
      // eslint-disable-next-line no-console
      console.warn('[lance-vector-ann-index] ensure failed (soft):', e)
      return false
    }
    throw e
  }
}

async function ensureIvfPqIndexUnsafe(
  table: Table,
  column: string,
  options?: EnsureIvfPqIndexOptions,
): Promise<boolean> {
  const threshold =
    typeof options?.threshold === 'number' &&
    Number.isFinite(options.threshold)
      ? Math.max(1, Math.floor(options.threshold))
      : KNOWLEDGE_ANN_ROW_THRESHOLD
  const rowCount =
    typeof options?.rowCount === 'number' && Number.isFinite(options.rowCount)
      ? Math.max(0, Math.floor(options.rowCount))
      : await table.countRows()
  if (rowCount < threshold) return false

  const indices = await table.listIndices()
  if (listHasIvfPqIndex(indices, column)) return false

  const waitTimeoutSeconds = Math.max(
    1,
    options?.waitTimeoutSeconds ?? 600,
  )
  await table.createIndex(column, {
    config: Index.ivfPq({ distanceType: 'l2' }),
    replace: true,
    waitTimeoutSeconds,
  })
  return true
}
