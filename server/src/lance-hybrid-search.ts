import { Index, rerankers, type Table } from '@lancedb/lancedb'

/** Memory Lance 表 FTS 列 */
export const MEMORY_FTS_COLUMN = 'corpus'

/** 资料库 vector Lance 表 FTS 列 */
export const LORE_FTS_COLUMN = 'text'

/** 中文（及中英混排）BM25：字符 n-gram，不用 English stemming */
export function chineseFtsIndexOptions() {
  return {
    baseTokenizer: 'ngram' as const,
    ngramMinLength: 2,
    ngramMaxLength: 3,
    lowercase: false,
    stem: false,
    removeStopWords: false,
    asciiFolding: false,
  }
}

let rrfRerankerPromise: Promise<rerankers.RRFReranker> | null = null

function sharedRrfReranker(): Promise<rerankers.RRFReranker> {
  if (!rrfRerankerPromise) {
    rrfRerankerPromise = rerankers.RRFReranker.create()
  }
  return rrfRerankerPromise
}

export async function tableHasFtsIndex(
  table: Table,
  column: string,
): Promise<boolean> {
  const indices = await table.listIndices()
  return indices.some(
    (idx) =>
      idx.indexType === 'FTS' &&
      Array.isArray(idx.columns) &&
      idx.columns.includes(column),
  )
}

/** 表重建或 bulk 写入后确保 BM25 FTS 索引存在 */
export async function ensureChineseFtsIndex(
  table: Table,
  column: string,
): Promise<void> {
  if (await tableHasFtsIndex(table, column)) return
  await table.createIndex(column, {
    config: Index.fts(chineseFtsIndexOptions()),
    replace: true,
    waitTimeoutSeconds: 120,
  })
}

export function hybridRelevanceScore(row: Record<string, unknown>): number {
  const rrf = Number(row._relevance_score)
  if (Number.isFinite(rrf)) return rrf
  const dist = Number(row._distance ?? 0)
  return 1 / (1 + dist)
}

export interface LanceHybridSearchParams {
  table: Table
  queryVector: number[]
  queryText: string
  textColumn: string
  limit: number
  whereClause?: string
}

/**
 * FTS + vector + RRF；失败或无 query 文本时回退纯向量检索。
 */
export async function runLanceHybridSearch(
  params: LanceHybridSearchParams,
): Promise<Record<string, unknown>[]> {
  const { table, queryVector, queryText, textColumn, limit, whereClause } =
    params
  if (!queryVector.length || limit < 1) return []

  const trimmedQuery = queryText.trim()
  if (trimmedQuery.length > 0 && (await tableHasFtsIndex(table, textColumn))) {
    try {
      const reranker = await sharedRrfReranker()
      let query = table
        .vectorSearch(queryVector)
        .fullTextSearch(trimmedQuery, { columns: textColumn })
        .rerank(reranker)
      if (whereClause) {
        query = query.where(whereClause)
      }
      return (await query.limit(limit).toArray()) as Record<string, unknown>[]
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[lance-hybrid-search] hybrid failed, falling back to vector:', e)
    }
  }

  let vectorQuery = table.vectorSearch(queryVector)
  if (whereClause) {
    vectorQuery = vectorQuery.where(whereClause)
  }
  return (await vectorQuery.limit(limit).toArray()) as Record<string, unknown>[]
}
